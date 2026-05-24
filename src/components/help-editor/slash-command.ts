import { Extension } from "@tiptap/core";
import Suggestion, { type SuggestionOptions } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import tippy, { type Instance as TippyInstance } from "tippy.js";
import {
  buildSlashItems,
  filterSlashItems,
  type SlashItem,
  type SlashItemContext,
} from "./slash-command-items";
import { SlashMenu, type SlashMenuRef } from "./slash-menu";

export interface SlashCommandOptions {
  suggestion: Omit<SuggestionOptions<SlashItem>, "editor">;
}

export function createSlashCommand(ctx: SlashItemContext) {
  const allItems = buildSlashItems(ctx);

  return Extension.create<SlashCommandOptions>({
    name: "slashCommand",

    addOptions() {
      return {
        suggestion: {
          char: "/",
          startOfLine: false,
          allowSpaces: false,
          command: ({ editor, range, props }) => {
            (props as SlashItem).command({ editor, range });
          },
          items: ({ query }) => filterSlashItems(allItems, query),
          render: () => {
            let component: ReactRenderer<SlashMenuRef> | null = null;
            let popup: TippyInstance | null = null;
            return {
              onStart: (props) => {
                component = new ReactRenderer(SlashMenu, {
                  props,
                  editor: props.editor,
                });

                if (!props.clientRect) return;
                popup = tippy(document.body, {
                  getReferenceClientRect: () =>
                    props.clientRect?.() ?? new DOMRect(0, 0, 0, 0),
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: "manual",
                  placement: "bottom-start",
                  arrow: false,
                  offset: [0, 6],
                  theme: "slash",
                });
              },
              onUpdate: (props) => {
                component?.updateProps(props);
                if (popup && props.clientRect) {
                  popup.setProps({
                    getReferenceClientRect: () =>
                      props.clientRect?.() ?? new DOMRect(0, 0, 0, 0),
                  });
                }
              },
              onKeyDown: (props) => {
                if (props.event.key === "Escape") {
                  popup?.hide();
                  return true;
                }
                return component?.ref?.onKeyDown(props.event) ?? false;
              },
              onExit: () => {
                popup?.destroy();
                popup = null;
                component?.destroy();
                component = null;
              },
            };
          },
        },
      };
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion,
        }),
      ];
    },
  });
}
