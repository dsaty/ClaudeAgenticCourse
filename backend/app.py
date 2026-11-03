"""Chat bot backend: a thin FastAPI layer between the Vite UI and the Claude API.

Run with:  uvicorn app:app --reload --port 8000
"""

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="Claude Chat Bot")

# Models offered in the UI dropdown. The first one is the default.
MODELS = [
    {"id": "claude-opus-5-5", "label": "Claude Opus 5.5"},
    {"id": "claude-sonnet-5-5", "label": "Claude Sonnet 5.5"},
    {"id": "claude-haiku-5-5", "label": "Claude Haiku 5.5"},
    {"id": "claude-fable-5-1", "label": "Claude Fable 5.1"},
]
MODEL_IDS = {m["id"] for m in MODELS}

# These models can decline a request via safety classifiers. With server-side
# fallbacks enabled, the API re-runs a declined request on a suitable model
# instead of just returning the refusal.
FALLBACK_MODELS = {"claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1"}

SYSTEM_PROMPT = "You are a friendly, helpful assistant. Answer clearly and concisely."


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    api_key: str
    model: str
    messages: list[ChatMessage]


@app.get("/api/models")
def list_models():
    return MODELS


@app.post("/api/chat")
def chat(req: ChatRequest):
    if not req.api_key.strip():
        raise HTTPException(status_code=400, detail="Please enter your Claude API key.")
    if req.model not in MODEL_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown model: {req.model}")
    if not req.messages or req.messages[-1].role != "user":
        raise HTTPException(status_code=400, detail="The last message must come from the user.")

    client = anthropic.Anthropic(api_key=req.api_key.strip())
    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    def generate():
        """Yield the reply text piece by piece as Claude produces it."""
        params = dict(
            model=req.model,
            max_tokens=64000,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        try:
            if req.model in FALLBACK_MODELS:
                stream_ctx = client.beta.messages.stream(
                    **params,
                    betas=["server-side-fallback-2026-07-01"],
                    fallbacks="default",
                )
            else:
                stream_ctx = client.messages.stream(**params)

            with stream_ctx as stream:
                for text in stream.text_stream:
                    yield text
                final = stream.get_final_message()

            if final.stop_reason == "refusal":
                yield "\n\n[The model declined to answer this request.]"
            elif final.stop_reason == "max_tokens":
                yield "\n\n[Response was cut off: maximum length reached.]"

        # Most specific errors first, so the user gets a useful message.
        except anthropic.AuthenticationError:
            yield "[Error] Invalid API key. Check the key and try again."
        except anthropic.PermissionDeniedError:
            yield "[Error] This API key does not have access to the selected model."
        except anthropic.NotFoundError:
            yield "[Error] Model not found for this account."
        except anthropic.RateLimitError:
            yield "[Error] Rate limit reached. Wait a moment and try again."
        except anthropic.APIStatusError as e:
            yield f"[Error] Claude API returned {e.status_code}: {e.message}"
        except anthropic.APIConnectionError:
            yield "[Error] Could not reach the Claude API. Check your internet connection."

    return StreamingResponse(generate(), media_type="text/plain; charset=utf-8")
