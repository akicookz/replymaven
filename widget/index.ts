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
  let pageContext: Record<string, string> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let config: Record<string, any> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let _isHandedOff = false;

  // Polling state
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastMessageTimestamp: number | null = null;
  let lastNewMessageAt: number = Date.now();
  const renderedMessageIds = new Set<string>();
  let unreadCount = 0;

  // Send guard -- prevents duplicate message sends
  let isSending = false;

  // Streaming guard -- prevents polling from creating duplicate messages during SSE
  let isStreaming = false;

  // Heartbeat state
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // Notification state
  let notificationPermission: NotificationPermission = "default";

  // Visibility tracking
  let isTabActive = !document.hidden;
  let originalDocTitle = document.title;
  let titleOverridden = false;

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
    chat: (() => {
      const id = "rm-sm-" + Math.random().toString(36).slice(2, 8);
      return `<svg viewBox="0 0 28 32" fill="none"><mask id="${id}"><rect width="28" height="32" fill="white"/><path d="M6 14C11.3333 19.3333 16.6667 19.3333 22 14" stroke="black" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></mask><path mask="url(#${id})" d="M24 32H6C2.6875 32 0 29.3125 0 26V6C0 2.6875 2.6875 0 6 0H25C26.6562 0 28 1.34375 28 3V21C28 22.3062 27.1625 23.4187 26 23.8312V28C27.1063 28 28 28.8937 28 30C28 31.1063 27.1063 32 26 32H24ZM6 24C4.89375 24 4 24.8937 4 26C4 27.1063 4.89375 28 6 28H22V24H6Z" fill="currentColor"/></svg>`;
    })(),
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
    bot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>',
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
    person:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
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

      /* ─── Theme tokens (light / solid default) ─────────────────────── */
      --rm-bg: #ffffff;
      --rm-bg-secondary: #f4f4f5;
      --rm-bg-tertiary: #e4e4e7;
      --rm-text: #18181b;
      --rm-text-secondary: #52525b;
      --rm-text-muted: #a1a1aa;
      --rm-border: #e4e4e7;
      --rm-border-subtle: rgba(0,0,0,0.06);
      --rm-shadow: 0 8px 40px rgba(0,0,0,0.12);
      --rm-input-bg: #f4f4f5;
      --rm-input-bg-focus: #ebebec;
      --rm-scrollbar: rgba(0,0,0,0.12);
      --rm-bot-bg: #ffffff;
      --rm-bot-text: #18181b;

      --rm-visitor-bg: var(--rm-primary, #2563eb);
      --rm-visitor-text: var(--rm-brand-text, #ffffff);

      /* ─── Accent tokens (derived from primary in JS) ────────────── */
      --rm-accent-bg: rgba(37,99,235, 0.08);
      --rm-accent-bg-hover: rgba(37,99,235, 0.15);
      --rm-accent-text: var(--rm-primary, #2563eb);

      /* ─── Derived radius tokens ────────────────────────────────────── */
      --rm-btn-radius: calc(var(--rm-chat-radius, 16px) * 1.25);
      --rm-input-radius: calc(var(--rm-chat-radius, 16px) * 0.875);
      --rm-card-radius: calc(var(--rm-chat-radius, 16px) * 1.0);
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
      width: 52px;
      height: 52px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 14px 0 color-mix(in srgb, var(--rm-primary, #2563eb), transparent 55%);
      transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.3s ease;
      position: relative;
      color: var(--rm-brand-text, #ffffff);
      opacity: 0;
      overflow: hidden;
    }
    .rm-trigger.ready {
      opacity: 1;
    }
    .rm-trigger:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 20px 0 color-mix(in srgb, var(--rm-primary, #2563eb), transparent 45%);
    }
    .rm-trigger svg {
      height: 28px;
      width: auto;
    }
    .rm-trigger .rm-icon-close svg {
      height: 22px;
      stroke-width: 1.5;
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
      top: -2px;
      right: -2px;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ef4444;
      display: none;
      z-index: 1;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .rm-trigger-badge.visible {
      display: block;
    }

    /* ─── Intro Pill (corner positions) ──────────────────────────────────── */
    @keyframes rm-pill-glow {
      0%, 100% { box-shadow: 0 0 6px 0px color-mix(in srgb, var(--rm-primary, #2563eb), transparent 90%); }
      50% { box-shadow: 0 0 10px 0px color-mix(in srgb, var(--rm-primary, #2563eb), transparent 82%); }
    }
    .rm-intro-pill {
      position: absolute;
      bottom: 12px;
      width: 300px;
      max-width: 300px;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 10px 16px 10px 10px;
      border: 0.5px solid var(--rm-glow-border, rgba(37,99,235,0.2));
      border-radius: calc(var(--rm-chat-radius, 16px) * 1.5);
      background: var(--rm-bg, #ffffff);
      animation: rm-pill-glow 4s ease-in-out infinite;
      box-shadow: 0 0 6px 0px color-mix(in srgb, var(--rm-primary, #2563eb), transparent 90%);
      cursor: pointer;
      opacity: 0;
      transform: translateX(10px);
      transition: opacity 0.4s ease, transform 0.4s ease;
      pointer-events: none;
      font-family: inherit;
    }
    .rm-widget-container.bottom-right .rm-intro-pill {
      right: 64px;
      border-radius: calc(var(--rm-chat-radius, 16px) * 1.5) calc(var(--rm-chat-radius, 16px) * 1.5) 12px calc(var(--rm-chat-radius, 16px) * 1.5);
    }
    .rm-widget-container.bottom-left .rm-intro-pill {
      left: 64px;
      transform: translateX(-10px);
      border-radius: calc(var(--rm-chat-radius, 16px) * 1.5) calc(var(--rm-chat-radius, 16px) * 1.5) calc(var(--rm-chat-radius, 16px) * 1.5) 12px;
    }
    .rm-intro-pill[data-bg-style="blurred"] {
      background: rgba(0,0,0,0.18);
      backdrop-filter: blur(24px) saturate(1.4);
      -webkit-backdrop-filter: blur(24px) saturate(1.4);
    }
    .rm-intro-pill.visible {
      opacity: 1;
      transform: translateX(0);
      pointer-events: auto;
    }
    .rm-intro-pill.rm-intro-hidden {
      opacity: 0;
      transform: translateX(10px);
      pointer-events: none;
      transition: opacity 0.4s ease, transform 0.4s ease;
    }
    .rm-widget-container.bottom-left .rm-intro-pill.rm-intro-hidden {
      transform: translateX(-10px);
    }
    .rm-intro-pill:hover {
      box-shadow: 0 6px 20px rgba(0,0,0,0.18);
    }
    .rm-trigger.active ~ .rm-intro-pill {
      opacity: 0 !important;
      pointer-events: none !important;
      transition: opacity 0.2s ease !important;
    }
    .rm-intro-pill-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
    }
    .rm-intro-pill-icon {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--rm-accent-bg);
      color: var(--rm-accent-text);
    }
    .rm-intro-pill-icon svg {
      height: 26px;
      width: auto;
    }
    .rm-intro-pill-text {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }
    .rm-intro-pill-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--rm-text, #18181b);
      line-height: 1.3;
      white-space: nowrap;
    }
    .rm-intro-pill-desc {
      font-size: 14px;
      font-weight: 500;
      color: var(--rm-text-secondary, #52525b);
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .rm-widget-container.center-inline .rm-intro-pill {
      display: none;
    }
    @media (max-width: 480px) {
      .rm-intro-pill {
        max-width: calc(100vw - 90px);
      }
      .rm-widget-container.bottom-right .rm-intro-pill {
        border-radius: calc(var(--rm-chat-radius, 16px) * 1.5) calc(var(--rm-chat-radius, 16px) * 1.5) 12px calc(var(--rm-chat-radius, 16px) * 1.5);
      }
      .rm-widget-container.bottom-left .rm-intro-pill {
        border-radius: calc(var(--rm-chat-radius, 16px) * 1.5) calc(var(--rm-chat-radius, 16px) * 1.5) calc(var(--rm-chat-radius, 16px) * 1.5) 12px;
      }
    }

    /* ─── Chat Window ─────────────────────────────────────────────────────── */
    .rm-chat-window {
      position: absolute;
      bottom: 66px;
      width: 400px;
      min-height: 600px;
      max-height: 620px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-radius: var(--rm-chat-radius, 16px);
      box-shadow: var(--rm-shadow);
      border: 1px solid var(--rm-border);
      background: var(--rm-bg);
      color: var(--rm-text);
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
    /* ─── Background Style: Blurred (dark glassmorphism) ────────────────── */
    .rm-chat-window[data-bg-style="blurred"] {
      background: rgba(0,0,0,0.18);
      backdrop-filter: blur(24px) saturate(1.4);
      -webkit-backdrop-filter: blur(24px) saturate(1.4);
      border: 1px solid rgba(var(--rm-primary-rgb, 37,99,235), 0.25);
      box-shadow: 0 8px 40px rgba(0,0,0,0.35), 0 0 0 1px rgba(var(--rm-primary-rgb, 37,99,235), 0.15);
      color: #ffffff;
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
      transform: none;
      pointer-events: auto;
    }

    /* ─── Header ──────────────────────────────────────────────────────────── */
    .rm-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 16px;
      margin-bottom: 0;
      background: var(--rm-bg, #ffffff);
      color: var(--rm-text, #18181b);
      flex-shrink: 0;
      position: relative;
      z-index: 2;
    }
    .rm-chat-window[data-bg-style="blurred"] .rm-header {
      background: transparent;
    }
    .rm-chat-window[data-bg-style="blurred"] .rm-header {
      margin-bottom: -24px;
      background: linear-gradient(to bottom, rgba(var(--rm-primary-rgb, 37,99,235), 0.3), rgba(var(--rm-primary-rgb, 37,99,235), 0.0));
    }
    .rm-header-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: var(--rm-accent-bg, rgba(37,99,235,0.08));
      color: var(--rm-accent-text, #2563eb);
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
      color: var(--rm-text-secondary, #52525b);
      opacity: 1;
      margin-top: 1px;
      line-height: 1.3;
    }
    .rm-header-close {
      background: var(--rm-bg-secondary, #f4f4f5);
      border: none;
      color: var(--rm-text-secondary, #52525b);
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
      background: var(--rm-bg-tertiary, #e4e4e7);
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
      background: transparent;
    }
    .rm-messages::-webkit-scrollbar {
      width: 4px;
    }
    .rm-messages::-webkit-scrollbar-thumb {
      background: var(--rm-scrollbar);
      border-radius: 4px;
    }

    /* ─── Message Row (avatar + bubble) ───────────────────────────────────── */
    .rm-message-row {
      display: flex;
      gap: 8px;
      align-items: flex-end;
      animation: rm-message-in 0.3s ease-out;
      max-width: 92%;
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
      overflow: hidden;
    }
    .rm-message-row.visitor .rm-message {
      background: var(--rm-visitor-bg, var(--rm-primary, #2563eb));
      color: var(--rm-visitor-text, var(--rm-brand-text, #ffffff));
      border-radius: 18px 18px 4px 18px;
    }
    .rm-message-row.bot .rm-message {
      background: var(--rm-bot-bg, #ffffff);
      color: var(--rm-bot-text, #18181b);
      border-radius: 18px 18px 18px 4px;
    }
    .rm-message-row.agent .rm-message {
      background: var(--rm-agent-bg, #f0f7ff);
      color: var(--rm-bot-text, #18181b);
      border-radius: 18px 18px 18px 4px;
    }
    .rm-msg-col {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }
    .rm-sender-label {
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 0;
    }
    .rm-sender-label.bot {
      color: var(--rm-bot-text, #18181b);
      opacity: 0.5;
    }
    .rm-sender-label.agent {
      color: var(--rm-primary, #2563eb);
      opacity: 0.7;
    }

    /* ─── Typing Indicator ────────────────────────────────────────────────── */
    .rm-typing-row {
      display: flex;
      align-items: center;
      align-self: flex-start;
      gap: 8px;
      padding: 0 16px;
      margin-top: 8px;
      max-height: 0;
      opacity: 0;
      overflow: hidden;
      transition: max-height 0.2s ease-out, opacity 0.2s ease-out, padding 0.2s ease-out;
    }
    .rm-typing-row.visible {
      max-height: 40px;
      opacity: 1;
      padding: 8px 16px;
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
      background: var(--rm-text-muted);
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
      color: var(--rm-text-muted);
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

    /* ─── Tool Call Card ──────────────────────────────────────────────────── */
    .rm-tool-call {
      align-self: flex-start;
      padding: 0 16px;
      margin: 4px 0;
      max-width: 88%;
    }
    .rm-tool-call-card {
      border-radius: 8px;
      border: 1px solid var(--rm-border-subtle);
      background: var(--rm-bg-secondary);
      overflow: hidden;
    }
    .rm-tool-call-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      cursor: pointer;
      user-select: none;
      font-size: 12px;
      color: var(--rm-text-secondary);
    }
    .rm-tool-call-header:hover {
      background: var(--rm-bg-tertiary);
    }
    .rm-tool-call-icon {
      width: 20px;
      height: 20px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .rm-tool-call-icon svg {
      width: 12px;
      height: 12px;
    }
    .rm-tool-call-icon.pending {
      background: rgba(59,130,246,0.15);
      color: #60a5fa;
    }
    .rm-tool-call-icon.success {
      background: rgba(34,197,94,0.15);
      color: #4ade80;
    }
    .rm-tool-call-icon.error {
      background: rgba(239,68,68,0.15);
      color: #f87171;
    }
    .rm-tool-call-name {
      flex: 1;
      min-width: 0;
      font-weight: 500;
      color: var(--rm-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .rm-tool-call-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      font-size: 10px;
    }
    .rm-tool-call-status {
      padding: 1px 6px;
      border-radius: 10px;
      font-weight: 500;
      font-size: 10px;
    }
    .rm-tool-call-status.success {
      background: rgba(34,197,94,0.15);
      color: #4ade80;
    }
    .rm-tool-call-status.error {
      background: rgba(239,68,68,0.15);
      color: #f87171;
    }
    .rm-tool-call-status.pending {
      background: rgba(59,130,246,0.15);
      color: #60a5fa;
    }
    .rm-tool-call-duration {
      color: var(--rm-text-muted);
    }
    .rm-tool-call-chevron {
      width: 12px;
      height: 12px;
      flex-shrink: 0;
      color: var(--rm-text-muted);
      transition: transform 0.15s ease;
    }
    .rm-tool-call.expanded .rm-tool-call-chevron {
      transform: rotate(90deg);
    }
    .rm-tool-call-details {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.2s ease-out;
    }
    .rm-tool-call.expanded .rm-tool-call-details {
      max-height: 400px;
    }
    .rm-tool-call-section {
      padding: 6px 10px;
      border-top: 1px solid var(--rm-border-subtle);
    }
    .rm-tool-call-section-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--rm-text-muted);
      margin-bottom: 4px;
    }
    .rm-tool-call-code {
      background: var(--rm-bg-tertiary);
      border-radius: 6px;
      padding: 6px 8px;
      font-family: monospace;
      font-size: 11px;
      color: var(--rm-text-secondary);
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 120px;
      overflow-y: auto;
    }
    .rm-tool-call-error-msg {
      font-size: 11px;
      color: #f87171;
      margin-bottom: 4px;
    }
    @keyframes rm-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .rm-tool-call-loading {
      animation: rm-pulse 1.5s ease-in-out infinite;
    }

    /* ─── Tool Error (legacy compat) ─────────────────────────────────────── */
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
      color: #fca5a5;
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
      color: #fecaca;
      background: rgba(220,38,38,0.15);
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
      background: transparent;
      position: relative;
      z-index: 2;
    }
    .rm-quick-topic {
      padding: 7px 14px;
      border-radius: var(--rm-btn-radius);
      border: 1px solid var(--rm-border);
      background: var(--rm-bg-secondary);
      font-size: 13px;
      cursor: pointer;
      transition: background 0.2s, border-color 0.2s;
      color: var(--rm-text);
      line-height: 1.3;
    }
    .rm-quick-topic:hover {
      background: var(--rm-accent-bg-hover);
      border-color: var(--rm-accent-bg-hover);
    }

    /* ─── Input Area ──────────────────────────────────────────────────────── */
    .rm-input-area {
      padding: 12px 16px;
      border-top: 1px solid var(--rm-border-subtle);
      display: flex;
      align-items: center;
      gap: 8px;
      background: transparent;
      position: relative;
      z-index: 2;
    }
    .rm-input {
      flex: 1;
      padding: 8px 14px;
      border: 1px solid var(--rm-border);
      border-radius: var(--rm-btn-radius);
      font-size: 14px;
      outline: none;
      background: var(--rm-input-bg);
      color: var(--rm-text);
      transition: border-color 0.2s, box-shadow 0.2s;
      font-family: inherit;
      touch-action: manipulation;
    }
    .rm-input:focus {
      border-color: var(--rm-primary, #2563eb);
      box-shadow: 0 0 0 3px rgba(var(--rm-primary-rgb, 37,99,235), 0.12);
      background: var(--rm-input-bg-focus);
    }
    .rm-input::placeholder {
      color: var(--rm-text-muted);
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
      color: var(--rm-brand-text, #ffffff);
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
      color: var(--rm-text-muted);
      transition: color 0.2s, background 0.2s;
      padding: 0;
    }
    .rm-attach-btn:hover {
      color: var(--rm-text-secondary);
      background: var(--rm-bg-secondary);
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
      background: transparent;
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
      border: 1px solid var(--rm-border);
    }
    .rm-image-preview-name {
      flex: 1;
      font-size: 12px;
      color: var(--rm-text-secondary);
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
      background: var(--rm-bg-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--rm-text-secondary);
      padding: 0;
    }
    .rm-image-preview-remove:hover {
      background: var(--rm-bg-tertiary);
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
      color: var(--rm-text-muted);
      background: transparent;
      position: relative;
      z-index: 2;
    }
    .rm-powered a {
      color: var(--rm-text-secondary);
      text-decoration: none;
      font-weight: 500;
    }
    .rm-powered a:hover {
      color: var(--rm-text);
    }

    /* ─── Handoff Card ────────────────────────────────────────────────────── */
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
      border: 3px solid var(--rm-border);
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
      color: var(--rm-text);
    }
    .rm-home-subtitle {
      font-size: 13px;
      color: var(--rm-text-secondary);
      margin-top: 4px;
    }
    .rm-home-ask {
      margin-top: 16px;
      border: 1px solid var(--rm-accent-bg-hover);
      border-radius: var(--rm-card-radius);
      padding: 14px;
      cursor: pointer;
      box-shadow: 0 1px 4px var(--rm-accent-bg);
    }
    .rm-home-ask-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--rm-accent-text);
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
      color: var(--rm-text);
      background: transparent;
      cursor: pointer;
      font-family: inherit;
      padding: 0;
      touch-action: manipulation;
    }
    .rm-home-ask-input::placeholder {
      color: var(--rm-text-muted);
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
      border: 1px solid var(--rm-border);
      border-radius: var(--rm-input-radius);
      cursor: pointer;
      text-decoration: none;
      color: inherit;
      transition: background 0.2s, border-color 0.2s;
    }
    .rm-home-link:hover {
      background: var(--rm-bg-secondary);
      border-color: var(--rm-bg-tertiary);
    }
    .rm-home-link-icon {
      width: 34px;
      height: 34px;
      min-width: 34px;
      border-radius: 8px;
      background: var(--rm-accent-bg);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--rm-accent-text);
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
      color: var(--rm-text);
    }
    .rm-home-link-arrow {
      width: 16px;
      height: 16px;
      color: var(--rm-text-muted);
      flex-shrink: 0;
    }
    .rm-home-link-arrow svg {
      width: 16px;
      height: 16px;
    }

    /* Chat header back button */
    .rm-header-back {
      background: var(--rm-bg-secondary, #f4f4f5);
      border: none;
      color: var(--rm-text-secondary, #52525b);
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
      background: var(--rm-bg-tertiary, #e4e4e7);
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
      margin: 4px 0 8px 18px;
      padding-left: 0;
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
      background: var(--rm-bg-secondary);
      padding: 1px 5px;
      border-radius: 4px;
      font-size: 13px;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
    }

    /* ─── Source Links ────────────────────────────────────────────────────── */
    .rm-sources {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px solid var(--rm-border-subtle);
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
      color: var(--rm-text-muted);
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

    /* ─── Inquiry Form ────────────────────────────────────────────────────── */
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
    }
    .rm-form-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background: transparent;
    }
    .rm-form-body::-webkit-scrollbar {
      width: 4px;
    }
    .rm-form-body::-webkit-scrollbar-thumb {
      background: var(--rm-scrollbar);
      border-radius: 4px;
    }
    .rm-form-description {
      font-size: 14px;
      color: var(--rm-text-secondary);
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
      color: var(--rm-text);
    }
    .rm-form-label .rm-required {
      color: #f87171;
      margin-left: 2px;
    }
    .rm-form-input {
      padding: 10px 14px;
      border: 1px solid var(--rm-border);
      border-radius: var(--rm-input-radius);
      font-size: 16px;
      outline: none;
      font-family: inherit;
      color: var(--rm-text);
      background: var(--rm-input-bg);
      transition: border-color 0.2s, box-shadow 0.2s;
      touch-action: manipulation;
    }
    .rm-form-input:focus {
      border-color: var(--rm-primary, #2563eb);
      box-shadow: 0 0 0 3px rgba(var(--rm-primary-rgb, 37,99,235), 0.12);
      background: var(--rm-input-bg-focus);
    }
    .rm-form-input::placeholder {
      color: var(--rm-text-muted);
    }
    .rm-form-textarea {
      padding: 10px 14px;
      border: 1px solid var(--rm-border);
      border-radius: var(--rm-input-radius);
      font-size: 16px;
      outline: none;
      font-family: inherit;
      color: var(--rm-text);
      background: var(--rm-input-bg);
      transition: border-color 0.2s, box-shadow 0.2s;
      resize: vertical;
      min-height: 80px;
      touch-action: manipulation;
    }
    .rm-form-textarea:focus {
      border-color: var(--rm-primary, #2563eb);
      box-shadow: 0 0 0 3px rgba(var(--rm-primary-rgb, 37,99,235), 0.12);
      background: var(--rm-input-bg-focus);
    }
    .rm-form-textarea::placeholder {
      color: var(--rm-text-muted);
    }
    .rm-form-submit {
      padding: 12px 24px;
      border-radius: var(--rm-card-radius);
      border: none;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      color: var(--rm-brand-text, #ffffff);
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
      color: #f87171;
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
      background: transparent;
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
      color: var(--rm-text);
    }
    .rm-form-success-subtitle {
      font-size: 13px;
      color: var(--rm-text-secondary);
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
      border-radius: var(--rm-btn-radius);
      border: 1px solid var(--rm-border);
      background: var(--rm-bg-secondary);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s, border-color 0.2s;
      color: var(--rm-text);
      font-family: inherit;
    }
    .rm-home-action-btn:hover {
      background: var(--rm-bg-tertiary);
      border-color: var(--rm-bg-tertiary);
    }
    .rm-home-action-btn svg {
      width: 14px;
      height: 14px;
    }

    /* ─── Animations ──────────────────────────────────────────────────────── */
    @keyframes rm-ask-sweep {
      0% { background-position: 200% center; }
      100% { background-position: -200% center; }
    }
    .rm-ask-label-text {
      background: linear-gradient(
        90deg,
        var(--rm-accent-text, #2563eb) 0%,
        var(--rm-primary, #2563eb) 40%,
        var(--rm-accent-text, #2563eb) 80%
      );
      background-size: 200% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: rm-ask-sweep 3s ease-in-out infinite;
    }
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
    .rm-back-btn {
      margin-top: 24px;
      padding: 10px 24px;
      border: 1px solid var(--rm-border);
      border-radius: var(--rm-input-radius);
      background: var(--rm-bg-secondary);
      font-size: 13px;
      font-weight: 500;
      color: var(--rm-text);
      cursor: pointer;
      transition: background 0.15s;
    }
    .rm-back-btn:hover { background: var(--rm-bg-tertiary); }

    @media (max-width: 480px) {
      .rm-widget-container.bottom-right,
      .rm-widget-container.bottom-left {
        bottom: 16px;
        right: 16px;
        left: auto;
      }
      .rm-chat-window {
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
        border-radius: 0 !important;
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
      width: 300px;
      max-width: calc(100% - 40px);
      z-index: 999999;
      border-radius: 26px;
      background: transparent;
      animation: rm-pill-glow 4s ease-in-out infinite;
      box-shadow: 0 0 6px 0px color-mix(in srgb, var(--rm-primary, #2563eb), transparent 90%);
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
      background: var(--rm-bg);
      border: 0.5px solid var(--rm-glow-border, rgba(37,99,235,0.2));
      border-radius: 24px;
      display: flex;
      align-items: center;
      padding: 5px 6px 5px 16px;
      gap: 8px;
      position: relative;
    }
    .rm-inline-bar[data-bg-style="blurred"] .rm-inline-bar-inner {
      background: color-mix(in srgb, var(--rm-primary, #2563eb), #000000 85%);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border: none;
    }
    .rm-inline-bar-input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: var(--rm-text);
      font-size: 14px;
      line-height: 1.4;
      min-width: 0;
      caret-color: var(--rm-text);
    }
    .rm-inline-bar-input::placeholder {
      color: var(--rm-text-muted);
    }
    .rm-inline-bar-placeholder {
      position: absolute;
      left: 20px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--rm-text-muted);
      font-size: 14px;
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
      width: 30px;
      height: 30px;
      border-radius: 50%;
      border: none;
      background: var(--rm-primary, #2563eb);
      color: var(--rm-brand-text, #ffffff);
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
      width: 14px;
      height: 14px;
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

    /* ─── Float container: stacks intro, actions, topics above the bar ────── */
    .rm-inline-bar-float {
      position: absolute;
      bottom: calc(100% + 10px);
      left: 0;
      right: 0;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      padding: 0 4px;
      opacity: 0;
      visibility: hidden;
      transform: translateY(8px);
      transition: opacity 0.25s ease, transform 0.25s ease, visibility 0.25s;
      pointer-events: none;
    }
    .rm-inline-bar.expanded:not(.chat-active) .rm-inline-bar-float {
      opacity: 1;
      visibility: visible;
      transform: translateY(0);
      pointer-events: auto;
    }

    /* Topics panel above the bar */
    .rm-inline-bar-topics {
      display: flex;
      flex-direction: column;
      gap: 6px;
      width: 100%;
    }

    .rm-inline-bar-topic {
      display: inline-flex;
      align-self: flex-start;
      padding: 8px 14px;
      border-radius: 20px;
      border: 1px solid var(--rm-border);
      background: var(--rm-bg);
      color: var(--rm-text);
      font-size: 13px;
      cursor: pointer;
      transition: background 0.2s ease, transform 0.1s ease;
      line-height: 1.3;
      text-align: left;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .rm-inline-bar-topic:hover {
      background: var(--rm-bg-secondary);
      transform: translateX(4px);
    }
    .rm-inline-bar[data-bg-style="blurred"] .rm-inline-bar-topic {
      background: color-mix(in srgb, var(--rm-primary, #2563eb), #000000 70%);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: none;
      color: #ffffff;
      box-shadow: none;
    }
    .rm-inline-bar[data-bg-style="blurred"] .rm-inline-bar-topic:hover {
      background: color-mix(in srgb, var(--rm-primary, #2563eb), #000000 55%);
    }
    .rm-inline-bar.expanded .rm-inline-bar-topic {
      animation: rm-topic-slide-up 0.3s ease forwards;
    }
    .rm-inline-bar.expanded .rm-inline-bar-topic:nth-of-type(1) { animation-delay: 0s; }
    .rm-inline-bar.expanded .rm-inline-bar-topic:nth-of-type(2) { animation-delay: 0.05s; }
    .rm-inline-bar.expanded .rm-inline-bar-topic:nth-of-type(3) { animation-delay: 0.1s; }
    .rm-inline-bar.expanded .rm-inline-bar-topic:nth-of-type(4) { animation-delay: 0.15s; }
    .rm-inline-bar.expanded .rm-inline-bar-topic:nth-of-type(5) { animation-delay: 0.2s; }

    /* ─── Center Inline Quick Action Bubbles ─────────────────────────────── */
    .rm-inline-bar-actions {
      display: none;
      justify-content: flex-start;
      gap: 8px;
      width: 100%;
    }
    .rm-inline-bar-actions.has-actions {
      display: flex;
    }
    .rm-inline-bar-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 20px;
      border: 1px solid var(--rm-border);
      background: var(--rm-bg);
      color: var(--rm-text);
      font-size: 13px;
      cursor: pointer;
      transition: opacity 0.2s ease, border-color 0.2s ease;
      line-height: 1.3;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    }
    .rm-inline-bar-action:hover {
      opacity: 0.8;
      border-color: var(--rm-text-secondary, #52525b);
    }
    .rm-inline-bar-action svg {
      width: 14px;
      height: 14px;
      opacity: 0.6;
      flex-shrink: 0;
    }
    .rm-inline-bar[data-bg-style="blurred"] .rm-inline-bar-action {
      background: color-mix(in srgb, var(--rm-primary, #2563eb), #000000 70%);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,0.1);
      color: #ffffff;
      box-shadow: none;
    }
    .rm-inline-bar[data-bg-style="blurred"] .rm-inline-bar-action:hover {
      opacity: 0.8;
      border-color: rgba(255,255,255,0.3);
    }

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
    /* Center-inline header tweaks */
    .rm-widget-container.center-inline .rm-header {
      margin-bottom: 0;
      padding: 14px 16px;
    }
    /* Hide back button in center-inline -- only X (close) button shown */
    .rm-widget-container.center-inline .rm-header-back {
      display: none;
    }
    /* Center-inline messages area */
    .rm-widget-container.center-inline .rm-messages {
      padding-top: 16px;
      padding-bottom: 16px;
      min-height: 120px;
    }
    /* Hide the chat window's own input area — the inline bar IS the input */
    .rm-widget-container.center-inline .rm-input-area {
      display: none;
    }
    /* Hide image preview in chat window for center-inline (we'll handle attachments via inline bar) */
    .rm-widget-container.center-inline .rm-image-preview {
      display: none;
    }
    /* Center-inline quick topics */
    .rm-widget-container.center-inline .rm-quick-topics {
      padding-bottom: 8px;
    }
    .rm-widget-container.center-inline .rm-powered {
      padding: 4px 16px 6px;
    }
    /* Home view hidden in center-inline */
    .rm-widget-container.center-inline .rm-home {
      display: none;
    }
    /* Center-inline: sources, typing, handoff, errors inherit base dark theme */

    /* When chat is active, inline bar gets a slightly different style (no glow, solid border) */
    .rm-inline-bar.chat-active {
      animation: none;
      background: transparent;
      box-shadow: none;
      border-radius: 20px;
    }
    .rm-inline-bar[data-bg-style="blurred"].chat-active {
      background: transparent;
    }
    .rm-inline-bar.chat-active .rm-inline-bar-inner {
      border: 0.5px solid var(--rm-glow-border, rgba(37,99,235,0.2));
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
      }
      .rm-widget-container.center-inline .rm-chat-window.open .rm-input {
        border-radius: var(--rm-card-radius);
        padding: 10px 14px;
        font-size: 16px;
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
  homeAskLabel.innerHTML =
    ICONS.sparkle + ' <span class="rm-ask-label-text">Ask AI</span>';
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

  // ─── Inquiry Form View ──────────────────────────────────────────────────────
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

  const defaultMessagePlaceholder = "Type a message...";
  const agentMessagePlaceholder = "Add any details for the team...";

  const input = document.createElement("input");
  input.className = "rm-input";
  input.placeholder = defaultMessagePlaceholder;

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

  // Assemble chat window
  chatWindow.appendChild(homeView);
  chatWindow.appendChild(formView);
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
  triggerBadge.textContent = "";
  trigger.appendChild(triggerChatIcon);
  trigger.appendChild(triggerCloseIcon);
  trigger.appendChild(triggerBadge);
  trigger.onclick = () => toggleChatWidget();

  // ─── Intro Pill (corner positions) ──────────────────────────────────────────
  const introPill = document.createElement("div");
  introPill.className = "rm-intro-pill";

  const introPillAvatar = document.createElement("img");
  introPillAvatar.className = "rm-intro-pill-avatar";
  introPillAvatar.alt = "Avatar";
  introPillAvatar.style.display = "none";

  const introPillIcon = document.createElement("div");
  introPillIcon.className = "rm-intro-pill-icon";
  introPillIcon.innerHTML = ICONS.chat;

  const introPillTextWrap = document.createElement("div");
  introPillTextWrap.className = "rm-intro-pill-text";

  const introPillTitle = document.createElement("div");
  introPillTitle.className = "rm-intro-pill-title";

  const introPillDesc = document.createElement("div");
  introPillDesc.className = "rm-intro-pill-desc";

  introPillTextWrap.appendChild(introPillTitle);
  introPillTextWrap.appendChild(introPillDesc);
  introPill.appendChild(introPillAvatar);
  introPill.appendChild(introPillIcon);
  introPill.appendChild(introPillTextWrap);
  introPill.onclick = () => toggleChatWidget();

  let introPillTimer: ReturnType<typeof setTimeout> | null = null;
  let introPillDelayTimer: ReturnType<typeof setTimeout> | null = null;

  container.appendChild(chatWindow);
  container.appendChild(trigger);
  container.appendChild(introPill);
  document.body.appendChild(container);

  // ─── Inline Bar DOM (created once, shown only for inline-bar variant) ───────
  const inlineBar = document.createElement("div");
  inlineBar.className = "rm-inline-bar";

  const inlineBarActions = document.createElement("div");
  inlineBarActions.className = "rm-inline-bar-actions";

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

  const inlineBarFloat = document.createElement("div");
  inlineBarFloat.className = "rm-inline-bar-float";
  inlineBarFloat.appendChild(inlineBarActions);
  inlineBarFloat.appendChild(inlineBarTopics);

  inlineBar.appendChild(inlineBarFloat);
  inlineBar.appendChild(inlineBarInner);

  // Not appended to body yet — only when variant is "inline-bar" in loadConfig

  // ─── Inline Bar State ───────────────────────────────────────────────────────
  let isInlineBarVariant = false;
  let inlineBarExpanded = false;
  let introMessageText: string | null = null;
  let introMessageAuthor: {
    name: string;
    avatar: string | null;
    workTitle: string | null;
  } | null = null;

  let placeholderTexts: string[] = ["Ask a question..."];
  let placeholderIndex = 0;
  let placeholderInterval: ReturnType<typeof setInterval> | null = null;

  function syncConversationModeUi() {
    const agentMode = conversationStatus === "agent_replied";
    _isHandedOff = agentMode;
    input.placeholder = agentMode
      ? agentMessagePlaceholder
      : defaultMessagePlaceholder;

    if (inlineBarExpanded) {
      inlineBarInput.placeholder = conversationId
        ? agentMode
          ? agentMessagePlaceholder
          : defaultMessagePlaceholder
        : "Ask a question...";
    }
  }

  function expandInlineBar() {
    if (inlineBarExpanded) return;
    inlineBarExpanded = true;
    inlineBar.classList.add("expanded");
    inlineBarPlaceholder.style.display = "none";
    inlineBarInput.placeholder = conversationId
      ? _isHandedOff
        ? agentMessagePlaceholder
        : defaultMessagePlaceholder
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
  let currentView: "home" | "chat" | "form" = "home";

  function showChatScreen() {
    currentView = "chat";
    homeView.classList.add("hidden");
    formView.classList.remove("active");
    chatView.classList.add("active");
    // Show intro message as the first bot message on first chat open
    if (introMessageText) {
      const msgEl = addMessageToUI("bot", introMessageText);
      // If an author is set, replace the avatar and add author name
      const msgRow = msgEl.closest(".rm-message-row");
      if (introMessageAuthor && msgRow) {
        const avatar = msgRow.querySelector(
          ".rm-message-avatar",
        ) as HTMLElement | null;
        if (avatar) {
          avatar.innerHTML = "";
          avatar.classList.remove("rm-icon-avatar");
          if (introMessageAuthor.avatar) {
            avatar.style.backgroundColor = "transparent";
            const img = document.createElement("img");
            img.src = resolveUrl(introMessageAuthor.avatar);
            img.alt = introMessageAuthor.name;
            img.style.width = "100%";
            img.style.height = "100%";
            img.style.borderRadius = "50%";
            img.style.objectFit = "cover";
            avatar.appendChild(img);
          } else {
            avatar.style.backgroundColor = `rgba(${hexToRgb(getPrimaryColor())}, 0.12)`;
            avatar.style.color = getPrimaryColor();
            avatar.textContent = introMessageAuthor.name
              .charAt(0)
              .toUpperCase();
            avatar.style.display = "flex";
            avatar.style.alignItems = "center";
            avatar.style.justifyContent = "center";
            avatar.style.fontSize = "12px";
            avatar.style.fontWeight = "600";
          }
          avatar.classList.remove("hidden");
        }
        // Add author name label above the message inside the column wrapper
        const col = msgEl.parentElement;
        if (col) {
          const nameLabel = document.createElement("div");
          nameLabel.className = "rm-sender-label bot";
          nameLabel.textContent = introMessageAuthor.name;
          col.insertBefore(nameLabel, msgEl);
        }
      }
      introMessageText = null;
    }
    setTimeout(() => input.focus(), 100);
  }

  function showHomeScreen() {
    // In center-inline mode there is no home screen — go to chat or close
    if (isInlineBarVariant) {
      if (conversationId) {
        showChatScreen();
      } else {
        closeChatWidget();
      }
      return;
    }
    currentView = "home";
    homeView.classList.remove("hidden");
    formView.classList.remove("active");
    chatView.classList.remove("active");
  }

  function showFormScreen() {
    currentView = "form";
    homeView.classList.add("hidden");
    chatView.classList.remove("active");
    formView.classList.add("active");
  }

  // ─── Visibility Tracking ─────────────────────────────────────────────────────
  document.addEventListener("visibilitychange", () => {
    isTabActive = !document.hidden;
    if (isTabActive && titleOverridden) {
      document.title = originalDocTitle;
      titleOverridden = false;
    }
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

  function getBrandTextColor(): string {
    return config?.widget?.textColor ?? "#ffffff";
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

    // Auto-link bare URLs (not already inside <a> tags)
    const linkPlaceholders: string[] = [];
    html = html.replace(/<a\s[^>]*>.*?<\/a>/g, (match) => {
      linkPlaceholders.push(match);
      return `%%LINK${linkPlaceholders.length - 1}%%`;
    });
    html = html.replace(
      /(https?:\/\/[^\s<)]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
    );
    html = html.replace(
      /%%LINK(\d+)%%/g,
      (_, i) => linkPlaceholders[Number(i)],
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

  // ─── Page Targeting ──────────────────────────────────────────────────────────

  let hiddenByPageTargeting = false;

  function matchesCurrentPage(patterns: string[]): boolean {
    const path = window.location.pathname;
    return patterns.some((pattern) => {
      if (pattern.endsWith("/*")) {
        const prefix = pattern.slice(0, -2);
        return path === prefix || path.startsWith(prefix + "/");
      }
      return path === pattern;
    });
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

      // Check page targeting: if allowedPages is set, only show on matching pages
      if (loadedConfig.widget?.allowedPages) {
        const patterns = (loadedConfig.widget.allowedPages as string)
          .split(",")
          .map((p: string) => p.trim())
          .filter(Boolean);
        if (patterns.length > 0) {
          // Initial check
          if (!matchesCurrentPage(patterns)) {
            container.style.display = "none";
            hiddenByPageTargeting = true;
          }

          // SPA route change detection
          const handleRouteChange = () => {
            if (!matchesCurrentPage(patterns) && !isOpen) {
              container.style.display = "none";
              hiddenByPageTargeting = true;
              stopPolling();
              stopHeartbeat();
            } else if (matchesCurrentPage(patterns)) {
              container.style.display = "";
              hiddenByPageTargeting = false;
            }
          };

          window.addEventListener("popstate", handleRouteChange);

          const origPush = history.pushState;
          history.pushState = function (...args: Parameters<typeof origPush>) {
            origPush.apply(this, args);
            handleRouteChange();
          };
          const origReplace = history.replaceState;
          history.replaceState = function (
            ...args: Parameters<typeof origReplace>
          ) {
            origReplace.apply(this, args);
            handleRouteChange();
          };
        }
      }

      // Apply styling
      if (loadedConfig.widget) {
        const w = loadedConfig.widget;
        const primary = w.primaryColor || "#2563eb";
        const brandText = w.textColor || "#ffffff";

        // Determine position mode early so styling can be conditional
        const isCenterInline = w.position === "center-inline";

        // Set CSS custom properties for theming
        container.style.setProperty("--rm-primary", primary);
        container.style.setProperty("--rm-primary-rgb", hexToRgb(primary));
        container.style.setProperty("--rm-brand-text", brandText);

        // ─── Background style + theme tokens ──────────────────────────────────
        const bgStyle = w.backgroundStyle || "solid";
        chatWindow.dataset.bgStyle = bgStyle;
        introPill.dataset.bgStyle = bgStyle;

        const pRgb = hexToRgb(primary);

        if (bgStyle === "blurred") {
          // Dark glassmorphism: primary-tinted dark theme
          container.style.setProperty("--rm-bg", "rgba(0,0,0,0.18)");
          container.style.setProperty(
            "--rm-bg-secondary",
            `rgba(255,255,255,0.06)`,
          );
          container.style.setProperty(
            "--rm-bg-tertiary",
            `rgba(255,255,255,0.10)`,
          );
          container.style.setProperty("--rm-text", "#ffffff");
          container.style.setProperty(
            "--rm-text-secondary",
            "rgba(255,255,255,0.7)",
          );
          container.style.setProperty(
            "--rm-text-muted",
            "rgba(255,255,255,0.4)",
          );
          container.style.setProperty("--rm-border", `rgba(255,255,255,0.12)`);
          container.style.setProperty(
            "--rm-border-subtle",
            `rgba(255,255,255,0.08)`,
          );
          container.style.setProperty(
            "--rm-shadow",
            `0 8px 40px rgba(0,0,0,0.35), 0 0 0 1px rgba(${pRgb}, 0.15)`,
          );
          container.style.setProperty(
            "--rm-input-bg",
            `rgba(255,255,255,0.08)`,
          );
          container.style.setProperty(
            "--rm-input-bg-focus",
            `rgba(255,255,255,0.12)`,
          );
          container.style.setProperty(
            "--rm-scrollbar",
            "rgba(255,255,255,0.12)",
          );
          // Accent tokens — visible on dark surfaces
          container.style.setProperty("--rm-accent-bg", `rgba(${pRgb}, 0.20)`);
          container.style.setProperty(
            "--rm-accent-bg-hover",
            `rgba(${pRgb}, 0.30)`,
          );
          container.style.setProperty("--rm-accent-text", "#ffffff");
          // Bot/visitor messages — always derived
          container.style.setProperty("--rm-bot-bg", "rgba(255,255,255,0.10)");
          container.style.setProperty("--rm-bot-text", "#ffffff");
          container.style.setProperty("--rm-agent-bg", `rgba(${pRgb}, 0.15)`);
          container.style.setProperty(
            "--rm-glow-border",
            "rgba(255,255,255,0.12)",
          );
        } else {
          // Light theme: accent tokens from primary
          container.style.setProperty("--rm-accent-bg", `rgba(${pRgb}, 0.08)`);
          container.style.setProperty(
            "--rm-accent-bg-hover",
            `rgba(${pRgb}, 0.15)`,
          );
          container.style.setProperty("--rm-accent-text", primary);
          // Bot/visitor messages — always derived
          container.style.setProperty("--rm-bot-bg", "#f4f4f5");
          container.style.setProperty("--rm-bot-text", "#18181b");
          container.style.setProperty("--rm-agent-bg", `rgba(${pRgb}, 0.06)`);
          container.style.setProperty("--rm-glow-border", `rgba(${pRgb}, 0.2)`);
        }

        // ─── Message colors (always derived from primary) ─────────────────────
        container.style.setProperty("--rm-visitor-bg", primary);
        container.style.setProperty("--rm-visitor-text", brandText);

        // Trigger & send button: brand colors
        trigger.style.backgroundColor = primary;
        sendBtn.style.backgroundColor = primary;

        void isCenterInline; // position handled below
        if (w.borderRadius) {
          container.style.setProperty(
            "--rm-chat-radius",
            w.borderRadius + "px",
          );
        }

        // Header text
        headerTitle.textContent =
          w.headerText || loadedConfig.botName || "Ask AI";
        headerSubtitle.textContent =
          w.headerSubtitle || "We typically reply instantly";

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
          const fontUrls: Record<string, string> = {
            Inter:
              "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap",
            Satoshi:
              "https://api.fontshare.com/v2/css?f[]=satoshi@400;500;600;700&display=swap",
            "DM Sans":
              "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap",
            Nunito:
              "https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700&display=swap",
            Raleway:
              "https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600&display=swap",
            "Plus Jakarta Sans":
              "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&display=swap",
            "IBM Plex Sans":
              "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap",
            Lato: "https://fonts.googleapis.com/css2?family=Lato:wght@400;700&display=swap",
            "Space Grotesk":
              "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&display=swap",
            Outfit:
              "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600&display=swap",
            "Merriweather Sans":
              "https://fonts.googleapis.com/css2?family=Merriweather+Sans:wght@400;500;600&display=swap",
            "JetBrains Mono":
              "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap",
          };
          const fontUrl = fontUrls[w.fontFamily];
          if (fontUrl) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = fontUrl;
            document.head.appendChild(link);
          }
          container.style.fontFamily =
            w.fontFamily + ", -apple-system, BlinkMacSystemFont, sans-serif";
        }

        // ─── Avatar (trigger, header, home screen) ────────────────────────────

        if (w.avatarUrl) {
          const avatarSrc = resolveUrl(w.avatarUrl);

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
          homeAvatar.style.color = brandText;
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

      // ─── Ask Label with Project Name ──────────────────────────────────────
      const projectDisplayName =
        loadedConfig.companyName || loadedConfig.projectName;
      if (projectDisplayName) {
        homeAskLabel.innerHTML =
          ICONS.sparkle +
          ` <span class="rm-ask-label-text">Ask AI about ${projectDisplayName}</span>`;
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
          } else if (qa.type === "inquiry") {
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
            } else if (qa.type === "inquiry") {
              showFormScreen();
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

      // ─── Inquiry Form Setup (build form fields if enabled) ──────────────────
      if (loadedConfig.inquiryForm) {
        const cf = loadedConfig.inquiryForm as {
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
              `${baseUrl}/api/widget/${projectSlug}/inquiries`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  visitorId,
                  visitorName: visitorInfo.name,
                  visitorEmail: visitorInfo.email,
                  data,
                }),
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

            const result = await res.json().catch(() => null);

            if ((result as { visitorEmail?: string | null })?.visitorEmail) {
              visitorInfo.email = (
                result as { visitorEmail: string }
              ).visitorEmail;
            }
            if ((result as { visitorName?: string | null })?.visitorName) {
              visitorInfo.name = (
                result as { visitorName: string }
              ).visitorName;
            }
            if ((result as { conversationId?: string })?.conversationId) {
              conversationId = (result as { conversationId: string })
                .conversationId;
              conversationStatus =
                (result as { conversationStatus?: string | null })
                  .conversationStatus ?? conversationStatus;
              persistConversationId(conversationId);
              startPolling();
              inlineBarActions.classList.remove("has-actions");
              await loadConversationHistory(false);
            }

            // Show success state
            formView.removeChild(formBody);
            const success = document.createElement("div");
            success.className = "rm-form-success";

            const successIcon = document.createElement("div");
            successIcon.className = "rm-form-success-icon";
            successIcon.style.backgroundColor = `rgba(${hexToRgb(primary)}, 0.12)`;
            successIcon.style.color = primary;
            successIcon.innerHTML = ICONS.check;

            const successTitle = document.createElement("div");
            successTitle.className = "rm-form-success-title";
            successTitle.textContent = "Message sent!";

            const successSubtitle = document.createElement("div");
            successSubtitle.className = "rm-form-success-subtitle";
            successSubtitle.textContent =
              cf.description || "We'll get back to you soon.";

            const formBackBtn = document.createElement("button");
            formBackBtn.className = "rm-form-back-btn";
            formBackBtn.textContent = "Back to Chat";
            formBackBtn.onclick = () => showChatScreen();

            success.appendChild(successIcon);
            success.appendChild(successTitle);
            success.appendChild(successSubtitle);
            success.appendChild(formBackBtn);
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

      // Intro message — stored for lazy display on first chat open
      if (loadedConfig.introMessage) {
        introMessageText = loadedConfig.introMessage;
      }
      if (loadedConfig.introMessageAuthor) {
        introMessageAuthor = loadedConfig.introMessageAuthor;
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
        const inlineBrandText = loadedConfig.widget?.textColor || "#ffffff";
        const inlineBgStyle = loadedConfig.widget?.backgroundStyle || "solid";
        inlineBar.style.setProperty("--rm-primary", inlinePrimary);
        inlineBar.style.setProperty(
          "--rm-primary-rgb",
          hexToRgb(inlinePrimary),
        );
        inlineBar.style.setProperty("--rm-brand-text", inlineBrandText);
        inlineBar.dataset.bgStyle = inlineBgStyle;

        // Set theme tokens on the inline bar (same as container)
        const iPRgb = hexToRgb(inlinePrimary);
        if (inlineBgStyle === "blurred") {
          inlineBar.style.setProperty("--rm-bg", "rgba(0,0,0,0.18)");
          inlineBar.style.setProperty(
            "--rm-bg-secondary",
            `rgba(255,255,255,0.06)`,
          );
          inlineBar.style.setProperty(
            "--rm-bg-tertiary",
            `rgba(255,255,255,0.10)`,
          );
          inlineBar.style.setProperty("--rm-text", "#ffffff");
          inlineBar.style.setProperty(
            "--rm-text-secondary",
            "rgba(255,255,255,0.7)",
          );
          inlineBar.style.setProperty(
            "--rm-text-muted",
            "rgba(255,255,255,0.4)",
          );
          inlineBar.style.setProperty("--rm-border", `rgba(255,255,255,0.12)`);
          inlineBar.style.setProperty(
            "--rm-border-subtle",
            `rgba(255,255,255,0.08)`,
          );
          inlineBar.style.setProperty(
            "--rm-input-bg",
            `rgba(255,255,255,0.08)`,
          );
          inlineBar.style.setProperty(
            "--rm-input-bg-focus",
            `rgba(255,255,255,0.12)`,
          );
          inlineBar.style.setProperty("--rm-accent-bg", `rgba(${iPRgb}, 0.20)`);
          inlineBar.style.setProperty(
            "--rm-accent-bg-hover",
            `rgba(${iPRgb}, 0.30)`,
          );
          inlineBar.style.setProperty("--rm-accent-text", "#ffffff");
          inlineBar.style.setProperty(
            "--rm-glow-border",
            "rgba(255,255,255,0.12)",
          );
        } else {
          inlineBar.style.setProperty("--rm-bg", "#ffffff");
          inlineBar.style.setProperty("--rm-bg-secondary", "#f4f4f5");
          inlineBar.style.setProperty("--rm-bg-tertiary", "#e4e4e7");
          inlineBar.style.setProperty("--rm-text", "#18181b");
          inlineBar.style.setProperty("--rm-text-secondary", "#52525b");
          inlineBar.style.setProperty("--rm-text-muted", "#a1a1aa");
          inlineBar.style.setProperty("--rm-border", "#e4e4e7");
          inlineBar.style.setProperty("--rm-border-subtle", "rgba(0,0,0,0.06)");
          inlineBar.style.setProperty("--rm-accent-bg", `rgba(${iPRgb}, 0.08)`);
          inlineBar.style.setProperty(
            "--rm-accent-bg-hover",
            `rgba(${iPRgb}, 0.15)`,
          );
          inlineBar.style.setProperty("--rm-accent-text", inlinePrimary);
          inlineBar.style.setProperty(
            "--rm-glow-border",
            `rgba(${iPRgb}, 0.2)`,
          );
        }

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

        // Populate inline bar action bubbles (max 2, all types, shown on focus with no history)
        inlineBarActions.innerHTML = "";
        const inlineActions = allActions.slice(0, 2);
        if (inlineActions.length > 0 && !conversationId) {
          inlineActions.forEach((qa) => {
            const actionBtn = document.createElement("button");
            actionBtn.className = "rm-inline-bar-action";

            // Add icon for non-prompt types
            if (qa.type === "link") {
              actionBtn.innerHTML =
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
            } else if (qa.type === "inquiry") {
              actionBtn.innerHTML =
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
            }

            const labelSpan = document.createElement("span");
            labelSpan.textContent = qa.label;
            actionBtn.appendChild(labelSpan);

            actionBtn.onclick = (e) => {
              e.stopPropagation();
              if (qa.type === "link") {
                window.open(qa.action, "_blank", "noopener,noreferrer");
              } else if (qa.type === "inquiry") {
                showChatScreen();
                openChatWidget();
                setTimeout(() => showFormScreen(), 100);
              } else if (qa.type === "prompt") {
                showChatScreen();
                openChatWidget();
                setTimeout(() => {
                  if (!isSending) handleSendMessage(qa.action);
                }, 100);
              }
              // Hide actions after click
              inlineBarActions.classList.remove("has-actions");
            };

            inlineBarActions.appendChild(actionBtn);
          });
          inlineBarActions.classList.add("has-actions");
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
        startHeartbeat();
        // Hide inline action bubbles once conversation starts
        inlineBarActions.classList.remove("has-actions");
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

      // Reopen closed conversation — server handles status update
      if (conversationStatus === "closed") {
        conversationStatus = "active";
        syncConversationModeUi();
      }

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
      lastNewMessageAt = Date.now();

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
        const body: Record<string, unknown> = { content: messageText };
        if (uploadedImageUrl) body.imageUrl = uploadedImageUrl;
        const ctx: Record<string, string> = {
          currentPageUrl: window.location.href,
          pageTitle: document.title,
          ...pageContext,
        };
        body.pageContext = ctx;

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

        // After a real agent reply, the server returns JSON instead of SSE.
        const contentType = res.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          hideTyping();
          // Message stored server-side, agent will reply via polling.
          return;
        }

        // Handle SSE stream
        const reader = res.body?.getReader();
        if (!reader) return;

        const decoder = new TextDecoder();
        let botMessage = "";
        let botMessageEl: HTMLElement | null = null;
        let inquiryDetected = false;
        let resolvedDetected = false;
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

                if (data.inquiry) {
                  inquiryDetected = true;
                  continue;
                }

                if (data.resolved) {
                  resolvedDetected = true;
                  // Remove any bot bubble that was showing the [RESOLVED] token
                  if (botMessageEl) {
                    botMessageEl.closest(".rm-message-row")?.remove();
                    botMessageEl = null;
                  }
                  hideTyping();
                  continue;
                }

                if (data.status?.message) {
                  showTyping(data.status.message);
                  continue;
                }

                // Handle tool execution events
                if (data.toolCall) {
                  hideTyping();
                  addToolCallCardToUI(
                    data.toolCall.name,
                    data.toolCall.args ?? null,
                  );
                  continue;
                }

                if (data.toolResult) {
                  updateToolCallCard(data.toolResult.name, {
                    success: data.toolResult.success,
                    output: data.toolResult.output ?? undefined,
                    httpStatus: data.toolResult.httpStatus ?? undefined,
                    duration: data.toolResult.duration ?? undefined,
                    errorMessage: data.toolResult.errorMessage ?? undefined,
                  });
                  if (data.toolResult.success) {
                    // Show "Thinking" while model processes the result
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

                if (data.finalText) {
                  botMessage = String(data.finalText);
                  if (!botMessageEl) {
                    hideTyping();
                    botMessageEl = addMessageToUI("bot", botMessage);
                  } else {
                    botMessageEl.innerHTML = renderMarkdown(botMessage);
                  }
                  scrollToBottom();
                  continue;
                }

                if (data.text) {
                  botMessage += data.text;

                  // Client-side filter: strip [NEW_INQUIRY] token if it leaks through
                  if (botMessage.includes("[NEW_INQUIRY]")) {
                    inquiryDetected = true;
                    botMessage = botMessage.replace("[NEW_INQUIRY]", "").trim();
                  }

                  // Client-side filter: if [RESOLVED] appears, mark as resolved
                  if (botMessage.includes("[RESOLVED]")) {
                    resolvedDetected = true;
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
                  // Inquiry requests a human, but AI stays active until an agent replies.
                  if (inquiryDetected) {
                    conversationStatus = "waiting_agent";
                    syncConversationModeUi();
                    requestNotificationPermission();
                  }
                  // Handle resolved -- close the conversation
                  if (resolvedDetected) {
                    conversationStatus = "closed";
                    syncConversationModeUi();
                    // Show the closing message as a final bot message
                    addMessageToUI(
                      "bot",
                      "Glad I could help! Feel free to reach out anytime if you have more questions.",
                    );
                    scrollToBottom();
                    stopPolling();
                    stopHeartbeat();
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

        // Edge case: stream ended without a done event but inquiry was detected
        if (inquiryDetected && conversationStatus !== "waiting_agent") {
          conversationStatus = "waiting_agent";
          syncConversationModeUi();
          requestNotificationPermission();
        }
        // Edge case: stream ended without a done event but resolved was detected
        if (resolvedDetected && conversationStatus !== "closed") {
          conversationStatus = "closed";
          syncConversationModeUi();
          addMessageToUI(
            "bot",
            "Glad I could help! Feel free to reach out anytime if you have more questions.",
          );
          scrollToBottom();
          stopPolling();
          stopHeartbeat();
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
      lastNewMessageAt = Date.now();
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
    senderName?: string,
    senderAvatar?: string,
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
    const isRoleChange = lastMessageRole !== null && lastMessageRole !== role;

    // Message row (avatar + bubble)
    const row = document.createElement("div");
    row.className = `rm-message-row ${role}`;
    if (messageId) row.dataset.messageId = messageId;
    let msgEl: HTMLElement;

    // Avatar for bot/agent messages
    if (role === "bot" || role === "agent") {
      const avatar = document.createElement("div");
      avatar.className = "rm-message-avatar";

      if (role === "agent" && senderAvatar) {
        // Agent with profile picture
        avatar.style.backgroundColor = "transparent";
        const avatarImg = document.createElement("img");
        avatarImg.src = resolveUrl(senderAvatar);
        avatarImg.alt = senderName || "Agent";
        avatarImg.style.width = "100%";
        avatarImg.style.height = "100%";
        avatarImg.style.borderRadius = "50%";
        avatarImg.style.objectFit = "cover";
        avatar.appendChild(avatarImg);
      } else if (role === "agent" && senderName) {
        // Agent with initials
        avatar.style.backgroundColor = `rgba(${hexToRgb(primaryColor)}, 0.15)`;
        avatar.style.color = primaryColor;
        avatar.style.fontSize = "12px";
        avatar.style.fontWeight = "600";
        avatar.textContent = senderName.charAt(0).toUpperCase();
      } else if (role === "agent") {
        // Agent fallback — person icon
        avatar.classList.add("rm-icon-avatar");
        avatar.style.backgroundColor = `rgba(${hexToRgb(primaryColor)}, 0.12)`;
        avatar.style.color = primaryColor;
        avatar.innerHTML = ICONS.person;
      } else {
        // Bot avatar — custom avatarUrl or AI sparkle icon
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
          avatar.style.backgroundColor = `rgba(${hexToRgb(primaryColor)}, 0.12)`;
          avatar.style.color = primaryColor;
          avatar.innerHTML = ICONS.aiSparkle;
        }
      }

      // Show avatar on the latest message only — hide previous same-role avatar
      if (lastMessageRole === role) {
        const prevRows = messagesContainer.querySelectorAll(
          `.rm-message-row.${role}`,
        );
        if (prevRows.length > 0) {
          const prevAvatar =
            prevRows[prevRows.length - 1].querySelector(".rm-message-avatar");
          if (prevAvatar) prevAvatar.classList.add("hidden");
        }
      }

      row.appendChild(avatar);

      // Column wrapper for label + bubble
      const col = document.createElement("div");
      col.className = "rm-msg-col";

      // Sender name label — show on role change for bot/agent
      if (isRoleChange) {
        const label = document.createElement("div");
        label.className = `rm-sender-label ${role}`;
        if (role === "bot") {
          label.textContent = senderName || config?.botName || "AI Assistant";
        } else {
          label.textContent =
            senderName || config?.agentName || "Support Agent";
        }
        col.appendChild(label);
      }

      // Message bubble
      msgEl = document.createElement("div");
      msgEl.className = "rm-message";

      // Render image inside bubble if present
      if (imageUrl) {
        const img = document.createElement("img");
        img.className = "rm-message-image";
        img.src = imageUrl.startsWith("data:")
          ? imageUrl
          : resolveUrl(imageUrl);
        img.alt = "Attached image";
        img.onclick = () => window.open(img.src, "_blank");
        msgEl.appendChild(img);
      }

      // Bot/agent messages: render markdown
      const textContainer = document.createElement("div");
      textContainer.innerHTML = renderMarkdown(content);
      msgEl.appendChild(textContainer);

      col.appendChild(msgEl);
      row.appendChild(col);
    } else {
      // Visitor messages — no avatar, no column wrapper
      msgEl = document.createElement("div");
      msgEl.className = "rm-message";

      // Render image inside bubble if present
      if (imageUrl) {
        const img = document.createElement("img");
        img.className = "rm-message-image";
        img.src = imageUrl.startsWith("data:")
          ? imageUrl
          : resolveUrl(imageUrl);
        img.alt = "Attached image";
        img.onclick = () => window.open(img.src, "_blank");
        msgEl.appendChild(img);
      }

      if (content && content !== "Sent an image") {
        const textNode = document.createElement("span");
        textNode.textContent = content;
        msgEl.appendChild(textNode);
      }
      msgEl.style.backgroundColor = primaryColor;
      msgEl.style.color = getBrandTextColor();

      row.appendChild(msgEl);
    }

    // Add extra spacing when switching between roles (role-aware grouping)
    if (isRoleChange) {
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
    statusText.textContent = message ?? "Thinking";
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

  // ─── Tool Call Card ─────────────────────────────────────────────────────────

  // Map of toolName -> card element for updating when result arrives
  const activeToolCallCards = new Map<string, HTMLElement>();

  function createSvgIcon(pathD: string): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", pathD);
    svg.appendChild(p);
    return svg;
  }

  function addToolCallCardToUI(
    toolName: string,
    args: Record<string, unknown> | null,
  ) {
    const container = document.createElement("div");
    container.className = "rm-tool-call";
    container.setAttribute("data-tool", toolName);

    const card = document.createElement("div");
    card.className = "rm-tool-call-card";

    // Header
    const header = document.createElement("div");
    header.className = "rm-tool-call-header";

    const icon = document.createElement("div");
    icon.className = "rm-tool-call-icon pending rm-tool-call-loading";
    // Wrench icon
    icon.appendChild(
      createSvgIcon(
        "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
      ),
    );

    const nameEl = document.createElement("span");
    nameEl.className = "rm-tool-call-name";
    const displayName = toolName.replace(/_/g, " ");
    nameEl.textContent =
      displayName.charAt(0).toUpperCase() + displayName.slice(1);

    const meta = document.createElement("div");
    meta.className = "rm-tool-call-meta";

    const statusBadge = document.createElement("span");
    statusBadge.className = "rm-tool-call-status pending";
    statusBadge.textContent = "Running...";
    meta.appendChild(statusBadge);

    // Chevron-right icon
    const chevron = createSvgIcon("m9 18 6-6-6-6");
    chevron.classList.add("rm-tool-call-chevron");

    header.appendChild(icon);
    header.appendChild(nameEl);
    header.appendChild(meta);
    header.appendChild(chevron);

    // Details (hidden by default)
    const details = document.createElement("div");
    details.className = "rm-tool-call-details";

    // Input section (shown immediately if args exist)
    if (args && Object.keys(args).length > 0) {
      const inputSection = document.createElement("div");
      inputSection.className = "rm-tool-call-section";
      const inputLabel = document.createElement("div");
      inputLabel.className = "rm-tool-call-section-label";
      inputLabel.textContent = "Parameters";
      const inputCode = document.createElement("div");
      inputCode.className = "rm-tool-call-code";
      inputCode.textContent = JSON.stringify(args, null, 2);
      inputSection.appendChild(inputLabel);
      inputSection.appendChild(inputCode);
      details.appendChild(inputSection);
    }

    // Result section placeholder — will be filled by updateToolCallCard
    const resultSection = document.createElement("div");
    resultSection.className = "rm-tool-call-section";
    resultSection.setAttribute("data-result", "true");
    resultSection.style.display = "none";
    details.appendChild(resultSection);

    card.appendChild(header);
    card.appendChild(details);
    container.appendChild(card);

    // Toggle expand on click
    header.addEventListener("click", () => {
      container.classList.toggle("expanded");
    });

    messagesContainer.insertBefore(container, typingRow);
    scrollToBottom();

    activeToolCallCards.set(toolName, container);
  }

  function updateToolCallCard(
    toolName: string,
    result: {
      success: boolean;
      output?: unknown;
      httpStatus?: number;
      duration?: number;
      errorMessage?: string;
    },
  ) {
    const container = activeToolCallCards.get(toolName);
    if (!container) return;

    // Update icon
    const icon = container.querySelector(".rm-tool-call-icon");
    if (icon) {
      icon.classList.remove("pending", "rm-tool-call-loading");
      icon.classList.add(result.success ? "success" : "error");
    }

    // Update status badge
    const statusBadge = container.querySelector(".rm-tool-call-status");
    if (statusBadge) {
      statusBadge.classList.remove("pending");
      statusBadge.classList.add(result.success ? "success" : "error");
      if (result.success) {
        statusBadge.textContent = result.httpStatus
          ? `${result.httpStatus} OK`
          : "Success";
      } else {
        statusBadge.textContent = "Error";
      }
    }

    // Add duration
    const meta = container.querySelector(".rm-tool-call-meta");
    if (meta && result.duration != null) {
      const durEl = document.createElement("span");
      durEl.className = "rm-tool-call-duration";
      durEl.textContent = `${result.duration}ms`;
      meta.insertBefore(
        durEl,
        meta.querySelector(".rm-tool-call-chevron") ?? null,
      );
    }

    // Fill in result section
    const resultSection = container.querySelector('[data-result="true"]');
    if (resultSection) {
      resultSection.removeAttribute("style"); // show it

      const resultLabel = document.createElement("div");
      resultLabel.className = "rm-tool-call-section-label";
      resultLabel.textContent = "Result";
      resultSection.appendChild(resultLabel);

      if (!result.success && result.errorMessage) {
        const errEl = document.createElement("div");
        errEl.className = "rm-tool-call-error-msg";
        errEl.textContent = result.errorMessage;
        resultSection.appendChild(errEl);
      }

      if (result.output) {
        const outputCode = document.createElement("div");
        outputCode.className = "rm-tool-call-code";
        outputCode.textContent =
          typeof result.output === "string"
            ? result.output
            : JSON.stringify(result.output, null, 2);
        resultSection.appendChild(outputCode);
      } else if (!result.errorMessage) {
        const noData = document.createElement("div");
        noData.className = "rm-tool-call-code";
        noData.textContent = "No output data";
        noData.style.fontStyle = "italic";
        resultSection.appendChild(noData);
      }
    }

    activeToolCallCards.delete(toolName);
    scrollToBottom();
  }

  // ─── Handoff Card ───────────────────────────────────────────────────────────

  // ─── Polling for New Messages ──────────────────────────────────────────────

  function startPolling() {
    if (pollTimer) return; // Already polling
    if (!conversationId) return;
    if (hiddenByPageTargeting) return;

    // Determine poll interval based on conversation status and idle time
    const getInterval = () => {
      const idleMin = (Date.now() - lastNewMessageAt) / 60000;
      const agentMode = conversationStatus === "agent_replied";

      if (idleMin < 5) return agentMode ? 3000 : 10000;
      if (idleMin < 30) return agentMode ? 10000 : 15000;
      return agentMode ? 15000 : 30000;
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

  // ─── Heartbeat ──────────────────────────────────────────────────────────────

  function startHeartbeat() {
    stopHeartbeat();
    if (!conversationId) return;

    heartbeatTimer = setInterval(async () => {
      if (!conversationId) {
        stopHeartbeat();
        return;
      }
      try {
        const presence = document.hidden ? "background" : "active";
        const res = await fetch(
          `${baseUrl}/api/widget/${projectSlug}/conversations/${conversationId}/heartbeat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ presence }),
          },
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data.status && data.status !== conversationStatus) {
          conversationStatus = data.status;
          if (data.status === "closed") {
            stopPolling();
          }
        }
      } catch {
        // Silently ignore heartbeat failures
      }
    }, 60_000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
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
        syncConversationModeUi();
        if (status === "closed") {
          stopPolling();
          stopHeartbeat();
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
          const el = addMessageToUI(
            msg.role,
            msg.content,
            msg.id,
            undefined,
            msg.senderName ?? undefined,
            msg.senderAvatar ?? undefined,
          );
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
        lastNewMessageAt = Date.now();
        if (isOpen) scrollToBottom();

        if (!isOpen) {
          // Widget is closed -- show red dot + pop out intro pill with latest message
          incrementUnreadBadge();
          showBrowserNotification(
            msgs[msgs.length - 1]?.content ?? "New message",
          );

          const latestMsg = [...msgs]
            .reverse()
            .find((m: { role: string }) => m.role !== "visitor");
          if (latestMsg) {
            const senderName =
              latestMsg.senderName ||
              (latestMsg.role === "agent"
                ? "Agent"
                : config?.botName ||
                  config?.widget?.headerText ||
                  "New message");
            introPillTitle.textContent = senderName;
            const text = latestMsg.content ?? "";
            introPillDesc.textContent =
              text.length > 120 ? text.substring(0, 120) + "..." : text;

            // Update avatar to match message author
            const msgAvatarUrl = latestMsg.senderAvatar
              ? resolveUrl(latestMsg.senderAvatar)
              : config?.widget?.avatarUrl
                ? resolveUrl(config.widget.avatarUrl)
                : null;
            updatePillAvatar(msgAvatarUrl);

            introPill.classList.remove("rm-intro-hidden");
            introPill.classList.add("visible");
            if (introPillTimer) clearTimeout(introPillTimer);
            introPillTimer = setTimeout(() => {
              introPill.classList.add("rm-intro-hidden");
              introPillTimer = null;
            }, 8000);
          }
        } else if (!isTabActive) {
          // Widget is open but tab is inactive -- flash document title
          incrementUnreadBadge();
          showBrowserNotification(
            msgs[msgs.length - 1]?.content ?? "New message",
          );
          if (!titleOverridden) {
            originalDocTitle = document.title;
          }
          document.title = "New Message | " + originalDocTitle;
          titleOverridden = true;
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
    triggerBadge.classList.add("visible");
  }

  function clearUnreadBadge() {
    unreadCount = 0;
    triggerBadge.classList.remove("visible");
  }

  // ─── Conversation History Loading ────────────────────────────────────────────

  async function loadConversationHistory(openChat = true) {
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
      syncConversationModeUi();

      // If conversation is closed, show history with closed banner (visitor can reopen)
      if (conversationStatus === "closed") {
        // Don't clear — show history and allow reopen by sending a message
      }

      // Render existing messages
      if (msgs.length > 0) {
        // Clear intro message — history already contains the conversation
        introMessageText = null;
        if (openChat && conversationStatus !== "closed") {
          // Switch to chat view since we have an active conversation with history
          showChatScreen();
        }

        for (const msg of msgs) {
          const el = addMessageToUI(
            msg.role,
            msg.content,
            msg.id,
            msg.imageUrl ?? undefined,
            msg.senderName ?? undefined,
            msg.senderAvatar ?? undefined,
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

      // Don't start polling for closed conversations
      if (conversationStatus === "closed") {
        return;
      }

      // Start polling for new messages
      startPolling();
      startHeartbeat();
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
      if (conversationId) {
        // Hide inline action bubbles — conversation already exists
        inlineBarActions.classList.remove("has-actions");
        return; // Successfully restored
      }
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
        // Hide inline action bubbles — conversation already exists
        inlineBarActions.classList.remove("has-actions");
      }
    } catch {
      // Silently ignore
    }

    // No active conversation found — show intro message pill if configured
    if (!conversationId && introMessageText && !isOpen) {
      showIntroPill();
    }
  }

  // ─── Intro/New-Message Pill Helpers ─────────────────────────────────────────

  function updatePillAvatar(avatarUrl: string | null) {
    if (avatarUrl) {
      introPillAvatar.src = resolveUrl(avatarUrl);
      introPillAvatar.style.display = "block";
      introPillIcon.style.display = "none";
    } else {
      introPillAvatar.style.display = "none";
      introPillIcon.style.display = "flex";
    }
  }

  function showIntroPill() {
    const senderName =
      introMessageAuthor?.name || config?.widget?.headerText || "Chat with us";
    introPillTitle.textContent = senderName;
    const text = introMessageText ?? "";
    introPillDesc.textContent =
      text.length > 120 ? text.substring(0, 120) + "..." : text;

    const avatarUrl = introMessageAuthor?.avatar
      ? resolveUrl(introMessageAuthor.avatar)
      : config?.widget?.avatarUrl
        ? resolveUrl(config.widget.avatarUrl)
        : null;
    updatePillAvatar(avatarUrl);

    const delay = (config?.introMessageDelay ?? 1) * 1000;
    const duration = (config?.introMessageDuration ?? 15) * 1000;

    if (introPillDelayTimer) clearTimeout(introPillDelayTimer);
    introPillDelayTimer = setTimeout(() => {
      introPillDelayTimer = null;
      introPill.classList.remove("rm-intro-hidden");
      introPill.classList.add("visible");
    }, delay);

    if (duration > 0) {
      if (introPillTimer) clearTimeout(introPillTimer);
      introPillTimer = setTimeout(() => {
        introPill.classList.add("rm-intro-hidden");
        introPillTimer = null;
      }, delay + duration);
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
    // Bypass page targeting when opened programmatically
    if (hiddenByPageTargeting) {
      container.style.display = "";
      hiddenByPageTargeting = false;
    }
    isOpen = true;
    chatWindow.classList.add("open");
    trigger.classList.add("active");
    clearUnreadBadge();
    // Hide intro pill permanently
    if (introPillDelayTimer) {
      clearTimeout(introPillDelayTimer);
      introPillDelayTimer = null;
    }
    if (introPillTimer) {
      clearTimeout(introPillTimer);
      introPillTimer = null;
    }
    introPill.classList.add("rm-intro-hidden");
    // Lock body scroll on mobile to prevent background scrolling
    if (isMobileViewport()) {
      document.body.style.overflow = "hidden";
      document.documentElement.style.overflow = "hidden";
    }
    // Route to appropriate screen based on conversation state
    if (!isInlineBarVariant) {
      if (conversationId && conversationStatus !== "closed") {
        showChatScreen();
      } else {
        showHomeScreen();
      }
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
      showChatScreen();
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
    setPageContext: (ctx: Record<string, string>) => {
      pageContext = { ...ctx };
    },
    requestNotifications: () => {
      requestNotificationPermission();
    },
    openInquiryForm: () => {
      if (!isOpen) openChatWidget();
      showFormScreen();
    },
  };

  // ─── Initialize ─────────────────────────────────────────────────────────────
  loadConfig().then(() => {
    // After config is loaded, try to restore an existing conversation
    restoreConversation();
  });
})();
