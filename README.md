# ClaudeAgenticCourse

## 01 – Claude Chat Bot

A simple chat bot: a **Python (FastAPI)** backend that calls Claude through the official
`anthropic` SDK, and a **Vite** frontend in plain JavaScript.

```
browser (Vite, :5173) ──/api/*──▶ FastAPI (:8000) ──anthropic SDK──▶ Claude API
```

### Run it

Backend (first time: create the venv and install):

```bash
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app:app --reload --port 8000
```

Frontend (in a second terminal):

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, pick a model, paste your API key (from
https://platform.claude.com/settings/keys) and start chatting.

### Key ideas

- **The API is stateless.** The frontend keeps the whole `history` array and sends it on
  every request; that's how Claude "remembers" the conversation.
- **Streaming.** `client.messages.stream(...)` yields text as it's generated; FastAPI passes it
  to the browser through a `StreamingResponse`, and the browser reads it chunk by chunk.
- **Refusal fallbacks.** For Opus 5.5 / Sonnet 5.5 / Fable 5.1 the backend sets
  `fallbacks="default"`, so the API reruns a declined request on another model.
- **Tools (the agent loop).** `backend/tools.py` defines `get_latest_stock_price(stock_name)`
  (live prices via `yfinance`). Claude replies with a `tool_use` block, the backend runs the
  function, sends back a `tool_result`, and loops until Claude gives a final answer. The UI
  shows each tool call as a dashed bubble. Try: "What's the price of Apple and Microsoft?"
- **`get_historical_stock_prices(stock_name, interval, date_range)`** returns one closing price
  per `interval` (`1h`, `1d`, `1wk`, `1mo`, `3mo`) over the last `date_range` (`5d` … `10y`,
  `ytd`, `max`). Enums in the schema keep Claude's inputs valid; results are capped at 500
  points, and the error tells Claude to retry with a coarser interval.
  Try: "How has Tesla done over the past 2 years, monthly?"
- **Full history round-trip.** The backend returns the whole conversation in API format
  (including tool calls and thinking blocks) and the browser sends it back unchanged next
  turn, so Claude remembers the tool results it saw.
- **The API key** goes from the browser to your local backend in each request. It isn't stored
  anywhere.
