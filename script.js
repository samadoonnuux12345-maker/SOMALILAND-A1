
const $ = (selector) => document.querySelector(selector);

const els = {
  sidebar: $("#sidebar"),
  messages: $("#messages"),
  welcome: $("#welcomeScreen"),
  input: $("#messageInput"),
  form: $("#chatForm"),
  send: $("#sendBtn"),
  history: $("#chatHistory"),
  model: $("#modelSelect"),
  toast: $("#toast"),
  preview: $("#imagePreview"),
  imageInput: $("#imageInput"),
  status: $("#connectionStatus")
};

let messages = [];
let chats = [];
let currentChatId = null;
let busy = false;
let selectedImage = null;
let recognition = null;
let currentReader = null;

function toast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.hidden = true, 3200);
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function markdown(text) {
  let safe = escapeHTML(text);
  const blocks = [];

  safe = safe.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_, language, code) => {
    const id = blocks.length;
    blocks.push(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
    return `@@CODE${id}@@`;
  });

  safe = safe.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  safe = safe.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/\*(.*?)\*/g, "<em>$1</em>");
  safe = safe.replace(/^\s*[-*]\s+(.+)$/gm, "• $1");
  safe = safe.replace(/^\s*(\d+)\.\s+(.+)$/gm, "$1. $2");
  safe = safe.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  safe = safe.replace(/\n/g, "<br>");
  safe = safe.replace(/@@CODE(\d+)@@/g, (_, id) => blocks[Number(id)] || "");

  return safe;
}

function saveStorage() {
  try {
    localStorage.setItem("somaliland-ai-chats", JSON.stringify(chats.slice(-40)));
    localStorage.setItem("somaliland-ai-current", currentChatId || "");
  } catch {
    toast("Browser storage is full. Some chat history may not be saved.");
  }
}

function renderHistory() {
  els.history.replaceChildren();

  if (!chats.length) {
    const p = document.createElement("p");
    p.className = "empty-history";
    p.textContent = "Your conversations will appear here.";
    els.history.appendChild(p);
    return;
  }

  [...chats].reverse().forEach(chat => {
    const button = document.createElement("button");
    button.className = "history-item" + (chat.id === currentChatId ? " selected" : "");
    button.textContent = chat.title || "New conversation";
    button.title = chat.title || "New conversation";
    button.addEventListener("click", () => openChat(chat.id));
    els.history.appendChild(button);
  });
}

function storeCurrentChat() {
  if (!messages.length) return;

  if (!currentChatId) {
    currentChatId = makeId();
    const first = messages.find(m => m.role === "user");
    chats.push({
      id: currentChatId,
      title: (first?.content || "New chat").slice(0, 42),
      messages: []
    });
  }

  const chat = chats.find(c => c.id === currentChatId);
  if (chat) {
    chat.messages = messages.map(m => ({
      role: m.role,
      content: m.content,
      model: m.model || ""
    }));
  }

  saveStorage();
  renderHistory();
}



