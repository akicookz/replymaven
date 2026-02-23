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

  // ─── State ──────────────────────────────────────────────────────────────────
  let isOpen = false;
  let conversationId: string | null = null;
  const visitorId =
    localStorage.getItem("rm_visitor_id") || generateVisitorId();
  let visitorInfo: { name?: string; email?: string } = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let config: Record<string, any> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let _isHandedOff = false;

  function generateVisitorId(): string {
    const id = "v_" + Math.random().toString(36).substring(2, 15);
    localStorage.setItem("rm_visitor_id", id);
    return id;
  }

  // ─── SVG Icons ──────────────────────────────────────────────────────────────
  const ICONS = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>',
    headset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>',
    arrowRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    externalLink: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    backArrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    // Home link icons
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    docs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  } as Record<string, string>;

  // ─── Styles ─────────────────────────────────────────────────────────────────
  const styles = document.createElement("style");
  styles.textContent = `
    .rm-widget-container {
      position: fixed;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }
    .rm-widget-container * {
      box-sizing: border-box;
    }
    .rm-widget-container.bottom-right {
      bottom: 20px;
      right: 20px;
    }
    .rm-widget-container.bottom-left {
      bottom: 20px;
      left: 20px;
    }

    /* ─── Trigger Button ──────────────────────────────────────────────────── */
    .rm-trigger {
      width: 60px;
      height: 60px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 14px rgba(0,0,0,0.16);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      position: relative;
      color: white;
    }
    .rm-trigger:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 20px rgba(0,0,0,0.22);
    }
    .rm-trigger svg {
      width: 26px;
      height: 26px;
    }
    .rm-trigger .rm-icon-chat,
    .rm-trigger .rm-icon-close {
      position: absolute;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.3s ease, opacity 0.2s ease;
    }
    .rm-trigger .rm-icon-chat {
      opacity: 1;
      transform: scale(1) rotate(0deg);
    }
    .rm-trigger .rm-icon-close {
      opacity: 0;
      transform: scale(0.5) rotate(-90deg);
    }
    .rm-trigger.active .rm-icon-chat {
      opacity: 0;
      transform: scale(0.5) rotate(90deg);
    }
    .rm-trigger.active .rm-icon-close {
      opacity: 1;
      transform: scale(1) rotate(0deg);
    }

    /* ─── Chat Window ─────────────────────────────────────────────────────── */
    .rm-chat-window {
      position: absolute;
      bottom: 74px;
      width: 400px;
      max-height: 620px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: 16px;
      box-shadow: 0 5px 40px rgba(0,0,0,0.16);
      border: 1px solid rgba(0,0,0,0.06);
      background: #ffffff;
      opacity: 0;
      visibility: hidden;
      transform: translateY(16px) scale(0.96);
      pointer-events: none;
      transition: opacity 0.3s cubic-bezier(0.4,0,0.2,1),
                  transform 0.3s cubic-bezier(0.4,0,0.2,1),
                  visibility 0.3s;
      transform-origin: bottom right;
    }
    .rm-chat-window.bottom-right {
      right: 0;
      transform-origin: bottom right;
    }
    .rm-chat-window.bottom-left {
      left: 0;
      transform-origin: bottom left;
    }
    .rm-chat-window.open {
      opacity: 1;
      visibility: visible;
      transform: translateY(0) scale(1);
      pointer-events: auto;
    }

    /* ─── Header ──────────────────────────────────────────────────────────── */
    .rm-header {
      padding: 18px 20px;
      color: white;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
      position: relative;
    }
    .rm-header-avatar {
      width: 36px;
      height: 36px;
      min-width: 36px;
      border-radius: 50%;
      background: rgba(255,255,255,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
    }
    .rm-header-avatar svg {
      width: 20px;
      height: 20px;
    }
    .rm-header-info {
      flex: 1;
      min-width: 0;
    }
    .rm-header-title {
      font-weight: 600;
      font-size: 15px;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .rm-header-subtitle {
      font-size: 12px;
      opacity: 0.8;
      margin-top: 1px;
      line-height: 1.3;
    }
    .rm-header-close {
      background: rgba(255,255,255,0.15);
      border: none;
      color: white;
      cursor: pointer;
      width: 32px;
      height: 32px;
      min-width: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }
    .rm-header-close:hover {
      background: rgba(255,255,255,0.25);
    }
    .rm-header-close svg {
      width: 16px;
      height: 16px;
    }

    /* ─── Messages Area ───────────────────────────────────────────────────── */
    .rm-messages {
      flex: 1;
      overflow-y: auto;
      padding: 20px 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-height: 300px;
      background: #fafafa;
      scroll-behavior: smooth;
    }
    .rm-messages::-webkit-scrollbar {
      width: 4px;
    }
    .rm-messages::-webkit-scrollbar-thumb {
      background: rgba(0,0,0,0.12);
      border-radius: 4px;
    }

    /* ─── Message Row (avatar + bubble) ───────────────────────────────────── */
    .rm-message-row {
      display: flex;
      gap: 8px;
      align-items: flex-end;
      animation: rm-message-in 0.3s ease-out;
      max-width: 88%;
    }
    .rm-message-row.visitor {
      align-self: flex-end;
      flex-direction: row-reverse;
    }
    .rm-message-row.bot,
    .rm-message-row.agent {
      align-self: flex-start;
    }
    .rm-message-avatar {
      width: 28px;
      height: 28px;
      min-width: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      margin-bottom: 2px;
    }
    .rm-message-avatar svg {
      width: 14px;
      height: 14px;
    }
    .rm-message-avatar.hidden {
      visibility: hidden;
    }

    /* ─── Message Bubble ──────────────────────────────────────────────────── */
    .rm-message {
      padding: 10px 14px;
      font-size: 14px;
      line-height: 1.5;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .rm-message-row.visitor .rm-message {
      background: #2563eb;
      color: white;
      border-radius: 18px 18px 4px 18px;
    }
    .rm-message-row.bot .rm-message,
    .rm-message-row.agent .rm-message {
      background: #ffffff;
      color: #1f2937;
      border-radius: 18px 18px 18px 4px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.06);
    }

    /* ─── Typing Indicator ────────────────────────────────────────────────── */
    .rm-typing-row {
      display: flex;
      gap: 8px;
      align-items: flex-end;
      align-self: flex-start;
      max-width: 88%;
      display: none;
    }
    .rm-typing-row.visible {
      display: flex;
    }
    .rm-typing-bubble {
      padding: 12px 16px;
      border-radius: 18px 18px 18px 4px;
      background: #ffffff;
      box-shadow: 0 1px 2px rgba(0,0,0,0.06);
    }
    .rm-typing-dots {
      display: flex;
      gap: 5px;
      align-items: center;
    }
    .rm-typing-dots span {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #94a3b8;
      animation: rm-bounce 1.4s infinite ease-in-out;
    }
    .rm-typing-dots span:nth-child(1) { animation-delay: 0s; }
    .rm-typing-dots span:nth-child(2) { animation-delay: 0.2s; }
    .rm-typing-dots span:nth-child(3) { animation-delay: 0.4s; }
    @keyframes rm-bounce {
      0%, 80%, 100% { opacity: 0.3; transform: translateY(0); }
      40% { opacity: 1; transform: translateY(-4px); }
    }

    /* ─── Quick Topics ────────────────────────────────────────────────────── */
    .rm-quick-topics {
      padding: 8px 16px 4px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      background: #fafafa;
    }
    .rm-quick-topic {
      padding: 7px 14px;
      border-radius: 20px;
      border: 1px solid rgba(0,0,0,0.08);
      background: #ffffff;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.2s, border-color 0.2s;
      color: inherit;
      line-height: 1.3;
    }
    .rm-quick-topic:hover {
      background: #f0f0f0;
      border-color: rgba(0,0,0,0.15);
    }

    /* ─── Input Area ──────────────────────────────────────────────────────── */
    .rm-input-area {
      padding: 12px 16px;
      border-top: 1px solid rgba(0,0,0,0.06);
      display: flex;
      align-items: center;
      gap: 8px;
      background: #ffffff;
    }
    .rm-input {
      flex: 1;
      padding: 10px 16px;
      border: 1px solid rgba(0,0,0,0.10);
      border-radius: 24px;
      font-size: 14px;
      outline: none;
      background: #fafafa;
      color: #1f2937;
      transition: border-color 0.2s, box-shadow 0.2s;
      font-family: inherit;
    }
    .rm-input:focus {
      border-color: rgba(0,0,0,0.2);
      box-shadow: 0 0 0 3px rgba(37,99,235,0.08);
      background: #ffffff;
    }
    .rm-input::placeholder {
      color: #9ca3af;
    }
    .rm-send-btn {
      width: 40px;
      height: 40px;
      min-width: 40px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      transition: opacity 0.2s, transform 0.15s;
    }
    .rm-send-btn:hover {
      opacity: 0.9;
      transform: scale(1.05);
    }
    .rm-send-btn:active {
      transform: scale(0.95);
    }
    .rm-send-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      transform: none;
    }
    .rm-send-btn svg {
      width: 18px;
      height: 18px;
    }

    /* ─── Powered By ──────────────────────────────────────────────────────── */
    .rm-powered {
      text-align: center;
      padding: 6px 16px 8px;
      font-size: 11px;
      color: #9ca3af;
      background: #ffffff;
    }
    .rm-powered a {
      color: #6b7280;
      text-decoration: none;
      font-weight: 500;
    }
    .rm-powered a:hover {
      color: #374151;
    }

    /* ─── Handoff Card ────────────────────────────────────────────────────── */
    .rm-handoff-card {
      margin: 8px 0;
      padding: 20px;
      border-radius: 14px;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
      text-align: center;
      animation: rm-message-in 0.4s ease-out;
      align-self: stretch;
      max-width: 100%;
    }
    .rm-handoff-icon {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 12px;
    }
    .rm-handoff-icon svg {
      width: 22px;
      height: 22px;
    }
    .rm-handoff-title {
      font-size: 14px;
      font-weight: 600;
      color: #1f2937;
      margin-bottom: 4px;
    }
    .rm-handoff-subtitle {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 16px;
      line-height: 1.4;
    }
    .rm-handoff-email-display {
      display: inline-block;
      padding: 6px 12px;
      background: #f4f4f5;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      color: #1f2937;
      margin-bottom: 14px;
    }
    .rm-handoff-actions {
      display: flex;
      gap: 8px;
      justify-content: center;
      flex-wrap: wrap;
    }
    .rm-handoff-btn {
      padding: 8px 18px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s, transform 0.15s;
      border: none;
      font-family: inherit;
    }
    .rm-handoff-btn:active {
      transform: scale(0.97);
    }
    .rm-handoff-btn-primary {
      color: white;
    }
    .rm-handoff-btn-secondary {
      background: #f4f4f5;
      color: #374151;
    }
    .rm-handoff-btn-secondary:hover {
      background: #e5e5e5;
    }
    .rm-handoff-email-form {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }
    .rm-handoff-email-input {
      flex: 1;
      padding: 9px 14px;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 10px;
      font-size: 13px;
      outline: none;
      font-family: inherit;
      color: #1f2937;
      background: #fafafa;
      transition: border-color 0.2s;
    }
    .rm-handoff-email-input:focus {
      border-color: rgba(0,0,0,0.25);
      background: #ffffff;
    }
    .rm-handoff-email-input::placeholder {
      color: #9ca3af;
    }
    .rm-handoff-submit {
      width: 36px;
      min-width: 36px;
      height: 36px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      transition: opacity 0.2s;
    }
    .rm-handoff-submit:hover {
      opacity: 0.9;
    }
    .rm-handoff-submit svg {
      width: 16px;
      height: 16px;
    }
    .rm-handoff-confirmed {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 13px;
      color: #16a34a;
      font-weight: 500;
      margin-top: 4px;
    }
    .rm-handoff-confirmed svg {
      width: 16px;
      height: 16px;
    }

    /* ─── Home Screen ─────────────────────────────────────────────────────── */
    .rm-home {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
    }
    .rm-home.hidden {
      display: none;
    }
    .rm-chat-view {
      flex: 1;
      display: none;
      flex-direction: column;
      min-height: 0;
    }
    .rm-chat-view.active {
      display: flex;
    }
    .rm-home-banner {
      height: 120px;
      position: relative;
      flex-shrink: 0;
      background-size: cover;
      background-position: center;
    }
    .rm-home-avatar {
      position: absolute;
      bottom: -22px;
      left: 20px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: 3px solid #ffffff;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .rm-home-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .rm-home-avatar svg {
      width: 22px;
      height: 22px;
    }
    .rm-home-body {
      padding: 32px 20px 16px;
      flex: 1;
    }
    .rm-home-title {
      font-size: 20px;
      font-weight: 700;
      line-height: 1.3;
      color: #1f2937;
    }
    .rm-home-subtitle {
      font-size: 13px;
      color: #6b7280;
      margin-top: 4px;
    }
    .rm-home-ask {
      margin-top: 16px;
      border: 1px solid rgba(0,0,0,0.08);
      border-radius: 12px;
      padding: 14px;
      cursor: pointer;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .rm-home-ask:hover {
      border-color: rgba(0,0,0,0.15);
      box-shadow: 0 1px 4px rgba(0,0,0,0.04);
    }
    .rm-home-ask-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #6b7280;
      margin-bottom: 8px;
    }
    .rm-home-ask-label svg {
      width: 13px;
      height: 13px;
    }
    .rm-home-ask-input {
      width: 100%;
      border: none;
      outline: none;
      font-size: 14px;
      color: #9ca3af;
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      padding: 0;
    }
    .rm-home-links {
      margin-top: 20px;
    }
    .rm-home-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 0;
      border-top: 1px solid rgba(0,0,0,0.06);
      cursor: pointer;
      text-decoration: none;
      color: inherit;
      transition: opacity 0.2s;
    }
    .rm-home-link:first-child {
      border-top: none;
    }
    .rm-home-link:hover {
      opacity: 0.7;
    }
    .rm-home-link-icon {
      width: 20px;
      height: 20px;
      color: #9ca3af;
      flex-shrink: 0;
    }
    .rm-home-link-icon svg {
      width: 20px;
      height: 20px;
    }
    .rm-home-link-label {
      flex: 1;
      font-size: 14px;
      font-weight: 500;
      color: #374151;
    }
    .rm-home-link-arrow {
      width: 16px;
      height: 16px;
      color: #9ca3af;
      flex-shrink: 0;
    }
    .rm-home-link-arrow svg {
      width: 16px;
      height: 16px;
    }

    /* Chat header back button */
    .rm-header-back {
      background: rgba(255,255,255,0.15);
      border: none;
      color: white;
      cursor: pointer;
      width: 32px;
      height: 32px;
      min-width: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }
    .rm-header-back:hover {
      background: rgba(255,255,255,0.25);
    }
    .rm-header-back svg {
      width: 16px;
      height: 16px;
    }

    /* ─── Animations ──────────────────────────────────────────────────────── */
    @keyframes rm-message-in {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    /* ─── Responsive ──────────────────────────────────────────────────────── */
    @media (max-width: 480px) {
      .rm-chat-window {
        width: calc(100vw - 24px);
        max-height: calc(100vh - 100px);
        bottom: 70px;
      }
      .rm-widget-container.bottom-right,
      .rm-widget-container.bottom-left {
        bottom: 12px;
        right: 12px;
        left: auto;
      }
      .rm-chat-window.bottom-right,
      .rm-chat-window.bottom-left {
        right: 0;
        left: auto;
      }
    }
  `;
  document.head.appendChild(styles);

  // ─── Build UI ───────────────────────────────────────────────────────────────

  // Container
  const container = document.createElement("div");
  container.className = "rm-widget-container bottom-right";

  // Chat Window
  const chatWindow = document.createElement("div");
  chatWindow.className = "rm-chat-window bottom-right";

  // ─── Home Screen View ───────────────────────────────────────────────────────
  const homeView = document.createElement("div");
  homeView.className = "rm-home";

  // Banner
  const homeBanner = document.createElement("div");
  homeBanner.className = "rm-home-banner";

  // Avatar on banner
  const homeAvatar = document.createElement("div");
  homeAvatar.className = "rm-home-avatar";
  homeAvatar.innerHTML = ICONS.bot;
  homeBanner.appendChild(homeAvatar);

  // Home body
  const homeBody = document.createElement("div");
  homeBody.className = "rm-home-body";

  const homeTitle = document.createElement("div");
  homeTitle.className = "rm-home-title";
  homeTitle.textContent = "How can we help?";

  const homeSubtitle = document.createElement("div");
  homeSubtitle.className = "rm-home-subtitle";

  // Ask box
  const homeAsk = document.createElement("div");
  homeAsk.className = "rm-home-ask";
  const homeAskLabel = document.createElement("div");
  homeAskLabel.className = "rm-home-ask-label";
  homeAskLabel.innerHTML = ICONS.sparkle + " Ask our assistant anything";
  const homeAskInput = document.createElement("input");
  homeAskInput.className = "rm-home-ask-input";
  homeAskInput.placeholder = "Ask a question...";
  homeAskInput.readOnly = false;
  homeAsk.appendChild(homeAskLabel);
  homeAsk.appendChild(homeAskInput);

  // Home links container
  const homeLinksContainer = document.createElement("div");
  homeLinksContainer.className = "rm-home-links";

  homeBody.appendChild(homeTitle);
  homeBody.appendChild(homeSubtitle);
  homeBody.appendChild(homeAsk);
  homeBody.appendChild(homeLinksContainer);

  homeView.appendChild(homeBanner);
  homeView.appendChild(homeBody);

  // ─── Chat View (header + messages + input) ──────────────────────────────────
  const chatView = document.createElement("div");
  chatView.className = "rm-chat-view";

  // Header
  const header = document.createElement("div");
  header.className = "rm-header";

  const headerBack = document.createElement("button");
  headerBack.className = "rm-header-back";
  headerBack.innerHTML = ICONS.backArrow;
  headerBack.onclick = () => showHomeScreen();

  const headerAvatar = document.createElement("div");
  headerAvatar.className = "rm-header-avatar";
  headerAvatar.innerHTML = ICONS.bot;

  const headerInfo = document.createElement("div");
  headerInfo.className = "rm-header-info";

  const headerTitle = document.createElement("div");
  headerTitle.className = "rm-header-title";
  headerTitle.textContent = "Chat with us";

  const headerSubtitle = document.createElement("div");
  headerSubtitle.className = "rm-header-subtitle";
  headerSubtitle.textContent = "We typically reply instantly";

  headerInfo.appendChild(headerTitle);
  headerInfo.appendChild(headerSubtitle);

  const closeBtn = document.createElement("button");
  closeBtn.className = "rm-header-close";
  closeBtn.innerHTML = ICONS.close;
  closeBtn.onclick = () => closeChatWidget();

  header.appendChild(headerBack);
  header.appendChild(headerAvatar);
  header.appendChild(headerInfo);
  header.appendChild(closeBtn);

  // Messages area
  const messagesContainer = document.createElement("div");
  messagesContainer.className = "rm-messages";

  // Typing indicator (lives inside messagesContainer)
  const typingRow = document.createElement("div");
  typingRow.className = "rm-typing-row";

  const typingAvatar = document.createElement("div");
  typingAvatar.className = "rm-message-avatar";
  typingAvatar.innerHTML = ICONS.bot;

  const typingBubble = document.createElement("div");
  typingBubble.className = "rm-typing-bubble";
  typingBubble.innerHTML =
    '<div class="rm-typing-dots"><span></span><span></span><span></span></div>';

  typingRow.appendChild(typingAvatar);
  typingRow.appendChild(typingBubble);
  messagesContainer.appendChild(typingRow);

  // Quick topics
  const quickTopicsContainer = document.createElement("div");
  quickTopicsContainer.className = "rm-quick-topics";

  // Input area
  const inputArea = document.createElement("div");
  inputArea.className = "rm-input-area";

  const input = document.createElement("input");
  input.className = "rm-input";
  input.placeholder = "Type a message...";

  const sendBtn = document.createElement("button");
  sendBtn.className = "rm-send-btn";
  sendBtn.innerHTML = ICONS.send;

  inputArea.appendChild(input);
  inputArea.appendChild(sendBtn);

  // Assemble chat view
  chatView.appendChild(header);
  chatView.appendChild(messagesContainer);
  chatView.appendChild(quickTopicsContainer);
  chatView.appendChild(inputArea);

  // Powered by
  const powered = document.createElement("div");
  powered.className = "rm-powered";
  powered.innerHTML = 'Powered by <a href="https://replymaven.com" target="_blank" rel="noopener">ReplyMaven</a>';

  // Assemble chat window
  chatWindow.appendChild(homeView);
  chatWindow.appendChild(chatView);
  chatWindow.appendChild(powered);

  // Trigger button
  const trigger = document.createElement("button");
  trigger.className = "rm-trigger";
  const triggerChatIcon = document.createElement("span");
  triggerChatIcon.className = "rm-icon-chat";
  triggerChatIcon.innerHTML = ICONS.chat;
  const triggerCloseIcon = document.createElement("span");
  triggerCloseIcon.className = "rm-icon-close";
  triggerCloseIcon.innerHTML = ICONS.close;
  trigger.appendChild(triggerChatIcon);
  trigger.appendChild(triggerCloseIcon);
  trigger.onclick = () => toggleChatWidget();

  container.appendChild(chatWindow);
  container.appendChild(trigger);
  document.body.appendChild(container);

  // ─── View State ──────────────────────────────────────────────────────────────
  let currentView: "home" | "chat" = "home";

  function showChatScreen() {
    currentView = "chat";
    homeView.classList.add("hidden");
    chatView.classList.add("active");
    setTimeout(() => input.focus(), 100);
  }

  function showHomeScreen() {
    currentView = "home";
    homeView.classList.remove("hidden");
    chatView.classList.remove("active");
  }

  // ─── Event Handlers ─────────────────────────────────────────────────────────

  // Home screen ask input: focus/click switches to chat view
  homeAskInput.addEventListener("focus", () => {
    showChatScreen();
  });

  // Also handle typing directly in the home ask input
  homeAskInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && homeAskInput.value.trim()) {
      const text = homeAskInput.value.trim();
      homeAskInput.value = "";
      showChatScreen();
      handleSendMessage(text);
    }
  });

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

  function getPrimaryColor(): string {
    return config?.widget?.primaryColor ?? "#2563eb";
  }

  async function loadConfig() {
    try {
      const res = await fetch(`${baseUrl}/api/widget/${projectSlug}/config`);
      if (!res.ok) return;
      const loadedConfig = await res.json();
      config = loadedConfig;

      // Apply styling
      if (loadedConfig.widget) {
        const w = loadedConfig.widget;
        const primary = w.primaryColor || "#2563eb";

        // Trigger & header colors
        trigger.style.backgroundColor = primary;
        header.style.backgroundColor = primary;
        sendBtn.style.backgroundColor = primary;

        // Chat window
        if (w.backgroundColor) {
          chatWindow.style.background = w.backgroundColor;
        }
        if (w.textColor) {
          chatWindow.style.color = w.textColor;
          input.style.color = w.textColor;
          homeTitle.style.color = w.textColor;
        }
        if (w.borderRadius) {
          chatWindow.style.borderRadius = w.borderRadius + "px";
        }

        // Header text
        headerTitle.textContent = w.headerText || "Chat with us";

        // Position
        if (w.position === "bottom-left") {
          container.className = "rm-widget-container bottom-left";
          chatWindow.className = "rm-chat-window bottom-left";
        }

        // Typing indicator colors
        typingAvatar.style.backgroundColor = primary + "15";
        typingAvatar.style.color = primary;

        // Font family
        if (w.fontFamily && w.fontFamily !== "system-ui") {
          container.style.fontFamily = w.fontFamily + ", -apple-system, BlinkMacSystemFont, sans-serif";
        }

        // ─── Home Screen Config ──────────────────────────────────────────────

        // Banner
        if (w.bannerUrl) {
          homeBanner.style.backgroundImage = `url(${w.bannerUrl})`;
        } else {
          homeBanner.style.backgroundColor = primary;
        }

        // Avatar
        if (w.avatarUrl) {
          homeAvatar.innerHTML = "";
          homeAvatar.style.backgroundColor = "#ffffff";
          const img = document.createElement("img");
          img.src = w.avatarUrl;
          img.alt = "Avatar";
          homeAvatar.appendChild(img);
        } else {
          homeAvatar.style.backgroundColor = primary;
          homeAvatar.style.color = "#ffffff";
        }

        // Home title & subtitle
        homeTitle.textContent = w.homeTitle || "How can we help?";
        if (w.homeSubtitle) {
          homeSubtitle.textContent = w.homeSubtitle;
          homeSubtitle.style.display = "block";
        } else {
          homeSubtitle.style.display = "none";
        }
      }

      // ─── Home Links ──────────────────────────────────────────────────────────
      homeLinksContainer.innerHTML = "";
      const links: Array<{ label: string; url: string; icon: string }> =
        loadedConfig.homeLinks?.length > 0
          ? loadedConfig.homeLinks
          : [{ label: "Visit website", url: "#", icon: "globe" }];

      links.forEach((link: { label: string; url: string; icon: string }) => {
        const a = document.createElement("a");
        a.className = "rm-home-link";
        a.href = link.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";

        const iconEl = document.createElement("span");
        iconEl.className = "rm-home-link-icon";
        iconEl.innerHTML = ICONS[link.icon] || ICONS.link;

        const labelEl = document.createElement("span");
        labelEl.className = "rm-home-link-label";
        labelEl.textContent = link.label;

        const arrowEl = document.createElement("span");
        arrowEl.className = "rm-home-link-arrow";
        arrowEl.innerHTML = ICONS.externalLink;

        a.appendChild(iconEl);
        a.appendChild(labelEl);
        a.appendChild(arrowEl);
        homeLinksContainer.appendChild(a);
      });

      // Intro message
      if (loadedConfig.introMessage) {
        addMessageToUI("bot", loadedConfig.introMessage);
      }

      // Quick topics
      if (loadedConfig.quickTopics?.length > 0) {
        loadedConfig.quickTopics.forEach((topic: { label: string; prompt: string }) => {
          const btn = document.createElement("button");
          btn.className = "rm-quick-topic";
          btn.textContent = topic.label;
          btn.onclick = () => {
            handleSendMessage(topic.prompt);
            quickTopicsContainer.style.display = "none";
          };
          quickTopicsContainer.appendChild(btn);
        });
      } else {
        quickTopicsContainer.style.display = "none";
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
    // Switch to chat view if on home screen
    if (currentView === "home") {
      showChatScreen();
    }

    // Create conversation if needed
    if (!conversationId) await createConversation();
    if (!conversationId) return;

    addMessageToUI("visitor", text);
    quickTopicsContainer.style.display = "none";

    // Show typing indicator
    showTyping();

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
        hideTyping();
        addMessageToUI("bot", "Sorry, something went wrong. Please try again.");
        return;
      }

      // Handle SSE stream
      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let botMessage = "";
      let botMessageEl: HTMLElement | null = null;
      let handoffDetected = false;
      let handoffEmail: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.handoff) {
                handoffDetected = true;
                handoffEmail = data.visitorEmail || visitorInfo.email || null;
                // Remove any bot message bubble that was showing the [HANDOFF_REQUESTED] token
                if (botMessageEl) {
                  botMessageEl.closest(".rm-message-row")?.remove();
                  botMessageEl = null;
                }
                hideTyping();
                continue;
              }

              if (data.text) {
                botMessage += data.text;

                // Client-side filter: if [HANDOFF_REQUESTED] appears in accumulated text,
                // strip it and mark handoff (backup for when SSE handoff event hasn't arrived yet)
                if (botMessage.includes("[HANDOFF_REQUESTED]")) {
                  handoffDetected = true;
                  handoffEmail = visitorInfo.email || null;
                  if (botMessageEl) {
                    botMessageEl.closest(".rm-message-row")?.remove();
                    botMessageEl = null;
                  }
                  hideTyping();
                  botMessage = "";
                  continue;
                }

                // Hide typing on first text chunk, show the bot bubble
                if (!botMessageEl) {
                  hideTyping();
                  botMessageEl = addMessageToUI("bot", botMessage);
                } else {
                  botMessageEl.textContent = botMessage;
                }
                scrollToBottom();
              }

              if (data.done) {
                // Stream complete -- show handoff card if needed
                if (handoffDetected) {
                  showHandoffCard(handoffEmail);
                }
              }

              if (data.error) {
                hideTyping();
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

      // Edge case: stream ended without a done event but handoff was detected
      if (handoffDetected && !document.querySelector(".rm-handoff-card")) {
        showHandoffCard(handoffEmail);
      }
    } catch {
      hideTyping();
      addMessageToUI(
        "bot",
        "Sorry, I couldn't connect. Please check your internet connection.",
      );
    }
  }

  // Track previous message role for avatar grouping
  let lastMessageRole: string | null = null;

  function addMessageToUI(role: string, content: string): HTMLElement {
    const primaryColor = getPrimaryColor();

    // Message row (avatar + bubble)
    const row = document.createElement("div");
    row.className = `rm-message-row ${role}`;

    // Avatar for bot/agent messages
    if (role === "bot" || role === "agent") {
      const avatar = document.createElement("div");
      avatar.className = "rm-message-avatar";
      avatar.style.backgroundColor = primaryColor + "12";
      avatar.style.color = primaryColor;
      avatar.innerHTML = ICONS.bot;

      // Hide avatar if this is a consecutive message from the same role
      if (lastMessageRole === role) {
        avatar.classList.add("hidden");
      }

      row.appendChild(avatar);
    }

    // Message bubble
    const msgEl = document.createElement("div");
    msgEl.className = "rm-message";
    msgEl.textContent = content;

    // Visitor bubble uses primary color
    if (role === "visitor") {
      msgEl.style.backgroundColor = primaryColor;
      msgEl.style.color = "#ffffff";
    }

    row.appendChild(msgEl);

    // Insert before typing indicator (which is always last child)
    messagesContainer.insertBefore(row, typingRow);
    scrollToBottom();

    lastMessageRole = role;
    return msgEl;
  }

  function showTyping() {
    typingRow.classList.add("visible");
    const primaryColor = getPrimaryColor();
    typingAvatar.style.backgroundColor = primaryColor + "12";
    typingAvatar.style.color = primaryColor;
    scrollToBottom();
  }

  function hideTyping() {
    typingRow.classList.remove("visible");
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
  }

  // ─── Handoff Card ───────────────────────────────────────────────────────────

  function showHandoffCard(email: string | null) {
    _isHandedOff = true;
    const primaryColor = getPrimaryColor();

    const card = document.createElement("div");
    card.className = "rm-handoff-card";

    // Icon
    const icon = document.createElement("div");
    icon.className = "rm-handoff-icon";
    icon.style.backgroundColor = primaryColor + "12";
    icon.style.color = primaryColor;
    icon.innerHTML = ICONS.headset;
    card.appendChild(icon);

    // Title
    const title = document.createElement("div");
    title.className = "rm-handoff-title";
    title.textContent = "Conversation forwarded to our team";
    card.appendChild(title);

    // Subtitle
    const subtitle = document.createElement("div");
    subtitle.className = "rm-handoff-subtitle";

    if (email) {
      subtitle.textContent = "Is this a good way to reach you?";
      card.appendChild(subtitle);

      // Show email
      const emailDisplay = document.createElement("div");
      emailDisplay.className = "rm-handoff-email-display";
      emailDisplay.textContent = email;
      card.appendChild(emailDisplay);

      // Actions
      const actions = document.createElement("div");
      actions.className = "rm-handoff-actions";

      const confirmBtn = document.createElement("button");
      confirmBtn.className = "rm-handoff-btn rm-handoff-btn-primary";
      confirmBtn.style.backgroundColor = primaryColor;
      confirmBtn.textContent = "Yes, that works";
      confirmBtn.onclick = () => {
        actions.remove();
        const confirmed = document.createElement("div");
        confirmed.className = "rm-handoff-confirmed";
        confirmed.innerHTML = ICONS.check;
        const confirmText = document.createElement("span");
        confirmText.textContent = `We'll follow up at ${email}`;
        confirmed.appendChild(confirmText);
        card.appendChild(confirmed);
        scrollToBottom();
      };

      const changeBtn = document.createElement("button");
      changeBtn.className = "rm-handoff-btn rm-handoff-btn-secondary";
      changeBtn.textContent = "Use a different email";
      changeBtn.onclick = () => {
        actions.remove();
        emailDisplay.remove();
        subtitle.textContent = "Enter your preferred email address";
        appendEmailForm(card);
      };

      actions.appendChild(confirmBtn);
      actions.appendChild(changeBtn);
      card.appendChild(actions);
    } else {
      subtitle.textContent = "Leave your email so we can get back to you.";
      card.appendChild(subtitle);
      appendEmailForm(card);
    }

    // Insert card before typing indicator
    messagesContainer.insertBefore(card, typingRow);
    scrollToBottom();

    // Update input placeholder
    input.placeholder = "Add any details for the team...";
  }

  function appendEmailForm(card: HTMLElement) {
    const primaryColor = getPrimaryColor();

    const form = document.createElement("div");
    form.className = "rm-handoff-email-form";

    const emailInput = document.createElement("input");
    emailInput.className = "rm-handoff-email-input";
    emailInput.type = "email";
    emailInput.placeholder = "you@example.com";

    const submitBtn = document.createElement("button");
    submitBtn.className = "rm-handoff-submit";
    submitBtn.style.backgroundColor = primaryColor;
    submitBtn.innerHTML = ICONS.arrowRight;

    async function submitEmail() {
      const email = emailInput.value.trim();
      if (!email || !email.includes("@")) return;

      submitBtn.disabled = true;
      emailInput.disabled = true;

      try {
        if (conversationId) {
          await fetch(
            `${baseUrl}/api/widget/${projectSlug}/conversations/${conversationId}/email`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email }),
            },
          );
        }
        // Update local state
        visitorInfo.email = email;

        // Replace form with confirmation
        form.remove();

        // Remove subtitle if it exists
        const sub = card.querySelector(".rm-handoff-subtitle");
        if (sub) sub.remove();

        const confirmed = document.createElement("div");
        confirmed.className = "rm-handoff-confirmed";
        confirmed.innerHTML = ICONS.check;
        const confirmText = document.createElement("span");
        confirmText.textContent = `Thanks! We'll reach out at ${email}`;
        confirmed.appendChild(confirmText);
        card.appendChild(confirmed);
        scrollToBottom();
      } catch {
        submitBtn.disabled = false;
        emailInput.disabled = false;
      }
    }

    emailInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitEmail();
    });
    submitBtn.onclick = submitEmail;

    form.appendChild(emailInput);
    form.appendChild(submitBtn);
    card.appendChild(form);

    // Auto-focus the email input
    setTimeout(() => emailInput.focus(), 100);
  }

  // ─── Open / Close / Toggle ──────────────────────────────────────────────────

  function openChatWidget() {
    isOpen = true;
    chatWindow.classList.add("open");
    trigger.classList.add("active");
    // Don't auto-focus the chat input -- the home screen is shown first
  }

  function closeChatWidget() {
    isOpen = false;
    chatWindow.classList.remove("open");
    trigger.classList.remove("active");
  }

  function toggleChatWidget() {
    if (isOpen) {
      closeChatWidget();
    } else {
      openChatWidget();
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
