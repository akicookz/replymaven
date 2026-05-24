import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { Editor, Range } from "@tiptap/core";
import { cn } from "@/lib/utils";
import type { SlashItem } from "./slash-command-items";

export interface SlashMenuRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export interface SlashMenuProps {
  items: SlashItem[];
  command: (item: SlashItem) => void;
  editor: Editor;
  range: Range;
}

export const SlashMenu = forwardRef<SlashMenuRef, SlashMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useEffect(() => {
      itemRefs.current[selectedIndex]?.scrollIntoView({
        block: "nearest",
      });
    }, [selectedIndex]);

    function selectItem(index: number) {
      const item = items[index];
      if (item) command(item);
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "ArrowUp") {
          setSelectedIndex(
            (i) => (i - 1 + Math.max(items.length, 1)) % Math.max(items.length, 1),
          );
          return true;
        }
        if (event.key === "Enter") {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="slash-menu">
          <div className="slash-menu-empty">No matching blocks</div>
        </div>
      );
    }

    return (
      <div className="slash-menu" role="listbox">
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              type="button"
              key={item.id}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              role="option"
              aria-selected={selectedIndex === index}
              onMouseDown={(e) => {
                e.preventDefault();
                selectItem(index);
              }}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                "slash-menu-item",
                selectedIndex === index && "is-selected",
              )}
            >
              <span className="slash-menu-icon">
                <Icon className="w-4 h-4" />
              </span>
              <span className="slash-menu-text">
                <span className="slash-menu-title">{item.title}</span>
                <span className="slash-menu-desc">{item.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    );
  },
);

SlashMenu.displayName = "SlashMenu";
