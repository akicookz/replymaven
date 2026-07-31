import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export { renderMarkdown } from "../../shared/chat-markdown";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
