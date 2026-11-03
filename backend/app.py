"""Chat bot backend: a thin FastAPI layer between the Vite UI and the Claude API.

Run with:  uvicorn app:app --reload --port 8000
"""

import json
from typing import Any

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from tools import TOOLS, run_tool

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

SYSTEM_PROMPT = (
    "You are a friendly, helpful assistant. Answer clearly and concisely. "
    "When you report a stock price, mention the ticker, currency and that it is the latest traded price."
)

# Safety net so a confused model can't loop on tool calls forever.
MAX_TOOL_ROUNDS = 10


class ChatRequest(BaseModel):
    api_key: str
    model: str
    # The full conversation in Claude API format, exactly as the backend returned
    # it last time (text, tool_use, tool_result and thinking blocks included),
    # plus the new user message at the end.
    messages: list[dict[str, Any]]


@app.get("/api/models")
def list_models():
    return MODELS


def event(**fields) -> str:
    """One newline-delimited JSON event for the browser."""
    return json.dumps(fields) + "\n"


def open_stream(client: anthropic.Anthropic, model: str, messages: list):
    params = dict(
        model=model,
        max_tokens=64000,
        system=SYSTEM_PROMPT,
        tools=TOOLS,
        messages=messages,
    )
    if model in FALLBACK_MODELS:
        return client.beta.messages.stream(
            **params,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    return client.messages.stream(**params)


@app.post("/api/chat")
def chat(req: ChatRequest):
    if not req.api_key.strip():
        raise HTTPException(status_code=400, detail="Please enter your Claude API key.")
    if req.model not in MODEL_IDS:
        raise HTTPException(status_code=400, detail=f"Unknown model: {req.model}")
    if not req.messages or req.messages[-1].get("role") != "user":
        raise HTTPException(status_code=400, detail="The last message must come from the user.")

    client = anthropic.Anthropic(api_key=req.api_key.strip())

    def generate():
        """The agent loop: call Claude, run any tools it asks for, repeat until it answers."""
        messages = list(req.messages)
        try:
            rounds = 0
            json_retries = 0
            while True:
                try:
                    with open_stream(client, req.model, messages) as stream:
                        for ev in stream:
                            if ev.type == "text":
                                yield event(type="text", text=ev.text)
                        response = stream.get_final_message()
                    json_retries = 0
                except ValueError:
                    # With eager input streaming, the SDK raises ValueError if a tool
                    # input is unparseable JSON. Re-run the turn a couple of times.
                    json_retries += 1
                    if json_retries > 2:
                        raise
                    continue

                # Keep Claude's whole reply (thinking, text and tool_use blocks), unchanged.
                # Later requests must replay it exactly, or its thinking blocks become invalid.
                messages.append({
                    "role": "assistant",
                    "content": [b.model_dump(mode="json", exclude_none=True) for b in response.content],
                })

                tool_uses = [b for b in response.content if b.type == "tool_use"]

                if response.stop_reason == "refusal":
                    yield event(type="notice", text="The model declined to answer this request.")
                    break
                if response.stop_reason == "max_tokens":
                    if tool_uses:
                        # A tool call cut off mid-input can't be run safely.
                        yield event(type="error", text="The response was cut off in the middle of a tool call.")
                        return
                    yield event(type="notice", text="Response was cut off: maximum length reached.")
                    break
                if not tool_uses:
                    break  # Claude gave its final answer.

                rounds += 1
                if rounds > MAX_TOOL_ROUNDS:
                    yield event(type="error", text="Stopped: too many tool calls in one turn.")
                    return

                # Run every requested tool and return ALL results in ONE user message.
                results = []
                for block in tool_uses:
                    yield event(type="tool_call", id=block.id, name=block.name, input=block.input)
                    output, is_error = run_tool(block.name, block.input)
                    yield event(type="tool_result", id=block.id, output=output, is_error=is_error)
                    results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": output,
                        "is_error": is_error,
                    })
                messages.append({"role": "user", "content": results})

            # Send the updated conversation back so the browser can resend it next time.
            yield event(type="done", messages=messages)

        # Most specific errors first, so the user gets a useful message.
        except anthropic.AuthenticationError:
            yield event(type="error", text="Invalid API key. Check the key and try again.")
        except anthropic.PermissionDeniedError:
            yield event(type="error", text="This API key does not have access to the selected model.")
        except anthropic.NotFoundError:
            yield event(type="error", text="Model not found for this account.")
        except anthropic.RateLimitError:
            yield event(type="error", text="Rate limit reached. Wait a moment and try again.")
        except anthropic.APIStatusError as e:
            yield event(type="error", text=f"Claude API returned {e.status_code}: {e.message}")
        except anthropic.APIConnectionError:
            yield event(type="error", text="Could not reach the Claude API. Check your internet connection.")
        except ValueError:
            yield event(type="error", text="Claude produced an invalid tool call. Please try again.")

    return StreamingResponse(generate(), media_type="application/x-ndjson")
