import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export const WIDGET_CUSTOM_CSS_CLASSES = [
  "rm-widget-container",
  "rm-chat-window",
  "rm-trigger",
  "rm-trigger-badge",
  "rm-header",
  "rm-header-title",
  "rm-header-subtitle",
  "rm-header-avatar",
  "rm-header-close",
  "rm-home",
  "rm-home-title",
  "rm-home-subtitle",
  "rm-home-banner",
  "rm-home-ask",
  "rm-home-ask-input",
  "rm-home-link",
  "rm-messages",
  "rm-message-row",
  "rm-message",
  "rm-input-area",
  "rm-input",
  "rm-send-btn",
  "rm-greeting-card",
  "rm-greeting-title",
  "rm-greeting-desc",
  "rm-quick-topic",
  "rm-powered",
  "rm-inline-bar",
] as const;

export const HELP_CUSTOM_CSS_CLASSES = [
  "help-shell",
  "help-sidebar",
  "help-sidebar-group-name",
  "help-sidebar-leaf",
  "help-main",
  "help-index-title",
  "help-index-subtitle",
  "help-category-card",
  "help-page-title",
  "help-page-subtitle",
  "help-prose",
  "help-toc",
  "help-breadcrumb",
  "help-article-nav",
] as const;

const MAX_SUGGESTIONS = 12;

const MIRROR_STYLE_PROPS = [
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
] as const;

interface ClassToken {
  start: number;
  query: string;
}

interface CaretViewport {
  top: number;
  left: number;
  lineHeight: number;
}

interface CustomCssEditorProps {
  value: string;
  onChange: (value: string) => void;
  classes: readonly string[];
  disabled?: boolean;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  autoFocus?: boolean;
}