function renderMessages() {
  els.messages.replaceChildren();
  els.welcome.hidden = messages.length > 0;

  messages.forEach((message, index) => {
    const row = document.createElement("article");
    row.className = `message ${message.role}`;

    const content = document.createElement("div");
    content.className = "message-content";

    const label = document.createElement("div");
    label.className = "message-label";
    label.textContent =
      message.role === "user" ? "YOU" : "✦ SOMALILAND AI";

    const body = document.createElement("div");
    body.className = "message-body";
    body.innerHTML = markdown(
      message.content ||
      (message.role === "assistant" ? "Thinking… 🤔" : "")
    );

    // Add a copy button above every code block
    body.querySelectorAll("pre").forEach(pre => {
      const wrapper = document.createElement("div");
      wrapper.className = "code-wrapper";
      pre.before(wrapper);
      wrapper.appendChild(pre);

      const codeCopy = document.createElement("button");
      codeCopy.type = "button";
      codeCopy.className = "copy-code-btn";
      codeCopy.textContent = "▢";
      codeCopy.title = "Copy code";

      codeCopy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(
            pre.querySelector("code")?.innerText || pre.innerText
          );
          codeCopy.textContent = "✓";
          toast("Code copied!");
          setTimeout(() => codeCopy.textContent = "▢", 1500);
        } catch {
          toast("Unable to copy code.");
        }
      });

      wrapper.prepend(codeCopy);
    });

    content.append(label, body);

    // Only AI messages get response action buttons
    if (message.role === "assistant" && message.content) {
      const actions = document.createElement("div");
      actions.className = "message-actions";

      function action(symbol, title, handler) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "response-action";
        button.textContent = symbol;
        button.title = title;
        button.setAttribute("aria-label", title);
        button.addEventListener("click", handler);
        actions.appendChild(button);
        return button;
      }

      action("▢", "Copy", async event => {
        const button = event.currentTarget;
        try {
          await navigator.clipboard.writeText(message.content);
          button.textContent = "✓";
          toast("Copied!");
          setTimeout(() => button.textContent = "▢", 1500);
        } catch {
          toast("Unable to copy answer.");
        }
      });

      let feedback = "";
      const like = action("👍", "Good response", () => {
        feedback = feedback === "like" ? "" : "like";
        like.classList.toggle("selected", feedback === "like");
        dislike.classList.toggle("selected", feedback === "dislike");
        toast("Thanks for your feedback!");
      });

      const dislike = action("👎", "Bad response", () => {
        feedback = feedback === "dislike" ? "" : "dislike";
        dislike.classList.toggle("selected", feedback === "dislike");
        like.classList.toggle("selected", feedback === "like");
        toast("Thanks for your feedback!");
      });

      action("↥", "Share", async () => {
        try {
          if (navigator.share) {
            await navigator.share({
              title: "Somaliland AI",
              text: message.content
            });
          } else {
            await navigator.clipboard.writeText(message.content);
            toast("Answer copied for sharing.");
          }
        } catch (error) {
          if (error.name !== "AbortError") toast("Unable to share.");
        }
      });

      action("🔊", "Read aloud", () => speakText(message.content));

      action("⟳", "Regenerate", () => {
        if (busy) {
          toast("Wait for the current answer to finish.");
          return;
        }

        const previousUser = messages
          .slice(0, index)
          .reverse()
          .find(item => item.role === "user");

        if (!previousUser) return;

        const previousText = previousUser.content;
        messages = messages.slice(0, index);
        sendMessage(previousText);
      });

      action("•••", "More", () => {
        const choice = prompt(
          "1 = Copy answer\n2 = Read aloud\n3 = Share answer"
        );

        if (choice === "1") {
          navigator.clipboard.writeText(message.content)
            .then(() => toast("Copied!"))
            .catch(() => toast("Unable to copy."));
        } else if (choice === "2") {
          speakText(message.content);
        } else if (choice === "3") {
          if (navigator.share) {
            navigator.share({
              title: "Somaliland AI",
              text: message.content
            }).catch(() => {});
          } else {
            navigator.clipboard.writeText(message.content)
              .then(() => toast("Copied for sharing."))
              .catch(() => toast("Unable to copy."));
          }
        }
      });

      content.appendChild(actions);
    }

    row.appendChild(content);
    els.messages.appendChild(row);
  });

  window.requestAnimationFrame(() => {
    const scroll = $("#chatScroll");
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  });
}

function openChat(id) {
  if (busy) {
    toast("Wait for the current answer to finish.");
    return;
  }

  const chat = chats.find(c => c.id === id);
  if (!chat) return;

  currentChatId = id;
  messages = chat.messages.map(m => ({ ...m }));
  renderMessages();
  renderHistory();
  els.sidebar.classList.remove("open");
}

function newChat() {
  if (busy) {
    toast("Wait for the current answer to finish.");
    return;
  }

  storeCurrentChat();
  messages = [];
  currentChatId = null;
  selectedImage = null;
  els.input.value = "";
  els.imageInput.value = "";
  els.preview.replaceChildren();
  els.messages.replaceChildren();
  els.welcome.hidden = false;
  renderHistory();
  els.input.focus();
}

function speakText(text) {
  if (!("speechSynthesis" in window)) {
    toast("Speech playback is not supported by this browser.");
    return;
  }

  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  speechSynthesis.speak(utterance);
}

async function checkHealth() {
  try {
    const response = await fetch("/api/health");
    const data = await response.json();

    els.status.innerHTML = data.ok
      ? '<i style="background:#54d6a0"></i> AI online'
      : '<i style="background:#ee727c"></i> Ollama offline';

    if (!data.ok) els.status.title = data.message || "Start Ollama first.";
  } catch {
    els.status.innerHTML = '<i style="background:#ee727c"></i> Server offline';
  }
}

async function loadModels() {
  try {
    const response = await fetch("/api/models");
    const data = await response.json();
    if (!data.models?.length) return;

    const previous = els.model.value;
    els.model.replaceChildren();

    data.models.forEach(name => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      els.model.appendChild(option);
    });

    if (data.models.includes(previous)) els.model.value = previous;
    else if (data.models.includes(data.default)) els.model.value = data.default;
  } catch {
    // Keep the default model option if the API is temporarily unavailable.
  }
}

