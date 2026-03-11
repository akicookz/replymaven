import { createContext, useContext } from "react";

interface MobileSidebarContextValue {
  openSidebar: () => void;
}

export const MobileSidebarContext = createContext<MobileSidebarContextValue>({
  openSidebar: () => {},
});

export function useMobileSidebar() {
  return useContext(MobileSidebarContext);
}
