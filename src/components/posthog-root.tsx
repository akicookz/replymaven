import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useSession } from "@/lib/auth-client";
import { syncPostHogForPath } from "@/lib/posthog";

export function PostHogRoot() {
  const location = useLocation();
  const { data: session } = useSession();
  const user = session?.user ?? null;

  useEffect(() => {
    void syncPostHogForPath(location.pathname, user);
  }, [location.pathname, user]);

  return null;
}
