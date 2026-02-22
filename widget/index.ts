/**
 * ReplyMaven Widget Embed Script
 *
 * Usage:
 * <script src="https://replymaven.com/api/widget-embed.js" data-project="your-project-slug"></script>
 *
 * Programmatic API:
 * window.ReplyMaven.open()
 * window.ReplyMaven.close()
 * window.ReplyMaven.toggle()
 * window.ReplyMaven.sendMessage("Hello")
 * window.ReplyMaven.identify({ name: "John", email: "john@example.com" })
 */

(function () {
  // Find the script tag to get config
  const script = document.currentScript as HTMLScriptElement;
  const projectSlug = script?.getAttribute("data-project");

  if (!projectSlug) {
    console.error("[ReplyMaven] Missing data-project attribute");
    return;
  }

  const baseUrl = new URL(script.src).origin;

  // State
  let isOpen = false;
  let conversationId: string | null = null;
  let visitorId =
    localStorage.getItem("sb_visitor_id") || generateVisitorId();
  let visitorInfo: { name?: string; email?: string } = {};
  let config: any = null;
  let messages: Array<{ role: string; content: string }> = [];

  function generateVisitorId(): string {
    const id = "v_" + Math.random().toString(36).substring(2, 15);
    localStorage.setItem("sb_visitor_id", id);
    return id;
  }

  // ─── Styles ─────────────────────────────────────────────────────────────────
  const styles = document.createElement("style");
  styles.textContent = `
    .sb-widget-container {
      position: fixed;
      z-index: 999999;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .sb-widget-container.bottom-right {
      bottom: 20px;
      right: 20px;
    }
    .sb-widget-container.bottom-left {
      bottom: 20px;
      left: 20px;
    }
    .sb-trigger {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .sb-trigger:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 20px rgba(0,0,0,0.2);
    }
    .sb-trigger svg {
      width: 24px;
      height: 24px;
      fill: white;
    }
    .sb-chat-window {
      position: absolute;
      bottom: 70px;
      width: 380px;
      max-height: 550px;
      display: none;
      flex-direction: column;
      overflow: hidden;
      box-shadow: 0 8px 30px rgba(0,0,0,0.12);
      border: 1px solid rgba(0,0,0,0.08);
    }
    .sb-chat-window.bottom-right {
      right: 0;
    }
    .sb-chat-window.bottom-left {
      left: 0;
    }
    .sb-chat-window.open {
      display: flex;
    }
    .sb-header {
      padding: 16px;
      color: white;
      font-weight: 600;
      font-size: 15px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .sb-header-close {
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      font-size: 18px;
      opacity: 0.8;
      padding: 4px;
    }
    .sb-header-close:hover { opacity: 1; }
    .sb-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-height: 300px;
    }
    .sb-message {
      max-width: 85%;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 14px;
      line-height: 1.4;
      word-wrap: break-word;
    }
    .sb-message.visitor {
      align-self: flex-end;
      background: #f0f0f0;
      color: #1f2937;
    }
    .sb-message.bot,
    .sb-message.agent {
      align-self: flex-start;
    }
    .sb-quick-topics {
      padding: 8px 16px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .sb-quick-topic {
      padding: 6px 12px;
      border-radius: 20px;
      border: 1px solid rgba(0,0,0,0.1);
      background: white;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .sb-quick-topic:hover {
      background: #f5f5f5;
    }
    .sb-input-area {
      padding: 12px 16px;
      border-top: 1px solid rgba(0,0,0,0.08);
      display: flex;
      gap: 8px;
    }
    .sb-input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 10px;
      font-size: 14px;
      outline: none;
      background: transparent;
    }
    .sb-input:focus {
      border-color: rgba(0,0,0,0.3);
    }
    .sb-send-btn {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .sb-send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .sb-send-btn svg {
      width: 16px;
      height: 16px;
      fill: white;
    }
    .sb-typing {
      align-self: flex-start;
      padding: 10px 14px;
      border-radius: 12px;
      font-size: 14px;
      display: none;
    }
    .sb-typing.visible {
      display: block;
    }
    .sb-typing-dots {
      display: flex;
      gap: 4px;
    }
    .sb-typing-dots span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.4;
      animation: sb-bounce 1.4s infinite ease-in-out;
    }
    .sb-typing-dots span:nth-child(1) { animation-delay: 0s; }
    .sb-typing-dots span:nth-child(2) { animation-delay: 0.2s; }
    .sb-typing-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes sb-bounce {
      0%, 80%, 100% { opacity: 0.4; transform: scale(1); }
      40% { opacity: 1; transform: scale(1.2); }
    }
  `;
  document.head.appendChild(styles);

  // ─── Build UI ───────────────────────────────────────────────────────────────
  const container = document.createElement("div");
  container.className = "sb-widget-container bottom-right";

  const chatWindow = document.createElement("div");
  chatWindow.className = "sb-chat-window bottom-right";

  const header = document.createElement("div");
  header.className = "sb-header";

  const headerText = document.createElement("span");
  headerText.textContent = "Chat with us";

  const closeBtn = document.createElement("button");
  closeBtn.className = "sb-header-close";
  closeBtn.innerHTML = "&times;";
  closeBtn.onclick = () => closeChatWidget();

  header.appendChild(headerText);
  header.appendChild(closeBtn);

  const messagesContainer = document.createElement("div");
  messagesContainer.className = "sb-messages";

  const quickTopicsContainer = document.createElement("div");
  quickTopicsContainer.className = "sb-quick-topics";

  const typingIndicator = document.createElement("div");
  typingIndicator.className = "sb-typing";
  typingIndicator.innerHTML =
    '<div class="sb-typing-dots"><span></span><span></span><span></span></div>';

  const inputArea = document.createElement("div");
  inputArea.className = "sb-input-area";

  const input = document.createElement("input");
  input.className = "sb-input";
  input.placeholder = "Type a message...";

  const sendBtn = document.createElement("button");
  sendBtn.className = "sb-send-btn";
  sendBtn.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';

  inputArea.appendChild(input);
  inputArea.appendChild(sendBtn);

  chatWindow.appendChild(header);
  chatWindow.appendChild(messagesContainer);
  chatWindow.appendChild(quickTopicsContainer);
  chatWindow.appendChild(typingIndicator);
  chatWindow.appendChild(inputArea);

  const trigger = document.createElement("button");
  trigger.className = "sb-trigger";
  trigger.innerHTML =
    '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  trigger.onclick = () => toggleChatWidget();

  container.appendChild(chatWindow);
  container.appendChild(trigger);
  document.body.appendChild(container);

  // ─── Event Handlers ─────────────────────────────────────────────────────────
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      handleSendMessage(input.value.trim());
      input.value = "";
    }
  });

  sendBtn.addEventListener("click", () => {
    if (input.value.trim()) {
      handleSendMessage(input.value.trim());
      input.value = "";
    }
  });

  // ─── Functions ──────────────────────────────────────────────────────────────
  async function loadConfig() {
    try {
      const res = await fetch(`${baseUrl}/api/widget/${projectSlug}/config`);
      if (!res.ok) return;
      config = await res.json();

      // Apply styling
      if (config.widget) {
        const w = config.widget;
        trigger.style.backgroundColor = w.primaryColor;
        header.style.backgroundColor = w.primaryColor;
        sendBtn.style.backgroundColor = w.primaryColor;
        chatWindow.style.backgroundColor = w.backgroundColor;
        chatWindow.style.color = w.textColor;
        chatWindow.style.borderRadius = w.borderRadius + "px";
        input.style.color = w.textColor;
        headerText.textContent = w.headerText || "Chat with us";

        if (w.position === "bottom-left") {
          container.className = "sb-widget-container bottom-left";
          chatWindow.className = "sb-chat-window bottom-left";
        }

        typingIndicator.style.backgroundColor = w.primaryColor + "15";
        typingIndicator.style.color = w.primaryColor;

        if (w.fontFamily && w.fontFamily !== "system-ui") {
          container.style.fontFamily = w.fontFamily + ", system-ui, sans-serif";
        }
      }

      // Intro message
      if (config.introMessage) {
        addMessageToUI("bot", config.introMessage);
      }

      // Quick topics
      if (config.quickTopics?.length > 0) {
        config.quickTopics.forEach((topic: any) => {
          const btn = document.createElement("button");
          btn.className = "sb-quick-topic";
          btn.textContent = topic.label;
          btn.onclick = () => {
            handleSendMessage(topic.prompt);
            quickTopicsContainer.style.display = "none";
          };
          quickTopicsContainer.appendChild(btn);
        });
      }
    } catch (err) {
      console.error("[ReplyMaven] Failed to load config:", err);
    }
  }

  async function createConversation() {
    if (conversationId) return;
    try {
      const res = await fetch(
        `${baseUrl}/api/widget/${projectSlug}/conversations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitorId,
            visitorName: visitorInfo.name,
            visitorEmail: visitorInfo.email,
            metadata: { url: window.location.href },
          }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        conversationId = data.id;
      }
    } catch (err) {
      console.error("[ReplyMaven] Failed to create conversation:", err);
    }
  }

  async function handleSendMessage(text: string) {
    // Create conversation if needed
    if (!conversationId) await createConversation();
    if (!conversationId) return;

    addMessageToUI("visitor", text);
    quickTopicsContainer.style.display = "none";

    // Show typing indicator
    typingIndicator.classList.add("visible");
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    try {
      const res = await fetch(
        `${baseUrl}/api/widget/${projectSlug}/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text }),
        },
      );

      if (!res.ok) {
        typingIndicator.classList.remove("visible");
        addMessageToUI("bot", "Sorry, something went wrong. Please try again.");
        return;
      }

      // Handle SSE stream
      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let botMessage = "";
      let botMessageEl: HTMLElement | null = null;

      typingIndicator.classList.remove("visible");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                botMessage += data.text;
                if (!botMessageEl) {
                  botMessageEl = addMessageToUI("bot", botMessage);
                } else {
                  botMessageEl.textContent = botMessage;
                }
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
              }
              if (data.done) {
                // Stream complete
              }
              if (data.error) {
                addMessageToUI(
                  "bot",
                  "Sorry, an error occurred. Please try again.",
                );
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }
    } catch (err) {
      typingIndicator.classList.remove("visible");
      addMessageToUI(
        "bot",
        "Sorry, I couldn't connect. Please check your internet connection.",
      );
    }
  }

  function addMessageToUI(role: string, content: string): HTMLElement {
    const msgEl = document.createElement("div");
    msgEl.className = `sb-message ${role}`;
    msgEl.textContent = content;

    if (role === "bot" || role === "agent") {
      const primaryColor = config?.widget?.primaryColor ?? "#2563eb";
      msgEl.style.backgroundColor = primaryColor + "15";
      msgEl.style.color = config?.widget?.textColor ?? "#1f2937";
    }

    messagesContainer.appendChild(msgEl);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
    return msgEl;
  }

  function openChatWidget() {
    isOpen = true;
    chatWindow.classList.add("open");
    trigger.style.display = "none";
    input.focus();
  }

  function closeChatWidget() {
    isOpen = false;
    chatWindow.classList.remove("open");
    trigger.style.display = "flex";
  }

  function toggleChatWidget() {
    if (isOpen) {
      closeChatWidget();
    } else {
      openChatWidget();
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────
  (window as any).ReplyMaven = {
    open: openChatWidget,
    close: closeChatWidget,
    toggle: toggleChatWidget,
    sendMessage: (text: string) => {
      if (!isOpen) openChatWidget();
      handleSendMessage(text);
    },
    identify: (info: { name?: string; email?: string }) => {
      visitorInfo = { ...visitorInfo, ...info };
    },
  };

  // ─── Initialize ─────────────────────────────────────────────────────────────
  loadConfig();
})();
