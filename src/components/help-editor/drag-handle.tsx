import { DragHandle } from "@tiptap/extension-drag-handle";

const GRIP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;

export function createHelpDragHandle() {
  return DragHandle.configure({
    render() {
      const element = document.createElement("div");
      element.className = "help-editor-drag-handle";
      element.setAttribute("aria-label", "Move block");
      element.innerHTML = GRIP_SVG;
      return element;
    },
    computePositionConfig: {
      placement: "left-start",
      strategy: "absolute",
    },
  });
}