function classTokenAt(value: string, caret: number): ClassToken | null {
  const before = value.slice(0, caret);
  const match = /(?:^|[\s,{>+~()])(\.[a-zA-Z0-9_-]*)$/.exec(before);
  if (!match) return null;
  const token = match[1];
  return { start: caret - token.length, query: token.slice(1) };
}

function filterCssClasses(classes: readonly string[], query: string): string[] {
  const q = query.toLowerCase();
  const starts: string[] = [];
  const contains: string[] = [];
  for (const cls of classes) {
    const lower = cls.toLowerCase();
    if (!q) {
      starts.push(cls);
      continue;
    }
    if (lower.startsWith(q)) starts.push(cls);
    else if (lower.includes(q)) contains.push(cls);
  }
  return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
}

function getTextareaCaretViewport(
  textarea: HTMLTextAreaElement,
  position: number,
): CaretViewport {
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.overflow = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  for (const prop of MIRROR_STYLE_PROPS) {
    const kebab = prop.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
    mirror.style.setProperty(kebab, computed[prop]);
  }
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.textContent = textarea.value.slice(0, position);
  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(position) || ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const parsedLineHeight = Number.parseFloat(computed.lineHeight);
  const lineHeight = Number.isFinite(parsedLineHeight)
    ? parsedLineHeight
    : Number.parseFloat(computed.fontSize) * 1.2;
  const top =
    textarea.getBoundingClientRect().top +
    marker.offsetTop -
    textarea.scrollTop +
    Number.parseFloat(computed.borderTopWidth);
  const left =
    textarea.getBoundingClientRect().left +
    marker.offsetLeft -
    textarea.scrollLeft +
    Number.parseFloat(computed.borderLeftWidth);

  mirror.remove();
  return { top, left, lineHeight };
}

export function CustomCssEditor({
  value,
  onChange,
  classes,
  disabled = false,
  placeholder,
  rows = 8,
  maxLength = 5000,
  autoFocus = false,
}: CustomCssEditorProps) {
  const listId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const focusedRef = useRef(false);
  const draftRef = useRef(value);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const [draft, setDraft] = useState(value);
  const [token, setToken] = useState<ClassToken | null>(null);
  const [caretPos, setCaretPos] = useState<CaretViewport | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedIndexRef = useRef(0);
  const matchesRef = useRef<string[]>([]);
  const tokenRef = useRef<ClassToken | null>(null);
  const menuOpenRef = useRef(false);

  draftRef.current = draft;
  valueRef.current = value;
  onChangeRef.current = onChange;
  tokenRef.current = token;

  const matches = token ? filterCssClasses(classes, token.query) : [];
  const menuOpen = !disabled && token !== null && matches.length > 0;
  selectedIndexRef.current = selectedIndex;
  matchesRef.current = matches;
  menuOpenRef.current = menuOpen;

  function commitDraft(): void {
    if (draftRef.current === valueRef.current) return;
    onChangeRef.current(draftRef.current);
  }

  function refreshToken(el: HTMLTextAreaElement): void {
    const next = classTokenAt(el.value, el.selectionStart);
    setToken(next);
    if (next) {
      setCaretPos(getTextareaCaretViewport(el, el.selectionStart));
    } else {
      setCaretPos(null);
    }
  }

  function insertClass(cls: string): void {
    const current = tokenRef.current;
    if (!current) return;
    const inserted = `.${cls}`;
    const caret = current.start + inserted.length;
    setDraft(
      draftRef.current.slice(0, current.start) +
        inserted +
        draftRef.current.slice(current.start + 1 + current.query.length),
    );
    setToken(null);
    setCaretPos(null);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  useEffect(() => {
    return () => {
      commitDraft();
    };
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [token?.query]);

  useEffect(() => {
    const list = listRef.current;
    const item = itemRefs.current[selectedIndex];
    if (!list || !item) return;
    const itemTop = item.offsetTop;
    const itemBottom = itemTop + item.offsetHeight;
    if (itemTop < list.scrollTop) {
      list.scrollTop = itemTop;
    } else if (itemBottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = itemBottom - list.clientHeight;
    }
  }, [selectedIndex, token?.query]);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (!menuOpenRef.current) return;
    const down =
      event.key === "ArrowDown" || event.code === "ArrowDown";
    const up = event.key === "ArrowUp" || event.code === "ArrowUp";
    if (down || up) {
      event.preventDefault();
      event.stopPropagation();
      const count = matchesRef.current.length;
      if (count === 0) return;
      setSelectedIndex((i) =>
        down ? (i + 1) % count : (i - 1 + count) % count,
      );
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      const selected = matchesRef.current[selectedIndexRef.current];
      if (!selected) return;
      event.preventDefault();
      event.stopPropagation();
      insertClass(selected);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setToken(null);
      setCaretPos(null);
    }
  }

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    function onNativeKeyDown(event: globalThis.KeyboardEvent): void {
      if (!menuOpenRef.current) return;
      const down =
        event.key === "ArrowDown" || event.code === "ArrowDown";
      const up = event.key === "ArrowUp" || event.code === "ArrowUp";
      if (down || up) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const count = matchesRef.current.length;
        if (count === 0) return;
        setSelectedIndex((i) =>
          down ? (i + 1) % count : (i - 1 + count) % count,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const selected = matchesRef.current[selectedIndexRef.current];
        if (!selected) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        insertClass(selected);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        setToken(null);
        setCaretPos(null);
      }
    }

    el.addEventListener("keydown", onNativeKeyDown);
    return () => {
      el.removeEventListener("keydown", onNativeKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    function onViewportChange(): void {
      const el = textareaRef.current;
      if (!el) return;
      refreshToken(el);
    }

    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [menuOpen, draft]);

  const openDown =
    caretPos !== null &&
    caretPos.top + caretPos.lineHeight + 240 < window.innerHeight;
  const menuLeft =
    caretPos === null
      ? 0
      : Math.min(Math.max(8, caretPos.left), window.innerWidth - 288);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={draft}
        autoFocus={autoFocus}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          refreshToken(e.target);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.defaultPrevented) return;
          onKeyDown(e);
        }}
        onKeyUp={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") return;
          refreshToken(e.currentTarget);
        }}
        onClick={(e) => refreshToken(e.currentTarget)}
        onScroll={(e) => refreshToken(e.currentTarget)}
        onBlur={(e) => {
          const next = e.relatedTarget;
          if (next instanceof Node && listRef.current?.contains(next)) return;
          focusedRef.current = false;
          setToken(null);
          setCaretPos(null);
          commitDraft();
        }}
        disabled={disabled}
        rows={rows}
        maxLength={maxLength}
        spellCheck={false}
        placeholder={placeholder}
        className={cn(
          "placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-input w-full min-w-0 rounded-lg border bg-input-background px-3 py-2 font-mono text-sm disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          "[outline:none] focus:border-ring focus:[outline:none] focus:ring-0",
        )}
      />
      {menuOpen && caretPos
        ? createPortal(
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              className="slash-menu"
              style={{
                position: "fixed",
                zIndex: 80,
                left: menuLeft,
                top: openDown ? caretPos.top + caretPos.lineHeight + 4 : undefined,
                bottom: openDown
                  ? undefined
                  : window.innerHeight - caretPos.top + 4,
                width: 260,
              }}
            >
              {matches.map((cls, index) => (
                <div
                  id={`${listId}-option-${index}`}
                  key={cls}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  role="option"
                  aria-selected={selectedIndex === index}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertClass(cls);
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    "slash-menu-item font-mono",
                    selectedIndex === index && "is-selected",
                  )}
                >
                  .{cls}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
