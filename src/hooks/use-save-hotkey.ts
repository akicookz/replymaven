import { useEffect, useRef } from "react";

export function isSaveHotkey(event: KeyboardEvent): boolean {
  if (event.key !== "s" && event.key !== "S") return false;
  if (!event.metaKey && !event.ctrlKey) return false;
  if (event.shiftKey || event.altKey) return false;
  return true;
}

export function useSaveHotkey(onSave: () => void) {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isSaveHotkey(event)) return;
      event.preventDefault();
      if (event.repeat) return;
      onSaveRef.current();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
