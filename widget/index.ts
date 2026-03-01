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
  let conversationStatus: string | null = null;
  const visitorId =
    localStorage.getItem("rm_visitor_id") || generateVisitorId();
  let visitorInfo: { name?: string; email?: string; phone?: string } = {};
  let customMetadata: Record<string, string> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let config: Record<string, any> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let _isHandedOff = false;

  // Polling state
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastMessageTimestamp: number | null = null;
  const renderedMessageIds = new Set<string>();
  let unreadCount = 0;

  // Send guard -- prevents duplicate message sends
  let isSending = false;

  // Streaming guard -- prevents polling from creating duplicate messages during SSE
  let isStreaming = false;

  // Notification state
  let notificationPermission: NotificationPermission = "default";

  // Visibility tracking
  let isTabActive = !document.hidden;

  function generateVisitorId(): string {
    const id = "v_" + Math.random().toString(36).substring(2, 15);
    localStorage.setItem("rm_visitor_id", id);
    return id;
  }

  // ─── Device Metadata Collection ─────────────────────────────────────────────
  function parseUserAgent(): { browser: string; os: string; device: string } {
    const ua = navigator.userAgent;
    let browser = "Unknown";
    let os = "Unknown";
    let device: "desktop" | "tablet" | "mobile" = "desktop";

    // Browser detection
    if (ua.includes("Firefox/")) {
      const match = ua.match(/Firefox\/(\d+)/);
      browser = `Firefox ${match?.[1] ?? ""}`.trim();
    } else if (ua.includes("Edg/")) {
      const match = ua.match(/Edg\/(\d+)/);
      browser = `Edge ${match?.[1] ?? ""}`.trim();
    } else if (ua.includes("Chrome/") && !ua.includes("Chromium/")) {
      const match = ua.match(/Chrome\/(\d+)/);
      browser = `Chrome ${match?.[1] ?? ""}`.trim();
    } else if (ua.includes("Safari/") && !ua.includes("Chrome")) {
      const match = ua.match(/Version\/(\d+)/);
      browser = `Safari ${match?.[1] ?? ""}`.trim();
    }

    // OS detection
    if (ua.includes("Windows")) {
      os = ua.includes("Windows NT 10") ? "Windows 10+" : "Windows";
    } else if (ua.includes("Mac OS X")) {
      const match = ua.match(/Mac OS X (\d+[._]\d+)/);
      os = `macOS ${match?.[1]?.replace(/_/g, ".") ?? ""}`.trim();
    } else if (ua.includes("iPhone") || ua.includes("iPad")) {
      const match = ua.match(/OS (\d+[._]\d+)/);
      os = `iOS ${match?.[1]?.replace(/_/g, ".") ?? ""}`.trim();
    } else if (ua.includes("Android")) {
      const match = ua.match(/Android (\d+(\.\d+)?)/);
      os = `Android ${match?.[1] ?? ""}`.trim();
    } else if (ua.includes("Linux")) {
      os = "Linux";
    }

    // Device type detection
    if (/Mobi|Android.*Mobile|iPhone|iPod/i.test(ua)) {
      device = "mobile";
    } else if (/iPad|Android(?!.*Mobile)|Tablet/i.test(ua)) {
      device = "tablet";
    }

    return { browser, os, device };
  }

  function collectDeviceMetadata(): Record<string, string> {
    const { browser, os, device } = parseUserAgent();
    return {
      browser,
      os,
      device,
      screenResolution: `${screen.width}x${screen.height}`,
      language: navigator.language,
      referrer: document.referrer || "",
      currentPageUrl: window.location.href,
      pageTitle: document.title,
      online: isTabActive ? "active" : "inactive",
    };
  }

  // ─── Conversation Persistence ───────────────────────────────────────────────
  function getStorageKey(suffix: string): string {
    return `rm_${projectSlug}_${suffix}`;
  }

  function persistConversationId(id: string): void {
    localStorage.setItem(getStorageKey("conversation_id"), id);
  }

  function loadPersistedConversationId(): string | null {
    return localStorage.getItem(getStorageKey("conversation_id"));
  }

  function clearPersistedConversation(): void {
    localStorage.removeItem(getStorageKey("conversation_id"));
  }

  // ─── SVG Icons ──────────────────────────────────────────────────────────────
  const ICONS = {
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>',
    headset:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>',
    arrowRight:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    sparkle:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    chevronRight:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    externalLink:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    backArrow:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    // Home link icons
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    docs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>',
    calendar:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    folder:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    globe:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    external:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
    paperclip:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    chevronLeft:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    clock:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    aiSparkle:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.912 5.813a2 2 0 0 0 1.275 1.275L21 12l-5.813 1.912a2 2 0 0 0-1.275 1.275L12 21l-1.912-5.813a2 2 0 0 0-1.275-1.275L3 12l5.813-1.912a2 2 0 0 0 1.275-1.275L12 3z"/><path d="M19 2l.5 1.5L21 4l-1.5.5L19 6l-.5-1.5L17 4l1.5-.5L19 2z"/></svg>',
    circleQuestion:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    phone:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  } as Record<string, string>;

  // ─── Styles ─────────────────────────────────────────────────────────────────
  const styles = document.createElement("style");
  styles.textContent = `
    .rm-widget-container {
      position: fixed;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      visibility: hidden;
    }
    .rm-widget-container.ready {
      visibility: visible;
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
      transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.3s ease;
      position: relative;
      color: white;
      opacity: 0;
      overflow: hidden;
    }
    .rm-trigger.ready {
      opacity: 1;
    }
    .rm-trigger:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 20px rgba(0,0,0,0.22);
    }
    .rm-trigger svg {
      width: 26px;
      height: 26px;
    }
    .rm-trigger-avatar {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      object-fit: cover;
    }
    .rm-trigger .rm-icon-chat,
    .rm-trigger .rm-icon-close {
      position: absolute;
      inset: 0;
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
    .rm-trigger-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 20px;
      height: 20px;
      border-radius: 10px;
      background: #ef4444;
      color: white;
      font-size: 11px;
      font-weight: 700;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 0 5px;
      line-height: 1;
      z-index: 1;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .rm-trigger-badge.visible {
      display: flex;
    }

    /* ─── Chat Window ─────────────────────────────────────────────────────── */
    .rm-chat-window {
      position: absolute;
      bottom: 74px;
      width: 400px;
      min-height: 600px;
      max-height: 620px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: var(--rm-chat-radius, 16px);
      box-shadow: 0 5px 40px rgba(0,0,0,0.16);
      border: 1px solid rgba(0,0,0,0.06);
      background: #ffffff;
      touch-action: manipulation;
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
      z-index: 2;
      margin-bottom: -24px;
      backdrop-filter: blur(16px) saturate(1.4);
      -webkit-backdrop-filter: blur(16px) saturate(1.4);
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
    .rm-header-avatar.rm-icon-avatar {
      border-radius: 10px;
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
      padding: 44px 16px 40px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-height: 300px;
      background: #fafafa;
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
    .rm-message-avatar.rm-icon-avatar {
      border-radius: 8px;
    }
    .rm-message-avatar svg {
      width: 14px;
      height: 14px;
    }
    .rm-message-avatar.hidden {
      visibility: hidden;
    }
    .rm-message-row.rm-role-change {
      margin-top: 8px;
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
      align-items: center;
      align-self: flex-start;
      gap: 8px;
      padding: 0 16px;
      max-height: 0;
      opacity: 0;
      overflow: hidden;
      transition: max-height 0.2s ease-out, opacity 0.2s ease-out, padding 0.2s ease-out;
    }
    .rm-typing-row.visible {
      max-height: 40px;
      opacity: 1;
      padding: 6px 16px;
    }
    .rm-typing-dots {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .rm-typing-dots span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #94a3b8;
      animation: rm-bounce 1.4s ease-in-out infinite;
    }
    .rm-typing-dots span:nth-child(2) {
      animation-delay: 0.2s;
    }
    .rm-typing-dots span:nth-child(3) {
      animation-delay: 0.4s;
    }
    .rm-status-text {
      font-size: 12px;
      font-weight: 500;
      color: #94a3b8;
    }
    @keyframes rm-bounce {
      0%, 60%, 100% {
        transform: translateY(0);
        opacity: 0.4;
      }
      30% {
        transform: translateY(-4px);
        opacity: 1;
      }
    }

    /* ─── Tool Error ─────────────────────────────────────────────────────── */
    .rm-tool-error {
      align-self: flex-start;
      padding: 0 16px;
      margin: 2px 0;
      max-width: 88%;
    }
    .rm-tool-error-header {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      font-size: 12px;
      color: #dc2626;
      user-select: none;
    }
    .rm-tool-error-header svg {
      width: 12px;
      height: 12px;
      flex-shrink: 0;
      transition: transform 0.15s ease;
    }
    .rm-tool-error.expanded .rm-tool-error-header svg {
      transform: rotate(180deg);
    }
    .rm-tool-error-detail {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.2s ease-out;
      font-size: 11px;
      color: #991b1b;
      background: #fef2f2;
      border-radius: 6px;
      padding: 0;
      margin-top: 0;
    }
    .rm-tool-error.expanded .rm-tool-error-detail {
      max-height: 200px;
      padding: 6px 8px;
      margin-top: 4px;
    }

    /* ─── Quick Topics ────────────────────────────────────────────────────── */
    .rm-quick-topics {
      padding: 8px 16px 4px;
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      background: rgba(250,250,250,0.80);
      backdrop-filter: blur(16px) saturate(1.4);
      -webkit-backdrop-filter: blur(16px) saturate(1.4);
      position: relative;
      z-index: 2;
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
      background: rgba(var(--rm-primary-rgb, 0,0,0), 0.05);
      border-color: rgba(var(--rm-primary-rgb, 0,0,0), 0.18);
    }

    /* ─── Input Area ──────────────────────────────────────────────────────── */
    .rm-input-area {
      padding: 12px 16px;
      border-top: 1px solid rgba(0,0,0,0.04);
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(255,255,255,0.80);
      backdrop-filter: blur(16px) saturate(1.4);
      -webkit-backdrop-filter: blur(16px) saturate(1.4);
      position: relative;
      z-index: 2;
      margin-top: -16px;
    }
    .rm-input {
      flex: 1;
      padding: 8px 14px;
      border: 1px solid rgba(0,0,0,0.10);
      border-radius: 24px;
      font-size: 14px;
      outline: none;
      background: #fafafa;
      color: #1f2937;
      transition: border-color 0.2s, box-shadow 0.2s;
      font-family: inherit;
      touch-action: manipulation;
    }
    .rm-input:focus {
      border-color: var(--rm-primary, rgba(0,0,0,0.2));
      box-shadow: 0 0 0 3px rgba(var(--rm-primary-rgb, 37,99,235), 0.08);
      background: #ffffff;
    }
    .rm-input::placeholder {
      color: #9ca3af;
    }
    .rm-send-btn {
      width: 36px;
      height: 36px;
      min-width: 36px;
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

    /* ─── Image Upload ─────────────────────────────────────────────────────── */
    .rm-attach-btn {
      width: 36px;
      height: 36px;
      min-width: 36px;
      border-radius: 50%;
      border: none;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #9ca3af;
      transition: color 0.2s, background 0.2s;
      padding: 0;
    }
    .rm-attach-btn:hover {
      color: #6b7280;
      background: rgba(0,0,0,0.04);
    }
    .rm-attach-btn svg {
      width: 18px;
      height: 18px;
    }
    .rm-image-preview {
      padding: 8px 16px 0;
      display: none;
      align-items: center;
      gap: 8px;
      background: rgba(255,255,255,0.80);
      backdrop-filter: blur(16px) saturate(1.4);
      -webkit-backdrop-filter: blur(16px) saturate(1.4);
      position: relative;
      z-index: 2;
    }
    .rm-image-preview.visible {
      display: flex;
    }
    .rm-image-preview img {
      width: 48px;
      height: 48px;
      object-fit: cover;
      border-radius: 8px;
      border: 1px solid rgba(0,0,0,0.08);
    }
    .rm-image-preview-name {
      flex: 1;
      font-size: 12px;
      color: #6b7280;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rm-image-preview-remove {
      width: 24px;
      height: 24px;
      min-width: 24px;
      border-radius: 50%;
      border: none;
      background: rgba(0,0,0,0.06);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #6b7280;
      padding: 0;
    }
    .rm-image-preview-remove:hover {
      background: rgba(0,0,0,0.1);
    }
    .rm-image-preview-remove svg {
      width: 12px;
      height: 12px;
    }
    .rm-message-image {
      max-width: 100%;
      border-radius: 10px;
      margin-bottom: 4px;
      cursor: pointer;
    }
    .rm-message-image:hover {
      opacity: 0.9;
    }

    /* ─── Powered By ──────────────────────────────────────────────────────── */
    .rm-powered {
      text-align: center;
      padding: 6px 16px 8px;
      font-size: 11px;
      color: #9ca3af;
      background: rgba(255,255,255,0.80);
      backdrop-filter: blur(16px) saturate(1.4);
      -webkit-backdrop-filter: blur(16px) saturate(1.4);
      position: relative;
      z-index: 2;
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
      border-color: var(--rm-primary, rgba(0,0,0,0.25));
      box-shadow: 0 0 0 3px rgba(var(--rm-primary-rgb, 37,99,235), 0.08);
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
      width: 100%;
      height: 120px;
      position: relative;
      flex-shrink: 0;
      background-size: cover;
      background-position: center center;
      background-repeat: no-repeat;
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
    .rm-home-avatar.rm-icon-avatar {
      border-radius: 14px;
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
      border-color: rgba(var(--rm-primary-rgb, 0,0,0), 0.25);
      box-shadow: 0 1px 4px rgba(var(--rm-primary-rgb, 0,0,0), 0.08);
    }
    .rm-home-ask-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--rm-primary, #6b7280);
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
      font-size: 16px;
      color: inherit;
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      padding: 0;
      touch-action: manipulation;
    }
    .rm-home-ask-input::placeholder {
      color: #9ca3af;
    }
    .rm-home-links {
      margin-top: 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .rm-home-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid rgba(0,0,0,0.07);
      border-radius: 10px;
      cursor: pointer;
      text-decoration: none;
      color: inherit;
      transition: background 0.2s, border-color 0.2s;
    }
    .rm-home-link:hover {
      background: rgba(0,0,0,0.02);
      border-color: rgba(0,0,0,0.12);
    }
    .rm-home-link-icon {
      width: 34px;
      height: 34px;
      min-width: 34px;
      border-radius: 8px;
      background: rgba(var(--rm-primary-rgb, 37,99,235), 0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--rm-primary, #6b7280);
      flex-shrink: 0;
    }
    .rm-home-link-icon svg {
      width: 16px;
      height: 16px;
    }
    .rm-home-link-label {
      flex: 1;
      font-size: 13.5px;
      font-weight: 500;
      color: #374151;
    }
    .rm-home-link-arrow {
      width: 16px;
      height: 16px;
      color: #c0c4cc;
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

    /* ─── Markdown in Messages ───────────────────────────────────────────── */
    .rm-message p {
      margin: 0 0 8px 0;
    }
    .rm-message p:last-child {
      margin-bottom: 0;
    }
    .rm-message ul, .rm-message ol {
      margin: 4px 0 8px 0;
      padding-left: 18px;
    }
    .rm-message li {
      margin-bottom: 3px;
    }
    .rm-message li:last-child {
      margin-bottom: 0;
    }
    .rm-message strong {
      font-weight: 600;
    }
    .rm-message em {
      font-style: italic;
    }
    .rm-message a {
      color: inherit;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .rm-message a:hover {
      opacity: 0.7;
    }
    .rm-message code {
      background: rgba(0,0,0,0.06);
      padding: 1px 5px;
      border-radius: 4px;
      font-size: 13px;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
    }

    /* ─── Source Links ────────────────────────────────────────────────────── */
    .rm-sources {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid rgba(0,0,0,0.06);
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .rm-source-link {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      text-decoration: none;
      font-size: 11px;
      line-height: 1.3;
      transition: opacity 0.2s;
      max-width: 100%;
      cursor: default;
    }
    a.rm-source-link {
      cursor: pointer;
    }
    a.rm-source-link:hover {
      opacity: 0.7;
    }
    .rm-source-icon {
      display: inline-flex;
      flex-shrink: 0;
    }
    .rm-source-link svg {
      width: 12px;
      height: 12px;
      flex-shrink: 0;
    }
    .rm-source-type {
      font-weight: 600;
      flex-shrink: 0;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .rm-source-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ─── Contact Form ────────────────────────────────────────────────────── */
    .rm-form-view {
      flex: 1;
      display: none;
      flex-direction: column;
      min-height: 0;
    }
    .rm-form-view.active {
      display: flex;
    }
    .rm-form-view > .rm-header {
      margin-bottom: 0;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      background-color: var(--rm-primary, #2563eb);
    }
    .rm-form-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: #fafafa;
    }
    .rm-form-body::-webkit-scrollbar {
      width: 4px;
    }
    .rm-form-body::-webkit-scrollbar-thumb {
      background: rgba(0,0,0,0.12);
      border-radius: 4px;
    }
    .rm-form-description {
      font-size: 14px;
      color: #6b7280;
      line-height: 1.5;
      text-align: center;
      padding: 8px 0;
    }
    .rm-form-field {
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .rm-form-label {
      font-size: 13px;
      font-weight: 500;
      color: #374151;
    }
    .rm-form-label .rm-required {
      color: #ef4444;
      margin-left: 2px;
    }
    .rm-form-input {
      padding: 10px 14px;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 10px;
      font-size: 16px;
      outline: none;
      font-family: inherit;
      color: #1f2937;
      background: #ffffff;
      transition: border-color 0.2s, box-shadow 0.2s;
      touch-action: manipulation;
    }
    .rm-form-input:focus {
      border-color: var(--rm-primary, rgba(0,0,0,0.25));
      box-shadow: 0 0 0 3px rgba(var(--rm-primary-rgb, 37,99,235), 0.08);
    }
    .rm-form-input::placeholder {
      color: #9ca3af;
    }
    .rm-form-textarea {
      padding: 10px 14px;
      border: 1px solid rgba(0,0,0,0.12);
      border-radius: 10px;
      font-size: 16px;
      outline: none;
      font-family: inherit;
      color: #1f2937;
      background: #ffffff;
      transition: border-color 0.2s, box-shadow 0.2s;
      resize: vertical;
      min-height: 80px;
      touch-action: manipulation;
    }
    .rm-form-textarea:focus {
      border-color: var(--rm-primary, rgba(0,0,0,0.25));
      box-shadow: 0 0 0 3px rgba(var(--rm-primary-rgb, 37,99,235), 0.08);
    }
    .rm-form-textarea::placeholder {
      color: #9ca3af;
    }
    .rm-form-submit {
      padding: 12px 24px;
      border-radius: 12px;
      border: none;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      color: white;
      transition: opacity 0.2s, transform 0.15s;
      font-family: inherit;
      margin-top: 4px;
    }
    .rm-form-submit:hover {
      opacity: 0.9;
    }
    .rm-form-submit:active {
      transform: scale(0.98);
    }
    .rm-form-submit:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    .rm-form-error {
      font-size: 12px;
      color: #ef4444;
      text-align: center;
    }
    .rm-form-success {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 40px 20px;
      text-align: center;
      flex: 1;
      background: #fafafa;
    }
    .rm-form-success-icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .rm-form-success-icon svg {
      width: 24px;
      height: 24px;
    }
    .rm-form-success-title {
      font-size: 16px;
      font-weight: 600;
      color: #1f2937;
    }
    .rm-form-success-subtitle {
      font-size: 13px;
      color: #6b7280;
      line-height: 1.4;
    }

    /* Quick action bar in home */
    .rm-home-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
    }
    .rm-home-action-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 9px 16px;
      border-radius: 20px;
      border: 1px solid rgba(0,0,0,0.08);
      background: #ffffff;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s, border-color 0.2s;
      color: #374151;
      font-family: inherit;
    }
    .rm-home-action-btn:hover {
      background: #f0f0f0;
      border-color: rgba(0,0,0,0.15);
    }
    .rm-home-action-btn svg {
      width: 14px;
      height: 14px;
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
    /* ─── Booking View ─────────────────────────────────────────────────────── */
    .rm-booking-view {
      display: none;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #fafafa;
    }
    .rm-booking-view.active {
      display: flex;
    }
    .rm-booking-view > .rm-header {
      margin-bottom: 0;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      background-color: var(--rm-primary, #2563eb);
    }
    .rm-booking-scroll {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
    }
    .rm-booking-scroll::-webkit-scrollbar { width: 4px; }
    .rm-booking-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 4px; }
    /* ── Month label row ─────────────────────────────────────────────────── */
    .rm-booking-month-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px 8px;
    }
    .rm-booking-month-label {
      font-size: 13px;
      font-weight: 600;
      color: #374151;
    }
    .rm-booking-month-arrows {
      display: flex;
      gap: 4px;
    }
    .rm-booking-date-arrow {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
      background: #fff;
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s;
    }
    .rm-booking-date-arrow:hover { background: #f3f4f6; }
    .rm-booking-date-arrow svg { width: 14px; height: 14px; color: #6b7280; }
    /* ── Date strip ──────────────────────────────────────────────────────── */
    .rm-booking-dates {
      display: flex;
      gap: 6px;
      padding: 4px 16px 14px;
      overflow-x: auto;
      scrollbar-width: none;
      -ms-overflow-style: none;
      scroll-behavior: smooth;
    }
    .rm-booking-dates::-webkit-scrollbar { display: none; }
    .rm-booking-date-pill {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px 0;
      border-radius: 12px;
      border: 1px solid #e5e7eb;
      background: #fff;
      cursor: pointer;
      min-width: 56px;
      transition: all 0.15s ease;
      flex-shrink: 0;
    }
    .rm-booking-date-pill:hover {
      border-color: #d1d5db;
      background: #f9fafb;
    }
    .rm-booking-date-pill.selected {
      border-color: var(--rm-primary, #2563eb);
      background: rgba(var(--rm-primary-rgb, 37,99,235), 0.08);
    }
    .rm-booking-date-pill.selected .rm-date-weekday,
    .rm-booking-date-pill.selected .rm-date-month {
      color: var(--rm-primary, #2563eb);
    }
    .rm-booking-date-pill.selected .rm-date-day {
      color: var(--rm-primary, #2563eb);
    }
    .rm-booking-date-pill.today:not(.selected) {
      border-color: var(--rm-primary, #2563eb);
    }
    .rm-date-weekday {
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
      color: #6b7280;
      letter-spacing: 0.5px;
    }
    .rm-date-day {
      font-size: 16px;
      font-weight: 700;
      color: #1f2937;
      line-height: 1.3;
    }
    .rm-date-month {
      font-size: 9px;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    /* ── Slots section ───────────────────────────────────────────────────── */
    .rm-booking-slots-section {
      padding: 0 16px 12px;
      border-top: 1px solid #e5e7eb;
    }
    .rm-booking-slots-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #9ca3af;
      padding: 12px 0 8px;
    }
    .rm-booking-slots-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .rm-booking-slots-loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 16px;
      color: #9ca3af;
      font-size: 13px;
    }
    .rm-booking-slot {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 10px 8px;
      border-radius: 10px;
      border: 1px solid #e5e7eb;
      background: #fff;
      font-size: 13px;
      font-weight: 500;
      color: #1f2937;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .rm-booking-slot:hover {
      border-color: var(--rm-primary, #2563eb);
      background: rgba(var(--rm-primary-rgb, 37,99,235), 0.04);
    }
    .rm-booking-slot.selected {
      border-color: var(--rm-primary, #2563eb);
      background: rgba(var(--rm-primary-rgb, 37,99,235), 0.08);
      color: var(--rm-primary, #2563eb);
      font-weight: 600;
    }
    .rm-booking-slot.unavailable {
      opacity: 0.35;
      cursor: not-allowed;
      text-decoration: line-through;
      pointer-events: none;
    }
    /* ── Inline fields + confirm ─────────────────────────────────────────── */
    .rm-booking-fields {
      padding: 12px 16px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .rm-booking-inline-field {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      background: #fff;
      transition: border-color 0.15s;
    }
    .rm-booking-inline-field:focus-within {
      border-color: var(--rm-primary, #2563eb);
      box-shadow: 0 0 0 3px rgba(var(--rm-primary-rgb, 37,99,235), 0.08);
    }
    .rm-booking-inline-field svg {
      width: 16px;
      height: 16px;
      color: #9ca3af;
      flex-shrink: 0;
    }
    .rm-booking-inline-field input {
      flex: 1;
      border: none;
      outline: none;
      font-size: 13px;
      color: #1f2937;
      background: transparent;
      font-family: inherit;
      min-width: 0;
    }
    .rm-booking-inline-field input::placeholder {
      color: #9ca3af;
    }
    .rm-booking-confirm-btn {
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      cursor: pointer;
      transition: opacity 0.15s;
      margin-top: 4px;
    }
    .rm-booking-confirm-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .rm-booking-confirm-btn:not(:disabled):hover {
      opacity: 0.9;
    }
    .rm-booking-error {
      color: #ef4444;
      font-size: 12px;
      text-align: center;
      margin-top: 4px;
      display: none;
    }
    .rm-booking-no-slots {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 16px;
      text-align: center;
      color: #9ca3af;
      font-size: 13px;
    }
    .rm-booking-no-slots svg {
      width: 32px;
      height: 32px;
      margin-bottom: 8px;
      opacity: 0.4;
    }
    /* ─── Booking Confirmation ─────────────────────────────────────────── */
    .rm-booking-confirmed {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      flex: 1;
      padding: 40px 24px;
      text-align: center;
    }
    .rm-booking-confirmed-icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
    }
    .rm-booking-confirmed-icon svg {
      width: 28px;
      height: 28px;
      color: #fff;
    }
    .rm-booking-confirmed h3 {
      font-size: 18px;
      font-weight: 700;
      color: #1f2937;
      margin: 0 0 12px;
    }
    .rm-booking-confirmed-details {
      font-size: 14px;
      font-weight: 500;
      color: #374151;
      margin-bottom: 4px;
    }
    .rm-booking-confirmed-time {
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 16px;
    }
    .rm-booking-confirmed-email {
      font-size: 13px;
      color: #6b7280;
      line-height: 1.5;
    }
    .rm-booking-confirmed-email strong {
      color: #374151;
    }
    .rm-booking-back-btn {
      margin-top: 24px;
      padding: 10px 24px;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      background: #fff;
      font-size: 13px;
      font-weight: 500;
      color: #374151;
      cursor: pointer;
      transition: background 0.15s;
    }
    .rm-booking-back-btn:hover { background: #f9fafb; }
    .rm-booking-no-slots {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 40px 16px;
      text-align: center;
      color: #9ca3af;
      font-size: 13px;
    }
    .rm-booking-no-slots svg {
      width: 32px;
      height: 32px;
      margin-bottom: 8px;
      opacity: 0.4;
    }

    @media (max-width: 480px) {
      .rm-widget-container.bottom-right,
      .rm-widget-container.bottom-left {
        bottom: 16px;
        right: 16px;
        left: auto;
      }
      .rm-widget-container {
        --rm-chat-radius: 0px !important;
      }
      .rm-chat-window {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        min-height: 0;
        max-height: none;
        height: 100%;
        box-shadow: none;
        border: none;
        transform-origin: bottom center;
      }
      .rm-chat-window.bottom-right,
      .rm-chat-window.bottom-left {
        right: 0;
        left: 0;
      }
      .rm-chat-window.open ~ .rm-trigger {
        display: none;
      }
    }

    /* ─── Center Inline Bar ──────────────────────────────────────────────── */
    @property --rm-glow-angle {
      syntax: "<angle>";
      initial-value: 0deg;
      inherits: false;
    }
    @keyframes rm-glow-spin {
      to { --rm-glow-angle: 360deg; }
    }
    @keyframes rm-topic-slide-up {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .rm-inline-bar {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      width: 320px;
      max-width: calc(100% - 40px);
      z-index: 999999;
      border-radius: 28px;
      padding: 2px;
      background: conic-gradient(
        from var(--rm-glow-angle, 0deg),
        var(--rm-primary, #2563eb),
        color-mix(in srgb, var(--rm-primary, #2563eb), #ffffff 40%),
        var(--rm-primary, #2563eb),
        color-mix(in srgb, var(--rm-primary, #2563eb), #000000 30%),
        var(--rm-primary, #2563eb)
      );
      animation: rm-glow-spin 4s linear infinite;
      transition: width 0.35s cubic-bezier(0.4,0,0.2,1), border-radius 0.35s cubic-bezier(0.4,0,0.2,1);
      will-change: width;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      visibility: hidden;
    }
    .rm-inline-bar.ready {
      visibility: visible;
    }
    .rm-inline-bar.hidden {
      display: none;
    }
    .rm-inline-bar.expanded {
      width: 560px;
    }
    .rm-inline-bar-inner {
      background: color-mix(in srgb, var(--rm-primary, #2563eb), #000000 85%);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-radius: 26px;
      display: flex;
      align-items: center;
      padding: 6px 8px 6px 20px;
      gap: 8px;
      position: relative;
    }
    .rm-inline-bar-input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: #ffffff;
      font-size: 15px;
      line-height: 1.4;
      min-width: 0;
      caret-color: #ffffff;
    }
    .rm-inline-bar-input::placeholder {
      color: rgba(255, 255, 255, 0.5);
    }
    .rm-inline-bar-placeholder {
      position: absolute;
      left: 20px;
      top: 50%;
      transform: translateY(-50%);
      color: rgba(255, 255, 255, 0.5);
      font-size: 15px;
      pointer-events: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: calc(100% - 64px);
      transition: opacity 0.3s ease;
    }
    .rm-inline-bar-placeholder.fade-out {
      opacity: 0;
    }
    .rm-inline-bar-btn {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      border: none;
      background: var(--rm-primary, #2563eb);
      color: #ffffff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: transform 0.2s ease, background 0.2s ease;
      position: relative;
    }
    .rm-inline-bar-btn:hover {
      transform: scale(1.05);
    }
    .rm-inline-bar-btn svg {
      width: 16px;
      height: 16px;
    }
    .rm-inline-bar-btn .rm-ib-icon-send,
    .rm-inline-bar-btn .rm-ib-icon-close {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .rm-inline-bar-btn .rm-ib-icon-send {
      opacity: 1;
      transform: scale(1);
    }
    .rm-inline-bar-btn .rm-ib-icon-close {
      opacity: 0;
      transform: scale(0.5);
    }
    .rm-inline-bar-btn.show-close .rm-ib-icon-send {
      opacity: 0;
      transform: scale(0.5);
    }
    .rm-inline-bar-btn.show-close .rm-ib-icon-close {
      opacity: 1;
      transform: scale(1);
    }

    /* Topics panel above the bar */
    .rm-inline-bar-topics {
      position: absolute;
      bottom: calc(100% + 10px);
      left: 0;
      right: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 0 4px;
      opacity: 0;
      visibility: hidden;
      transform: translateY(8px);
      transition: opacity 0.25s ease, transform 0.25s ease, visibility 0.25s;
      pointer-events: none;
    }
    .rm-inline-bar.expanded .rm-inline-bar-topics {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
      pointer-events: auto;
    }
    /* Hide topics when chat is active — the chat window sits above the bar */
    .rm-inline-bar.chat-active .rm-inline-bar-topics {
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translateY(8px);
    }
    .rm-inline-bar-topic {
      display: inline-flex;
      align-self: flex-start;
      padding: 10px 18px;
      border-radius: 22px;
      border: none;
      background: color-mix(in srgb, var(--rm-primary, #2563eb), #000000 70%);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: #ffffff;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.2s ease, transform 0.1s ease;
      line-height: 1.3;
      text-align: left;
    }
    .rm-inline-bar-topic:hover {
      background: color-mix(in srgb, var(--rm-primary, #2563eb), #000000 55%);
      transform: translateX(4px);
    }
    .rm-inline-bar.expanded .rm-inline-bar-topic {
      animation: rm-topic-slide-up 0.3s ease forwards;
    }
    .rm-inline-bar.expanded .rm-inline-bar-topic:nth-child(1) { animation-delay: 0s; }
    .rm-inline-bar.expanded .rm-inline-bar-topic:nth-child(2) { animation-delay: 0.05s; }
    .rm-inline-bar.expanded .rm-inline-bar-topic:nth-child(3) { animation-delay: 0.1s; }
    .rm-inline-bar.expanded .rm-inline-bar-topic:nth-child(4) { animation-delay: 0.15s; }
    .rm-inline-bar.expanded .rm-inline-bar-topic:nth-child(5) { animation-delay: 0.2s; }

    /* ─── Center-Inline: chat window sits directly above the inline bar ──── */
    .rm-widget-container.center-inline {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      top: 0;
      pointer-events: none;
    }
    .rm-widget-container.center-inline .rm-trigger {
      display: none;
    }
    .rm-widget-container.center-inline .rm-chat-window {
      position: fixed;
      /* Sit directly above the inline bar: bar is at bottom:24px, ~50px tall + 8px gap */
      bottom: 82px;
      left: 50%;
      transform: translateX(-50%) translateY(12px);
      right: auto;
      width: 560px;
      max-width: calc(100% - 40px);
      min-height: 0;
      max-height: min(520px, calc(100vh - 120px));
      transform-origin: bottom center;
      pointer-events: auto;
      background: color-mix(in srgb, var(--rm-primary, #2563eb), #000000 85%);
      backdrop-filter: blur(24px) saturate(1.4);
      -webkit-backdrop-filter: blur(24px) saturate(1.4);
      box-shadow: 0 8px 40px rgba(0,0,0,0.35), 0 0 0 1px rgba(var(--rm-primary-rgb), 0.15);
      border: 1px solid rgba(var(--rm-primary-rgb), 0.12);
      border-radius: 20px;
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transition: opacity 0.3s cubic-bezier(0.4,0,0.2,1),
                  transform 0.3s cubic-bezier(0.4,0,0.2,1),
                  visibility 0.3s;
    }
    .rm-widget-container.center-inline .rm-chat-window.open {
      opacity: 1;
      visibility: visible;
      transform: translateX(-50%) translateY(0);
      pointer-events: auto;
    }
    .rm-widget-container.center-inline .rm-chat-window.bottom-right,
    .rm-widget-container.center-inline .rm-chat-window.bottom-left {
      right: auto;
      left: 50%;
      transform-origin: bottom center;
    }
    .rm-widget-container.center-inline .rm-chat-window.bottom-right.open,
    .rm-widget-container.center-inline .rm-chat-window.bottom-left.open {
      transform: translateX(-50%) translateY(0);
    }
    /* Dark frosted header matching inline bar aesthetic */
    .rm-widget-container.center-inline .rm-header {
      background: rgba(var(--rm-primary-rgb), 0.12);
      backdrop-filter: blur(20px) saturate(1.4);
      -webkit-backdrop-filter: blur(20px) saturate(1.4);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      margin-bottom: 0;
      padding: 14px 16px;
    }
    /* Hide back button in center-inline -- only X (close) button shown */
    .rm-widget-container.center-inline .rm-header-back {
      display: none;
    }
    .rm-widget-container.center-inline .rm-header-close {
      background: rgba(255, 255, 255, 0.08);
    }
    .rm-widget-container.center-inline .rm-header-close:hover {
      background: rgba(255, 255, 255, 0.15);
    }
    /* Transparent messages area with no extra padding for header overlap */
    .rm-widget-container.center-inline .rm-messages {
      background: transparent;
      padding-top: 16px;
      padding-bottom: 16px;
      min-height: 120px;
    }
    /* Bot bubbles: frosted glass with primary tint */
    .rm-widget-container.center-inline .rm-message-row.bot .rm-message {
      background: rgba(var(--rm-primary-rgb), 0.12);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.06);
      color: #ffffff;
    }
    .rm-widget-container.center-inline .rm-message-row.bot .rm-message a {
      color: color-mix(in srgb, var(--rm-primary, #2563eb), #ffffff 50%);
    }
    /* Visitor bubbles: solid primary color */
    .rm-widget-container.center-inline .rm-message-row.visitor .rm-message {
      background: var(--rm-primary, #2563eb) !important;
      color: #ffffff !important;
    }
    /* Hide the chat window's own input area — the inline bar IS the input */
    .rm-widget-container.center-inline .rm-input-area {
      display: none;
    }
    /* Hide image preview in chat window for center-inline (we'll handle attachments via inline bar) */
    .rm-widget-container.center-inline .rm-image-preview {
      display: none;
    }
    /* Quick topics inside the chat window */
    .rm-widget-container.center-inline .rm-quick-topics {
      background: transparent;
      backdrop-filter: none;
      padding-bottom: 8px;
    }
    .rm-widget-container.center-inline .rm-quick-topic {
      background: rgba(var(--rm-primary-rgb), 0.15);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: #ffffff;
      border-color: rgba(255, 255, 255, 0.08);
    }
    .rm-widget-container.center-inline .rm-quick-topic:hover {
      background: rgba(var(--rm-primary-rgb), 0.25);
      border-color: rgba(255, 255, 255, 0.12);
    }
    /* Powered-by footer: subtle in dark theme */
    .rm-widget-container.center-inline .rm-powered {
      background: transparent;
      color: rgba(255, 255, 255, 0.3);
      padding: 4px 16px 6px;
    }
    .rm-widget-container.center-inline .rm-powered a {
      color: rgba(255, 255, 255, 0.4);
    }
    .rm-widget-container.center-inline .rm-powered a:hover {
      color: rgba(255, 255, 255, 0.6);
    }
    /* Home view hidden in center-inline */
    .rm-widget-container.center-inline .rm-home {
      display: none;
    }
    /* Sources styling */
    .rm-widget-container.center-inline .rm-source-link {
      background: rgba(var(--rm-primary-rgb), 0.12);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      color: #ffffff !important;
      border-color: rgba(255, 255, 255, 0.08);
    }
    /* Typing indicator */
    .rm-widget-container.center-inline .rm-typing-row {
      background: rgba(var(--rm-primary-rgb), 0.12);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-radius: 12px;
    }
    .rm-widget-container.center-inline .rm-typing-dots span {
      background: rgba(255, 255, 255, 0.5);
    }
    .rm-widget-container.center-inline .rm-status-text {
      color: rgba(255, 255, 255, 0.5);
    }
    /* Handoff card dark theme */
    .rm-widget-container.center-inline .rm-handoff-card {
      background: rgba(var(--rm-primary-rgb), 0.1);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.06);
      box-shadow: none;
    }
    .rm-widget-container.center-inline .rm-handoff-title {
      color: #ffffff;
    }
    .rm-widget-container.center-inline .rm-handoff-subtitle {
      color: rgba(255, 255, 255, 0.6);
    }
    /* Tool error dark theme */
    .rm-widget-container.center-inline .rm-tool-error-header {
      color: #fca5a5;
    }
    .rm-widget-container.center-inline .rm-tool-error-detail {
      color: #fecaca;
      background: rgba(220, 38, 38, 0.15);
    }

    /* When chat is active, inline bar gets a slightly different style (no glow, solid border) */
    .rm-inline-bar.chat-active {
      animation: none;
      background: color-mix(in srgb, var(--rm-primary, #2563eb), #000000 70%);
      border-radius: 20px;
    }
    .rm-inline-bar.chat-active .rm-inline-bar-inner {
      border-radius: 18px;
    }

    /* Center-inline: mobile overrides */
    @media (max-width: 480px) {
      .rm-inline-bar {
        bottom: 16px;
        width: 280px;
        max-width: calc(100% - 32px);
      }
      .rm-inline-bar.expanded {
        left: 16px;
        right: 16px;
        width: auto;
        transform: none;
      }
      .rm-inline-bar-topic {
        font-size: 13px;
        padding: 8px 14px;
      }
      /* On mobile, chat window goes full-screen and inline bar hides */
      .rm-widget-container.center-inline .rm-chat-window {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100%;
        height: 100%;
        max-width: none;
        max-height: none;
        min-height: 0;
        border-radius: 0;
        border: none;
        box-shadow: none;
        transform: translateY(16px);
        transform-origin: bottom center;
      }
      .rm-widget-container.center-inline .rm-chat-window.open {
        transform: translateY(0);
      }
      .rm-widget-container.center-inline .rm-chat-window.bottom-right.open,
      .rm-widget-container.center-inline .rm-chat-window.bottom-left.open {
        transform: translateY(0);
        left: 0;
      }
      /* On mobile full-screen, show the input area inside the chat window */
      .rm-widget-container.center-inline .rm-chat-window.open .rm-input-area {
        display: flex;
        background: color-mix(in srgb, var(--rm-primary, #2563eb), #000000 85%);
        border-top: 1px solid rgba(255, 255, 255, 0.06);
      }
      .rm-widget-container.center-inline .rm-chat-window.open .rm-input {
        background: rgba(var(--rm-primary-rgb), 0.1);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(var(--rm-primary-rgb), 0.15);
        border-radius: 12px;
        padding: 10px 14px;
        font-size: 16px;
        color: #ffffff !important;
      }
      .rm-widget-container.center-inline .rm-chat-window.open .rm-input::placeholder {
        color: rgba(255, 255, 255, 0.5);
      }
      .rm-widget-container.center-inline .rm-chat-window.open .rm-send-btn {
        color: #ffffff;
      }
      .rm-widget-container.center-inline .rm-chat-window.open .rm-attach-btn {
        color: rgba(255, 255, 255, 0.5);
      }
      /* Prevent iOS input zoom — all inputs must be 16px */
      .rm-inline-bar-input {
        font-size: 16px !important;
      }
      .rm-input {
        font-size: 16px !important;
      }
      .rm-home-ask-input {
        font-size: 16px !important;
      }
      .rm-handoff-email-input {
        font-size: 16px !important;
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
  homeAvatar.className = "rm-home-avatar rm-icon-avatar";
  homeAvatar.innerHTML = ICONS.aiSparkle;
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

  // ─── Contact Form View ──────────────────────────────────────────────────────
  const formView = document.createElement("div");
  formView.className = "rm-form-view";

  // Form header (reuses chat header pattern)
  const formHeader = document.createElement("div");
  formHeader.className = "rm-header";

  const formHeaderBack = document.createElement("button");
  formHeaderBack.className = "rm-header-back";
  formHeaderBack.innerHTML = ICONS.backArrow;
  formHeaderBack.onclick = () => showHomeScreen();

  const formHeaderIcon = document.createElement("div");
  formHeaderIcon.className = "rm-header-avatar";
  formHeaderIcon.innerHTML = ICONS.mail;

  const formHeaderInfo = document.createElement("div");
  formHeaderInfo.className = "rm-header-info";

  const formHeaderTitle = document.createElement("div");
  formHeaderTitle.className = "rm-header-title";
  formHeaderTitle.textContent = "Leave a message";

  const formHeaderSubtitle = document.createElement("div");
  formHeaderSubtitle.className = "rm-header-subtitle";
  formHeaderSubtitle.textContent = "We'll get back to you soon";

  formHeaderInfo.appendChild(formHeaderTitle);
  formHeaderInfo.appendChild(formHeaderSubtitle);

  const formCloseBtn = document.createElement("button");
  formCloseBtn.className = "rm-header-close";
  formCloseBtn.innerHTML = ICONS.close;
  formCloseBtn.onclick = () => closeChatWidget();

  formHeader.appendChild(formHeaderBack);
  formHeader.appendChild(formHeaderIcon);
  formHeader.appendChild(formHeaderInfo);
  formHeader.appendChild(formCloseBtn);

  // Form body (scrollable area with fields)
  const formBody = document.createElement("div");
  formBody.className = "rm-form-body";

  formView.appendChild(formHeader);
  formView.appendChild(formBody);

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
  headerAvatar.className = "rm-header-avatar rm-icon-avatar";
  headerAvatar.innerHTML = ICONS.aiSparkle;

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

  // Typing indicator (lives inside messagesContainer — always last child)
  const typingRow = document.createElement("div");
  typingRow.className = "rm-typing-row";

  const typingDots = document.createElement("div");
  typingDots.className = "rm-typing-dots";
  for (let i = 0; i < 3; i++) {
    typingDots.appendChild(document.createElement("span"));
  }

  const statusText = document.createElement("span");
  statusText.className = "rm-status-text";
  statusText.textContent = "Thinking";

  typingRow.appendChild(typingDots);
  typingRow.appendChild(statusText);
  messagesContainer.appendChild(typingRow);

  // Quick topics
  const quickTopicsContainer = document.createElement("div");
  quickTopicsContainer.className = "rm-quick-topics";

  // Image preview bar (shown above input when an image is selected)
  const imagePreview = document.createElement("div");
  imagePreview.className = "rm-image-preview";
  const imagePreviewImg = document.createElement("img");
  imagePreviewImg.alt = "Preview";
  const imagePreviewName = document.createElement("span");
  imagePreviewName.className = "rm-image-preview-name";
  const imagePreviewRemove = document.createElement("button");
  imagePreviewRemove.className = "rm-image-preview-remove";
  imagePreviewRemove.innerHTML = ICONS.x;
  imagePreview.appendChild(imagePreviewImg);
  imagePreview.appendChild(imagePreviewName);
  imagePreview.appendChild(imagePreviewRemove);

  // Input area
  const inputArea = document.createElement("div");
  inputArea.className = "rm-input-area";

  // Hidden file input for image selection
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/jpeg,image/png,image/webp";
  fileInput.style.display = "none";

  // Paperclip button
  const attachBtn = document.createElement("button");
  attachBtn.className = "rm-attach-btn";
  attachBtn.innerHTML = ICONS.paperclip;
  attachBtn.type = "button";

  const input = document.createElement("input");
  input.className = "rm-input";
  input.placeholder = "Type a message...";

  const sendBtn = document.createElement("button");
  sendBtn.className = "rm-send-btn";
  sendBtn.innerHTML = ICONS.send;

  inputArea.appendChild(fileInput);
  inputArea.appendChild(attachBtn);
  inputArea.appendChild(input);
  inputArea.appendChild(sendBtn);

  // Track pending image file
  let pendingImageFile: File | null = null;

  // Assemble chat view
  chatView.appendChild(header);
  chatView.appendChild(messagesContainer);
  chatView.appendChild(quickTopicsContainer);
  chatView.appendChild(imagePreview);
  chatView.appendChild(inputArea);

  // Powered by
  const powered = document.createElement("div");
  powered.className = "rm-powered";
  powered.innerHTML =
    'Powered by <a href="https://replymaven.com" target="_blank" rel="noopener">ReplyMaven</a>';

  // ─── Booking View ────────────────────────────────────────────────────────────
  const bookingView = document.createElement("div");
  bookingView.className = "rm-booking-view";

  // Booking header (reuses the .rm-header style)
  const bookingHeader = document.createElement("div");
  bookingHeader.className = "rm-header";
  const bookingHeaderBack = document.createElement("button");
  bookingHeaderBack.className = "rm-header-back";
  bookingHeaderBack.innerHTML = ICONS.backArrow;
  bookingHeaderBack.onclick = () => showHomeScreen();
  const bookingHeaderTitle = document.createElement("div");
  bookingHeaderTitle.style.cssText = "flex:1;min-width:0;";
  bookingHeaderTitle.innerHTML =
    '<div style="font-weight:600;font-size:14px;">Book a Meeting</div><div class="rm-booking-subtitle" style="font-size:12px;opacity:0.75;margin-top:1px;">Select a date & time</div>';
  const bookingHeaderClose = document.createElement("button");
  bookingHeaderClose.className = "rm-header-close";
  bookingHeaderClose.innerHTML = ICONS.close;
  bookingHeaderClose.onclick = () => closeChatWidget();
  bookingHeader.appendChild(bookingHeaderBack);
  bookingHeader.appendChild(bookingHeaderTitle);
  bookingHeader.appendChild(bookingHeaderClose);
  bookingView.appendChild(bookingHeader);

  // Booking content container (swapped between step1/step2/step3)
  const bookingContent = document.createElement("div");
  bookingContent.style.cssText =
    "display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;";
  bookingView.appendChild(bookingContent);

  // Assemble chat window
  chatWindow.appendChild(homeView);
  chatWindow.appendChild(formView);
  chatWindow.appendChild(bookingView);
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
  const triggerBadge = document.createElement("span");
  triggerBadge.className = "rm-trigger-badge";
  triggerBadge.textContent = "0";
  trigger.appendChild(triggerChatIcon);
  trigger.appendChild(triggerCloseIcon);
  trigger.appendChild(triggerBadge);
  trigger.onclick = () => toggleChatWidget();

  container.appendChild(chatWindow);
  container.appendChild(trigger);
  document.body.appendChild(container);

  // ─── Inline Bar DOM (created once, shown only for inline-bar variant) ───────
  const inlineBar = document.createElement("div");
  inlineBar.className = "rm-inline-bar";

  const inlineBarTopics = document.createElement("div");
  inlineBarTopics.className = "rm-inline-bar-topics";

  const inlineBarInner = document.createElement("div");
  inlineBarInner.className = "rm-inline-bar-inner";

  const inlineBarPlaceholder = document.createElement("span");
  inlineBarPlaceholder.className = "rm-inline-bar-placeholder";
  inlineBarPlaceholder.textContent = "Ask a question...";

  const inlineBarInput = document.createElement("input");
  inlineBarInput.className = "rm-inline-bar-input";
  inlineBarInput.type = "text";

  const inlineBarBtn = document.createElement("button");
  inlineBarBtn.className = "rm-inline-bar-btn";

  const ibSendIcon = document.createElement("span");
  ibSendIcon.className = "rm-ib-icon-send";
  ibSendIcon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';

  const ibCloseIcon = document.createElement("span");
  ibCloseIcon.className = "rm-ib-icon-close";
  ibCloseIcon.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  inlineBarBtn.appendChild(ibSendIcon);
  inlineBarBtn.appendChild(ibCloseIcon);

  inlineBarInner.appendChild(inlineBarPlaceholder);
  inlineBarInner.appendChild(inlineBarInput);
  inlineBarInner.appendChild(inlineBarBtn);

  inlineBar.appendChild(inlineBarTopics);
  inlineBar.appendChild(inlineBarInner);

  // Not appended to body yet — only when variant is "inline-bar" in loadConfig

  // ─── Inline Bar State ───────────────────────────────────────────────────────
  let isInlineBarVariant = false;
  let inlineBarExpanded = false;
  let placeholderTexts: string[] = ["Ask a question..."];
  let placeholderIndex = 0;
  let placeholderInterval: ReturnType<typeof setInterval> | null = null;

  function expandInlineBar() {
    if (inlineBarExpanded) return;
    inlineBarExpanded = true;
    inlineBar.classList.add("expanded");
    inlineBarPlaceholder.style.display = "none";
    inlineBarInput.placeholder = conversationId
      ? "Type a message..."
      : "Ask a question...";
    inlineBarInput.focus();
    stopPlaceholderRotation();
    updateInlineBarBtn();
  }

  function collapseInlineBar() {
    if (!inlineBarExpanded) return;
    inlineBarExpanded = false;
    inlineBar.classList.remove("expanded");
    inlineBarInput.value = "";
    inlineBarInput.placeholder = "";
    inlineBarInput.blur();
    inlineBarPlaceholder.style.display = "";
    startPlaceholderRotation();
    updateInlineBarBtn();
  }

  function updateInlineBarBtn() {
    // When chat is active, always show send icon (never the close icon)
    if (isOpen && isInlineBarVariant) {
      inlineBarBtn.classList.remove("show-close");
      return;
    }
    if (inlineBarExpanded && inlineBarInput.value.trim() === "") {
      inlineBarBtn.classList.add("show-close");
    } else {
      inlineBarBtn.classList.remove("show-close");
    }
  }

  function startPlaceholderRotation() {
    if (placeholderInterval) return;
    if (placeholderTexts.length <= 1) {
      inlineBarPlaceholder.textContent =
        placeholderTexts[0] || "Ask a question...";
      return;
    }
    placeholderIndex = 0;
    inlineBarPlaceholder.textContent = placeholderTexts[0];
    inlineBarPlaceholder.classList.remove("fade-out");

    placeholderInterval = setInterval(() => {
      inlineBarPlaceholder.classList.add("fade-out");
      setTimeout(() => {
        placeholderIndex = (placeholderIndex + 1) % placeholderTexts.length;
        inlineBarPlaceholder.textContent = placeholderTexts[placeholderIndex];
        inlineBarPlaceholder.classList.remove("fade-out");
      }, 300);
    }, 3000);
  }

  function stopPlaceholderRotation() {
    if (placeholderInterval) {
      clearInterval(placeholderInterval);
      placeholderInterval = null;
    }
  }

  function sendFromInlineBar() {
    const text = inlineBarInput.value.trim();
    if (!text || isSending) return;
    inlineBarInput.value = "";
    // Keep the inline bar expanded — it IS the input
    // Open the chat window above it and send the message
    showChatScreen();
    openChatWidget();
    setTimeout(() => handleSendMessage(text), 100);
  }

  // Inline bar event listeners
  inlineBarInput.addEventListener("focus", () => {
    if (!inlineBarExpanded) expandInlineBar();
    // If there's a conversation to restore, open the chat window
    if (isInlineBarVariant && !isOpen && conversationId) {
      showChatScreen();
      openChatWidget();
    }
  });

  inlineBarInput.addEventListener("input", () => {
    updateInlineBarBtn();
  });

  inlineBarInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // If chat is already open, send directly as a chat message
      if (isOpen && isInlineBarVariant) {
        const text = inlineBarInput.value.trim();
        if (!text || isSending) return;
        inlineBarInput.value = "";
        handleSendMessage(text);
      } else {
        sendFromInlineBar();
      }
    }
  });

  inlineBarBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    // If chat is active, use inline bar as chat input
    if (isOpen && isInlineBarVariant) {
      const text = inlineBarInput.value.trim();
      if (!text || isSending) return;
      inlineBarInput.value = "";
      handleSendMessage(text);
    } else if (inlineBarInput.value.trim()) {
      sendFromInlineBar();
    } else if (inlineBarExpanded) {
      collapseInlineBar();
    } else {
      expandInlineBar();
    }
  });

  // Click outside to collapse (but not when chat is active — user may click in chat window)
  document.addEventListener("click", (e) => {
    if (!isInlineBarVariant || !inlineBarExpanded) return;
    // Don't collapse when chat is open — the bar stays as input
    if (isOpen) return;
    if (!inlineBar.contains(e.target as Node)) {
      collapseInlineBar();
    }
  });

  // ─── View State ──────────────────────────────────────────────────────────────
  let currentView: "home" | "chat" | "form" | "booking" = "home";

  function showChatScreen() {
    currentView = "chat";
    homeView.classList.add("hidden");
    formView.classList.remove("active");
    bookingView.classList.remove("active");
    chatView.classList.add("active");
    setTimeout(() => input.focus(), 100);
  }

  function showHomeScreen() {
    currentView = "home";
    homeView.classList.remove("hidden");
    formView.classList.remove("active");
    bookingView.classList.remove("active");
    chatView.classList.remove("active");
  }

  function showFormScreen() {
    currentView = "form";
    homeView.classList.add("hidden");
    chatView.classList.remove("active");
    bookingView.classList.remove("active");
    formView.classList.add("active");
  }

  function showBookingScreen() {
    currentView = "booking";
    homeView.classList.add("hidden");
    chatView.classList.remove("active");
    formView.classList.remove("active");
    bookingView.classList.add("active");
    initBookingView();
  }

  // ─── Visibility Tracking ─────────────────────────────────────────────────────
  document.addEventListener("visibilitychange", () => {
    isTabActive = !document.hidden;
  });

  // ─── Event Handlers ─────────────────────────────────────────────────────────

  // Home screen ask box: clicking anywhere in the bordered area opens chat
  homeAsk.addEventListener("click", () => {
    showChatScreen();
  });
  homeAskInput.addEventListener("focus", () => {
    showChatScreen();
  });

  // Also handle typing directly in the home ask input
  homeAskInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !isSending && homeAskInput.value.trim()) {
      const text = homeAskInput.value.trim();
      homeAskInput.value = "";
      showChatScreen();
      handleSendMessage(text);
    }
  });

  input.addEventListener("keydown", (e) => {
    if (
      e.key === "Enter" &&
      !isSending &&
      (input.value.trim() || pendingImageFile)
    ) {
      handleSendMessage(input.value.trim());
      input.value = "";
    }
  });

  sendBtn.addEventListener("click", () => {
    if (!isSending && (input.value.trim() || pendingImageFile)) {
      handleSendMessage(input.value.trim());
      input.value = "";
    }
  });

  // ─── Image Upload Handlers ──────────────────────────────────────────────────

  attachBtn.addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    // Validate file type and size
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      return;
    }

    pendingImageFile = file;

    // Show preview
    const reader = new FileReader();
    reader.onload = () => {
      imagePreviewImg.src = reader.result as string;
      imagePreviewName.textContent = file.name;
      imagePreview.classList.add("visible");
    };
    reader.readAsDataURL(file);

    // Reset file input so the same file can be re-selected
    fileInput.value = "";
  });

  imagePreviewRemove.addEventListener("click", () => {
    pendingImageFile = null;
    imagePreview.classList.remove("visible");
    imagePreviewImg.src = "";
    imagePreviewName.textContent = "";
  });

  // ─── Functions ──────────────────────────────────────────────────────────────

  function getPrimaryColor(): string {
    return config?.widget?.primaryColor ?? "#2563eb";
  }

  function hexToRgb(hex: string): string {
    const h = hex.replace("#", "");
    const bigint = parseInt(
      h.length === 3
        ? h
            .split("")
            .map((c) => c + c)
            .join("")
        : h,
      16,
    );
    return `${(bigint >> 16) & 255}, ${(bigint >> 8) & 255}, ${bigint & 255}`;
  }

  function resolveUrl(url: string): string {
    if (!url) return url;
    if (
      url.startsWith("http://") ||
      url.startsWith("https://") ||
      url.startsWith("data:")
    )
      return url;
    return baseUrl + url;
  }

  /** Lightweight markdown to HTML (bold, italic, code, lists, links, paragraphs) */
  function renderMarkdown(text: string): string {
    // Escape HTML entities first
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Inline code (before other inline formatting)
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Bold **text** or __text__
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

    // Italic *text* or _text_ (but not inside words with underscores)
    html = html.replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, "<em>$1</em>");
    html = html.replace(/(?<!\w)_([^_]+?)_(?!\w)/g, "<em>$1</em>");

    // Links [text](url)
    html = html.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    );

    // Split into lines for block-level processing
    const lines = html.split("\n");
    const output: string[] = [];
    let inUl = false;
    let inOl = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const ulMatch = line.match(/^[\s]*[-*]\s+(.*)/);
      const olMatch = line.match(/^[\s]*\d+[.)]\s+(.*)/);

      if (ulMatch) {
        if (!inUl) {
          output.push("<ul>");
          inUl = true;
        }
        if (inOl) {
          output.push("</ol>");
          inOl = false;
        }
        output.push(`<li>${ulMatch[1]}</li>`);
      } else if (olMatch) {
        if (!inOl) {
          output.push("<ol>");
          inOl = true;
        }
        if (inUl) {
          output.push("</ul>");
          inUl = false;
        }
        output.push(`<li>${olMatch[1]}</li>`);
      } else {
        if (inUl) {
          output.push("</ul>");
          inUl = false;
        }
        if (inOl) {
          output.push("</ol>");
          inOl = false;
        }
        const trimmed = line.trim();
        if (trimmed === "") {
          // Empty line — paragraph break (only if next line has content)
          continue;
        }
        output.push(trimmed);
      }
    }
    if (inUl) output.push("</ul>");
    if (inOl) output.push("</ol>");

    // Group consecutive non-list lines into paragraphs
    const result: string[] = [];
    let paragraphLines: string[] = [];

    function flushParagraph() {
      if (paragraphLines.length > 0) {
        result.push(`<p>${paragraphLines.join("<br>")}</p>`);
        paragraphLines = [];
      }
    }

    for (const item of output) {
      if (
        item.startsWith("<ul>") ||
        item.startsWith("</ul>") ||
        item.startsWith("<ol>") ||
        item.startsWith("</ol>") ||
        item.startsWith("<li>")
      ) {
        flushParagraph();
        result.push(item);
      } else {
        paragraphLines.push(item);
      }
    }
    flushParagraph();

    return result.join("");
  }

  // ─── Booking Logic ───────────────────────────────────────────────────────────

  let bookingConfig: {
    enabled: boolean;
    timezone?: string;
    slotDuration?: number;
    bookingWindowDays?: number;
  } | null = null;
  let bookingSelectedDate: string | null = null;
  let bookingSelectedSlot: {
    startTime: string;
    endTime: string;
    startTimeLocal: string;
    endTimeLocal: string;
  } | null = null;
  let bookingStep: "slots" | "confirmed" = "slots";

  function getVisitorTimezone(): string {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "America/New_York";
    }
  }

  function getBookingDates(): Array<{
    dateStr: string;
    label: string;
    weekday: string;
    day: number;
    month: string;
    isToday: boolean;
  }> {
    const dates: Array<{
      dateStr: string;
      label: string;
      weekday: string;
      day: number;
      month: string;
      isToday: boolean;
    }> = [];
    const today = new Date();
    const windowDays = bookingConfig?.bookingWindowDays ?? 14;
    for (let i = 0; i < windowDays; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      const dateStr = `${year}-${month}-${day}`;
      const weekday = d.toLocaleDateString("en-US", { weekday: "short" });
      const monthLabel = d.toLocaleDateString("en-US", { month: "short" });
      dates.push({
        dateStr,
        label: `${monthLabel} ${d.getDate()}`,
        weekday,
        day: d.getDate(),
        month: monthLabel,
        isToday: i === 0,
      });
    }
    return dates;
  }

  async function fetchBookingConfig(): Promise<void> {
    try {
      const res = await fetch(
        `${baseUrl}/api/widget/${projectSlug}/booking/config`,
      );
      if (res.ok) {
        bookingConfig = await res.json();
      }
    } catch {
      // Silently fail
    }
  }

  async function fetchSlots(dateStr: string): Promise<
    Array<{
      startTime: string;
      endTime: string;
      startTimeLocal: string;
      endTimeLocal: string;
      available: boolean;
    }>
  > {
    try {
      const tz = encodeURIComponent(getVisitorTimezone());
      const res = await fetch(
        `${baseUrl}/api/widget/${projectSlug}/booking/slots?date=${dateStr}&timezone=${tz}`,
      );
      if (res.ok) {
        const data = await res.json();
        return data.slots || [];
      }
    } catch {
      // Silently fail
    }
    return [];
  }

  async function submitBooking(data: {
    visitorName: string;
    visitorEmail: string;
    visitorPhone?: string;
    notes?: string;
    startTime: string;
    timezone: string;
    conversationId?: string;
  }): Promise<boolean> {
    try {
      const res = await fetch(`${baseUrl}/api/widget/${projectSlug}/booking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  function initBookingView() {
    bookingStep = "slots";
    bookingSelectedSlot = null;
    const dates = getBookingDates();
    if (dates.length > 0 && !bookingSelectedDate) {
      bookingSelectedDate = dates[0].dateStr;
    }
    renderBookingSlots();
  }

  function renderBookingSlots() {
    const primary = config?.widget?.primaryColor || "#2563eb";
    bookingContent.innerHTML = "";

    // Reset header to default
    const duration = bookingConfig?.slotDuration || 30;
    bookingHeaderTitle.innerHTML = `<div style="font-weight:600;font-size:14px;">Book a Meeting</div><div class="rm-booking-subtitle" style="font-size:12px;opacity:0.75;margin-top:1px;">${duration} min · Select a date & time</div>`;
    bookingHeaderBack.onclick = () => showHomeScreen();

    // Single scrollable container for the entire view
    const scroll = document.createElement("div");
    scroll.className = "rm-booking-scroll";

    const dates = getBookingDates();

    // ── Month / year label row ──────────────────────────────────────────────
    const selectedDateObj = bookingSelectedDate
      ? new Date(bookingSelectedDate + "T12:00:00")
      : new Date();
    const monthRow = document.createElement("div");
    monthRow.className = "rm-booking-month-row";

    const monthLabel = document.createElement("span");
    monthLabel.className = "rm-booking-month-label";
    monthLabel.textContent = selectedDateObj.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

    const arrowsWrap = document.createElement("div");
    arrowsWrap.className = "rm-booking-month-arrows";

    const leftArrow = document.createElement("button");
    leftArrow.className = "rm-booking-date-arrow";
    leftArrow.innerHTML = ICONS.chevronLeft;

    const rightArrow = document.createElement("button");
    rightArrow.className = "rm-booking-date-arrow";
    rightArrow.innerHTML = ICONS.chevronRight;

    arrowsWrap.appendChild(leftArrow);
    arrowsWrap.appendChild(rightArrow);
    monthRow.appendChild(monthLabel);
    monthRow.appendChild(arrowsWrap);
    scroll.appendChild(monthRow);

    // ── Date strip (horizontal scroll) ──────────────────────────────────────
    const dateStrip = document.createElement("div");
    dateStrip.className = "rm-booking-dates";

    leftArrow.onclick = () => {
      dateStrip.scrollBy({ left: -180, behavior: "smooth" });
    };
    rightArrow.onclick = () => {
      dateStrip.scrollBy({ left: 180, behavior: "smooth" });
    };

    dates.forEach((d) => {
      const pill = document.createElement("div");
      pill.className = "rm-booking-date-pill";
      if (d.dateStr === bookingSelectedDate) pill.classList.add("selected");
      if (d.isToday) pill.classList.add("today");
      pill.style.setProperty("--rm-primary", primary);
      pill.style.setProperty("--rm-primary-rgb", hexToRgb(primary));

      const weekday = document.createElement("span");
      weekday.className = "rm-date-weekday";
      weekday.textContent = d.weekday;

      const day = document.createElement("span");
      day.className = "rm-date-day";
      day.textContent = String(d.day);

      const month = document.createElement("span");
      month.className = "rm-date-month";
      month.textContent = d.month;

      pill.appendChild(weekday);
      pill.appendChild(day);
      pill.appendChild(month);

      pill.onclick = () => {
        bookingSelectedDate = d.dateStr;
        bookingSelectedSlot = null;
        renderBookingSlots();
      };
      dateStrip.appendChild(pill);
    });

    scroll.appendChild(dateStrip);

    // ── Slots section (2-col grid) ──────────────────────────────────────────
    const slotsSection = document.createElement("div");
    slotsSection.className = "rm-booking-slots-section";

    const slotsLabel = document.createElement("div");
    slotsLabel.className = "rm-booking-slots-label";
    slotsLabel.textContent = "Available times";
    slotsSection.appendChild(slotsLabel);

    const slotsGrid = document.createElement("div");
    slotsGrid.className = "rm-booking-slots-grid";

    const loading = document.createElement("div");
    loading.className = "rm-booking-slots-loading";
    loading.textContent = "Loading available times...";
    slotsGrid.appendChild(loading);
    slotsSection.appendChild(slotsGrid);
    scroll.appendChild(slotsSection);

    // ── Inline fields + confirm button ──────────────────────────────────────
    const fieldsArea = document.createElement("div");
    fieldsArea.className = "rm-booking-fields";

    // Email field
    const emailRow = document.createElement("div");
    emailRow.className = "rm-booking-inline-field";
    emailRow.innerHTML = ICONS.mail;
    const emailInput = document.createElement("input");
    emailInput.type = "email";
    emailInput.placeholder = "Email address";
    if (visitorInfo.email) emailInput.value = visitorInfo.email;
    emailRow.appendChild(emailInput);
    fieldsArea.appendChild(emailRow);

    // Phone field
    const phoneRow = document.createElement("div");
    phoneRow.className = "rm-booking-inline-field";
    phoneRow.innerHTML = ICONS.phone;
    const phoneInput = document.createElement("input");
    phoneInput.type = "tel";
    phoneInput.placeholder = "Phone (optional)";
    fieldsArea.appendChild(phoneRow);
    phoneRow.appendChild(phoneInput);

    // Confirm button
    const confirmBtn = document.createElement("button");
    confirmBtn.className = "rm-booking-confirm-btn";
    confirmBtn.style.backgroundColor = primary;
    confirmBtn.textContent = "Confirm Booking";
    fieldsArea.appendChild(confirmBtn);

    // Error message
    const errorEl = document.createElement("div");
    errorEl.className = "rm-booking-error";
    fieldsArea.appendChild(errorEl);

    scroll.appendChild(fieldsArea);
    bookingContent.appendChild(scroll);

    // ── Confirm button handler ──────────────────────────────────────────────
    confirmBtn.onclick = async () => {
      const email = emailInput.value.trim();
      const phone = phoneInput.value.trim();

      if (!bookingSelectedSlot) {
        errorEl.textContent = "Please select a time slot";
        errorEl.style.display = "block";
        return;
      }
      if (!email) {
        errorEl.textContent = "Email is required";
        errorEl.style.display = "block";
        return;
      }
      if (!email.includes("@") || !email.includes(".")) {
        errorEl.textContent = "Please enter a valid email address";
        errorEl.style.display = "block";
        return;
      }

      confirmBtn.disabled = true;
      confirmBtn.textContent = "Booking...";
      errorEl.style.display = "none";

      const success = await submitBooking({
        visitorName: visitorInfo.name || email.split("@")[0],
        visitorEmail: email,
        visitorPhone: phone || undefined,
        startTime: bookingSelectedSlot!.startTime,
        timezone: getVisitorTimezone(),
        conversationId: conversationId || undefined,
      });

      if (success) {
        renderBookingConfirmation(
          visitorInfo.name || email.split("@")[0],
          email,
        );
      } else {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "Confirm Booking";
        errorEl.textContent =
          "This time slot may no longer be available. Please try another time.";
        errorEl.style.display = "block";
      }
    };

    // ── Fetch and render slots ──────────────────────────────────────────────
    if (bookingSelectedDate) {
      fetchSlots(bookingSelectedDate).then((slots) => {
        slotsGrid.innerHTML = "";

        if (slots.length === 0) {
          const noSlots = document.createElement("div");
          noSlots.className = "rm-booking-no-slots";
          noSlots.innerHTML = ICONS.calendar;
          const noSlotsText = document.createElement("span");
          noSlotsText.textContent = "No available times on this date";
          noSlots.appendChild(noSlotsText);
          slotsGrid.style.display = "block";
          slotsGrid.appendChild(noSlots);
          return;
        }

        const hasAvailable = slots.some((s) => s.available);
        if (!hasAvailable) {
          const noSlots = document.createElement("div");
          noSlots.className = "rm-booking-no-slots";
          noSlots.innerHTML = ICONS.clock;
          const noSlotsText = document.createElement("span");
          noSlotsText.textContent = "All times are booked for this date";
          noSlots.appendChild(noSlotsText);
          slotsGrid.style.display = "block";
          slotsGrid.appendChild(noSlots);
          return;
        }

        slots.forEach((slot) => {
          const el = document.createElement("div");
          el.className = "rm-booking-slot";
          el.style.setProperty("--rm-primary", primary);
          el.style.setProperty("--rm-primary-rgb", hexToRgb(primary));
          el.textContent = slot.startTimeLocal;

          if (!slot.available) {
            el.classList.add("unavailable");
          } else {
            if (bookingSelectedSlot?.startTime === slot.startTime) {
              el.classList.add("selected");
            }
            el.onclick = () => {
              bookingSelectedSlot = {
                startTime: slot.startTime,
                endTime: slot.endTime,
                startTimeLocal: slot.startTimeLocal,
                endTimeLocal: slot.endTimeLocal,
              };
              // Highlight selected, deselect others
              slotsGrid
                .querySelectorAll(".rm-booking-slot")
                .forEach((s) => s.classList.remove("selected"));
              el.classList.add("selected");
            };
          }
          slotsGrid.appendChild(el);
        });
      });
    }

    // Scroll to selected date pill
    setTimeout(() => {
      const selected = dateStrip.querySelector(".selected");
      if (selected) {
        selected.scrollIntoView({ inline: "center", block: "nearest" });
      }
    }, 50);
  }

  function renderBookingConfirmation(name: string, email: string) {
    bookingStep = "confirmed";
    const primary = config?.widget?.primaryColor || "#2563eb";

    bookingContent.innerHTML = "";
    bookingHeaderTitle.innerHTML =
      '<div style="font-weight:600;font-size:14px;">Booking Confirmed</div>';
    bookingHeaderBack.onclick = () => showHomeScreen();

    const confirmed = document.createElement("div");
    confirmed.className = "rm-booking-confirmed";

    const icon = document.createElement("div");
    icon.className = "rm-booking-confirmed-icon";
    icon.style.backgroundColor = primary;
    icon.innerHTML = ICONS.check;

    const h3 = document.createElement("h3");
    h3.textContent = "Booking Confirmed!";

    if (bookingSelectedDate && bookingSelectedSlot) {
      const selectedDate = new Date(bookingSelectedDate + "T12:00:00");
      const dateLabel = selectedDate.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });

      const details = document.createElement("div");
      details.className = "rm-booking-confirmed-details";
      details.textContent = dateLabel;

      const time = document.createElement("div");
      time.className = "rm-booking-confirmed-time";
      time.textContent = `${bookingSelectedSlot.startTimeLocal} - ${bookingSelectedSlot.endTimeLocal}`;

      const emailMsg = document.createElement("div");
      emailMsg.className = "rm-booking-confirmed-email";
      emailMsg.innerHTML = `We'll send a calendar invite to<br><strong>${email}</strong>`;

      const backBtn = document.createElement("button");
      backBtn.className = "rm-booking-back-btn";
      backBtn.textContent = "Back to Chat";
      backBtn.onclick = () => {
        bookingSelectedDate = null;
        bookingSelectedSlot = null;
        bookingHeaderTitle.innerHTML =
          '<div style="font-weight:600;font-size:14px;">Book a Meeting</div>';
        bookingHeaderBack.onclick = () => showHomeScreen();
        showHomeScreen();
      };

      confirmed.appendChild(icon);
      confirmed.appendChild(h3);
      confirmed.appendChild(details);
      confirmed.appendChild(time);
      confirmed.appendChild(emailMsg);
      confirmed.appendChild(backBtn);
    }

    bookingContent.appendChild(confirmed);
  }

  async function loadConfig() {
    try {
      const res = await fetch(`${baseUrl}/api/widget/${projectSlug}/config`);
      if (!res.ok) {
        trigger.style.backgroundColor = "#2563eb";
        trigger.classList.add("ready");
        container.classList.add("ready");
        return;
      }
      const loadedConfig = await res.json();
      config = loadedConfig;

      // Apply styling
      if (loadedConfig.widget) {
        const w = loadedConfig.widget;
        const primary = w.primaryColor || "#2563eb";

        // Determine position mode early so styling can be conditional
        const isCenterInline = w.position === "center-inline";

        // Set CSS custom properties for theming
        container.style.setProperty("--rm-primary", primary);
        container.style.setProperty("--rm-primary-rgb", hexToRgb(primary));

        // Trigger & header colors
        trigger.style.backgroundColor = primary;
        sendBtn.style.backgroundColor = primary;

        if (isCenterInline) {
          // Center-inline: header uses frosted glass with primary tint (CSS handles it via --rm-primary-rgb)
          header.style.backgroundColor = "transparent";
          if (w.backgroundColor) {
            chatWindow.style.background = w.backgroundColor;
          }
          if (w.textColor) {
            chatWindow.style.color = w.textColor;
            input.style.color = w.textColor;
          }
        } else {
          header.style.backgroundColor = primary + "e8"; // ~91% opacity for frosted glass
          if (w.backgroundColor) {
            chatWindow.style.background = w.backgroundColor;
          }
          if (w.textColor) {
            chatWindow.style.color = w.textColor;
            input.style.color = w.textColor;
            homeTitle.style.color = w.textColor;
          }
        }
        if (w.borderRadius) {
          container.style.setProperty(
            "--rm-chat-radius",
            w.borderRadius + "px",
          );
        }

        // Header text
        headerTitle.textContent = w.headerText || "Chat with us";

        // Position
        if (isCenterInline) {
          isInlineBarVariant = true;
          container.className = "rm-widget-container center-inline";
          chatWindow.className = "rm-chat-window center-inline";
        } else if (w.position === "bottom-left") {
          container.className = "rm-widget-container bottom-left";
          chatWindow.className = "rm-chat-window bottom-left";
        }

        // Font family
        if (w.fontFamily && w.fontFamily !== "system-ui") {
          container.style.fontFamily =
            w.fontFamily + ", -apple-system, BlinkMacSystemFont, sans-serif";
        }

        // ─── Avatar (trigger, header, home screen) ────────────────────────────

        if (w.avatarUrl) {
          const avatarSrc = resolveUrl(w.avatarUrl);

          // Trigger button: show avatar instead of chat icon
          triggerChatIcon.innerHTML = "";
          const triggerImg = document.createElement("img");
          triggerImg.src = avatarSrc;
          triggerImg.alt = "Chat";
          triggerImg.className = "rm-trigger-avatar";
          triggerChatIcon.appendChild(triggerImg);

          // Header avatar
          headerAvatar.innerHTML = "";
          headerAvatar.classList.remove("rm-icon-avatar");
          headerAvatar.style.backgroundColor = "transparent";
          const headerImg = document.createElement("img");
          headerImg.src = avatarSrc;
          headerImg.alt = "Avatar";
          headerImg.style.width = "100%";
          headerImg.style.height = "100%";
          headerImg.style.borderRadius = "50%";
          headerImg.style.objectFit = "cover";
          headerAvatar.appendChild(headerImg);

          // Home screen avatar
          homeAvatar.innerHTML = "";
          homeAvatar.classList.remove("rm-icon-avatar");
          homeAvatar.style.backgroundColor = "#ffffff";
          const homeImg = document.createElement("img");
          homeImg.src = avatarSrc;
          homeImg.alt = "Avatar";
          homeAvatar.appendChild(homeImg);
        } else {
          headerAvatar.classList.add("rm-icon-avatar");
          homeAvatar.classList.add("rm-icon-avatar");
          homeAvatar.style.backgroundColor = primary;
          homeAvatar.style.color = "#ffffff";
        }

        // ─── Home Screen Config ──────────────────────────────────────────────

        // Banner
        if (w.bannerUrl) {
          homeBanner.style.backgroundImage = `url(${resolveUrl(w.bannerUrl)})`;
        } else {
          homeBanner.style.backgroundColor = primary;
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

      // ─── Quick Actions on Home Screen ────────────────────────────────────────
      homeLinksContainer.innerHTML = "";
      const allActions: Array<{
        id: string;
        type: string;
        label: string;
        action: string;
        icon: string;
        showOnHome: boolean;
      }> = loadedConfig.quickActions || [];

      const homeActions = allActions.filter((a) => a.showOnHome);

      if (homeActions.length > 0) {
        homeActions.forEach((qa) => {
          const row = document.createElement("div");
          row.className = "rm-home-link";
          row.style.cursor = "pointer";

          // Left icon
          const iconEl = document.createElement("span");
          iconEl.className = "rm-home-link-icon";
          iconEl.innerHTML = ICONS[qa.icon] || ICONS.link;

          // Label
          const labelEl = document.createElement("span");
          labelEl.className = "rm-home-link-label";
          labelEl.textContent = qa.label;

          // Right icon based on type
          const arrowEl = document.createElement("span");
          arrowEl.className = "rm-home-link-arrow";
          if (qa.type === "link") {
            arrowEl.innerHTML = ICONS.externalLink;
          } else if (qa.type === "contact_form" || qa.type === "booking") {
            arrowEl.innerHTML = ICONS.chevronRight;
          } else {
            // prompt type
            arrowEl.innerHTML = ICONS.aiSparkle;
          }

          row.appendChild(iconEl);
          row.appendChild(labelEl);
          row.appendChild(arrowEl);

          // Click behavior based on type
          row.onclick = () => {
            if (qa.type === "link") {
              window.open(qa.action, "_blank", "noopener,noreferrer");
            } else if (qa.type === "contact_form") {
              showFormScreen();
            } else if (qa.type === "booking") {
              showBookingScreen();
            } else if (qa.type === "prompt") {
              showChatScreen();
              setTimeout(() => {
                if (!isSending) {
                  handleSendMessage(qa.action);
                }
              }, 100);
            }
          };

          // For link type, use an <a> tag for accessibility
          if (qa.type === "link") {
            const a = document.createElement("a");
            a.className = "rm-home-link";
            a.href = qa.action;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
            a.appendChild(iconEl);
            a.appendChild(labelEl);
            a.appendChild(arrowEl);
            homeLinksContainer.appendChild(a);
          } else {
            homeLinksContainer.appendChild(row);
          }
        });
      }

      // ─── Contact Form Setup (build form fields if enabled) ──────────────────
      if (loadedConfig.contactForm) {
        const cf = loadedConfig.contactForm as {
          description: string | null;
          fields: Array<{ label: string; type: string; required: boolean }>;
        };

        const primary = loadedConfig.widget?.primaryColor || "#2563eb";

        // Build form fields
        formBody.innerHTML = "";

        if (cf.description) {
          const desc = document.createElement("div");
          desc.className = "rm-form-description";
          desc.textContent = cf.description;
          formBody.appendChild(desc);
        }

        const fieldInputs: Array<{
          label: string;
          input: HTMLInputElement | HTMLTextAreaElement;
          required: boolean;
        }> = [];

        for (const field of cf.fields) {
          const fieldContainer = document.createElement("div");
          fieldContainer.className = "rm-form-field";

          const label = document.createElement("label");
          label.className = "rm-form-label";
          label.textContent = field.label;
          if (field.required) {
            const req = document.createElement("span");
            req.className = "rm-required";
            req.textContent = "*";
            label.appendChild(req);
          }
          fieldContainer.appendChild(label);

          if (field.type === "textarea") {
            const textarea = document.createElement("textarea");
            textarea.className = "rm-form-textarea";
            textarea.placeholder = field.label;
            if (field.required) textarea.required = true;
            fieldContainer.appendChild(textarea);
            fieldInputs.push({
              label: field.label,
              input: textarea,
              required: field.required,
            });
          } else {
            const inp = document.createElement("input");
            inp.className = "rm-form-input";
            inp.type = "text";
            inp.placeholder = field.label;
            if (field.required) inp.required = true;
            fieldContainer.appendChild(inp);
            fieldInputs.push({
              label: field.label,
              input: inp,
              required: field.required,
            });
          }

          formBody.appendChild(fieldContainer);
        }

        // Error message
        const formError = document.createElement("div");
        formError.className = "rm-form-error";
        formError.style.display = "none";
        formBody.appendChild(formError);

        // Submit button
        const submitBtn2 = document.createElement("button");
        submitBtn2.className = "rm-form-submit";
        submitBtn2.style.backgroundColor = primary;
        submitBtn2.textContent = "Send message";
        formBody.appendChild(submitBtn2);

        submitBtn2.onclick = async () => {
          // Validate required fields
          for (const fi of fieldInputs) {
            if (fi.required && !fi.input.value.trim()) {
              formError.textContent = `${fi.label} is required`;
              formError.style.display = "block";
              fi.input.focus();
              return;
            }
          }
          formError.style.display = "none";

          submitBtn2.disabled = true;
          submitBtn2.textContent = "Sending...";

          const data: Record<string, string> = {};
          for (const fi of fieldInputs) {
            if (fi.input.value.trim()) {
              data[fi.label] = fi.input.value.trim();
            }
          }

          try {
            const res = await fetch(
              `${baseUrl}/api/widget/${projectSlug}/contact-form`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ visitorId, data }),
              },
            );

            if (!res.ok) {
              const err = await res.json().catch(() => null);
              formError.textContent =
                (err as { error?: string })?.error ||
                "Something went wrong. Please try again.";
              formError.style.display = "block";
              submitBtn2.disabled = false;
              submitBtn2.textContent = "Send message";
              return;
            }

            // Show success state
            formView.removeChild(formBody);
            const success = document.createElement("div");
            success.className = "rm-form-success";

            const successIcon = document.createElement("div");
            successIcon.className = "rm-form-success-icon";
            successIcon.style.backgroundColor = primary + "15";
            successIcon.style.color = primary;
            successIcon.innerHTML = ICONS.check;

            const successTitle = document.createElement("div");
            successTitle.className = "rm-form-success-title";
            successTitle.textContent = "Message sent!";

            const successSubtitle = document.createElement("div");
            successSubtitle.className = "rm-form-success-subtitle";
            successSubtitle.textContent =
              cf.description || "We'll get back to you soon.";

            success.appendChild(successIcon);
            success.appendChild(successTitle);
            success.appendChild(successSubtitle);
            formView.appendChild(success);
          } catch {
            formError.textContent =
              "Couldn't send message. Please check your connection.";
            formError.style.display = "block";
            submitBtn2.disabled = false;
            submitBtn2.textContent = "Send message";
          }
        };
      }

      // ─── Booking Setup ──────────────────────────────────────────────────────
      if (loadedConfig.bookingEnabled) {
        fetchBookingConfig(); // Pre-load booking config

        // Booking primary color already applied via CSS var(--rm-primary)
      }

      // Intro message
      if (loadedConfig.introMessage) {
        addMessageToUI("bot", loadedConfig.introMessage);
      }

      // ─── Prompt-type Quick Actions as Chat Pills ────────────────────────────
      const promptActions = allActions.filter((a) => a.type === "prompt");
      if (promptActions.length > 0) {
        promptActions.forEach((qa) => {
          const btn = document.createElement("button");
          btn.className = "rm-quick-topic";
          btn.textContent = qa.label;
          btn.onclick = () => {
            if (isSending) return;
            handleSendMessage(qa.action);
            quickTopicsContainer.style.display = "none";
          };
          quickTopicsContainer.appendChild(btn);
        });
      } else {
        quickTopicsContainer.style.display = "none";
      }

      // ─── Inline Bar Variant Setup ──────────────────────────────────────────
      if (isInlineBarVariant) {
        // Apply brand color CSS variables to inline bar (it lives on document.body, not inside container)
        const inlinePrimary = loadedConfig.widget?.primaryColor || "#2563eb";
        inlineBar.style.setProperty("--rm-primary", inlinePrimary);
        inlineBar.style.setProperty(
          "--rm-primary-rgb",
          hexToRgb(inlinePrimary),
        );

        // Populate inline bar topics from prompt-type quick actions
        inlineBarTopics.innerHTML = "";
        if (promptActions.length > 0) {
          placeholderTexts = promptActions.map((qa) => qa.label);
          promptActions.forEach((qa) => {
            const topicBtn = document.createElement("button");
            topicBtn.className = "rm-inline-bar-topic";
            topicBtn.textContent = qa.label;
            topicBtn.onclick = (e) => {
              e.stopPropagation();
              if (isSending) return;
              // Keep inline bar visible — it becomes the chat input
              showChatScreen();
              openChatWidget();
              setTimeout(() => handleSendMessage(qa.action), 100);
            };
            inlineBarTopics.appendChild(topicBtn);
          });
        }

        // Append inline bar to body and start placeholder rotation
        document.body.appendChild(inlineBar);
        startPlaceholderRotation();
        inlineBar.classList.add("ready");
      }

      // Show the widget now that config is applied
      trigger.classList.add("ready");
      container.classList.add("ready");
    } catch (err) {
      console.error("[ReplyMaven] Failed to load config:", err);
      // Still show the trigger with default styling on error
      trigger.style.backgroundColor = "#2563eb";
      trigger.classList.add("ready");
      container.classList.add("ready");
    }
  }

  async function createConversation() {
    if (conversationId) return;
    try {
      const deviceMeta = collectDeviceMetadata();
      const metadata = { ...deviceMeta, ...customMetadata };

      const res = await fetch(
        `${baseUrl}/api/widget/${projectSlug}/conversations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitorId,
            visitorName: visitorInfo.name,
            visitorEmail: visitorInfo.email,
            metadata,
          }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        conversationId = data.id;
        conversationStatus = data.status ?? "active";
        persistConversationId(data.id);
        startPolling();
      }
    } catch (err) {
      console.error("[ReplyMaven] Failed to create conversation:", err);
    }
  }

  async function handleSendMessage(text: string) {
    // Prevent duplicate sends
    if (isSending) return;
    isSending = true;
    sendBtn.disabled = true;
    input.disabled = true;
    // Also disable inline bar input if in center-inline mode
    if (isInlineBarVariant) {
      inlineBarInput.disabled = true;
    }

    try {
      // Switch to chat view if on home screen
      if (currentView === "home") {
        showChatScreen();
      }

      // Create conversation if needed
      if (!conversationId) await createConversation();
      if (!conversationId) return;

      // Capture and clear any pending image
      const imageFile = pendingImageFile;
      let uploadedImageUrl: string | null = null;
      let localPreviewUrl: string | null = null;

      if (imageFile) {
        localPreviewUrl = imagePreviewImg.src; // data: URL from FileReader
        pendingImageFile = null;
        imagePreview.classList.remove("visible");
        imagePreviewImg.src = "";
        imagePreviewName.textContent = "";
      }

      // Use a default message if only an image was sent
      const messageText = text || (imageFile ? "Sent an image" : "");
      if (!messageText && !imageFile) return;

      addMessageToUI(
        "visitor",
        messageText,
        undefined,
        localPreviewUrl ?? undefined,
      );
      quickTopicsContainer.style.display = "none";
      lastMessageTimestamp = Date.now();

      // Upload image to R2 if present
      if (imageFile) {
        try {
          const formData = new FormData();
          formData.append("file", imageFile);
          const uploadRes = await fetch(
            `${baseUrl}/api/widget/${projectSlug}/upload`,
            { method: "POST", body: formData },
          );
          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            uploadedImageUrl = uploadData.url;
          }
        } catch (err) {
          console.error("[ReplyMaven] Image upload failed:", err);
        }
      }

      // Show typing indicator
      showTyping();

      // Pause polling during SSE streaming to prevent duplicate messages
      isStreaming = true;
      stopPolling();

      try {
        const body: Record<string, string> = { content: messageText };
        if (uploadedImageUrl) body.imageUrl = uploadedImageUrl;

        const res = await fetch(
          `${baseUrl}/api/widget/${projectSlug}/conversations/${conversationId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
        );

        if (!res.ok) {
          hideTyping();
          addMessageToUI(
            "bot",
            "Sorry, something went wrong. Please try again.",
          );
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
        let sseBuffer = "";

        // Timeout to prevent the stream from hanging forever (90s)
        const streamTimeout = setTimeout(() => {
          try {
            reader.cancel();
          } catch {
            /* ignore */
          }
        }, 90_000);

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          // Keep the last (possibly incomplete) line in the buffer
          sseBuffer = lines.pop() ?? "";

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

                if (data.booking) {
                  // Bot detected scheduling intent -> open booking UI
                  if (botMessageEl) {
                    botMessageEl.closest(".rm-message-row")?.remove();
                    botMessageEl = null;
                  }
                  hideTyping();
                  if (bookingConfig?.enabled) {
                    showBookingScreen();
                  }
                  continue;
                }

                // Handle tool execution events
                if (data.toolCall) {
                  const displayName = data.toolCall.name.replace(/_/g, " ");
                  const label =
                    displayName.charAt(0).toUpperCase() + displayName.slice(1);
                  showTyping(`Fetching ${label}`);
                  continue;
                }

                if (data.toolResult) {
                  if (
                    data.toolResult.success === false &&
                    data.toolResult.errorMessage
                  ) {
                    // Show inline error for failed tool calls
                    hideTyping();
                    addToolErrorToUI(
                      data.toolResult.name,
                      data.toolResult.errorMessage,
                    );
                  } else {
                    // After successful tool result, show "Thinking" while model processes the result
                    showTyping();
                  }
                  continue;
                }

                if (data.toolError) {
                  // Show expandable error from fallback path
                  hideTyping();
                  addToolErrorToUI(
                    null,
                    data.toolError.detail || data.toolError.message,
                  );
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

                  // Client-side filter: if [BOOKING_REQUESTED] appears, open booking UI
                  if (botMessage.includes("[BOOKING_REQUESTED]")) {
                    if (botMessageEl) {
                      botMessageEl.closest(".rm-message-row")?.remove();
                      botMessageEl = null;
                    }
                    hideTyping();
                    botMessage = "";
                    if (bookingConfig?.enabled) {
                      showBookingScreen();
                    }
                    continue;
                  }

                  // Hide typing on first text chunk, show the bot bubble
                  if (!botMessageEl) {
                    hideTyping();
                    botMessageEl = addMessageToUI("bot", botMessage);
                  } else {
                    botMessageEl.innerHTML = renderMarkdown(botMessage);
                  }
                  scrollToBottom();
                }

                if (data.done) {
                  hideTyping();
                  // Stream complete -- render final markdown
                  if (botMessageEl && botMessage) {
                    botMessageEl.innerHTML = renderMarkdown(botMessage);
                  }
                  // Add source links if present
                  if (data.sources && data.sources.length > 0 && botMessageEl) {
                    addSourcesToMessage(botMessageEl, data.sources);
                  }
                  // Track the bot message ID if provided, and update timestamp
                  if (data.messageId) {
                    renderedMessageIds.add(data.messageId);
                  }
                  lastMessageTimestamp = Date.now();
                  scrollToBottom();
                  // Show handoff card if needed
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
        clearTimeout(streamTimeout);
      } catch {
        hideTyping();
        addMessageToUI(
          "bot",
          "Sorry, I couldn't connect. Please check your internet connection.",
        );
      }
    } finally {
      isStreaming = false;
      startPolling();
      isSending = false;
      sendBtn.disabled = false;
      input.disabled = false;
      // Re-enable and focus the correct input
      if (isInlineBarVariant) {
        inlineBarInput.disabled = false;
        if (!isMobileViewport()) {
          inlineBarInput.focus();
        } else {
          input.focus();
        }
      } else {
        input.focus();
      }
    }
  }

  // Track previous message role for avatar grouping
  let lastMessageRole: string | null = null;

  function addMessageToUI(
    role: string,
    content: string,
    messageId?: string,
    imageUrl?: string,
  ): HTMLElement {
    // Track rendered message IDs for deduplication (polling)
    if (messageId) {
      if (renderedMessageIds.has(messageId)) {
        // Return a dummy element if already rendered
        return document.createElement("div");
      }
      renderedMessageIds.add(messageId);
    }

    const primaryColor = getPrimaryColor();

    // Message row (avatar + bubble)
    const row = document.createElement("div");
    row.className = `rm-message-row ${role}`;
    if (messageId) row.dataset.messageId = messageId;

    // Avatar for bot/agent messages
    if (role === "bot" || role === "agent") {
      const avatar = document.createElement("div");
      avatar.className = "rm-message-avatar";

      const avatarUrl = config?.widget?.avatarUrl;
      if (avatarUrl) {
        avatar.style.backgroundColor = "transparent";
        const avatarImg = document.createElement("img");
        avatarImg.src = resolveUrl(avatarUrl);
        avatarImg.alt = "Bot";
        avatarImg.style.width = "100%";
        avatarImg.style.height = "100%";
        avatarImg.style.borderRadius = "50%";
        avatarImg.style.objectFit = "cover";
        avatar.appendChild(avatarImg);
      } else {
        avatar.classList.add("rm-icon-avatar");
        avatar.style.backgroundColor = primaryColor + "12";
        avatar.style.color = primaryColor;
        avatar.innerHTML = ICONS.aiSparkle;
      }

      // Hide avatar if this is a consecutive message from the same role
      if (lastMessageRole === role) {
        avatar.classList.add("hidden");
      }

      row.appendChild(avatar);
    }

    // Message bubble
    const msgEl = document.createElement("div");
    msgEl.className = "rm-message";

    // Render image inside bubble if present
    if (imageUrl) {
      const img = document.createElement("img");
      img.className = "rm-message-image";
      img.src = imageUrl.startsWith("data:") ? imageUrl : resolveUrl(imageUrl);
      img.alt = "Attached image";
      img.onclick = () => window.open(img.src, "_blank");
      msgEl.appendChild(img);
    }

    if (role === "visitor") {
      // Visitor messages: plain text, styled with primary color
      if (content && content !== "Sent an image") {
        const textNode = document.createElement("span");
        textNode.textContent = content;
        msgEl.appendChild(textNode);
      }
      msgEl.style.backgroundColor = primaryColor;
      msgEl.style.color = "#ffffff";
    } else {
      // Bot/agent messages: render markdown
      const textContainer = document.createElement("div");
      textContainer.innerHTML = renderMarkdown(content);
      msgEl.appendChild(textContainer);
    }

    row.appendChild(msgEl);

    // Add extra spacing when switching between roles (role-aware grouping)
    if (lastMessageRole !== null && lastMessageRole !== role) {
      row.classList.add("rm-role-change");
    }

    // Insert before typing indicator (which is always last child)
    messagesContainer.insertBefore(row, typingRow);
    scrollToBottom();

    lastMessageRole = role;
    return msgEl;
  }

  function addSourcesToMessage(
    msgEl: HTMLElement,
    sources: Array<{
      title: string;
      url?: string | null;
      type?: "webpage" | "pdf" | "faq";
    }>,
  ): void {
    if (!sources || sources.length === 0) return;

    const primaryColor = getPrimaryColor();

    const sourcesContainer = document.createElement("div");
    sourcesContainer.className = "rm-sources";

    for (const source of sources) {
      // Determine icon based on source type
      const sourceType = source.type || "webpage";
      let iconSvg: string;
      let typeLabel: string;
      if (sourceType === "pdf") {
        iconSvg = ICONS.docs;
        typeLabel = "Docs";
      } else if (sourceType === "faq") {
        iconSvg = ICONS.circleQuestion;
        typeLabel = "FAQ";
      } else {
        iconSvg = ICONS.globe;
        typeLabel = "Website";
      }

      // Use <a> for clickable webpages, <span> for non-linkable PDFs/FAQs
      const isClickable = sourceType === "webpage" && source.url;
      const el = document.createElement(isClickable ? "a" : "span");
      el.className = "rm-source-link";
      el.style.color = primaryColor + "80";

      if (isClickable) {
        (el as HTMLAnchorElement).href = source.url!;
        (el as HTMLAnchorElement).target = "_blank";
        (el as HTMLAnchorElement).rel = "noopener noreferrer";
      }

      // Icon
      const iconEl = document.createElement("span");
      iconEl.className = "rm-source-icon";
      iconEl.innerHTML = iconSvg;

      // Type label
      const labelEl = document.createElement("span");
      labelEl.className = "rm-source-type";
      labelEl.textContent = typeLabel;

      // Title (truncated via CSS)
      const titleEl = document.createElement("span");
      titleEl.className = "rm-source-title";
      titleEl.textContent = source.title;

      el.appendChild(iconEl);
      el.appendChild(labelEl);
      el.appendChild(titleEl);
      sourcesContainer.appendChild(el);
    }

    // Append sources inside the message bubble, after the text
    msgEl.appendChild(sourcesContainer);
  }

  function showTyping(message?: string) {
    statusText.textContent = message ?? "";
    typingRow.classList.add("visible");
    scrollToBottom();
  }

  function hideTyping() {
    typingRow.classList.remove("visible");
    statusText.textContent = "Thinking";
    scrollToBottom();
  }

  let _scrollDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  function scrollToBottom() {
    if (_scrollDebounceTimer) clearTimeout(_scrollDebounceTimer);
    _scrollDebounceTimer = setTimeout(() => {
      _scrollDebounceTimer = null;
      requestAnimationFrame(() => {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      });
    }, 50);
  }

  // ─── Tool Error Display ────────────────────────────────────────────────────

  function addToolErrorToUI(toolName: string | null, detail: string) {
    const container = document.createElement("div");
    container.className = "rm-tool-error";

    const header = document.createElement("div");
    header.className = "rm-tool-error-header";

    // Chevron-down SVG icon
    const chevron = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    chevron.setAttribute("viewBox", "0 0 24 24");
    chevron.setAttribute("fill", "none");
    chevron.setAttribute("stroke", "currentColor");
    chevron.setAttribute("stroke-width", "2");
    chevron.setAttribute("stroke-linecap", "round");
    chevron.setAttribute("stroke-linejoin", "round");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m6 9 6 6 6-6");
    chevron.appendChild(path);

    const label = document.createElement("span");
    const displayName = toolName ? toolName.replace(/_/g, " ") : "Tool";
    label.textContent = `${displayName} failed`;

    header.appendChild(chevron);
    header.appendChild(label);

    const detailEl = document.createElement("div");
    detailEl.className = "rm-tool-error-detail";
    detailEl.textContent = detail;

    container.appendChild(header);
    container.appendChild(detailEl);

    header.addEventListener("click", () => {
      container.classList.toggle("expanded");
    });

    messagesContainer.insertBefore(container, typingRow);
    scrollToBottom();
  }

  // ─── Handoff Card ───────────────────────────────────────────────────────────

  function showHandoffCard(email: string | null) {
    _isHandedOff = true;
    conversationStatus = "waiting_agent";
    const primaryColor = getPrimaryColor();

    // Request notification permission on handoff
    requestNotificationPermission();

    // Restart polling with faster interval for agent replies
    stopPolling();
    startPolling();

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

  // ─── Polling for New Messages ──────────────────────────────────────────────

  function startPolling() {
    if (pollTimer) return; // Already polling
    if (!conversationId) return;

    // Determine poll interval based on conversation status
    const getInterval = () => {
      if (
        conversationStatus === "waiting_agent" ||
        conversationStatus === "agent_replied"
      ) {
        return 3000; // 3s when waiting for agent
      }
      return 10000; // 10s for active conversations
    };

    let currentInterval = getInterval();

    function schedulePoll() {
      pollTimer = setTimeout(async () => {
        if (!conversationId) {
          stopPolling();
          return;
        }
        await pollMessages();
        // Recalculate interval in case status changed
        currentInterval = getInterval();
        schedulePoll();
      }, currentInterval);
    }

    schedulePoll();
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  async function pollMessages() {
    if (!conversationId) return;
    if (isStreaming) return; // Don't poll during active SSE stream

    try {
      let url = `${baseUrl}/api/widget/${projectSlug}/conversations/${conversationId}/messages`;
      if (lastMessageTimestamp) {
        url += `?since=${lastMessageTimestamp}`;
      }

      const res = await fetch(url);
      if (!res.ok) return;

      const data = await res.json();
      const msgs = data.messages ?? data;
      const status = data.status;

      // Update conversation status
      if (status && status !== conversationStatus) {
        conversationStatus = status;
        if (status === "closed") {
          stopPolling();
          clearPersistedConversation();
          return;
        }
      }

      // Process new messages
      let hasNewMessages = false;
      for (const msg of msgs) {
        if (renderedMessageIds.has(msg.id)) continue;

        // Only render bot/agent messages (visitor messages are already rendered locally)
        if (msg.role === "bot" || msg.role === "agent") {
          hideTyping();
          const el = addMessageToUI(msg.role, msg.content, msg.id);
          // Render markdown for bot/agent messages
          if (el.parentElement) {
            el.innerHTML = renderMarkdown(msg.content);
            if (msg.sources) {
              try {
                const sources =
                  typeof msg.sources === "string"
                    ? JSON.parse(msg.sources)
                    : msg.sources;
                if (Array.isArray(sources) && sources.length > 0) {
                  addSourcesToMessage(el, sources);
                }
              } catch {
                // Ignore malformed sources
              }
            }
          }
          hasNewMessages = true;
        } else if (msg.role === "visitor") {
          // Mark visitor messages as rendered so we don't duplicate them
          renderedMessageIds.add(msg.id);
        }

        // Update last message timestamp
        const msgTime =
          msg.createdAt instanceof Date
            ? msg.createdAt.getTime()
            : typeof msg.createdAt === "number"
              ? msg.createdAt * 1000
              : new Date(msg.createdAt).getTime();
        if (!lastMessageTimestamp || msgTime > lastMessageTimestamp) {
          lastMessageTimestamp = msgTime;
        }
      }

      if (hasNewMessages) {
        scrollToBottom();
        // Show notification if widget is closed/minimized
        if (!isOpen || !isTabActive) {
          incrementUnreadBadge();
          showBrowserNotification(
            msgs[msgs.length - 1]?.content ?? "New message",
          );
        }
      }
    } catch {
      // Silently ignore polling errors
    }
  }

  // ─── Browser Notifications ──────────────────────────────────────────────────

  function requestNotificationPermission() {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      notificationPermission = "granted";
      return;
    }
    if (Notification.permission === "denied") {
      notificationPermission = "denied";
      return;
    }

    Notification.requestPermission().then((permission) => {
      notificationPermission = permission;
    });
  }

  function showBrowserNotification(messagePreview: string) {
    if (!("Notification" in window)) return;
    if (notificationPermission !== "granted") return;
    if (isOpen && isTabActive) return; // Don't notify if widget is open and tab is active

    const title = config?.widget?.headerText || "New message";
    const avatarUrl = config?.widget?.avatarUrl
      ? resolveUrl(config.widget.avatarUrl)
      : undefined;

    try {
      const notification = new Notification(title, {
        body:
          messagePreview.length > 100
            ? messagePreview.substring(0, 100) + "..."
            : messagePreview,
        icon: avatarUrl,
        tag: "rm-new-message", // Replaces previous notification
      });

      notification.onclick = () => {
        window.focus();
        openChatWidget();
        showChatScreen();
        notification.close();
      };

      // Auto-close after 5 seconds
      setTimeout(() => notification.close(), 5000);
    } catch {
      // Notification constructor can fail in some contexts (e.g., insecure origins)
    }
  }

  // ─── Unread Badge ────────────────────────────────────────────────────────────

  function incrementUnreadBadge() {
    unreadCount++;
    triggerBadge.textContent = unreadCount > 99 ? "99+" : String(unreadCount);
    triggerBadge.classList.add("visible");
  }

  function clearUnreadBadge() {
    unreadCount = 0;
    triggerBadge.classList.remove("visible");
  }

  // ─── Conversation History Loading ────────────────────────────────────────────

  async function loadConversationHistory() {
    if (!conversationId) return;

    try {
      const res = await fetch(
        `${baseUrl}/api/widget/${projectSlug}/conversations/${conversationId}/messages`,
      );
      if (!res.ok) {
        // Conversation might not exist anymore
        if (res.status === 404) {
          conversationId = null;
          conversationStatus = null;
          clearPersistedConversation();
        }
        return;
      }

      const data = await res.json();
      const msgs = data.messages ?? data;
      conversationStatus = data.status ?? null;

      // If conversation is closed, clear it and start fresh
      if (conversationStatus === "closed") {
        conversationId = null;
        conversationStatus = null;
        clearPersistedConversation();
        return;
      }

      // Render existing messages
      if (msgs.length > 0) {
        // Switch to chat view since we have history
        showChatScreen();

        for (const msg of msgs) {
          const el = addMessageToUI(
            msg.role,
            msg.content,
            msg.id,
            msg.imageUrl ?? undefined,
          );
          // Render markdown for bot/agent messages
          if (
            (msg.role === "bot" || msg.role === "agent") &&
            el.parentElement
          ) {
            el.innerHTML = renderMarkdown(msg.content);
            if (msg.sources) {
              try {
                const sources =
                  typeof msg.sources === "string"
                    ? JSON.parse(msg.sources)
                    : msg.sources;
                if (Array.isArray(sources) && sources.length > 0) {
                  addSourcesToMessage(el, sources);
                }
              } catch {
                // Ignore malformed sources
              }
            }
          }

          // Track timestamp
          const msgTime =
            msg.createdAt instanceof Date
              ? msg.createdAt.getTime()
              : typeof msg.createdAt === "number"
                ? msg.createdAt * 1000
                : new Date(msg.createdAt).getTime();
          if (!lastMessageTimestamp || msgTime > lastMessageTimestamp) {
            lastMessageTimestamp = msgTime;
          }
        }

        scrollToBottom();
      }

      // If conversation is in a handoff state, show the handoff status
      if (
        conversationStatus === "waiting_agent" ||
        conversationStatus === "agent_replied"
      ) {
        _isHandedOff = true;
        input.placeholder = "Add any details for the team...";
      }

      // Start polling for new messages
      startPolling();
    } catch (err) {
      console.error("[ReplyMaven] Failed to load conversation history:", err);
    }
  }

  async function restoreConversation() {
    // First try localStorage
    const storedId = loadPersistedConversationId();
    if (storedId) {
      conversationId = storedId;
      await loadConversationHistory();
      if (conversationId) return; // Successfully restored
    }

    // Fallback: try to find active conversation by visitorId
    try {
      const res = await fetch(
        `${baseUrl}/api/widget/${projectSlug}/conversations/active?visitorId=${encodeURIComponent(visitorId)}`,
      );
      if (!res.ok) return;

      const data = await res.json();
      if (data.conversation) {
        conversationId = data.conversation.id;
        conversationStatus = data.conversation.status;
        persistConversationId(data.conversation.id);
        await loadConversationHistory();
      }
    } catch {
      // Silently ignore
    }
  }

  // ─── Server Sync for Identity/Metadata ──────────────────────────────────────

  async function syncIdentityToServer() {
    if (!conversationId) return;
    try {
      await fetch(
        `${baseUrl}/api/widget/${projectSlug}/conversations/${conversationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            visitorName: visitorInfo.name,
            visitorEmail: visitorInfo.email,
          }),
        },
      );
    } catch {
      // Silently ignore sync errors
    }
  }

  async function syncMetadataToServer() {
    if (!conversationId) return;
    try {
      const deviceMeta = collectDeviceMetadata();
      const merged = { ...deviceMeta, ...customMetadata };
      await fetch(
        `${baseUrl}/api/widget/${projectSlug}/conversations/${conversationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ metadata: merged }),
        },
      );
    } catch {
      // Silently ignore sync errors
    }
  }

  // ─── Open / Close / Toggle ──────────────────────────────────────────────────

  function isMobileViewport(): boolean {
    return window.matchMedia("(max-width: 480px)").matches;
  }

  function openChatWidget() {
    isOpen = true;
    chatWindow.classList.add("open");
    trigger.classList.add("active");
    clearUnreadBadge();
    // Lock body scroll on mobile to prevent background scrolling
    if (isMobileViewport()) {
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    }
    // For center-inline: keep the bar visible as the input, skip home screen
    if (isInlineBarVariant) {
      stopPlaceholderRotation();
      showChatScreen();
      // Ensure inline bar is expanded and marked as active
      if (!inlineBarExpanded) expandInlineBar();
      inlineBar.classList.add("chat-active");
      updateInlineBarBtn();
      // On mobile, hide the inline bar since chat goes full-screen with its own input
      if (isMobileViewport()) {
        inlineBar.classList.add("hidden");
      }
      // Focus the inline bar input (it's the persistent input)
      setTimeout(() => {
        if (!isMobileViewport()) {
          inlineBarInput.focus();
        }
      }, 100);
    }
    // Don't auto-focus the chat input -- the home screen is shown first (non-inline variant)
  }

  function closeChatWidget() {
    isOpen = false;
    chatWindow.classList.remove("open");
    trigger.classList.remove("active");
    // Restore body scroll
    if (isMobileViewport()) {
      document.body.style.overflow = "";
      document.documentElement.style.overflow = "";
    }
    // For center-inline: collapse the bar and remove active state
    if (isInlineBarVariant) {
      inlineBar.classList.remove("hidden");
      inlineBar.classList.remove("chat-active");
      collapseInlineBar();
    }
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
    identify: (info: {
      name?: string;
      email?: string;
      phone?: string;
      metadata?: Record<string, string>;
    }) => {
      visitorInfo = {
        ...visitorInfo,
        name: info.name ?? visitorInfo.name,
        email: info.email ?? visitorInfo.email,
        phone: info.phone ?? visitorInfo.phone,
      };
      if (info.metadata) {
        customMetadata = { ...customMetadata, ...info.metadata };
      }
      // Sync retroactively if conversation already exists
      if (conversationId) {
        syncIdentityToServer();
        if (info.metadata) syncMetadataToServer();
      }
    },
    setMetadata: (meta: Record<string, string>) => {
      customMetadata = { ...customMetadata, ...meta };
      if (conversationId) syncMetadataToServer();
    },
    requestNotifications: () => {
      requestNotificationPermission();
    },
  };

  // ─── Initialize ─────────────────────────────────────────────────────────────
  loadConfig().then(() => {
    // After config is loaded, try to restore an existing conversation
    restoreConversation();
  });
})();
