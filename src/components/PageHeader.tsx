import { ArrowLeft } from "lucide-react";
import { useMobileSidebar } from "@/lib/mobile-sidebar";

/**
 * Small back-arrow button that opens the sidebar on mobile.
 * Drop this into any page header area.
 */
export function MobileMenuButton() {
  const { openSidebar } = useMobileSidebar();

  return (
    <button
      onClick={openSidebar}
      className="p-1.5 -ml-1.5 rounded-lg hover:bg-accent text-muted-foreground md:hidden shrink-0"
      aria-label="Open menu"
    >
      <ArrowLeft className="w-5 h-5" />
    </button>
  );
}
