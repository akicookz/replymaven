import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DashboardCommandMenu } from "@/components/commands/DashboardCommandMenu";
import {
  cancelPendingSequence,
  classifyActivationSurface,
  decideKeyActivation,
  IDLE_PENDING,
  type ActivationTargetDescriptor,
  type CommandPlatform,
  type DashboardCommandContext,
  type DashboardCommandIntent,
  type InboxCommandScope,
  type KeyEventInput,
  type PendingKeySequence,
} from "@/lib/commands/dashboard-command-domain";
import { dashboardNav } from "@/lib/dashboard/nav";

export interface InboxCommandRegistration {
  scope: InboxCommandScope;
  execute: (intent: DashboardCommandIntent) => void;
}

interface DashboardCommandApi {
  registerInbox: (registration: InboxCommandRegistration | null) => void;
}

const DashboardCommandApiContext = createContext<DashboardCommandApi | null>(
  null,
);

function detectPlatform(): CommandPlatform {
  if (typeof navigator === "undefined") return "other";
  return /mac/i.test(navigator.platform) ? "macos" : "other";
}

function toKeyEventInput(
  event: KeyboardEvent,
  platform: CommandPlatform,
): KeyEventInput {
  return {
    key: event.key,
    keyCode: event.keyCode,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    repeat: event.repeat,
    defaultPrevented: event.defaultPrevented,
    isComposing: event.isComposing,
    platform,
  };
}

export function describeActivationTarget(
  target: EventTarget | null,
): ActivationTargetDescriptor {
  const element = target instanceof Element ? target : null;
  const html = target instanceof HTMLElement ? target : null;
  const layerAttr = element
    ?.closest("[data-command-layer]")
    ?.getAttribute("data-command-layer");
  const composerAttr = element
    ?.closest("[data-command-composer]")
    ?.getAttribute("data-command-composer");

  let commandLayer: ActivationTargetDescriptor["commandLayer"] = null;
  if (layerAttr === "command-menu") {
    commandLayer = "command-menu";
  } else if (layerAttr === "blocking") {
    commandLayer = "blocking";
  } else if (
    typeof document !== "undefined" &&
    document.querySelector("[data-command-layer='blocking']")
  ) {
    commandLayer = "blocking";
  }

  let composer: ActivationTargetDescriptor["composer"] = null;
  if (composerAttr === "public" || composerAttr === "sidechat") {
    composer = composerAttr;
  }

  return {
    tagName: html?.tagName ?? "",
    contentEditable: html?.getAttribute("contenteditable") ?? null,
    isContentEditable: html?.isContentEditable ?? false,
    role: html?.getAttribute("role") ?? null,
    tabIndex: html == null ? null : html.tabIndex,
    commandLayer,
    composer,
    inSidechatPane: Boolean(element?.closest("[data-sidechat-pane]")),
  };
}

function applyPending(
  pendingRef: { current: PendingKeySequence },
  timerRef: { current: number },
  next: PendingKeySequence,
) {
  pendingRef.current = next;
  window.clearTimeout(timerRef.current);
  if (next.status !== "waiting") return;
  timerRef.current = window.setTimeout(() => {
    pendingRef.current = cancelPendingSequence();
  }, Math.max(0, next.expiresAt - Date.now()));
}

export function useRegisterInboxCommands(
  registration: InboxCommandRegistration | null,
): void {
  const api = useContext(DashboardCommandApiContext);

  useEffect(() => {
    if (api == null) return;
    api.registerInbox(registration);
    return () => api.registerInbox(null);
  }, [api, registration]);

  if (api == null) {
    throw new Error(
      "useRegisterInboxCommands requires DashboardCommandProvider",
    );
  }
}