async function sendMessage(rawText) {
  const text = rawText.trim();
  if ((!text && !selectedImage) || busy) return;

  const userMessage = {
    role: "user",
    content: text || "Please describe this image."
  };

  if (selectedImage) userMessage.images = [selectedImage];

  messages.push(userMessage);
  selectedImage = null;
  els.preview.replaceChildren();
  els.imageInput.value = "";
  els.input.value = "";
  els.input.style.height = "auto";

  const assistantMessage = { role: "assistant", content: "" };
  messages.push(assistantMessage);

  busy = true;
  els.send.disabled = true;
  renderMessages();

  try {
    const apiMessages = messages.slice(0, -1).map(m => ({
      role: m.role,
      content: m.content,
      ...(m.images ? { images: m.images } : {})
    }));

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: apiMessages,
        model: els.model.value,
        stream: true,
        web_search: $("#webSearchToggle").checked
      })
    });

    if (!response.ok) {
      let error = `Server error (${response.status})`;
      try {
        const data = await response.json();
        error = data.error || data.message || error;
      } catch {}
      throw new Error(error);
    }

    const reader = response.body.getReader();
    currentReader = reader;
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const result = await reader.read();
      if (result.done) break;

      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;

        const packet = JSON.parse(line);

        if (packet.type === "token") {
          assistantMessage.content += packet.token;
          renderMessages();
        } else if (packet.type === "error") {
          throw new Error(packet.error || "The AI returned an error.");
        }
      }
    }

    if (buffer.trim()) {
      const packet = JSON.parse(buffer);
      if (packet.type === "token") assistantMessage.content += packet.token;
      if (packet.type === "error") throw new Error(packet.error || "AI error");
    }

    if (!assistantMessage.content) {
      assistantMessage.content = "No answer was returned. Please try again.";
    }

    storeCurrentChat();
    renderMessages();
  } catch (error) {
    assistantMessage.content = `⚠️ ${error.message}`;
    renderMessages();
    toast(error.message);
  } finally {
    busy = false;
    currentReader = null;
    els.send.disabled = false;
    els.input.focus();
  }
}

els.form.addEventListener("submit", event => {
  event.preventDefault();
  sendMessage(els.input.value);
});

els.input.addEventListener("input", () => {
  els.input.style.height = "auto";
  els.input.style.height = `${Math.min(els.input.scrollHeight, 180)}px`;
});

els.input.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    els.form.requestSubmit();
  }
});

$("#newChatBtn").addEventListener("click", newChat);
$("#clearBtn").addEventListener("click", newChat);
$("#menuBtn").addEventListener("click", () => els.sidebar.classList.toggle("open"));
$("#sidebarClose").addEventListener("click", () => els.sidebar.classList.remove("open"));

document.querySelectorAll(".suggestion-card").forEach(button => {
  button.addEventListener("click", () => sendMessage(button.dataset.prompt || ""));
});

document.querySelectorAll(".nav-item").forEach(button => {
  button.addEventListener("click", () => {
    const page = button.dataset.page;

    document.querySelectorAll(".nav-item").forEach(item => item.classList.remove("active"));
    button.classList.add("active");

    if (page === "chat") {
      els.sidebar.classList.remove("open");
      return;
    }

    if (page === "explore") {
      toast("Choose a suggestion or ask Somaliland AI to explore a topic.");
  } else if (page === "library") {
  openLibrary();
  els.sidebar.classList.remove("open");
}
  });
});

$("#themeBtn").addEventListener("click", () => {
  document.body.classList.toggle("light");
  const light = document.body.classList.contains("light");
  $("#themeBtn").textContent = light ? "🌙" : "☀️";
  localStorage.setItem("somaliland-ai-theme", light ? "light" : "dark");
});

$("#imageInput").addEventListener("change", event => {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    toast("Please choose an image.");
    event.target.value = "";
    return;
  }

  if (file.size > 8 * 1024 * 1024) {
    toast("Image must be smaller than 8 MB.");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    selectedImage = String(reader.result).split(",")[1];

    const image = document.createElement("img");
    image.src = String(reader.result);
    image.alt = "Image selected for the next message";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "✕ Remove";
    remove.addEventListener("click", () => {
      selectedImage = null;
      els.preview.replaceChildren();
      els.imageInput.value = "";
    });

    els.preview.replaceChildren(image, remove);
  };
  reader.readAsDataURL(file);
});

