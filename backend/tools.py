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

# ---- 1. Definitions sent to Claude ------------------------------------------
TOOLS = [
    {
        "name": "get_latest_stock_price",
        "description": (
            "Get the latest traded price of a stock. Accepts a company name "
            "(e.g. 'Apple', 'Tata Motors') or a ticker symbol (e.g. 'MSFT'). "
            "Returns the resolved ticker, company name, price, currency and exchange. "
            "Use this whenever the user asks about a current stock price; "
            "never guess prices from memory."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "stock_name": {
                    "type": "string",
                    "description": "Company name or ticker symbol of the stock.",
                }
            },
            "required": ["stock_name"],
        },
        # Stream the tool's input as Claude generates it (see app.py).
        "eager_input_streaming": True,
    }
]

# Quote types we treat as "a stock" when resolving a name to a ticker.
_STOCK_TYPES = {"EQUITY", "ETF"}


# ---- 2. Python implementations ----------------------------------------------
def get_latest_stock_price(stock_name: str) -> dict:
    """Resolve a company name or ticker to a symbol and fetch its last price."""
    quotes = yf.Search(stock_name, max_results=5).quotes
    match = next((q for q in quotes if q.get("quoteType") in _STOCK_TYPES), None)
    if match is None:
        raise ValueError(f"No stock found matching '{stock_name}'.")

    symbol = match["symbol"]
    info = yf.Ticker(symbol).fast_info
    price = info.last_price
    if price is None:
        raise ValueError(f"No price data available for {symbol}.")

    return {
        "symbol": symbol,
        "name": match.get("longname") or match.get("shortname") or symbol,
        "price": round(float(price), 2),
        "currency": info.currency,
        "exchange": match.get("exchDisp") or info.exchange,
        "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


_FUNCTIONS = {
    "get_latest_stock_price": get_latest_stock_price,
}


def run_tool(name: str, tool_input: object) -> tuple[str, bool]:
    """Run a tool by name. Returns (result_text, is_error).

    Errors are returned to Claude (not raised) so it can explain the problem
    to the user or try again with a different input.
    """
    func = _FUNCTIONS.get(name)
    if func is None:
        return f"Unknown tool: {name}", True

    # Validate the input ourselves: with eager input streaming the API does
    # not validate it against the schema.
    if not (isinstance(tool_input, dict) and isinstance(tool_input.get("stock_name"), str)
            and tool_input["stock_name"].strip()):
        return f"Invalid input, expected {{'stock_name': <non-empty string>}}: {json.dumps(tool_input)}", True

    try:
        return json.dumps(func(tool_input["stock_name"].strip())), False
    except Exception as e:  # network errors, unknown symbols, etc.
        return f"Tool failed: {e}", True
