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
- **The API key** goes from the browser to your local backend in each request. It isn't stored
  anywhere.