$("#voiceBtn").addEventListener("click", () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    toast("Voice input is unavailable in this browser.");
    return;
  }

  if (recognition) {
    recognition.stop();
    recognition = null;
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.onresult = event => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }
    els.input.value = transcript;
  };
  recognition.onerror = () => toast("Could not capture your voice. Try again.");
  recognition.onend = () => { recognition = null; };
  recognition.start();
});

$("#readBtn").addEventListener("click", () => {
  const latest = [...messages].reverse().find(m => m.role === "assistant" && m.content);
  if (latest) speakText(latest.content);
  else toast("There is no AI answer to read yet.");
});

try {
  if (localStorage.getItem("somaliland-ai-theme") === "light") {
    document.body.classList.add("light");
    $("#themeBtn").textContent = "🌙";
  }

  const saved = JSON.parse(localStorage.getItem("somaliland-ai-chats") || "[]");
  if (Array.isArray(saved)) chats = saved;
} catch {
  chats = [];
}

renderHistory();
checkHealth();
loadModels();

/* ===== SOMALILAND AI - LOCAL LIBRARY ===== */

function openLibrary() {
  let modal = document.getElementById("libraryModal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "libraryModal";
    modal.style.cssText = `
      position:fixed; inset:0; z-index:9999;
      background:rgba(0,0,0,.65); display:flex;
      align-items:center; justify-content:center; padding:20px;
    `;

    modal.innerHTML = `
      <section style="
        background:var(--panel,#191a22); color:inherit;
        width:min(600px,100%); max-height:85vh; overflow:auto;
        border-radius:18px; padding:24px;
        border:1px solid rgba(128,128,128,.25);
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
          <h2 style="margin:0">📚 My Library</h2>
          <button id="libraryClose" class="icon-btn" type="button">✕</button>
        </div>
        <p>Save and manage files on this computer.</p>
        <form id="libraryUploadForm" style="margin:18px 0">
          <input id="libraryFileInput" type="file" required
            accept=".txt,.pdf,.png,.jpg,.jpeg,.gif,.webp,.docx,.csv,.md">
          <button class="send-btn" type="submit">Upload file</button>
        </form>
        <p id="libraryStatus" role="status"></p>
        <div id="libraryFiles">Loading files…</div>
      </section>
    `;

    document.body.appendChild(modal);

    modal.querySelector("#libraryClose").onclick = () => modal.remove();

    modal.addEventListener("click", event => {
      if (event.target === modal) modal.remove();
    });

    modal.querySelector("#libraryUploadForm").onsubmit = async event => {
      event.preventDefault();

      const input = modal.querySelector("#libraryFileInput");
      const status = modal.querySelector("#libraryStatus");
      const file = input.files[0];

      if (!file) return;

      const formData = new FormData();
      formData.append("file", file);
      status.textContent = "Uploading…";

      try {
        const response = await fetch("/api/library", {
          method: "POST",
          body: formData
        });
        const result = await response.json();

        if (!response.ok) throw new Error(result.error || "Upload failed.");

        status.textContent = "File saved successfully.";
        input.value = "";
        await refreshLibrary();
      } catch (error) {
        status.textContent = error.message;
      }
    };
  }

  modal.style.display = "flex";
  refreshLibrary();
}

async function refreshLibrary() {
  const modal = document.getElementById("libraryModal");
  if (!modal) return;

  const list = modal.querySelector("#libraryFiles");
  list.textContent = "Loading files…";

  try {
    const response = await fetch("/api/library");
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "Could not load files.");

    list.replaceChildren();

    if (!result.files.length) {
      list.textContent = "No files saved yet. Upload a file to get started.";
      return;
    }

    result.files.forEach(file => {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #5555";

      const info = document.createElement("span");
      info.textContent = `${file.name} (${Math.ceil(file.size / 1024)} KB)`;
      info.style.overflowWrap = "anywhere";

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete";

      remove.onclick = async () => {
        if (!confirm(`Delete ${file.name}?`)) return;

        try {
          const response = await fetch(
            `/api/library/${encodeURIComponent(file.name)}`,
            { method: "DELETE" }
          );
          const result = await response.json();

          if (!response.ok) throw new Error(result.error || "Delete failed.");

          await refreshLibrary();
        } catch (error) {
          modal.querySelector("#libraryStatus").textContent = error.message;
        }
      };

      row.append(info, remove);
      list.appendChild(row);
    });
  } catch (error) {
    list.textContent = error.message;
  }
}
