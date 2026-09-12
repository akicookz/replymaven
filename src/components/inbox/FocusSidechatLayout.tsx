import type { ReactNode } from "react";

interface FocusSidechatLayoutProps {
  focusView: ReactNode;
  sidechatPane: ReactNode;
}

export default function FocusSidechatLayout({
  focusView,
  sidechatPane,
}: FocusSidechatLayoutProps) {
  return (
    <div
      data-focus-sidechat-layout
      className="relative -m-4 flex h-screen min-w-0 overflow-hidden md:-m-8"
    >
      <div data-focus-view-shell className="min-w-0 flex-1">
        {focusView}
      </div>
      {sidechatPane}
    </div>
  );
}
