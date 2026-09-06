import type { PostHog } from "posthog-js";

const POSTHOG_HOST_US = "https://us.i.posthog.com";
// Public project token (phc_). Safe in the SPA bundle.
const POSTHOG_PROJECT_TOKEN =
  "phc_wg3UZPHCu6Dzz6JpQqPFJc8urCS8cV6RbXqxPqjrGyhr";

const DISABLED_CAPTURE = {
  autocapture: false,
  capture_pageview: false as const,
  disable_session_recording: true,
};

const ENABLED_CAPTURE = {
  autocapture: true,
  capture_pageview: true as const,
  disable_session_recording: false,
};

let client: PostHog | null = null;
let initPromise: Promise<PostHog> | null = null;

export function isFirstPartyAnalyticsPath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname.startsWith("/app/onboarding")) return true;
  if (pathname.startsWith("/app/new-project")) return true;
  if (pathname === "/blog" || pathname.startsWith("/blog/")) return true;
  return false;
}

async function loadClient(): Promise<PostHog> {
  if (client) return client;
  if (initPromise) return initPromise;

  initPromise = import("posthog-js").then(({ default: posthog }) => {
    posthog.init(POSTHOG_PROJECT_TOKEN, {
      api_host: POSTHOG_HOST_US,
      defaults: "2026-01-30",
      person_profiles: "identified_only",
      capture_pageview: true,
      capture_pageleave: true,
      session_recording: { maskAllInputs: true },
    });
    client = posthog;
    return posthog;
  });

  return initPromise;
}

export async function syncPostHogForPath(
  pathname: string,
  user: { id: string; email?: string | null; name?: string | null } | null,
): Promise<void> {
  if (!isFirstPartyAnalyticsPath(pathname)) {
    if (client) {
      client.stopSessionRecording();
      client.set_config(DISABLED_CAPTURE);
    }
    return;
  }

  const posthog = await loadClient();

  if (!isFirstPartyAnalyticsPath(window.location.pathname)) {
    posthog.stopSessionRecording();
    posthog.set_config(DISABLED_CAPTURE);
    return;
  }

  posthog.set_config(ENABLED_CAPTURE);
  posthog.startSessionRecording();
  if (user) {
    posthog.identify(user.id, {
      email: user.email ?? undefined,
      name: user.name ?? undefined,
    });
  }
}

export function resetFirstPartyPostHog(): void {
  client?.reset();
}
