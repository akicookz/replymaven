/**
 * ReplyMaven Widget Embed Script
 *
 * Usage:
 * <script src="https://widget.replymaven.com/widget-embed.js" data-project="your-project-slug"></script>
 *
 * Programmatic API:
 * window.ReplyMaven.open()
 * window.ReplyMaven.close()
 * window.ReplyMaven.toggle()
 * window.ReplyMaven.sendMessage("Hello")
 * window.ReplyMaven.identify({ name: "John", email: "john@example.com" })
 */

import { renderMarkdown } from "../shared/chat-markdown";
import {
  parseMessageImageUrls,
  serializeMessageImageUrls,
  shouldShowMessageContent,
} from "../shared/message-images";
import type {
  PublicChatChildState,
  PublicChatSessionResponse,
} from "../shared/public-chat-agent";
import { sanitizePageContext } from "../shared/page-context";
import { sanitizeCustomCss } from "../shared/sanitize-custom-css";
import { fontFaceCss, resolveWidgetFont } from "../shared/widget-fonts";
import { widgetRadiusTokens } from "../shared/widget-radius";
import type { PublicMessageRecord } from "../shared/maven-conversation";
import { createLazyWidgetAgentChatClient } from "./lazy-agent-chat-client";
import type { WidgetChatActivity } from "./agent-chat-bridge";
import { classifyAgentSessionFailure } from "./agent-session-response";
import { claimWidgetInstance } from "./instance-guard";
import {
  isSignedIdentityInput,
  planCustomerIdentityReset,
  WidgetIdentitySessionGuard,
  type WidgetIdentitySessionToken,
} from "./customer-identity-state";