export function DashboardCommandProvider({
  projectId,
  children,
}: {
  projectId: string | null;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const platform = useMemo(() => detectPlatform(), []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [inboxRegistration, setInboxRegistration] =
    useState<InboxCommandRegistration | null>(null);
  const pendingRef = useRef<PendingKeySequence>(IDLE_PENDING);
  const timerRef = useRef(0);
  const restoreFocusRef = useRef<Element | null>(null);
  const menuOpenRef = useRef(menuOpen);
  const inboxRef = useRef(inboxRegistration);
  menuOpenRef.current = menuOpen;
  inboxRef.current = inboxRegistration;

  const registerInbox = useCallback(
    (registration: InboxCommandRegistration | null) => {
      setInboxRegistration(registration);
    },
    [],
  );
  const api = useMemo<DashboardCommandApi>(
    () => ({ registerInbox }),
    [registerInbox],
  );

  const scope = inboxRegistration?.scope
    ?? (projectId != null ? { kind: "dashboard" as const, projectId } : null);

  const commandContext: DashboardCommandContext | null = scope == null
    ? null
    : {
        scope,
        platform,
        menuOpen,
        pending: pendingRef.current,
        nowMs: Date.now(),
      };

  const navItems = projectId == null
    ? []
    : dashboardNav({
        projectId,
        pathname: location.pathname,
        search: location.search,
      });

  const closeMenuAndRestoreFocus = useCallback(() => {
    setMenuOpen(false);
    const node = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (node instanceof HTMLElement) {
      requestAnimationFrame(() => {
        node.focus();
      });
    }
  }, []);

  const executeIntent = useCallback((intent: DashboardCommandIntent) => {
    if (intent.type === "toggle-command-menu") {
      if (menuOpenRef.current) {
        closeMenuAndRestoreFocus();
        return;
      }
      restoreFocusRef.current = document.activeElement;
      applyPending(pendingRef, timerRef, cancelPendingSequence());
      setMenuOpen(true);
      return;
    }
    if (intent.type === "navigate") {
      closeMenuAndRestoreFocus();
      navigate(intent.href);
      return;
    }
    inboxRef.current?.execute(intent);
  }, [closeMenuAndRestoreFocus, navigate]);

  const executeIntentRef = useRef(executeIntent);
  executeIntentRef.current = executeIntent;

  function setMenuOpenFromUi(open: boolean) {
    if (open) {
      restoreFocusRef.current = document.activeElement;
      applyPending(pendingRef, timerRef, cancelPendingSequence());
      setMenuOpen(true);
      return;
    }
    closeMenuAndRestoreFocus();
  }

  useEffect(() => {
    applyPending(pendingRef, timerRef, cancelPendingSequence());
  }, [location.pathname, location.search]);

  useEffect(() => {
    function cancel() {
      applyPending(pendingRef, timerRef, cancelPendingSequence());
    }

    function onVisibility() {
      if (document.visibilityState === "hidden") cancel();
    }

    function onMutation() {
      if (document.querySelector("[data-command-layer='blocking']")) {
        cancel();
      }
    }

    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", onVisibility);
    const observer = new MutationObserver(onMutation);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-command-layer"],
    });
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
      window.clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (projectId == null) return;
    const activeProjectId = projectId;

    function onKeyDown(event: KeyboardEvent) {
      if (menuOpenRef.current) return;
      const surface = classifyActivationSurface(
        describeActivationTarget(event.target),
      );
      const inbox = inboxRef.current;
      const activeScope = inbox?.scope ?? {
        kind: "dashboard" as const,
        projectId: activeProjectId,
      };
      const context: DashboardCommandContext = {
        scope: activeScope,
        platform,
        menuOpen: false,
        pending: pendingRef.current,
        nowMs: Date.now(),
      };
      const decision = decideKeyActivation(
        toKeyEventInput(event, platform),
        surface,
        context,
      );
      applyPending(pendingRef, timerRef, decision.pending);

      if (
        decision.kind === "dispatch" ||
        decision.kind === "consume-prefix" ||
        decision.kind === "cancel-prefix"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      if (decision.kind === "dispatch") {
        executeIntentRef.current(decision.intent);
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [projectId, platform]);

  return (
    <DashboardCommandApiContext.Provider value={api}>
      {children}
      {commandContext != null && (
        <DashboardCommandMenu
          open={menuOpen}
          onOpenChange={setMenuOpenFromUi}
          context={commandContext}
          navItems={navItems}
          platform={platform}
          onExecute={executeIntent}
        />
      )}
    </DashboardCommandApiContext.Provider>
  );
}
