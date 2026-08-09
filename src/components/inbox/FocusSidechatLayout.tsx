import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FocusSidechatLayoutProps {
  sidechatOpen: boolean;
  focusView: ReactNode;
  sidechatPane: ReactNode;
}

export default function FocusSidechatLayout({
  sidechatOpen,
  focusView,
  sidechatPane,
}: FocusSidechatLayoutProps) {
  return (
    <div
      data-focus-sidechat-layout
      className="-m-4 flex h-screen min-w-0 overflow-hidden md:-m-8"
    >
      <div
        data-focus-view-shell
        className={cn(
          "min-w-0 flex-1",
          sidechatOpen && "hidden md:block",
        )}
      >
        {focusView}
      </div>
      {sidechatPane}
    </div>
  );
}