(function () {
  // Find the script tag to get config
  const script = document.currentScript as HTMLScriptElement;
  const projectSlug = script?.getAttribute("data-project");

  if (!projectSlug) {
    console.error("[ReplyMaven] Missing data-project attribute");
    return;
  }

  if (!claimWidgetInstance(document.documentElement, projectSlug)) return;

  const scriptOrigin = new URL(script.src).origin;
  const baseUrl = scriptOrigin.replace(/^(https?:\/\/)widget\./, "$1");

  try {
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = baseUrl;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  } catch {
    /* non-fatal */
  }

  // ─── State ──────────────────────────────────────────────────────────────────
  let isOpen = false;
  let conversationId: string | null = null;
  let conversationStatus: string | null = null;
  let visitorId = localStorage.getItem("rm_visitor_id") || generateVisitorId();
  let visitorInfo: { name?: string; email?: string; phone?: string } = {};
  let customMetadata: Record<string, string> = {};
  let pageContext: Record<string, string> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let config: Record<string, any> | null = null;
  let _isHandedOff = false;
  let isBanned = false;
  const identitySessions = new WidgetIdentitySessionGuard();

  const renderedMessageIds = new Set<string>();
  const pendingVisitorMessageIds = new Set<string>();
  const pendingIncomingResponseIds = new Set<string>();
  // Delivery status element per locally submitted message, driven by outbox
  // state transitions from the Agent runtime.
  const visitorStatusElsByMessageId = new Map<string, HTMLElement>();
  // Last rendered outbox state per message so unrelated publishes don't
  // re-process settled entries (rebuilding Retry buttons, hiding typing).
  const lastOutboxStateByMessageId = new Map<string, string>();
  const agentChatClient = createLazyWidgetAgentChatClient(
    `${scriptOrigin}/widget-agent-runtime.js`,
  );
  let agentSessionRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let agentSessionGeneration = 0;
  let connectedAgentConversationId: string | null = null;
  let agentSessionExpiresAt = 0;
  let authoritativeMessageIds = new Set<string>();
  let hasReceivedAgentSnapshot = false;
  let latestAgentActivity: WidgetChatActivity = {
    status: "ready",
    isServerStreaming: false,
    isRecovering: false,
    error: undefined,
  };

  // Id of the newest bot/agent (non-visitor) message currently known. Tracked so
  // we can surface an unseen response on page load and persist a per-device
  // "seen up to here" marker. Tracking the newest *response* (not any message)
  // avoids re-flagging when the visitor's own later message is newest.
  let newestResponseId: string | null = null;

  // Detect touch-primary devices once at init. Used to disable Enter-to-send so
  // mobile users can insert newlines (the on-screen keyboard has no Shift+Enter).
  const isTouchDevice =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches;

  // Send guard -- prevents duplicate message sends
  let isSending = false;

  // Heartbeat state
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // Notification state
  let notificationPermission: NotificationPermission = "default";

  // Visibility tracking
  let isTabActive = !document.hidden;
  let originalDocTitle = document.title;
  let titleOverridden = false;

  function generateVisitorId(): string {
    const id = `v_${crypto.randomUUID()}`;
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

  // Per-device "seen up to here" marker — the newest response id the visitor has
  // viewed. Used to surface an unseen response on load. Per-device by nature
  // since visitorId is per-device localStorage.
  function getStoredSeenResponseId(): string | null {
    return localStorage.getItem(getStorageKey("last_seen_response_id"));
  }
  function setStoredSeenResponseId(id: string): void {
    localStorage.setItem(getStorageKey("last_seen_response_id"), id);
  }
  // The response id whose preview card the visitor explicitly dismissed (✕).
  // A dismissed response keeps badging the launcher but stops popping the
  // card; any newer response pops it again. Replaces the old pop-once marker
  // (`last_popped_intro_id`) — the card now stays out until seen or dismissed.
  function getDismissedIntroId(): string | null {
    return localStorage.getItem(getStorageKey("dismissed_intro_id"));
  }
  function setDismissedIntroId(id: string): void {
    localStorage.setItem(getStorageKey("dismissed_intro_id"), id);
  }

  // ─── SVG Icons ──────────────────────────────────────────────────────────────
  const ICONS = {
    chat: (() => {
      const id = "rm-sm-" + Math.random().toString(36).slice(2, 8);
      return `<svg viewBox="0 0 28 32" fill="none"><mask id="${id}"><rect width="28" height="32" fill="white"/><path d="M6 14C11.3333 19.3333 16.6667 19.3333 22 14" stroke="black" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></mask><path mask="url(#${id})" d="M24 32H6C2.6875 32 0 29.3125 0 26V6C0 2.6875 2.6875 0 6 0H25C26.6562 0 28 1.34375 28 3V21C28 22.3062 27.1625 23.4187 26 23.8312V28C27.1063 28 28 28.8937 28 30C28 31.1063 27.1063 32 26 32H24ZM6 24C4.89375 24 4 24.8937 4 26C4 27.1063 4.89375 28 6 28H22V24H6Z" fill="currentColor"/></svg>`;
    })(),
    close:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>',
    image:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>',
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
    /* Form controls and links don't inherit font-family by default — without
       this, buttons/inputs/anchors keep the host page's font when a custom
       widget font is configured. */
    .rm-widget-container button, .rm-widget-container input,
    .rm-widget-container textarea, .rm-widget-container select,
    .rm-widget-container a,
    .rm-inline-bar button, .rm-inline-bar input, .rm-inline-bar a {
      font-family: inherit;
    }
    .rm-widget-container {
      position: fixed;
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-optical-sizing: none;
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

      /* Size tiers. JS overwrites these from Sharp / Rounded / Pill.
         Controls use min(..., 50%) so 999px becomes a stadium. */
      --rm-chat-radius: 16px;
      --rm-card-radius: 12px;
      --rm-btn-radius: 8px;
      --rm-input-radius: 8px;
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
    /* Sibling of the trigger, not a child: the trigger clips children to its
       circle (overflow: hidden + border-radius: 50%), which swallowed a
       corner-positioned dot entirely. The container shrink-wraps the trigger,
       so container-relative coordinates land on the launcher's corner. */
    .rm-trigger-badge {
      position: absolute;
      top: -2px;
      right: -2px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #ef4444;
      border: 2px solid var(--rm-bg, #ffffff);
      display: none;
      z-index: 2;
      pointer-events: none;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    }
    .rm-trigger-badge.visible {
      display: block;
    }
    .rm-widget-container.center-inline .rm-trigger-badge {
      display: none;
    }

    /* ─── Greetings Stack (welcome + news cards) ───────────────────────── */
    .rm-greeting-stack {
      position: absolute;
      bottom: 76px;
      width: 360px;
      max-width: 360px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
      font-family: inherit;
    }
    .rm-widget-container.bottom-right .rm-greeting-stack {
      right: 12px;
      align-items: flex-end;
    }
    .rm-widget-container.bottom-left .rm-greeting-stack {
      left: 12px;
      align-items: flex-start;
    }
    .rm-widget-container.center-inline .rm-greeting-stack {
      display: none;
    }
    .rm-greeting-card {
      width: 100%;
      background: var(--rm-bg, #ffffff);
      border: 0.5px solid var(--rm-glow-border, rgba(0,0,0,0.08));
      border-radius: min(var(--rm-card-radius), 50%);
      box-shadow: 0 6px 24px rgba(0,0,0,0.12);
      overflow: hidden;
      opacity: 0;
      transform: translateY(8px);
      transition: opacity 0.35s ease, transform 0.35s ease, max-height 0.35s ease;
      pointer-events: auto;
      position: relative;
      max-height: 600px;
    }
    .rm-greeting-card[data-bg-style="blurred"] {
      background: rgba(0,0,0,0.18);
      backdrop-filter: blur(24px) saturate(1.4);
      -webkit-backdrop-filter: blur(24px) saturate(1.4);
    }
    .rm-greeting-card.visible {
      opacity: 1;
      transform: translateY(0);
    }
    .rm-greeting-card.dismissed {
      opacity: 0;
      transform: translateY(8px);
      max-height: 0;
      margin: 0;
      pointer-events: none;
    }
    .rm-greeting-image {
      display: block;
      width: 100%;
      height: 140px;
      object-fit: cover;
      /* Fade the artwork into the card body. A mask (not a painted
         gradient) turns the image itself transparent, so the user's
         background color — or the blurred glass style — shows through,
         and the card radius keeps clipping the corners as usual. */
      -webkit-mask-image: linear-gradient(
        to bottom,
        #000 55%,
        rgba(0, 0, 0, 0.45) 80%,
        transparent 100%
      );
      mask-image: linear-gradient(
        to bottom,
        #000 55%,
        rgba(0, 0, 0, 0.45) 80%,
        transparent 100%
      );
    }
    .rm-greeting-image.square {
      height: auto;
      aspect-ratio: 1 / 1;
      /* Keep tall images from dwarfing the card body; object-fit crops
         around the configured focal point. */
      max-height: 260px;
    }
    /* Let the text rise into the faded zone so image and body melt
       together instead of stacking as two blocks. */
    .rm-greeting-image + .rm-greeting-body {
      position: relative;
      margin-top: -28px;
    }
    .rm-greeting-body {
      padding: 14px 16px 14px 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .rm-greeting-card.compact .rm-greeting-body {
      flex-direction: row;
      align-items: flex-start;
      gap: 12px;
      padding: 10px 14px 10px 10px;
    }
    .rm-greeting-card.compact {
      cursor: pointer;
      /* The wider stack is for rich news cards; bubbles stay chat-sized. */
      max-width: 320px;
    }
    .rm-greeting-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
    }
    .rm-greeting-avatar-fallback {
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
    .rm-greeting-avatar-fallback svg {
      height: 22px;
      width: auto;
    }
    .rm-greeting-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
      flex: 1;
    }
    .rm-greeting-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--rm-text, #18181b);
      line-height: 1.3;
      letter-spacing: 0;
    }
    .rm-greeting-card.compact .rm-greeting-title {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .rm-greeting-desc {
      font-size: 13px;
      color: var(--rm-text-secondary, #52525b);
      line-height: 1.45;
    }
    /* Rich (news) cards: clearer hierarchy — bigger title, quieter
       description, roomier body. Compact bubbles keep the base sizes since
       the description holds the actual message there. */
    .rm-greeting-card:not(.compact) .rm-greeting-body {
      padding: 18px;
    }
    .rm-greeting-card:not(.compact) .rm-greeting-text {
      gap: 5px;
    }
    .rm-greeting-card:not(.compact) .rm-greeting-title {
      font-size: 14px;
      letter-spacing: 0;
    }
    .rm-greeting-card:not(.compact) .rm-greeting-desc {
      font-size: 14px;
      line-height: 1.55;
      color: var(--rm-text-secondary, #71717a);
      opacity: 0.85;
    }
    .rm-greeting-card.compact .rm-greeting-desc {
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .rm-greeting-cta {
      align-self: stretch;
      margin-top: 10px;
      min-height: 40px;
      padding: 0 16px;
      border-radius: min(var(--rm-btn-radius), 50%);
      background: var(--rm-primary, #2563eb);
      color: var(--rm-brand-text, #ffffff);
      font-size: 14px;
      font-weight: 500;
      line-height: 1;
      letter-spacing: 0;
      font-family: inherit;
      border: 0;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      gap: 6px;
      transition: opacity 0.2s ease;
    }
    .rm-greeting-cta:hover {
      opacity: 0.9;
    }
    .rm-greeting-close {
      position: absolute;
      top: 6px;
      right: 6px;
      width: 20px;
      height: 20px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--rm-bg, #ffffff);
      color: var(--rm-text-secondary, #52525b);
      box-shadow: 0 1px 4px rgba(0,0,0,0.18);
      cursor: pointer;
      opacity: 0;
      transform: scale(0.85);
      transition: opacity 0.15s ease, transform 0.15s ease, background 0.15s ease, color 0.15s ease;
      z-index: 3;
    }
    .rm-greeting-card:hover .rm-greeting-close,
    .rm-greeting-card:focus-within .rm-greeting-close {
      opacity: 1;
      transform: scale(1);
    }
    .rm-greeting-close:hover {
      background: var(--rm-bg-secondary, #f4f4f5);
      color: var(--rm-text, #18181b);
    }
    .rm-greeting-close svg {
      width: 12px;
      height: 12px;
    }
    @media (hover: none) {
      .rm-greeting-close {
        opacity: 1;
        transform: scale(1);
      }
    }
    .rm-trigger.active ~ .rm-greeting-stack {
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
    }
    @media (max-width: 480px) {
      /* Anchor to the viewport (not the offset launcher container) so the card
         sits 12px from both screen edges instead of overflowing to the left. */
      .rm-greeting-stack,
      .rm-widget-container.bottom-right .rm-greeting-stack,
      .rm-widget-container.bottom-left .rm-greeting-stack {
        position: fixed;
        left: 12px;
        right: 12px;
        bottom: 84px;
        width: auto;
        max-width: none;
      }
      .rm-greeting-image {
        height: 120px;
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
      border-radius: min(var(--rm-chat-radius), 50%);
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
      font-weight: 500;
      font-size: 14px;
      line-height: 1.3;
      letter-spacing: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .rm-header-subtitle {
      font-size: 13px;
      font-weight: 500;
      color: var(--rm-text-secondary, #52525b);
      opacity: 1;
      margin-top: 1px;
      line-height: 1.3;
      letter-spacing: 0;
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
      width: 18px;
      height: 18px;
      min-width: 18px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .rm-message-avatar.rm-icon-avatar {
      border-radius: 5px;
    }
    .rm-message-avatar svg {
      width: 10px;
      height: 10px;
    }
    .rm-message-avatar.hidden {
      display: none;
    }
    .rm-msg-footer {
      display: flex;
      align-items: center;
      gap: 5px;
      margin-top: 3px;
      padding-left: 2px;
    }
    .rm-msg-footer.hidden {
      display: none;
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
      gap: 0;
      min-width: 0;
    }
    .rm-msg-status {
      font-size: 11px;
      line-height: 1;
      color: var(--rm-text-muted);
      text-align: right;
      margin-top: 3px;
      padding-right: 2px;
      transition: opacity 0.5s ease;
    }
    .rm-msg-status.failed {
      color: #ef4444;
    }
    .rm-msg-retry {
      background: none;
      border: none;
      padding: 0;
      font: inherit;
      color: inherit;
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
    }
    /* A reply that is still streaming hides its avatar/name footer so the
       growing bubble and the phase indicator below it read as one message,
       not a finished reply plus a second one being typed. */
    .rm-message-row.rm-streaming .rm-msg-footer {
      display: none;
    }
    .rm-sender-label {
      font-size: 11px;
      font-weight: 500;
      line-height: 1;
    }
    .rm-sender-label.bot {
      color: var(--rm-bot-text, #18181b);
      opacity: 0.4;
    }
    .rm-sender-label.agent {
      color: var(--rm-primary, #2563eb);
      opacity: 0.6;
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
      transition: opacity 0.15s ease-out;
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
      border-radius: min(var(--rm-btn-radius), 50%);
      border: 1px solid var(--rm-border);
      background: var(--rm-bg-secondary);
      font-size: 14px;
      font-weight: 500;
      line-height: 1;
      letter-spacing: 0;
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
      padding: 0 16px 6px;
      display: flex;
      align-items: flex-end;
      gap: 8px;
      background: transparent;
      position: relative;
      z-index: 2;
    }
    /* Pill wrapper — carries the border/focus ring; the textarea inside is
       transparent and the image/send buttons pin to the pill's bottom corners
       (iMessage-style), staying put as the textarea grows upward. */
    .rm-input-shell {
      position: relative;
      flex: 1;
      display: flex;
      align-items: flex-end;
      border: 1px solid var(--rm-border);
      border-radius: 999px;
      background: var(--rm-input-bg);
      transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
      box-sizing: border-box;
    }
    .rm-input-shell:focus-within {
      border-color: var(--rm-primary, #2563eb);
      box-shadow: 0 0 0 3px rgba(var(--rm-primary-rgb, 37,99,235), 0.12);
      background: var(--rm-input-bg-focus);
    }
    .rm-input {
      flex: 1;
      width: 100%;
      padding: 9px 44px 9px 40px;
      border: none;
      border-radius: inherit;
      font-size: 14px;
      font-weight: 400;
      line-height: 1.45;
      letter-spacing: 0;
      outline: none;
      background: transparent;
      color: var(--rm-text);
      font-family: inherit;
      touch-action: manipulation;
      resize: none;
      overflow: hidden;
      max-height: 120px;
      box-sizing: border-box;
    }
    .rm-input::placeholder {
      color: var(--rm-text-muted);
    }
    .rm-send-btn {
      position: absolute;
      right: 5px;
      bottom: 5px;
      width: 30px;
      height: 30px;
      min-width: 30px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      /* Fallback so the button is branded even before (or without) the
         config fetch — JS overrides with the exact tenant color once loaded. */
      background: var(--rm-primary, #2563eb);
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
      width: 16px;
      height: 16px;
    }

    /* ─── Image Upload ─────────────────────────────────────────────────────── */
    .rm-attach-btn {
      position: absolute;
      left: 5px;
      bottom: 5px;
      width: 30px;
      height: 30px;
      min-width: 30px;
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
      width: 17px;
      height: 17px;
    }
    /* Staged-attachment chip — thumbnail with the remove button badged on
       its corner (matches the dashboard composer). */
    .rm-image-preview {
      padding: 10px 16px 8px;
      display: none;
      background: transparent;
      position: relative;
      z-index: 2;
    }
    .rm-image-preview.visible {
      display: flex;
    }
    .rm-image-preview-chip {
      position: relative;
      display: inline-flex;
    }
    .rm-image-preview img {
      width: 56px;
      height: 56px;
      object-fit: cover;
      border-radius: 10px;
      border: 1px solid var(--rm-border);
    }
    .rm-image-preview-remove {
      position: absolute;
      top: -7px;
      right: -7px;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: 1px solid var(--rm-border);
      background: var(--rm-bg);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.14);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--rm-text-secondary);
      padding: 0;
    }
    .rm-image-preview-remove:hover {
      background: var(--rm-bg-secondary);
      color: var(--rm-text);
    }
    .rm-image-preview-remove svg {
      width: 11px;
      height: 11px;
    }
    /* Drag-and-drop hint — covers the chat view while an image file is over it */
    .rm-drop-hint {
      position: absolute;
      inset: 8px;
      z-index: 5;
      display: none;
      align-items: center;
      justify-content: center;
      gap: 8px;
      border: 2px dashed var(--rm-primary, #2563eb);
      border-radius: 14px;
      background: var(--rm-bg);
      opacity: 0.96;
      font-size: 13px;
      font-weight: 500;
      color: var(--rm-text-secondary);
      pointer-events: none;
    }
    .rm-drop-hint.visible {
      display: flex;
    }
    .rm-drop-hint svg {
      width: 16px;
      height: 16px;
    }
    /* Transient attachment rejection notice (wrong type / too large) */
    .rm-attach-error {
      display: none;
      padding: 6px 16px 0;
      font-size: 12px;
      color: #dc2626;
    }
    .rm-attach-error.visible {
      display: block;
    }
    .rm-message-image {
      max-width: 100%;
      border-radius: 10px;
      margin-bottom: 4px;
      cursor: zoom-in;
    }
    .rm-message-image:hover {
      opacity: 0.9;
    }
    /* Multi-image messages render as a uniform 2-up tile grid */
    .rm-message-images {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      width: 300px;
      max-width: 100%;
      margin-bottom: 4px;
    }
    .rm-message-images .rm-message-image {
      width: 100%;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      margin-bottom: 0;
    }

    /* ─── Image lightbox (appended to body, above the widget) ─────────────── */
    .rm-lightbox {
      position: fixed;
      inset: 0;
      z-index: 1000000;
      background: rgba(0, 0, 0, 0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: zoom-out;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }
    .rm-lightbox > img {
      max-width: 92vw;
      max-height: 88vh;
      object-fit: contain;
      border-radius: 10px;
    }
    .rm-lightbox-close,
    .rm-lightbox-nav {
      position: absolute;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      border: none;
      background: rgba(255, 255, 255, 0.14);
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    .rm-lightbox-close:hover,
    .rm-lightbox-nav:hover {
      background: rgba(255, 255, 255, 0.28);
    }
    .rm-lightbox-close svg,
    .rm-lightbox-nav svg {
      width: 17px;
      height: 17px;
    }
    .rm-lightbox-close {
      top: 16px;
      right: 16px;
    }
    .rm-lightbox-nav.prev {
      left: 14px;
      top: 50%;
      transform: translateY(-50%);
    }
    .rm-lightbox-nav.next {
      right: 14px;
      top: 50%;
      transform: translateY(-50%);
    }
    .rm-lightbox-counter {
      position: absolute;
      bottom: 18px;
      left: 50%;
      transform: translateX(-50%);
      color: rgba(255, 255, 255, 0.85);
      font-size: 12.5px;
      font-weight: 500;
    }

    /* ─── Powered By ──────────────────────────────────────────────────────── */
    .rm-powered {
      text-align: center;
      padding: 2px 16px 8px;
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
      /* Anchors the drag-and-drop overlay (.rm-drop-hint). */
      position: relative;
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
    .rm-home-close {
      position: absolute;
      top: 14px;
      right: 14px;
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 50%;
      /* Desktop closes via the floating launcher; only needed on mobile where
         the launcher is hidden behind the fullscreen panel. */
      display: none;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      background: rgba(0,0,0,0.35);
      color: #ffffff;
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      transition: background 0.2s;
      z-index: 2;
    }
    .rm-home-close:hover {
      background: rgba(0,0,0,0.5);
    }
    .rm-home-close svg {
      width: 16px;
      height: 16px;
    }
    .rm-home-body {
      padding: 32px 20px 16px;
      flex: 1;
    }
    .rm-home-title {
      font-size: 20px;
      font-weight: 500;
      line-height: 1.25;
      letter-spacing: -0.02em;
      color: var(--rm-text);
    }
    .rm-home-subtitle {
      font-size: 13px;
      font-weight: 400;
      line-height: 1.3;
      letter-spacing: 0;
      color: var(--rm-text-secondary);
      margin-top: 4px;
    }
    .rm-home-ask {
      margin-top: 16px;
      border: 1px solid var(--rm-accent-bg-hover);
      border-radius: min(var(--rm-card-radius), 50%);
      padding: 14px;
      cursor: pointer;
      box-shadow: 0 1px 4px var(--rm-accent-bg);
    }
    .rm-home-ask-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      line-height: 1.3;
      letter-spacing: 0;
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
      font-size: 14px;
      font-weight: 400;
      line-height: 1.45;
      letter-spacing: 0;
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
      border-radius: min(var(--rm-card-radius), 50%);
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
      border-radius: min(var(--rm-btn-radius), 50%);
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
      font-size: 14px;
      font-weight: 500;
      line-height: 1.3;
      letter-spacing: 0;
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
      margin: 4px 0 8px 0;
      padding-left: 20px;
    }
    .rm-message li {
      margin-bottom: 3px;
    }
    .rm-message li:last-child {
      margin-bottom: 0;
    }
    .rm-message h1,
    .rm-message h2,
    .rm-message h3,
    .rm-message h4,
    .rm-message h5,
    .rm-message h6 {
      font-weight: 500;
      line-height: 1.3;
      margin: 6px 0 2px;
      font-size: 1em;
    }
    .rm-message h1:first-child,
    .rm-message h2:first-child,
    .rm-message h3:first-child,
    .rm-message h4:first-child,
    .rm-message h5:first-child,
    .rm-message h6:first-child {
      margin-top: 0;
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
    .rm-message a:not(.rm-source-chip):hover {
      opacity: 0.7;
    }
    .rm-message :not(pre) > code {
      background: color-mix(in srgb, currentColor 12%, transparent);
      padding: 1px 5px;
      border-radius: 4px;
      font-size: 13px;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
    }
    .rm-message pre {
      max-width: 100%;
      margin: 4px 0 8px;
      overflow-x: auto;
      border-radius: 8px;
      background: color-mix(in srgb, currentColor 12%, transparent);
      padding: 9px 11px;
    }
    .rm-message pre code {
      background: transparent;
      padding: 0;
      border-radius: 0;
      font-size: 13px;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      white-space: pre;
      overflow-wrap: normal;
    }

    /* ─── Source Links ────────────────────────────────────────────────────── */
    .rm-sources {
      margin-top: 10px;
      display: flex;
      gap: 4px;
    }

    .rm-source-chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--rm-bot-bg, #ffffff);
      border: 1px solid var(--rm-border-subtle, rgba(0,0,0,0.08));
      color: var(--rm-text-muted);
      text-decoration: none;
      transition: opacity 0.2s;
      cursor: default;
      position: relative;
      cursor: pointer;

    }


    .rm-source-chip svg {
      width: 12px;
      height: 12px;
    }

    .rm-source-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--rm-bot-bg, #ffffff);
      color: var(--rm-text-muted);
      border: 1px solid var(--rm-border-subtle, rgba(0,0,0,0.08));
      font-size: 9px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }
    .rm-source-tooltip {
      display: inline-block;
      position: absolute;
      bottom: calc(100% + 6px);
      left: 0;
      /* Solid surface: --rm-bot-bg is translucent in dark themes, which lets
         the message text bleed through a floating tooltip. */
      background: var(--rm-bg, #ffffff);
      color: var(--rm-text, #18181b);
      font-size: 11px;
      line-height: 1.3;
      padding: 4px 8px;
      border-radius: 6px;
      border: 1px solid var(--rm-border-subtle, rgba(0,0,0,0.08));
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      white-space: nowrap;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.12s ease-out;
      z-index: 10;
    }
    .rm-source-chip:hover .rm-source-tooltip {
      opacity: 1;
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
      line-height: 1.3;
      letter-spacing: 0;
      color: var(--rm-text);
    }
    .rm-form-label .rm-required {
      color: #f87171;
      margin-left: 2px;
    }
    .rm-form-input {
      padding: 10px 14px;
      border: 1px solid var(--rm-border);
      border-radius: min(var(--rm-input-radius), 50%);
      font-size: 16px;
      font-weight: 400;
      line-height: 1.45;
      letter-spacing: 0;
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
      border-radius: min(var(--rm-input-radius), 50%);
      font-size: 16px;
      font-weight: 400;
      line-height: 1.45;
      letter-spacing: 0;
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
      width: 100%;
      min-height: 40px;
      padding: 0 16px;
      border-radius: min(var(--rm-btn-radius), 50%);
      border: none;
      font-size: 14px;
      font-weight: 500;
      line-height: 1;
      letter-spacing: 0;
      cursor: pointer;
      color: var(--rm-brand-text, #ffffff);
      transition: opacity 0.2s, transform 0.15s;
      font-family: inherit;
      margin-top: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
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
    .rm-chat-note {
      text-align: center;
      font-size: 11.5px;
      color: rgba(107, 114, 128, 0.9);
      margin: 6px 0 10px;
    }
    .rm-turn-retry {
      background: none;
      border: 0;
      padding: 0;
      margin-left: 4px;
      font: inherit;
      color: var(--rm-primary, #2563eb);
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
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
      border-radius: min(var(--rm-btn-radius), 50%);
      border: 1px solid var(--rm-border);
      background: var(--rm-bg-secondary);
      font-size: 14px;
      font-weight: 500;
      line-height: 1;
      letter-spacing: 0;
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
      border-radius: min(var(--rm-input-radius), 50%);
      background: var(--rm-bg-secondary);
      font-size: 14px;
      font-weight: 500;
      line-height: 1;
      letter-spacing: 0;
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
      /* The launcher (the usual close affordance) is hidden above, so the home
         view needs its own close button on mobile. */
      .rm-home-close {
        display: flex;
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
    @keyframes rm-pill-glow {
      0%, 100% { box-shadow: 0 0 6px 0px color-mix(in srgb, var(--rm-primary, #2563eb), transparent 90%); }
      50% { box-shadow: 0 0 10px 0px color-mix(in srgb, var(--rm-primary, #2563eb), transparent 82%); }
    }

    .rm-inline-bar {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      width: 300px;
      max-width: calc(100% - 40px);
      z-index: 999999;
      font-optical-sizing: none;
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
      .rm-widget-container.center-inline .rm-chat-window.open .rm-input-shell {
        border-radius: 999px;
      }
      .rm-widget-container.center-inline .rm-chat-window.open .rm-input {
        padding: 10px 44px 10px 40px;
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

  function applyWidgetCustomCss(css: string | null | undefined): void {
    const safe = sanitizeCustomCss(css);
    let el = document.getElementById("rm-widget-custom-css");
    if (!safe) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement("style");
      el.id = "rm-widget-custom-css";
      document.head.appendChild(el);
    }
    el.textContent = safe;
  }

  function setOptionalLine(
    el: HTMLElement,
    text: string | null | undefined,
  ): void {
    const value = typeof text === "string" ? text.trim() : "";
    el.textContent = value;
    el.hidden = value.length === 0;
  }

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

  // Close button — only visible on mobile, where the launcher button (the usual
  // close affordance) is hidden behind the fullscreen panel.
  const homeCloseBtn = document.createElement("button");
  homeCloseBtn.className = "rm-home-close";
  homeCloseBtn.type = "button";
  homeCloseBtn.setAttribute("aria-label", "Close");
  homeCloseBtn.innerHTML = ICONS.close;
  homeCloseBtn.onclick = () => closeChatWidget();
  homeBanner.appendChild(homeCloseBtn);

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
  setOptionalLine(headerSubtitle, null);

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
  // Expose status updates to assistive tech so screen readers announce each
  // phase change ("Searching docs", "Writing the reply", etc.) without
  // stealing focus. `aria-live="polite"` queues updates, `role="status"`
  // identifies it as a live status region, `aria-atomic="true"` ensures the
  // full label is read on every change instead of just the diff.
  statusText.setAttribute("role", "status");
  statusText.setAttribute("aria-live", "polite");
  statusText.setAttribute("aria-atomic", "true");

  typingRow.appendChild(typingDots);
  typingRow.appendChild(statusText);
  messagesContainer.appendChild(typingRow);

  // Quick topics
  const quickTopicsContainer = document.createElement("div");
  quickTopicsContainer.className = "rm-quick-topics";

  // Staged-attachment chip (shown above input when an image is selected):
  // thumbnail with the remove button badged on its corner. The filename shows
  // as the thumbnail's tooltip (imagePreviewImg.title).
  const imagePreview = document.createElement("div");
  imagePreview.className = "rm-image-preview";
  const imagePreviewChip = document.createElement("div");
  imagePreviewChip.className = "rm-image-preview-chip";
  const imagePreviewImg = document.createElement("img");
  imagePreviewImg.alt = "Preview";
  const imagePreviewRemove = document.createElement("button");
  imagePreviewRemove.className = "rm-image-preview-remove";
  imagePreviewRemove.setAttribute("aria-label", "Remove attachment");
  imagePreviewRemove.innerHTML = ICONS.x;
  imagePreviewChip.appendChild(imagePreviewImg);
  imagePreviewChip.appendChild(imagePreviewRemove);
  imagePreview.appendChild(imagePreviewChip);

  // Transient attachment rejection notice (wrong type / too large)
  const attachError = document.createElement("div");
  attachError.className = "rm-attach-error";

  // Drag-and-drop overlay shown while an image file is dragged over the chat
  const dropHint = document.createElement("div");
  dropHint.className = "rm-drop-hint";
  dropHint.innerHTML = `${ICONS.image}<span>Drop an image to attach</span>`;

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
  attachBtn.innerHTML = ICONS.image;
  attachBtn.type = "button";

  const defaultMessagePlaceholder = "Type a message...";
  const agentMessagePlaceholder = "Add any details for the team...";

  const input = document.createElement("textarea");
  input.className = "rm-input";
  input.placeholder = defaultMessagePlaceholder;
  input.rows = 1;

  const sendBtn = document.createElement("button");
  sendBtn.className = "rm-send-btn";
  sendBtn.innerHTML = ICONS.send;

  // Pill shell hosts the textarea with the image/send buttons pinned inside
  // its bottom corners (iMessage-style).
  const inputShell = document.createElement("div");
  inputShell.className = "rm-input-shell";
  inputShell.appendChild(attachBtn);
  inputShell.appendChild(input);
  inputShell.appendChild(sendBtn);

  inputArea.appendChild(fileInput);
  inputArea.appendChild(inputShell);

  // Track pending image file
  let pendingImageFile: File | null = null;

  // Assemble chat view
  chatView.appendChild(header);
  chatView.appendChild(messagesContainer);
  chatView.appendChild(quickTopicsContainer);
  chatView.appendChild(imagePreview);
  chatView.appendChild(attachError);
  chatView.appendChild(inputArea);
  chatView.appendChild(dropHint);

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
  trigger.onclick = () => toggleChatWidget();

  // ─── Message Preview Stack (unseen replies) ─────────────────────────────────
  // The unseen-message preview reuses the greeting-card component so both
  // bubbles look and behave identically. It gets its own stack node because
  // renderGreetings() wipes the greeting stack's contents; the two are never
  // visible together — greetings require no conversation, the preview needs one.
  const previewStack = document.createElement("div");
  previewStack.className = "rm-greeting-stack";

  // ─── Greeting Stack (welcome + news cards) ──────────────────────────────────
  const greetingStack = document.createElement("div");
  greetingStack.className = "rm-greeting-stack";

  container.appendChild(chatWindow);
  container.appendChild(trigger);
  container.appendChild(triggerBadge);
  container.appendChild(previewStack);
  container.appendChild(greetingStack);
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

  interface GreetingPublic {
    id: string;
    enabled: boolean;
    imageUrl: string | null;
    imagePosition: string | null;
    imageAspect?: "landscape" | "square" | null;
    title: string;
    description: string | null;
    ctaText: string | null;
    ctaLink: string | null;
    author: {
      id: string;
      name: string;
      avatar: string | null;
      workTitle: string | null;
    } | null;
    allowedPages: string[] | null;
    delaySeconds: number;
    durationSeconds: number;
    sortOrder: number;
  }

  let greetingsList: GreetingPublic[] = [];
  const greetingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const greetingDurationTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

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

  function showBannedState() {
    isBanned = true;
    input.disabled = true;
    input.placeholder = "You have been blocked from this chat";
    sendBtn.disabled = true;
    if (isInlineBarVariant) {
      inlineBarInput.disabled = true;
      inlineBarInput.placeholder = "You have been blocked from this chat";
    }
    addMessageToUI(
      "bot",
      "You are no longer able to send messages in this chat.",
    );
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
    requestAnimationFrame(() => handleSendMessage(text));
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
            avatar.style.fontSize = "9px";
            avatar.style.fontWeight = "600";
          }
        }
        const nameLabel = msgRow.querySelector(
          ".rm-sender-label",
        ) as HTMLElement | null;
        if (nameLabel) {
          nameLabel.textContent = introMessageAuthor.name;
        }
        const footer = msgRow.querySelector(
          ".rm-msg-footer",
        ) as HTMLElement | null;
        if (footer) {
          footer.classList.remove("hidden");
        }
      }
      introMessageText = null;
    }
    ensureLatestMessageVisible();
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

  function retireArchivedConversation() {
    conversationId = null;
    conversationStatus = null;
    clearPersistedConversation();
    stopHeartbeat();
    disconnectConversationAgent();

    renderedMessageIds.clear();
    pendingVisitorMessageIds.clear();
    pendingIncomingResponseIds.clear();
    visitorStatusElsByMessageId.clear();
    lastOutboxStateByMessageId.clear();
    authoritativeMessageIds.clear();
    hasReceivedAgentSnapshot = false;
    newestResponseId = null;
    messagesContainer.replaceChildren(typingRow);
    previewStack.replaceChildren();
    clearUnreadBadge();
    hideTyping();
    syncConversationModeUi();
    showHomeScreen();
    renderGreetings({ force: true });
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
    void sendAckViaHeartbeat({});
    if (isTabActive) reportRead();
  });

  async function sendAckViaHeartbeat(fields: {
    deliveredUpTo?: string;
    readUpTo?: string;
  }): Promise<void> {
    if (!conversationId) return;
    try {
      await fetch(
        `${baseUrl}/api/widget/${projectSlug}/conversations/${conversationId}/heartbeat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            presence: document.hidden ? "background" : "active",
            ...fields,
          }),
        },
      );
    } catch {
      // best-effort
    }
  }

  // Tell the server the newest outbound (bot/agent) message reached this widget
  // so the dashboard can show a "Delivered" receipt.
  function reportDelivered(): void {
    if (!conversationId || !newestResponseId) return;
    void sendAckViaHeartbeat({ deliveredUpTo: newestResponseId });
  }

  // Tell the server the visitor has actually seen the newest outbound message —
  // only when the panel is open AND the tab is focused.
  function reportRead(): void {
    if (!conversationId || !newestResponseId) return;
    if (!isOpen || !isTabActive) return;
    void sendAckViaHeartbeat({ readUpTo: newestResponseId });
  }

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
    // On touch devices, Enter inserts a newline — the on-screen keyboard has no
    // Shift, so Enter-to-send strands users with no way to multi-line. Send
    // button is the only submit path on mobile.
    if (isTouchDevice) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isSending && (input.value.trim() || pendingImageFile)) {
        handleSendMessage(input.value.trim());
        input.value = "";
        input.style.height = "auto";
      }
    }
  });

  // Auto-resize textarea on input
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    input.style.overflow = input.scrollHeight > 120 ? "auto" : "hidden";
  });

  sendBtn.addEventListener("click", () => {
    if (!isSending && (input.value.trim() || pendingImageFile)) {
      handleSendMessage(input.value.trim());
      input.value = "";
      input.style.height = "auto";
    }
  });

  // ─── Image Upload Handlers ──────────────────────────────────────────────────

  // Mirrors the widget upload endpoint's allowlist and 5MB cap.
  const ATTACH_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
  const ATTACH_MAX_BYTES = 5 * 1024 * 1024;

  let attachErrorTimer: ReturnType<typeof setTimeout> | null = null;
  function showAttachError(message: string): void {
    attachError.textContent = message;
    attachError.classList.add("visible");
    if (attachErrorTimer) clearTimeout(attachErrorTimer);
    attachErrorTimer = setTimeout(() => {
      attachError.classList.remove("visible");
    }, 3000);
  }

  // Validate and stage a picked/dropped image. Single slot — a new image
  // replaces the previous one; rejections show a transient notice.
  function stageImageFile(file: File | null | undefined): void {
    if (!file) return;
    if (!ATTACH_IMAGE_TYPES.includes(file.type)) {
      showAttachError("Only JPEG, PNG, or WebP images can be attached");
      return;
    }
    if (file.size > ATTACH_MAX_BYTES) {
      showAttachError("Image too large (max 5MB)");
      return;
    }

    pendingImageFile = file;
    const identitySession = identitySessions.capture();

    // Show preview
    const reader = new FileReader();
    reader.onload = () => {
      if (
        !identitySessions.isCurrent(identitySession) ||
        pendingImageFile !== file
      ) {
        return;
      }
      imagePreviewImg.src = reader.result as string;
      imagePreviewImg.title = file.name;
      imagePreview.classList.add("visible");
    };
    reader.readAsDataURL(file);
  }

  attachBtn.addEventListener("click", () => {
    fileInput.click();
  });

  fileInput.addEventListener("change", () => {
    stageImageFile(fileInput.files?.[0]);
    // Reset file input so the same file can be re-selected
    fileInput.value = "";
  });

  // Drag-and-drop onto the chat view. dragenter/dragleave fire for every
  // child crossed — depth-count so the overlay doesn't flicker.
  let attachDragDepth = 0;
  function dragHasFiles(e: DragEvent): boolean {
    return (
      !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files")
    );
  }
  chatView.addEventListener("dragenter", (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    attachDragDepth += 1;
    dropHint.classList.add("visible");
  });
  chatView.addEventListener("dragover", (e) => {
    if (!dragHasFiles(e)) return;
    // preventDefault marks the chat view as a valid drop target.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  });
  chatView.addEventListener("dragleave", (e) => {
    if (!dragHasFiles(e)) return;
    attachDragDepth = Math.max(0, attachDragDepth - 1);
    if (attachDragDepth === 0) dropHint.classList.remove("visible");
  });
  chatView.addEventListener("drop", (e) => {
    if (!dragHasFiles(e)) return;
    e.preventDefault();
    attachDragDepth = 0;
    dropHint.classList.remove("visible");
    // Single-image slot: stage the first image file (or the first file, so a
    // non-image drop still surfaces the type notice).
    const files = Array.from(e.dataTransfer?.files ?? []);
    stageImageFile(
      files.find((f) => ATTACH_IMAGE_TYPES.includes(f.type)) ?? files[0],
    );
  });

  imagePreviewRemove.addEventListener("click", () => {
    pendingImageFile = null;
    imagePreview.classList.remove("visible");
    imagePreviewImg.src = "";
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

  // Perceived luminance (Rec. 601) — used to flip the widget's text/secondary
  // tokens to a dark theme when a custom surface color is dark.
  function isDarkColor(hex: string): boolean {
    const [r, g, b] = hexToRgb(hex)
      .split(",")
      .map((n) => parseInt(n.trim(), 10));
    return 0.299 * r + 0.587 * g + 0.114 * b < 140;
  }

  // Apply a custom solid surface color to an element's --rm-* tokens. A light
  // pick just recolors the surface; a dark pick also flips text/secondary
  // tokens so the widget stays readable. White (the default) is a no-op.
  function applySurfaceColor(el: HTMLElement, surface: string): void {
    if (!surface || /^f{3}(f{3})?$/i.test(surface.replace("#", ""))) return;
    el.style.setProperty("--rm-bg", surface);
    if (!isDarkColor(surface)) return;
    el.style.setProperty("--rm-bg-secondary", "rgba(255,255,255,0.06)");
    el.style.setProperty("--rm-bg-tertiary", "rgba(255,255,255,0.10)");
    el.style.setProperty("--rm-text", "#ffffff");
    el.style.setProperty("--rm-text-secondary", "rgba(255,255,255,0.7)");
    el.style.setProperty("--rm-text-muted", "rgba(255,255,255,0.4)");
    el.style.setProperty("--rm-border", "rgba(255,255,255,0.12)");
    el.style.setProperty("--rm-border-subtle", "rgba(255,255,255,0.08)");
    el.style.setProperty("--rm-bot-bg", "rgba(255,255,255,0.10)");
    el.style.setProperty("--rm-bot-text", "#ffffff");
    el.style.setProperty("--rm-input-bg", "rgba(255,255,255,0.08)");
    el.style.setProperty("--rm-input-bg-focus", "rgba(255,255,255,0.12)");
    el.style.setProperty("--rm-scrollbar", "rgba(255,255,255,0.12)");
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
              stopHeartbeat();
              hideGreetingStack();
            } else if (matchesCurrentPage(patterns)) {
              container.style.display = "";
              hiddenByPageTargeting = false;
              if (!isOpen && !conversationId) renderGreetings();
            } else if (matchesCurrentPage(patterns) === false && isOpen) {
              // chat is open – do nothing, let user finish
            } else {
              // Per-greeting visibility may have changed — re-render
              if (!isOpen && !conversationId) renderGreetings();
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
          // Custom solid surface color (no-op when left at the default white).
          applySurfaceColor(container, w.backgroundColor || "#ffffff");
        }

        // ─── Message colors (always derived from primary) ─────────────────────
        container.style.setProperty("--rm-visitor-bg", primary);
        container.style.setProperty("--rm-visitor-text", brandText);

        // Trigger & send button: brand colors
        trigger.style.backgroundColor = primary;
        sendBtn.style.backgroundColor = primary;

        void isCenterInline; // position handled below
        if (
          typeof w.borderRadius === "number" &&
          Number.isFinite(w.borderRadius)
        ) {
          const radius = widgetRadiusTokens(w.borderRadius);
          container.style.setProperty("--rm-chat-radius", `${radius.window}px`);
          container.style.setProperty("--rm-card-radius", `${radius.card}px`);
          container.style.setProperty("--rm-btn-radius", `${radius.control}px`);
          container.style.setProperty(
            "--rm-input-radius",
            `${radius.control}px`,
          );
        }

        // Header text
        headerTitle.textContent =
          w.headerText || loadedConfig.botName || "Ask AI";
        setOptionalLine(headerSubtitle, w.headerSubtitle);

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
        const resolvedFont = resolveWidgetFont(w.fontFamily);
        if (resolvedFont && resolvedFont.faces.length > 0) {
          const css = fontFaceCss(resolvedFont);
          let fontStyle = document.getElementById("rm-widget-font");
          if (!fontStyle) {
            fontStyle = document.createElement("style");
            fontStyle.id = "rm-widget-font";
            document.head.appendChild(fontStyle);
          }
          fontStyle.textContent = css;
          const fontStack =
            '"' +
            resolvedFont.value +
            '", -apple-system, BlinkMacSystemFont, sans-serif';
          container.style.fontFamily = fontStack;
          // The inline bar is its own top-level element — it does not
          // inherit from container, so it needs the font applied too.
          inlineBar.style.fontFamily = fontStack;
        } else {
          document.getElementById("rm-widget-font")?.remove();
        }

        applyWidgetCustomCss(
          typeof w.customCss === "string" ? w.customCss : null,
        );

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
          if (w.bannerPosition) {
            homeBanner.style.backgroundPosition = w.bannerPosition;
          }
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
              requestAnimationFrame(() => {
                if (!isSending) {
                  handleSendMessage(qa.action);
                }
              });
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
          const identitySession = identitySessions.capture();
          const requestVisitorId = visitorId;
          const requestVisitorInfo = { ...visitorInfo };

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
                signal: identitySession.signal,
                body: JSON.stringify({
                  visitorId: requestVisitorId,
                  visitorName: requestVisitorInfo.name,
                  visitorEmail: requestVisitorInfo.email,
                  data,
                  streamAi: false,
                }),
              },
            );
            if (!identitySessions.isCurrent(identitySession)) return;

            if (!res.ok) {
              const err = await res.json().catch(() => null);
              if (!identitySessions.isCurrent(identitySession)) return;
              formError.textContent =
                (err as { error?: string })?.error ||
                "Something went wrong. Please try again.";
              formError.style.display = "block";
              submitBtn2.disabled = false;
              submitBtn2.textContent = "Send message";
              return;
            }

            const accepted = (await res.json()) as ContactAcceptedClientPayload;
            if (!identitySessions.isCurrent(identitySession)) return;

            // The form endpoint has already persisted the visitor message and
            // started any server-side follow-up. Native Agent hydration owns
            // the transcript from here; submitting it again would duplicate it.
            applyContactAccepted(accepted);
            showChatScreen();
            await connectConversationAgent(
              identitySession,
              accepted.conversationId,
            );
            if (!identitySessions.isCurrent(identitySession)) return;

            // Reset the form so it stays usable if the visitor returns to it
            // (the backend appends repeat submissions to the same conversation).
            for (const fi of fieldInputs) {
              fi.input.value = "";
            }
            formError.style.display = "none";
            submitBtn2.disabled = false;
            submitBtn2.textContent = "Send message";
          } catch {
            if (!identitySessions.isCurrent(identitySession)) return;
            formError.textContent =
              "Couldn't send message. Please check your connection.";
            formError.style.display = "block";
            submitBtn2.disabled = false;
            submitBtn2.textContent = "Send message";
          }
        };
      }

      // Greetings — pop-out cards (welcome + news) and lazy first-message
      if (Array.isArray(loadedConfig.greetings)) {
        greetingsList = loadedConfig.greetings as GreetingPublic[];
      } else {
        greetingsList = [];
      }

      // Derive lazy in-thread first-message from the first compact greeting
      // (no image, no CTA). Rich cards only live in the popout, not the chat
      // thread.
      const firstCompact = greetingsList.find(
        (g) => g.enabled && !g.imageUrl && !g.ctaText && !g.ctaLink,
      );
      if (firstCompact) {
        introMessageText = firstCompact.title;
        introMessageAuthor = firstCompact.author
          ? {
              name: firstCompact.author.name,
              avatar: firstCompact.author.avatar,
              workTitle: firstCompact.author.workTitle,
            }
          : null;
      } else if (loadedConfig.introMessage) {
        // Back-compat: legacy config payload
        introMessageText = loadedConfig.introMessage;
        introMessageAuthor = loadedConfig.introMessageAuthor ?? null;
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
          applySurfaceColor(
            inlineBar,
            loadedConfig.widget?.backgroundColor || "#ffffff",
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
              requestAnimationFrame(() => handleSendMessage(qa.action));
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

  function disconnectConversationAgent(): void {
    agentSessionGeneration += 1;
    if (agentSessionRefreshTimer) {
      clearTimeout(agentSessionRefreshTimer);
      agentSessionRefreshTimer = null;
    }
    connectedAgentConversationId = null;
    agentSessionExpiresAt = 0;
    agentChatClient.disconnect();
  }

  async function connectConversationAgent(
    identitySession: WidgetIdentitySessionToken = identitySessions.capture(),
    requestedConversationId: string | null = conversationId,
    forceRefresh = false,
  ): Promise<"agent" | "unavailable"> {
    if (!requestedConversationId) return "unavailable";
    if (
      !forceRefresh &&
      connectedAgentConversationId === requestedConversationId &&
      agentSessionExpiresAt * 1_000 - Date.now() > 30_000
    )
      return "agent";
    const generation = agentSessionGeneration + 1;
    agentSessionGeneration = generation;
    if (agentSessionRefreshTimer) {
      clearTimeout(agentSessionRefreshTimer);
      agentSessionRefreshTimer = null;
    }
    try {
      const response = await fetch(
        `${baseUrl}/api/widget/${projectSlug}/conversations/${encodeURIComponent(requestedConversationId)}/agent-session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: identitySession.signal,
          body: JSON.stringify({ visitorId }),
        },
      );
      if (
        generation !== agentSessionGeneration ||
        !identitySessions.isCurrent(identitySession) ||
        conversationId !== requestedConversationId
      )
        return "unavailable";
      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        const action = classifyAgentSessionFailure(
          response.status,
          errorPayload?.error ?? null,
        );
        if (action === "retire") {
          retireArchivedConversation();
        } else if (response.status === 403) {
          showBannedState();
        }
        return "unavailable";
      }
      const session = (await response.json()) as PublicChatSessionResponse;
      if (
        generation !== agentSessionGeneration ||
        !identitySessions.isCurrent(identitySession) ||
        conversationId !== requestedConversationId
      )
        return "unavailable";
      agentChatClient.connect(session);
      connectedAgentConversationId = requestedConversationId;
      agentSessionExpiresAt = session.expiresAt;
      const refreshIn = Math.max(
        5_000,
        session.expiresAt * 1_000 - Date.now() - 15_000,
      );
      agentSessionRefreshTimer = setTimeout(() => {
        void connectConversationAgent(
          identitySession,
          requestedConversationId,
          true,
        );
      }, refreshIn);
      return "agent";
    } catch (error) {
      if (!identitySessions.isCurrent(identitySession)) return "unavailable";
      console.error(
        "[ReplyMaven] Failed to connect conversation Agent:",
        error,
      );
      return "unavailable";
    }
  }

  async function createConversation(
    session: WidgetIdentitySessionToken = identitySessions.capture(),
  ) {
    if (conversationId) return;
    const requestVisitorId = visitorId;
    try {
      const deviceMeta = collectDeviceMetadata();
      const metadata = { ...deviceMeta, ...customMetadata };

      const res = await fetch(
        `${baseUrl}/api/widget/${projectSlug}/conversations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: session.signal,
          body: JSON.stringify({
            visitorId: requestVisitorId,
            visitorName: visitorInfo.name,
            visitorEmail: visitorInfo.email,
            metadata,
          }),
        },
      );
      if (res.ok) {
        const data = await res.json();
        if (
          !identitySessions.isCurrent(session) ||
          visitorId !== requestVisitorId
        ) {
          return;
        }
        conversationId = data.id;
        conversationStatus = data.status ?? "active";
        persistConversationId(data.id);
        await connectConversationAgent(session, data.id);
        startHeartbeat();
        // Hide inline action bubbles once conversation starts
        inlineBarActions.classList.remove("has-actions");
      } else if (res.status === 403) {
        const data = await res.json().catch(() => null);
        if (data?.banned) {
          showBannedState();
        }
      }
    } catch (err) {
      if (!identitySessions.isCurrent(session)) return;
      console.error("[ReplyMaven] Failed to create conversation:", err);
    }
  }

  interface SendMessageOptions {
    identitySession?: WidgetIdentitySessionToken;
  }

  interface ContactAcceptedClientPayload {
    conversationId: string;
    visitorMessageId: string;
    conversationStatus: string;
    aiWillRespond: boolean;
    visitorName: string | null;
    visitorEmail: string | null;
    assistantName: string;
    fallbackMessage: string;
  }

  function applyContactAccepted(payload: ContactAcceptedClientPayload): void {
    conversationId = payload.conversationId;
    conversationStatus = payload.conversationStatus;
    if (payload.visitorName) visitorInfo.name = payload.visitorName;
    if (payload.visitorEmail) visitorInfo.email = payload.visitorEmail;
    persistConversationId(payload.conversationId);
    syncConversationModeUi();
    startHeartbeat();
    inlineBarActions.classList.remove("has-actions");

    messagesContainer.querySelector(".rm-chat-note")?.remove();
    const note = document.createElement("div");
    note.className = "rm-chat-note";
    note.textContent = payload.aiWillRespond
      ? `Sent to the team. ${payload.assistantName} is looking into it now.`
      : "Sent to the team. They'll reply here.";
    messagesContainer.insertBefore(note, typingRow);
    scrollToBottom();
  }

  // A failed turn is invisible unless we say something: the server discards
  // the partial reply and the error frame is otherwise console-only. A
  // status note (not a bot bubble) is the honest surface. The visitor's
  // message DID deliver — only the reply failed — so the retry re-sends the
  // last visitor message as a fresh turn instead of asking them to retype.
  function lastVisitorMessageText(): string | null {
    const messages = agentChatClient.messages();
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]!;
      if (message.author !== "visitor") continue;
      const content = message.content?.trim();
      if (content && content !== "Sent an image") return content;
      return null;
    }
    return null;
  }

  function showTurnFailureNote(): void {
    removeTurnFailureNote();
    const note = document.createElement("div");
    note.className = "rm-chat-note rm-turn-failed";
    const retryText = lastVisitorMessageText();
    if (retryText) {
      note.append("The reply didn't come through.");
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "rm-turn-retry";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => {
        removeTurnFailureNote();
        void handleSendMessage(retryText);
      });
      note.appendChild(retry);
    } else {
      note.textContent = "The reply didn't come through. Please try again.";
    }
    messagesContainer.insertBefore(note, typingRow);
    scrollToBottom();
  }

  function removeTurnFailureNote(): void {
    messagesContainer.querySelector(".rm-turn-failed")?.remove();
  }

  async function handleSendMessage(
    text: string,
    options: SendMessageOptions = {},
  ): Promise<void> {
    const identitySession =
      options.identitySession ?? identitySessions.capture();
    if (!identitySessions.isCurrent(identitySession) || isBanned || isSending) {
      return;
    }
    const requestVisitorId = visitorId;
    isSending = true;
    sendBtn.disabled = true;
    input.disabled = true;
    if (isInlineBarVariant) inlineBarInput.disabled = true;

    let optimisticMessageId: string | null = null;
    try {
      if (currentView === "home") showChatScreen();

      const imageFile = pendingImageFile;
      let uploadedImageUrl: string | null = null;
      let localPreviewUrl: string | null = null;
      if (imageFile) {
        localPreviewUrl = imagePreviewImg.src;
        pendingImageFile = null;
        imagePreview.classList.remove("visible");
        imagePreviewImg.src = "";
      }

      const messageText = text || (imageFile ? "Sent an image" : "");
      if (!messageText && !imageFile) return;

      // Render the bubble before conversation creation and the socket
      // connect, or the first message shows a frozen composer with nothing
      // on screen for the whole setup round-trip.
      optimisticMessageId = crypto.randomUUID();
      pendingVisitorMessageIds.add(optimisticMessageId);
      addMessageToUI(
        "visitor",
        messageText,
        optimisticMessageId,
        localPreviewUrl ?? undefined,
        undefined,
        undefined,
        true,
      );
      quickTopicsContainer.style.display = "none";
      removeTurnFailureNote();

      if (!conversationId) await createConversation(identitySession);
      if (!identitySessions.isCurrent(identitySession)) return;
      if (!conversationId) {
        throw new Error("The conversation could not be created");
      }
      const requestedConversationId = conversationId;
      const transport = await connectConversationAgent(
        identitySession,
        requestedConversationId,
      );
      if (
        !identitySessions.isCurrent(identitySession) ||
        conversationId !== requestedConversationId
      )
        return;
      if (transport === "unavailable") {
        throw new Error("Conversation transport is unavailable");
      }

      if (conversationStatus === "closed") {
        conversationStatus = "active";
        syncConversationModeUi();
      }

      if (imageFile) {
        async function tryUpload(): Promise<string> {
          const formData = new FormData();
          formData.append("file", imageFile!);
          formData.append("conversationId", requestedConversationId);
          formData.append("visitorId", requestVisitorId);
          const uploadResponse = await fetch(
            `${baseUrl}/api/widget/${projectSlug}/upload`,
            {
              method: "POST",
              body: formData,
              signal: identitySession.signal,
            },
          );
          if (!uploadResponse.ok) {
            throw new Error(`upload ${uploadResponse.status}`);
          }
          const upload = (await uploadResponse.json()) as { url: string };
          if (!identitySessions.isCurrent(identitySession)) {
            throw new DOMException("Identity session reset", "AbortError");
          }
          return new URL(upload.url, baseUrl).toString();
        }

        try {
          uploadedImageUrl = await tryUpload();
        } catch {
          try {
            await new Promise((resolve) => setTimeout(resolve, 600));
            if (!identitySessions.isCurrent(identitySession)) return;
            uploadedImageUrl = await tryUpload();
          } catch (error) {
            if (!identitySessions.isCurrent(identitySession)) return;
            console.error("[ReplyMaven] Image upload failed:", error);
            // A separate note, not the delivery status line: the text still
            // sends and its outbox transitions must not erase this notice.
            const statusElement = optimisticMessageId
              ? visitorStatusElsByMessageId.get(optimisticMessageId)
              : null;
            if (statusElement?.parentElement) {
              const note = document.createElement("div");
              note.className = "rm-msg-status failed";
              note.textContent = "Image failed to upload";
              statusElement.parentElement.insertBefore(note, statusElement);
            }
          }
        }
        if (!uploadedImageUrl && !text) return;
      }

      const currentPageContext = sanitizePageContext({
        currentPageUrl: window.location.href,
        pageTitle: document.title,
        ...pageContext,
      });
      // Enqueue only: the outbox owns delivery, retries, and the status
      // transitions reported through handleAgentOutbox.
      await agentChatClient.send({
        id: optimisticMessageId,
        content: messageText,
        imageUrls: uploadedImageUrl ? [uploadedImageUrl] : [],
        pageContext: currentPageContext,
      });
    } catch (error) {
      if (!identitySessions.isCurrent(identitySession)) return;
      console.error("[ReplyMaven] Agent message failed:", error);
      hideTyping();
      if (optimisticMessageId) {
        const statusElement =
          visitorStatusElsByMessageId.get(optimisticMessageId);
        if (statusElement) {
          statusElement.textContent = "Failed to send";
          statusElement.style.opacity = "1";
          statusElement.classList.add("failed");
        }
      } else if (text && !input.value) {
        // Failed before anything rendered (e.g. transport unavailable):
        // restore the draft so the typed message is not lost, and never
        // touch the previous message's status element.
        input.value = text;
      }
    } finally {
      if (optimisticMessageId) {
        pendingVisitorMessageIds.delete(optimisticMessageId);
      }
      if (identitySessions.isCurrent(identitySession)) {
        isSending = false;
        sendBtn.disabled = false;
        input.disabled = false;
        inlineBarInput.disabled = false;
        if (isInlineBarVariant && !isMobileViewport()) {
          inlineBarInput.focus();
        } else {
          input.focus();
        }
      }
    }
  }

  // Track previous message role for avatar grouping
  let lastMessageRole: string | null = null;

  // Outbox transitions drive each message's delivery label. "delivered" means
  // the server sent the request's final frame; "undeliverable" offers a retry
  // that re-enqueues the same message id in the Agent runtime.
  function handleAgentOutbox(
    entries: Array<{ id: string; state: string }>,
  ): void {
    for (const entry of entries) {
      if (lastOutboxStateByMessageId.get(entry.id) === entry.state) continue;
      lastOutboxStateByMessageId.set(entry.id, entry.state);
      const statusElement = visitorStatusElsByMessageId.get(entry.id);
      if (!statusElement) continue;
      if (entry.state === "queued" || entry.state === "inflight") {
        statusElement.replaceChildren();
        statusElement.textContent = "Sending...";
        statusElement.classList.remove("failed");
        statusElement.style.opacity = "1";
      } else if (entry.state === "delivered") {
        statusElement.replaceChildren();
        statusElement.textContent = "Sent";
        statusElement.classList.remove("failed");
        setTimeout(() => {
          statusElement.style.opacity = "0";
        }, 2_000);
        visitorStatusElsByMessageId.delete(entry.id);
        lastOutboxStateByMessageId.delete(entry.id);
      } else if (entry.state === "undeliverable") {
        statusElement.replaceChildren();
        statusElement.append("Not delivered · ");
        const retryButton = document.createElement("button");
        retryButton.type = "button";
        retryButton.className = "rm-msg-retry";
        retryButton.textContent = "Retry";
        retryButton.addEventListener("click", () => {
          agentChatClient.retry(entry.id);
        });
        statusElement.appendChild(retryButton);
        statusElement.classList.add("failed");
        statusElement.style.opacity = "1";
        hideTyping();
      }
    }
  }

  // Full-screen viewer for message images: backdrop/image click or Esc
  // closes, ←/→ and arrow buttons navigate multi-image messages. Appended to
  // body (not the widget container) so ancestor transforms can't trap the
  // fixed overlay.
  function openImageLightbox(urls: string[], startIndex: number): void {
    let index = startIndex;

    const overlay = document.createElement("div");
    overlay.className = "rm-lightbox";
    const img = document.createElement("img");
    overlay.appendChild(img);

    let counter: HTMLElement | null = null;
    const show = () => {
      img.src = urls[index];
      img.alt = `Attachment ${index + 1} of ${urls.length}`;
      if (counter) counter.textContent = `${index + 1} / ${urls.length}`;
    };
    const step = (delta: number) => {
      index = (index + delta + urls.length) % urls.length;
      show();
    };
    const close = () => {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (urls.length > 1 && e.key === "ArrowLeft") step(-1);
      if (urls.length > 1 && e.key === "ArrowRight") step(1);
    };

    const closeBtn = document.createElement("button");
    closeBtn.className = "rm-lightbox-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = ICONS.x;
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      close();
    };
    overlay.appendChild(closeBtn);

    if (urls.length > 1) {
      const prev = document.createElement("button");
      prev.className = "rm-lightbox-nav prev";
      prev.setAttribute("aria-label", "Previous image");
      prev.innerHTML = ICONS.chevronLeft;
      prev.onclick = (e) => {
        e.stopPropagation();
        step(-1);
      };
      const next = document.createElement("button");
      next.className = "rm-lightbox-nav next";
      next.setAttribute("aria-label", "Next image");
      next.innerHTML = ICONS.chevronRight;
      next.onclick = (e) => {
        e.stopPropagation();
        step(1);
      };
      counter = document.createElement("div");
      counter.className = "rm-lightbox-counter";
      overlay.appendChild(prev);
      overlay.appendChild(next);
      overlay.appendChild(counter);
    }

    overlay.onclick = close;
    document.addEventListener("keydown", onKey);
    show();
    document.body.appendChild(overlay);
  }

  // Renders a message's attached image(s) into its bubble: one image at its
  // natural size, several as a 2-up tile grid. Click opens the lightbox at
  // that image.
  function appendMessageImages(msgEl: HTMLElement, rawImageUrl: string): void {
    const urls = parseMessageImageUrls(rawImageUrl).map((url) =>
      url.startsWith("data:") ? url : resolveUrl(url),
    );
    if (urls.length === 0) return;

    const host = urls.length > 1 ? document.createElement("div") : msgEl;
    if (host !== msgEl) host.className = "rm-message-images";
    urls.forEach((src, i) => {
      const img = document.createElement("img");
      img.className = "rm-message-image";
      img.src = src;
      img.alt = urls.length > 1 ? `Attached image ${i + 1}` : "Attached image";
      img.onclick = () => openImageLightbox(urls, i);
      host.appendChild(img);
    });
    if (host !== msgEl) msgEl.appendChild(host);
  }

  function addMessageToUI(
    role: string,
    content: string,
    messageId?: string,
    imageUrl?: string,
    senderName?: string,
    senderAvatar?: string,
    optimisticVisitor = false,
  ): HTMLElement {
    // Track rendered message IDs for native full-transcript reconciliation.
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
        avatar.style.backgroundColor = `rgba(${hexToRgb(primaryColor)}, 0.15)`;
        avatar.style.color = primaryColor;
        avatar.style.fontSize = "9px";
        avatar.style.fontWeight = "600";
        avatar.textContent = senderName.charAt(0).toUpperCase();
      } else if (role === "agent") {
        avatar.classList.add("rm-icon-avatar");
        avatar.style.backgroundColor = `rgba(${hexToRgb(primaryColor)}, 0.12)`;
        avatar.style.color = primaryColor;
        avatar.innerHTML = ICONS.person;
      } else {
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

      const col = document.createElement("div");
      col.className = "rm-msg-col";

      msgEl = document.createElement("div");
      msgEl.className = "rm-message";

      if (imageUrl) appendMessageImages(msgEl, imageUrl);

      const textContainer = document.createElement("div");
      textContainer.innerHTML = shouldShowMessageContent(content)
        ? renderMarkdown(content)
        : "";
      msgEl.appendChild(textContainer);

      col.appendChild(msgEl);

      const footer = document.createElement("div");
      footer.className = "rm-msg-footer";

      if (lastMessageRole === role) {
        const prevRows = messagesContainer.querySelectorAll(
          `.rm-message-row.${role}`,
        );
        if (prevRows.length > 0) {
          const prevFooter =
            prevRows[prevRows.length - 1].querySelector(".rm-msg-footer");
          if (prevFooter) prevFooter.classList.add("hidden");
        }
      }

      footer.appendChild(avatar);

      const label = document.createElement("div");
      label.className = `rm-sender-label ${role}`;
      if (role === "bot") {
        const botDisplayName = senderName || config?.botName || "Assistant";
        label.textContent = `${botDisplayName} · AI`;
      } else {
        label.textContent = senderName || config?.agentName || "Support Agent";
      }
      footer.appendChild(label);

      col.appendChild(footer);
      row.appendChild(col);
    } else {
      // Visitor messages — no avatar, no column wrapper
      msgEl = document.createElement("div");
      msgEl.className = "rm-message";

      // Render image(s) inside bubble if present
      if (imageUrl) appendMessageImages(msgEl, imageUrl);

      if (shouldShowMessageContent(content)) {
        const textContainer = document.createElement("div");
        textContainer.innerHTML = renderMarkdown(content);
        msgEl.appendChild(textContainer);
      }
      msgEl.style.backgroundColor = primaryColor;
      msgEl.style.color = getBrandTextColor();

      // Wrap message + status in a column for visitor messages
      const visitorCol = document.createElement("div");
      visitorCol.style.display = "flex";
      visitorCol.style.flexDirection = "column";
      visitorCol.style.alignItems = "flex-end";
      visitorCol.style.minWidth = "0";
      visitorCol.appendChild(msgEl);

      // Add delivery status only for a locally submitted visitor message.
      if (!messageId || optimisticVisitor) {
        const statusEl = document.createElement("div");
        statusEl.className = "rm-msg-status";
        statusEl.textContent = "Sending...";
        visitorCol.appendChild(statusEl);
        if (messageId) visitorStatusElsByMessageId.set(messageId, statusEl);
      }

      row.appendChild(visitorCol);
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

    const capped = sources.slice(0, 3);
    const sourcesContainer = document.createElement("div");
    sourcesContainer.className = "rm-sources";

    capped.forEach((source, index) => {
      const sourceType = source.type || "webpage";
      let iconSvg: string;
      if (sourceType === "pdf") {
        iconSvg = ICONS.docs;
      } else if (sourceType === "faq") {
        iconSvg = ICONS.circleQuestion;
      } else {
        iconSvg = ICONS.globe;
      }

      const isClickable = sourceType === "webpage" && source.url;
      const el = document.createElement(isClickable ? "a" : "span");
      el.className = "rm-source-chip";

      if (isClickable) {
        (el as HTMLAnchorElement).href = source.url!;
        (el as HTMLAnchorElement).target = "_blank";
        (el as HTMLAnchorElement).rel = "noopener noreferrer";
      }

      el.innerHTML = iconSvg;

      const badge = document.createElement("span");
      badge.className = "rm-source-badge";
      badge.textContent = String(index + 1);
      el.appendChild(badge);

      const tooltip = document.createElement("span");
      tooltip.className = "rm-source-tooltip";
      tooltip.textContent = source.title;
      el.appendChild(tooltip);

      sourcesContainer.appendChild(el);
    });

    msgEl.appendChild(sourcesContainer);
  }

  // Stable user-facing labels per backend phase. The widget owns the copy so
  // we never surface raw backend strings and can localize later without
  // touching the worker. Falls back to the backend `message` when the phase is
  // unknown, and finally to "Thinking" when neither is provided.
  const PHASE_LABELS: Record<string, string> = {
    thinking: "Thinking\u2026",
    retrieval: "Searching docs\u2026",
    tool: "Checking connected systems\u2026",
    verify: "Checking facts\u2026",
    compose: "Writing the reply\u2026",
  };

  function showTyping(message?: string, phase?: string) {
    removeTurnFailureNote();
    typingRow.classList.add("visible");
    const label = (phase && PHASE_LABELS[phase]) || message || "Thinking";
    if (statusText.textContent !== label) {
      statusText.style.opacity = "0";
      setTimeout(() => {
        statusText.textContent = label;
        statusText.style.opacity = "1";
      }, 150);
    }
    if (phase) {
      statusText.dataset.phase = phase;
    } else {
      delete statusText.dataset.phase;
    }
    scrollToBottom();
  }

  function hideTyping() {
    typingRow.classList.remove("visible");
    statusText.textContent = "Thinking";
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

  function ensureLatestMessageVisible() {
    const settleDelays = [0, 80, 180, 320];
    for (const delay of settleDelays) {
      window.setTimeout(() => {
        requestAnimationFrame(() => {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        });
      }, delay);
    }
  }

  // ─── Tool Error Display ────────────────────────────────────────────────────

  // ─── Handoff Card ───────────────────────────────────────────────────────────

  // ─── Native Agent Transcript ───────────────────────────────────────────────

  function updateRenderedPublicMessage(message: PublicMessageRecord): void {
    if (message.author === "system") return;
    const role = message.author;
    const imageUrl =
      message.imageUrls.length > 0
        ? (serializeMessageImageUrls(message.imageUrls) ?? undefined)
        : undefined;
    const row = messagesContainer.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(message.id)}"]`,
    );
    if (!row) {
      const messageElement = addMessageToUI(
        role,
        message.content,
        message.id,
        imageUrl,
        message.senderName ?? undefined,
        message.senderAvatar ?? undefined,
      );
      if (message.sources.length > 0) {
        addSourcesToMessage(messageElement, message.sources);
      }
      return;
    }

    const messageElement = row.querySelector<HTMLElement>(".rm-message");
    if (!messageElement) return;
    messageElement.replaceChildren();
    if (imageUrl) appendMessageImages(messageElement, imageUrl);
    if (shouldShowMessageContent(message.content)) {
      const text = document.createElement("div");
      text.innerHTML = renderMarkdown(message.content);
      messageElement.appendChild(text);
    }
    if (message.sources.length > 0) {
      addSourcesToMessage(messageElement, message.sources);
    }
  }

  function notifyForIncomingResponse(message: PublicMessageRecord): void {
    if (isOpen) {
      scrollToBottom();
      markConversationSeen();
    }
    if (!isOpen) {
      incrementUnreadBadge();
      showBrowserNotification(message.content || "New message");
      popMessagePreviewForIncomingMessage({
        ...message,
        role: message.author,
      });
    } else if (!isTabActive) {
      incrementUnreadBadge();
      showBrowserNotification(message.content || "New message");
      if (!titleOverridden) originalDocTitle = document.title;
      document.title = `New Message | ${originalDocTitle}`;
      titleOverridden = true;
    }
  }

  let streamingResponseRowId: string | null = null;

  function markStreamingResponseRow(id: string | null): void {
    if (streamingResponseRowId === id) return;
    if (streamingResponseRowId) {
      messagesContainer
        .querySelector(
          `[data-message-id="${CSS.escape(streamingResponseRowId)}"]`,
        )
        ?.classList.remove("rm-streaming");
    }
    streamingResponseRowId = id;
    if (id) {
      messagesContainer
        .querySelector(`[data-message-id="${CSS.escape(id)}"]`)
        ?.classList.add("rm-streaming");
    }
  }

  function isTurnStreaming(): boolean {
    return (
      !latestAgentActivity.error &&
      !latestAgentActivity.isRecovering &&
      (latestAgentActivity.status === "submitted" ||
        latestAgentActivity.status === "streaming" ||
        latestAgentActivity.isServerStreaming)
    );
  }

  function handleAgentMessages(messages: PublicMessageRecord[]): void {
    const nextIds = new Set(messages.map((message) => message.id));
    for (const id of authoritativeMessageIds) {
      if (nextIds.has(id)) continue;
      const row = messagesContainer.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(id)}"]`,
      );
      row?.remove();
      renderedMessageIds.delete(id);
      pendingIncomingResponseIds.delete(id);
    }

    for (const message of messages) {
      if (pendingVisitorMessageIds.has(message.id)) {
        pendingVisitorMessageIds.delete(message.id);
      }
      if (
        hasReceivedAgentSnapshot &&
        !authoritativeMessageIds.has(message.id) &&
        (message.author === "bot" || message.author === "agent")
      ) {
        pendingIncomingResponseIds.add(message.id);
      }
      // A streaming response exists from the stream's start part, before any
      // text; keep showing the typing indicator instead of an empty bubble.
      const isEmptyPendingResponse =
        (message.author === "bot" || message.author === "agent") &&
        message.content.length === 0 &&
        message.imageUrls.length === 0;
      if (!isEmptyPendingResponse) updateRenderedPublicMessage(message);
      if (
        (message.author === "bot" || message.author === "agent") &&
        message.content
      )
        hideTyping();
    }
    authoritativeMessageIds = nextIds;

    const lastMessage = messages.at(-1);
    markStreamingResponseRow(
      lastMessage &&
        (lastMessage.author === "bot" || lastMessage.author === "agent") &&
        isTurnStreaming()
        ? lastMessage.id
        : null,
    );

    if (messages.length > 0) {
      introMessageText = null;
      if (conversationStatus !== "closed") showChatScreen();
      ensureLatestMessageVisible();
    }

    const latestResponse = [...messages]
      .reverse()
      .find(
        (message) => message.author === "bot" || message.author === "agent",
      );
    if (latestResponse) {
      const isNewLatestResponse = newestResponseId !== latestResponse.id;
      newestResponseId = latestResponse.id;
      if (
        isNewLatestResponse &&
        latestAgentActivity.status === "ready" &&
        !latestAgentActivity.isServerStreaming &&
        !latestAgentActivity.isRecovering
      )
        reportDelivered();
    } else {
      newestResponseId = null;
    }

    if (!hasReceivedAgentSnapshot) {
      hasReceivedAgentSnapshot = true;
      if (latestResponse) {
        if (isOpen) {
          markConversationSeen();
        } else if (latestResponse.id !== getStoredSeenResponseId()) {
          incrementUnreadBadge();
          const lastMessage = messages.at(-1);
          if (lastMessage?.id === latestResponse.id) {
            popMessagePreviewForIncomingMessage({
              ...latestResponse,
              role: latestResponse.author,
            });
          }
        }
      }
      return;
    }

    flushPendingIncomingResponses(messages);
  }

  function flushPendingIncomingResponses(
    messages: PublicMessageRecord[],
  ): void {
    if (
      latestAgentActivity.status !== "ready" ||
      latestAgentActivity.isServerStreaming ||
      latestAgentActivity.isRecovering
    )
      return;
    const deliverable = messages.filter(
      (message) =>
        pendingIncomingResponseIds.has(message.id) &&
        (message.author === "bot" || message.author === "agent") &&
        (message.content.length > 0 || message.imageUrls.length > 0),
    );
    for (const message of deliverable) {
      pendingIncomingResponseIds.delete(message.id);
    }
    const latestIncoming = deliverable.at(-1);
    if (latestIncoming) notifyForIncomingResponse(latestIncoming);
  }

  function handleAgentActivity(activity: WidgetChatActivity): void {
    latestAgentActivity = activity;
    if (activity.error) {
      hideTyping();
      markStreamingResponseRow(null);
      console.error(
        "[ReplyMaven] Conversation Agent connection failed:",
        activity.error,
      );
      if (activity.errorSource === "turn") showTurnFailureNote();
      return;
    }
    if (activity.isRecovering) {
      showTyping("Reconnecting…");
      return;
    }
    if (
      activity.status === "submitted" ||
      activity.status === "streaming" ||
      activity.isServerStreaming
    ) {
      showTyping(undefined, activity.statusPhase);
      return;
    }
    hideTyping();
    markStreamingResponseRow(null);
    reportDelivered();
    queueMicrotask(() => {
      flushPendingIncomingResponses(agentChatClient.messages());
    });
  }

  function handleAgentConversationState(state: PublicChatChildState): void {
    if (state.archived) {
      retireArchivedConversation();
      return;
    }
    if (conversationStatus !== state.status) {
      conversationStatus = state.status;
      syncConversationModeUi();
    }
    if (state.status === "waiting_agent") requestNotificationPermission();
    if (state.status === "closed") stopHeartbeat();
  }

  agentChatClient.onMessages(handleAgentMessages);
  agentChatClient.onActivity(handleAgentActivity);
  agentChatClient.onOutbox(handleAgentOutbox);
  agentChatClient.onConversationState(handleAgentConversationState);

  // Messages older than this never pop the preview — a stale reply shouldn't
  // greet a visitor returning weeks later. The launcher badge still marks it.
  const MAX_PREVIEW_AGE_MS = 7 * 24 * 60 * 60 * 1000;

  // createdAt arrives as a Date (rare), epoch seconds (Agent/API), or an ISO
  // string depending on the path. Returns null when unparseable.
  function messageTimeMs(createdAt: unknown): number | null {
    if (createdAt instanceof Date) return createdAt.getTime();
    if (typeof createdAt === "number") {
      return createdAt < 1_000_000_000_000 ? createdAt * 1000 : createdAt;
    }
    if (typeof createdAt === "string") {
      const t = new Date(createdAt).getTime();
      return Number.isNaN(t) ? null : t;
    }
    return null;
  }

  // Show the unseen-message preview when the widget is closed. Shared by the
  // Agent and page-load paths so behavior stays consistent. Renders a
  // compact greeting-style card (same component as proactive greetings) that
  // stays out until the visitor opens the chat or dismisses it via ✕ —
  // auto-hiding meant unseen replies went unnoticed.
  // Callers must only pass the conversation's actual latest message — a reply
  // the visitor has since responded to shouldn't resurface as a popup.
  function popMessagePreviewForIncomingMessage(msg: {
    id: string;
    role: string;
    content: string;
    senderName?: string | null;
    senderAvatar?: string | null;
    createdAt?: unknown;
  }) {
    if (msg.role === "visitor") return;
    // Without an id we can't record a dismissal, which would make the card
    // un-dismissable — skip rather than trap the visitor.
    if (!msg.id) return;
    // Never re-pop a preview the visitor explicitly dismissed. The launcher
    // badge (handled by the callers) still shows until the chat is opened.
    if (msg.id === getDismissedIntroId()) return;
    // Skip stale replies (unparseable timestamps count as fresh — the live
    // WS/poll paths only ever deliver current messages).
    const timeMs = messageTimeMs(msg.createdAt);
    if (timeMs !== null && Date.now() - timeMs > MAX_PREVIEW_AGE_MS) return;

    const senderName =
      msg.senderName ||
      (msg.role === "agent"
        ? "Agent"
        : config?.botName || config?.widget?.headerText || "New message");
    const text = msg.content ?? "";
    const preview = text.length > 120 ? text.substring(0, 120) + "..." : text;

    const card = document.createElement("div");
    card.className = "rm-greeting-card compact";
    card.dataset.bgStyle = config?.widget?.backgroundStyle || "solid";

    const body = document.createElement("div");
    body.className = "rm-greeting-body";

    const avatarUrl = msg.senderAvatar
      ? resolveUrl(msg.senderAvatar)
      : config?.widget?.avatarUrl
        ? resolveUrl(config.widget.avatarUrl)
        : null;
    if (avatarUrl) {
      const avatar = document.createElement("img");
      avatar.className = "rm-greeting-avatar";
      avatar.src = avatarUrl;
      avatar.alt = "";
      body.appendChild(avatar);
    } else {
      const fallback = document.createElement("div");
      fallback.className = "rm-greeting-avatar-fallback";
      fallback.innerHTML = ICONS.chat;
      body.appendChild(fallback);
    }

    const textWrap = document.createElement("div");
    textWrap.className = "rm-greeting-text";
    const title = document.createElement("div");
    title.className = "rm-greeting-title";
    title.textContent = senderName;
    const desc = document.createElement("div");
    desc.className = "rm-greeting-desc";
    desc.textContent = preview;
    textWrap.appendChild(title);
    textWrap.appendChild(desc);
    body.appendChild(textWrap);
    card.appendChild(body);

    const close = document.createElement("button");
    close.className = "rm-greeting-close";
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss message preview");
    close.innerHTML = ICONS.x;
    close.onclick = (e) => {
      e.stopPropagation();
      setDismissedIntroId(msg.id);
      card.classList.add("dismissed");
      setTimeout(() => card.remove(), 350);
    };
    card.appendChild(close);

    card.onclick = () => toggleChatWidget();
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleChatWidget();
      }
    };

    // Greetings shouldn't normally be up while a conversation exists, but the
    // forced showGreetings() API can put them there — the preview wins.
    hideGreetingStack();
    previewStack.innerHTML = "";
    previewStack.appendChild(card);
    // setTimeout rather than requestAnimationFrame: rAF stalls in background
    // tabs, leaving the card permanently invisible on background page loads.
    setTimeout(() => card.classList.add("visible"), 20);
  }

  // Hide (without persisting a dismissal) — used when the chat opens, which
  // marks the previewed response seen via markConversationSeen().
  function hideMessagePreview(): void {
    const cards = previewStack.querySelectorAll(".rm-greeting-card");
    cards.forEach((c) => c.classList.add("dismissed"));
  }

  // ─── Heartbeat ──────────────────────────────────────────────────────────────

  function startHeartbeat() {
    stopHeartbeat();
    if (!conversationId) return;
    void sendAckViaHeartbeat({});

    // Agent state owns status changes. This low-frequency HTTP path preserves
    // presence plus delivery/read receipts without a second realtime socket.
    heartbeatTimer = setInterval(async () => {
      if (!conversationId) {
        stopHeartbeat();
        return;
      }
      const identitySession = identitySessions.capture();
      const requestedConversationId = conversationId;
      try {
        const presence = document.hidden ? "background" : "active";
        const res = await fetch(
          `${baseUrl}/api/widget/${projectSlug}/conversations/${requestedConversationId}/heartbeat`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: identitySession.signal,
            body: JSON.stringify({ presence }),
          },
        );
        if (
          !identitySessions.isCurrent(identitySession) ||
          conversationId !== requestedConversationId
        ) {
          return;
        }
        if (!res.ok) {
          if (res.status === 410 || res.status === 404) {
            retireArchivedConversation();
          }
          return;
        }
        const data = await res.json();
        if (
          !identitySessions.isCurrent(identitySession) ||
          conversationId !== requestedConversationId
        ) {
          return;
        }
        if (data.status && data.status !== conversationStatus) {
          conversationStatus = data.status;
          syncConversationModeUi();
          if (data.status === "closed") {
            stopHeartbeat();
          }
        }
      } catch {
        // Silently ignore heartbeat failures
      }
    }, 5 * 60_000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
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
    triggerBadge.classList.add("visible");
  }

  function clearUnreadBadge() {
    triggerBadge.classList.remove("visible");
  }

  // Persist that the visitor has seen the newest response and clear the badge.
  // Called when the widget opens or a response is viewed while open.
  function markConversationSeen() {
    if (newestResponseId) setStoredSeenResponseId(newestResponseId);
    clearUnreadBadge();
    reportRead();
  }

  // ─── Conversation History Loading ────────────────────────────────────────────

  async function loadConversationAgent(
    identitySession: WidgetIdentitySessionToken = identitySessions.capture(),
    requestedConversationId: string | null = conversationId,
  ): Promise<void> {
    if (!requestedConversationId) return;
    hasReceivedAgentSnapshot = false;
    authoritativeMessageIds.clear();
    await connectConversationAgent(identitySession, requestedConversationId);
    if (
      !identitySessions.isCurrent(identitySession) ||
      conversationId !== requestedConversationId
    )
      return;
    startHeartbeat();
  }

  async function restoreConversation(
    identitySession: WidgetIdentitySessionToken = identitySessions.capture(),
  ) {
    const requestVisitorId = visitorId;
    // First try localStorage
    const storedId = loadPersistedConversationId();
    if (storedId) {
      conversationId = storedId;
      await loadConversationAgent(identitySession, storedId);
      if (!identitySessions.isCurrent(identitySession)) return;
      if (conversationId) {
        // Hide inline action bubbles — conversation already exists
        inlineBarActions.classList.remove("has-actions");
        return; // Successfully restored
      }
    }

    // Fallback: try to find active conversation by visitorId
    try {
      const res = await fetch(
        `${baseUrl}/api/widget/${projectSlug}/conversations/active?visitorId=${encodeURIComponent(requestVisitorId)}`,
        { signal: identitySession.signal },
      );
      if (!identitySessions.isCurrent(identitySession)) return;
      if (!res.ok) return;

      const data = await res.json();
      if (
        !identitySessions.isCurrent(identitySession) ||
        visitorId !== requestVisitorId
      ) {
        return;
      }
      if (data.conversation) {
        conversationId = data.conversation.id;
        conversationStatus = data.conversation.status;
        persistConversationId(data.conversation.id);
        await loadConversationAgent(identitySession, data.conversation.id);
        if (!identitySessions.isCurrent(identitySession)) return;
        // Hide inline action bubbles — conversation already exists
        inlineBarActions.classList.remove("has-actions");
      }
    } catch {
      // Silently ignore
    }

    // No active conversation found — show greetings stack
    if (!conversationId && !isOpen) {
      renderGreetings();
    }
  }

  // ─── Greetings (welcome + news cards) ───────────────────────────────────────

  function getDismissedGreetingIds(): string[] {
    try {
      const raw = localStorage.getItem(getStorageKey("greetings_dismissed"));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === "string")
        : [];
    } catch {
      return [];
    }
  }

  function addDismissedGreetingId(id: string): void {
    const set = new Set(getDismissedGreetingIds());
    set.add(id);
    try {
      localStorage.setItem(
        getStorageKey("greetings_dismissed"),
        JSON.stringify([...set]),
      );
    } catch {
      // localStorage may be unavailable
    }
  }

  function isGreetingDismissed(id: string): boolean {
    return getDismissedGreetingIds().includes(id);
  }

  function clearGreetingTimers(): void {
    for (const timer of greetingTimers.values()) clearTimeout(timer);
    for (const timer of greetingDurationTimers.values()) clearTimeout(timer);
    greetingTimers.clear();
    greetingDurationTimers.clear();
  }

  function buildGreetingCard(greeting: GreetingPublic): HTMLElement {
    const card = document.createElement("div");
    card.className = "rm-greeting-card";
    card.setAttribute("data-greeting-id", greeting.id);

    const bgStyle = config?.widget?.backgroundStyle || "solid";
    card.dataset.bgStyle = bgStyle;

    const isRich = Boolean(greeting.imageUrl) || Boolean(greeting.ctaText);
    if (!isRich) card.classList.add("compact");

    if (greeting.imageUrl) {
      const img = document.createElement("img");
      img.className =
        greeting.imageAspect === "square"
          ? "rm-greeting-image square"
          : "rm-greeting-image";
      img.src = resolveUrl(greeting.imageUrl);
      img.alt = "";
      if (greeting.imagePosition) {
        img.style.objectPosition = greeting.imagePosition;
      }
      card.appendChild(img);
    }

    const body = document.createElement("div");
    body.className = "rm-greeting-body";

    if (!isRich) {
      const avatarUrl = greeting.author?.avatar
        ? resolveUrl(greeting.author.avatar)
        : config?.widget?.avatarUrl
          ? resolveUrl(config.widget.avatarUrl)
          : null;
      if (avatarUrl) {
        const avatar = document.createElement("img");
        avatar.className = "rm-greeting-avatar";
        avatar.src = avatarUrl;
        avatar.alt = "";
        body.appendChild(avatar);
      } else {
        const fallback = document.createElement("div");
        fallback.className = "rm-greeting-avatar-fallback";
        fallback.innerHTML = ICONS.chat;
        body.appendChild(fallback);
      }
    }

    const text = document.createElement("div");
    text.className = "rm-greeting-text";

    const title = document.createElement("div");
    title.className = "rm-greeting-title";
    title.textContent =
      greeting.author?.name && !isRich ? greeting.author.name : greeting.title;
    text.appendChild(title);

    const desc = document.createElement("div");
    desc.className = "rm-greeting-desc";
    desc.textContent =
      greeting.author?.name && !isRich
        ? greeting.title
        : (greeting.description ?? "");
    if (desc.textContent) text.appendChild(desc);

    if (isRich && greeting.description) {
      // already added above when author check fails
    }

    body.appendChild(text);

    if (greeting.ctaText && greeting.ctaLink) {
      const cta = document.createElement("a");
      cta.className = "rm-greeting-cta";
      cta.href = greeting.ctaLink;
      cta.target = "_blank";
      cta.rel = "noopener noreferrer";
      cta.textContent = greeting.ctaText;
      cta.onclick = () => {
        addDismissedGreetingId(greeting.id);
      };
      text.appendChild(cta);
    }

    card.appendChild(body);

    const close = document.createElement("button");
    close.className = "rm-greeting-close";
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss");
    close.innerHTML = ICONS.x;
    close.onclick = (e) => {
      e.stopPropagation();
      dismissGreetingCard(card, greeting.id, true);
    };
    card.appendChild(close);

    if (!isRich) {
      card.onclick = () => toggleChatWidget();
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      card.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleChatWidget();
        }
      };
    }

    return card;
  }

  function dismissGreetingCard(
    card: HTMLElement,
    id: string,
    persist: boolean,
  ): void {
    if (persist) addDismissedGreetingId(id);
    card.classList.add("dismissed");
    const delayTimer = greetingTimers.get(id);
    if (delayTimer) {
      clearTimeout(delayTimer);
      greetingTimers.delete(id);
    }
    const durationTimer = greetingDurationTimers.get(id);
    if (durationTimer) {
      clearTimeout(durationTimer);
      greetingDurationTimers.delete(id);
    }
    setTimeout(() => {
      if (card.parentElement) card.parentElement.removeChild(card);
    }, 350);
  }

  function renderGreetings(options?: { force?: boolean }): void {
    const force = options?.force ?? false;
    clearGreetingTimers();
    greetingStack.innerHTML = "";

    if (isOpen) return;
    if (hiddenByPageTargeting) return;
    if (isBanned) return;
    // An unseen-reply preview outranks marketing greetings — both stacks
    // occupy the same coordinates, and a support reply is the more urgent
    // card. Applies to the forced showGreetings() API path too. Matches any
    // non-dismissed card (not just .visible) so a preview still inside its
    // reveal delay can't be covered.
    if (previewStack.querySelector(".rm-greeting-card:not(.dismissed)")) {
      return;
    }

    const visible = greetingsList.filter((g) => {
      if (!g.enabled) return false;
      if (!force && isGreetingDismissed(g.id)) return false;
      if (g.allowedPages && g.allowedPages.length > 0) {
        if (!matchesCurrentPage(g.allowedPages)) return false;
      }
      return true;
    });

    for (const greeting of visible) {
      const card = buildGreetingCard(greeting);
      greetingStack.appendChild(card);

      const delayMs = Math.max(0, greeting.delaySeconds) * 1000;
      const showTimer = setTimeout(() => {
        greetingTimers.delete(greeting.id);
        card.classList.add("visible");
      }, delayMs);
      greetingTimers.set(greeting.id, showTimer);

      if (greeting.durationSeconds > 0) {
        const durationMs = greeting.durationSeconds * 1000;
        const hideTimer = setTimeout(() => {
          greetingDurationTimers.delete(greeting.id);
          // Auto-hide does not persist dismissal — the card just disappears
          // until the next navigation/render.
          dismissGreetingCard(card, greeting.id, false);
        }, delayMs + durationMs);
        greetingDurationTimers.set(greeting.id, hideTimer);
      }
    }
  }

  function hideGreetingStack(): void {
    clearGreetingTimers();
    const cards = greetingStack.querySelectorAll(".rm-greeting-card");
    cards.forEach((c) => c.classList.add("dismissed"));
  }

  // ─── Server Sync for Identity/Metadata ──────────────────────────────────────

  async function syncIdentityToServer() {
    if (!conversationId) return;
    const identitySession = identitySessions.capture();
    const requestedConversationId = conversationId;
    try {
      await fetch(
        `${baseUrl}/api/widget/${projectSlug}/conversations/${requestedConversationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          signal: identitySession.signal,
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
    const identitySession = identitySessions.capture();
    const requestedConversationId = conversationId;
    try {
      const deviceMeta = collectDeviceMetadata();
      const merged = { ...deviceMeta, ...customMetadata };
      await fetch(
        `${baseUrl}/api/widget/${projectSlug}/conversations/${requestedConversationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          signal: identitySession.signal,
          body: JSON.stringify({ metadata: merged }),
        },
      );
    } catch {
      // Silently ignore sync errors
    }
  }

  async function identifySignedCustomer(token: string): Promise<void> {
    const identitySession = identitySessions.capture();
    const requestVisitorId = visitorId;
    const requestedConversationId = conversationId;
    return identitySessions.enqueueSignedIdentify(async () => {
      if (!identitySessions.isCurrent(identitySession)) {
        throw new Error("ReplyMaven customer identification was cancelled");
      }
      try {
        const response = await fetch(
          `${baseUrl}/api/widget/${projectSlug}/identify`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: identitySession.signal,
            body: JSON.stringify({
              visitorId: requestVisitorId,
              ...(requestedConversationId
                ? { conversationId: requestedConversationId }
                : {}),
              token,
            }),
          },
        );
        if (!response.ok) {
          throw new Error(
            `ReplyMaven customer identification was rejected (${response.status})`,
          );
        }
      } catch (error) {
        if (identitySessions.isCurrent(identitySession)) {
          console.warn("[ReplyMaven] Customer identification failed");
        }
        throw error;
      }
    });
  }

  function resetCustomerIdentity(): void {
    identitySessions.rotate();
    closeChatWidget();
    agentChatClient.stop();
    stopHeartbeat();
    disconnectConversationAgent();

    const plan = planCustomerIdentityReset({
      projectSlug: projectSlug!,
      currentVisitorId: visitorId,
      nextUuid: crypto.randomUUID(),
      state: {
        config,
        conversationId,
        conversationStatus,
        visitorInfo,
        customMetadata,
        pageContext,
        messages: agentChatClient.messages(),
        renderedMessageIds: [...renderedMessageIds],
        newestResponseId,
        agentConnected: connectedAgentConversationId !== null,
        agentSessionExpiresAt,
        heartbeat: heartbeatTimer !== null,
        messageDraft: input.value,
        inlineDraft: inlineBarInput.value,
        formDrafts: Array.from(
          formView.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
            "input, textarea",
          ),
        ).map((field) => field.value),
        pendingAttachment: pendingImageFile !== null,
        inputDisabled: input.disabled,
      },
    });
    for (const key of plan.storageKeysToRemove) {
      localStorage.removeItem(key);
    }
    localStorage.setItem("rm_visitor_id", plan.nextState.visitorId);

    visitorId = plan.nextState.visitorId;
    conversationId = null;
    conversationStatus = null;
    visitorInfo = {};
    customMetadata = {};
    pageContext = {};
    renderedMessageIds.clear();
    pendingVisitorMessageIds.clear();
    pendingIncomingResponseIds.clear();
    visitorStatusElsByMessageId.clear();
    lastOutboxStateByMessageId.clear();
    authoritativeMessageIds.clear();
    hasReceivedAgentSnapshot = false;
    newestResponseId = null;
    isSending = false;
    _isHandedOff = false;
    isBanned = false;
    input.value = plan.nextState.messageDraft;
    input.style.height = "auto";
    homeAskInput.value = "";
    inlineBarInput.value = plan.nextState.inlineDraft;
    for (const field of formView.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >("input, textarea")) {
      field.value = "";
    }
    pendingImageFile = null;
    fileInput.value = "";
    imagePreview.classList.remove("visible");
    imagePreviewImg.src = "";
    imagePreviewImg.title = "";
    attachError.classList.remove("visible");
    attachError.textContent = "";
    dropHint.classList.remove("visible");
    attachDragDepth = 0;
    sendBtn.disabled = plan.nextState.inputDisabled;
    input.disabled = plan.nextState.inputDisabled;
    inlineBarInput.disabled = plan.nextState.inputDisabled;
    for (const button of formView.querySelectorAll<HTMLButtonElement>(
      ".rm-form-submit",
    )) {
      button.disabled = false;
      button.textContent = "Send message";
    }
    messagesContainer.replaceChildren(typingRow);
    previewStack.replaceChildren();
    clearUnreadBadge();
    hideTyping();
    syncConversationModeUi();
    showHomeScreen();

    void restoreConversation();
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
    reportDelivered();
    markConversationSeen();
    // Hide message preview — opening the chat marks the previewed response seen.
    hideMessagePreview();
    // Hide greeting stack without dismissing — re-shows when chat closes.
    hideGreetingStack();
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
    ensureLatestMessageVisible();
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
    // Re-render greetings (skip dismissed ones) when no active conversation.
    if (!conversationId) {
      renderGreetings();
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
      token?: string;
      name?: string;
      email?: string;
      phone?: string;
      metadata?: Record<string, string>;
    }) => {
      if (isSignedIdentityInput(info)) {
        return identifySignedCustomer(info.token);
      }
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
    reset: resetCustomerIdentity,
    setMetadata: (meta: Record<string, string>) => {
      customMetadata = { ...customMetadata, ...meta };
      if (conversationId) syncMetadataToServer();
    },
    // Hosts pass live app state, so values arrive as numbers and booleans too.
    setPageContext: (ctx: Record<string, unknown>) => {
      pageContext = sanitizePageContext(ctx);
    },
    requestNotifications: () => {
      requestNotificationPermission();
    },
    openInquiryForm: () => {
      // Legacy public API name — kept for embedded widgets already in the wild.
      if (!isOpen) openChatWidget();
      showFormScreen();
    },
    openTicketForm: () => {
      if (!isOpen) openChatWidget();
      showFormScreen();
    },
    showGreetings: () => {
      renderGreetings({ force: true });
    },
    dismissGreeting: (id?: string) => {
      if (id) {
        const card = greetingStack.querySelector(
          `[data-greeting-id="${id}"]`,
        ) as HTMLElement | null;
        if (card) {
          dismissGreetingCard(card, id, true);
        } else {
          addDismissedGreetingId(id);
        }
        return;
      }
      const cards = Array.from(
        greetingStack.querySelectorAll(".rm-greeting-card"),
      ) as HTMLElement[];
      for (const card of cards) {
        const cardId = card.getAttribute("data-greeting-id");
        if (cardId) dismissGreetingCard(card, cardId, true);
      }
    },
  };

  // ─── Initialize ─────────────────────────────────────────────────────────────
  loadConfig().then(() => {
    // After config is loaded, try to restore an existing conversation
    restoreConversation();
  });
})();
