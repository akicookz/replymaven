import { useState } from "react";
import { BubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Check,
  ChevronDown,
  Italic,
  Code,
  Link as LinkIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface EditorBubbleMenuProps {
  editor: Editor;
}

const TEXT_STYLES = [
  { id: "body", label: "Body", short: "Body" },
  { id: "h1", label: "Heading 1", short: "H1" },
  { id: "h2", label: "Heading 2", short: "H2" },
  { id: "h3", label: "Heading 3", short: "H3" },
] as const;

type TextStyleId = (typeof TEXT_STYLES)[number]["id"];

function activeTextStyle(editor: Editor): TextStyleId {
  if (editor.isActive("heading", { level: 1 })) return "h1";
  if (editor.isActive("heading", { level: 2 })) return "h2";
  if (editor.isActive("heading", { level: 3 })) return "h3";
  return "body";
}

function applyTextStyle(editor: Editor, id: TextStyleId) {
  const chain = editor.chain().focus();
  if (id === "body") {
    chain.setParagraph().run();
    return;
  }
  const levels = { h1: 1, h2: 2, h3: 3 } as const;
  chain.setHeading({ level: levels[id] }).run();
}

export function EditorBubbleMenu({ editor }: EditorBubbleMenuProps) {
  const [styleOpen, setStyleOpen] = useState(false);

  function setLink() {
    const previous = (editor.getAttributes("link").href as string | undefined) ?? "";
    const url = window.prompt("Link URL", previous || "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }

  const style = TEXT_STYLES.find((item) => item.id === activeTextStyle(editor));

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor, from, to }) => {
        if (styleOpen) return true;
        if (from === to) return false;
        if (editor.isActive("image")) return false;
        if (editor.isActive("codeBlock")) return false;
        return true;
      }}
    >
      <div className="bubble-menu">
        <DropdownMenu modal={false} open={styleOpen} onOpenChange={setStyleOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="bubble-menu-btn is-label"
              aria-label="Text style"
              title="Text style"
              onMouseDown={(e) => e.preventDefault()}
            >
              {style?.short ?? "Body"}
              <ChevronDown className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="min-w-[10rem] rounded-xl p-1"
            onCloseAutoFocus={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
          >
            {TEXT_STYLES.map((item) => {
              const active = item.id === (style?.id ?? "body");
              return (
                <DropdownMenuItem
                  key={item.id}
                  className="gap-2 rounded-lg"
                  onSelect={() => applyTextStyle(editor, item.id)}
                >
                  <span className="flex-1">{item.label}</span>
                  {active ? (
                    <Check className="w-3.5 h-3.5 text-foreground" />
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <BubbleButton
          label="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="w-4 h-4" />
        </BubbleButton>
        <BubbleButton
          label="Italic"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="w-4 h-4" />
        </BubbleButton>
        <BubbleButton
          label="Inline code"
          active={editor.isActive("code")}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <Code className="w-4 h-4" />
        </BubbleButton>
        <BubbleButton
          label="Link"
          active={editor.isActive("link")}
          onClick={setLink}
        >
          <LinkIcon className="w-4 h-4" />
        </BubbleButton>
      </div>
    </BubbleMenu>
  );
}

interface BubbleButtonProps {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function BubbleButton({ label, active, onClick, children }: BubbleButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "bubble-menu-btn",
        active && "is-active",
      )}
    >
      {children}
    </button>
  );
}
