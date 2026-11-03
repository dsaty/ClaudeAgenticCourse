import "./style.css";

const EYE_OPEN = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_CLOSED = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

const modelSelect = document.getElementById("model");
const keyInput = document.getElementById("api-key");
const toggleKeyBtn = document.getElementById("toggle-key");
const messagesEl = document.getElementById("messages");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const clearBtn = document.getElementById("clear");

// The whole conversation is kept here and sent with every request,
// because the Claude API is stateless: it only knows what you send it.
let history = [];
let busy = false;

// ---- Model dropdown --------------------------------------------------------
async function loadModels() {
  try {
    const res = await fetch("/api/models");
    const models = await res.json();
    modelSelect.innerHTML = models
      .map((m) => `<option value="${m.id}">${m.label}</option>`)
      .join("");
  } catch {
    modelSelect.innerHTML = `<option value="">Backend not reachable</option>`;
  }
}

// ---- API key show / hide ---------------------------------------------------
function setKeyVisible(visible) {
  keyInput.type = visible ? "text" : "password";
  toggleKeyBtn.innerHTML = visible ? EYE_CLOSED : EYE_OPEN;
  const label = visible ? "Hide API key" : "Show API key";
  toggleKeyBtn.setAttribute("aria-label", label);
  toggleKeyBtn.title = label;
}
toggleKeyBtn.addEventListener("click", () => setKeyVisible(keyInput.type === "password"));
setKeyVisible(false);

// ---- Chat rendering --------------------------------------------------------
function addBubble(role, text = "") {
  messagesEl.querySelector(".empty")?.remove();
  const bubble = document.createElement("div");
  bubble.className = `bubble ${role}`;
  bubble.textContent = text; // textContent, never innerHTML: model output is untrusted
  messagesEl.appendChild(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

function setBusy(value) {
  busy = value;
  sendBtn.disabled = value;
  sendBtn.textContent = value ? "..." : "Send";
}

// ---- Sending a message -----------------------------------------------------
async function sendMessage() {
  const text = input.value.trim();
  if (!text || busy) return;

  if (!keyInput.value.trim()) {
    addBubble("error", "Please enter your Claude API key first.");
    return;
  }

  input.value = "";
  autoGrow();
  addBubble("user", text);
  history.push({ role: "user", content: text });

  const reply = addBubble("assistant");
  reply.classList.add("typing");
  setBusy(true);

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: keyInput.value,
        model: modelSelect.value,
        messages: history,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Request failed (${res.status})`);
    }

    // Read the streamed response chunk by chunk so text appears as it's written.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      full += decoder.decode(value, { stream: true });
      reply.textContent = full;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    if (full.startsWith("[Error]")) {
      reply.className = "bubble error";
      history.pop(); // drop the failed user turn so the user can retry
    } else {
      history.push({ role: "assistant", content: full });
    }
  } catch (e) {
    reply.className = "bubble error";
    reply.textContent = e.message;
    history.pop();
  } finally {
    reply.classList.remove("typing");
    setBusy(false);
    input.focus();
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage();
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function autoGrow() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 200) + "px";
}
input.addEventListener("input", autoGrow);

clearBtn.addEventListener("click", () => {
  if (busy) return;
  history = [];
  messagesEl.innerHTML = `<div class="empty">New chat started. Say hello.</div>`;
});

loadModels();
