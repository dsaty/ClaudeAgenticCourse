"""Tools the chat bot can call.

A tool has two halves:
  1. A *definition* (name, description, JSON schema) that is sent to Claude so it
     knows the tool exists and how to call it.
  2. A *Python function* that actually does the work when Claude asks for it.
Claude never runs code itself: it replies with a `tool_use` block, our backend
runs the function, and we send the result back in a `tool_result` block.
"""

import json
import warnings
from datetime import datetime, timezone

import yfinance as yf

# yfinance emits noisy pandas deprecation warnings; they don't affect results.
warnings.filterwarnings("ignore", module="yfinance")

INTERVALS = ["1h", "1d", "1wk", "1mo", "3mo"]
DATE_RANGES = ["5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "ytd", "max"]
# Yahoo only serves hourly data for roughly the last 730 days.
HOURLY_RANGES = {"5d", "1mo", "3mo", "6mo", "1y", "ytd"}
# Keep tool results small enough for Claude to read comfortably.
MAX_POINTS = 500

STOCK_NAME_PARAM = {
    "type": "string",
    "description": "Company name (e.g. 'Apple', 'Tata Motors') or ticker symbol (e.g. 'MSFT').",
}

# ---- 1. Definitions sent to Claude ------------------------------------------
TOOLS = [
    {
        "name": "get_latest_stock_price",
        "description": (
            "Get the latest traded price of a stock. Accepts a company name or ticker symbol. "
            "Returns the resolved ticker, company name, price, currency and exchange. "
            "Use this whenever the user asks about a current stock price; "
            "never guess prices from memory."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"stock_name": STOCK_NAME_PARAM},
            "required": ["stock_name"],
        },
        # Stream the tool's input as Claude generates it (see app.py).
        "eager_input_streaming": True,
    },
    {
        "name": "get_historical_stock_prices",
        "description": (
            "Get historical closing prices of a stock: one closing price per `interval`, "
            "covering the last `date_range` up to today. Use this for trends, performance "
            "over a period, highs/lows, or comparisons over time. "
            f"Hourly ('1h') data is only available for date ranges up to 1 year. "
            f"At most {MAX_POINTS} prices are returned; pick a coarser interval for long ranges "
            "(e.g. '1wk' or '1mo' for 5y or more)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "stock_name": STOCK_NAME_PARAM,
                "interval": {
                    "type": "string",
                    "enum": INTERVALS,
                    "description": "Spacing between closing prices: 1h = hourly, 1d = daily, "
                                   "1wk = weekly, 1mo = monthly, 3mo = quarterly.",
                },
                "date_range": {
                    "type": "string",
                    "enum": DATE_RANGES,
                    "description": "How far back to go from today: d = days, mo = months, y = years, "
                                   "ytd = since Jan 1 this year, max = all available history.",
                },
            },
            "required": ["stock_name", "interval", "date_range"],
        },
        "eager_input_streaming": True,
    },
]

# Quote types we treat as "a stock" when resolving a name to a ticker.
_STOCK_TYPES = {"EQUITY", "ETF"}


# ---- 2. Python implementations ----------------------------------------------
def _resolve_stock(stock_name: str) -> dict:
    """Turn a company name or ticker into a Yahoo search match (symbol, name, exchange)."""
    quotes = yf.Search(stock_name, max_results=5).quotes
    match = next((q for q in quotes if q.get("quoteType") in _STOCK_TYPES), None)
    if match is None:
        raise ValueError(f"No stock found matching '{stock_name}'.")
    return match


def _display_name(match: dict) -> str:
    return match.get("longname") or match.get("shortname") or match["symbol"]


def get_latest_stock_price(stock_name: str) -> dict:
    """Resolve a company name or ticker to a symbol and fetch its last price."""
    match = _resolve_stock(stock_name)
    symbol = match["symbol"]
    info = yf.Ticker(symbol).fast_info
    price = info.last_price
    if price is None:
        raise ValueError(f"No price data available for {symbol}.")

    return {
        "symbol": symbol,
        "name": _display_name(match),
        "price": round(float(price), 2),
        "currency": info.currency,
        "exchange": match.get("exchDisp") or info.exchange,
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def get_historical_stock_prices(stock_name: str, interval: str, date_range: str) -> dict:
    """Fetch one closing price per `interval` over the last `date_range`."""
    if interval == "1h" and date_range not in HOURLY_RANGES:
        raise ValueError(
            "Hourly data is only available for date ranges up to 1 year. "
            "Use a shorter date_range or a coarser interval."
        )

    match = _resolve_stock(stock_name)
    symbol = match["symbol"]
    ticker = yf.Ticker(symbol)
    history = ticker.history(period=date_range, interval=interval)
    if history.empty:
        raise ValueError(f"No historical data for {symbol} with interval={interval}, date_range={date_range}.")
    if len(history) > MAX_POINTS:
        raise ValueError(
            f"That would return {len(history)} prices (limit {MAX_POINTS}). "
            "Use a coarser interval or a shorter date_range."
        )

    date_format = "%Y-%m-%d %H:%M" if interval == "1h" else "%Y-%m-%d"
    closes = [
        {"date": ts.strftime(date_format), "close": round(float(close), 2)}
        for ts, close in history["Close"].items()
    ]
    return {
        "symbol": symbol,
        "name": _display_name(match),
        "currency": ticker.fast_info.currency,
        "interval": interval,
        "date_range": date_range,
        "count": len(closes),
        "closes": closes,
    }


_FUNCTIONS = {
    "get_latest_stock_price": get_latest_stock_price,
    "get_historical_stock_prices": get_historical_stock_prices,
}
_SCHEMAS = {tool["name"]: tool["input_schema"] for tool in TOOLS}


def _validate(schema: dict, tool_input: object) -> str | None:
    """Check the input against the tool's schema. Returns an error message, or None if valid.

    We validate ourselves because, with eager input streaming, the API does not.
    (All our parameters are strings, which keeps this check simple.)
    """
    if not isinstance(tool_input, dict):
        return "Input must be a JSON object."
    for key in schema["required"]:
        value = tool_input.get(key)
        if not isinstance(value, str) or not value.strip():
            return f"'{key}' must be a non-empty string."
    for key, prop in schema["properties"].items():
        if "enum" in prop and key in tool_input and tool_input[key] not in prop["enum"]:
            return f"'{key}' must be one of {prop['enum']}, got {tool_input[key]!r}."
    unknown = set(tool_input) - set(schema["properties"])
    if unknown:
        return f"Unknown parameter(s): {sorted(unknown)}."
    return None


def run_tool(name: str, tool_input: object) -> tuple[str, bool]:
    """Run a tool by name. Returns (result_text, is_error).

    Errors are returned to Claude (not raised) so it can explain the problem
    to the user or try again with a different input.
    """
    func = _FUNCTIONS.get(name)
    if func is None:
        return f"Unknown tool: {name}", True

    error = _validate(_SCHEMAS[name], tool_input)
    if error:
        return f"Invalid input: {error} Received: {json.dumps(tool_input)}", True

    try:
        args = {k: v.strip() for k, v in tool_input.items()}
        return json.dumps(func(**args)), False
    except Exception as e:  # network errors, unknown symbols, etc.
        return f"Tool failed: {e}", True
