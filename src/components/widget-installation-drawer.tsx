import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  Code,
  Copy,
  KeyRound,
  Loader2,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { WidgetSectionCard } from "@/components/WidgetSettings";
import {
  identityBrowserSnippet,
  identityServerSnippet,
} from "@/lib/widget-installation-snippets";

interface WidgetInstallationDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  embedSnippet: string;
}

export function WidgetInstallationDrawer({
  open,
  onOpenChange,
  projectId,
  embedSnippet,
}: WidgetInstallationDrawerProps) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [identitySecret, setIdentitySecret] = useState<string | null>(null);

  const { data: identitySettings } = useQuery<{
    customerIdentitySecretConfigured: boolean;
  }>({
    queryKey: ["project-settings", projectId],
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/settings`);
      if (!response.ok) throw new Error("Failed to load signing settings");
      return response.json();
    },
    enabled: open && Boolean(projectId),
  });

  const rotateSecret = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/projects/${projectId}/customer-identity-secret/rotate`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error("Could not rotate customer signing secret");
      }
      return response.json() as Promise<{ configured: true; secret: string }>;
    },
    onSuccess(result) {
      setIdentitySecret(result.secret);
      queryClient.invalidateQueries({
        queryKey: ["project-settings", projectId],
      });
      toast.success("Customer signing secret ready");
    },
    onError() {
      toast.error("Could not rotate customer signing secret");
    },
  });

  async function copyText(value: string, kind: "embed" | "secret") {
    try {
      await navigator.clipboard.writeText(value);
      if (kind === "embed") setCopied(true);
      else setCopiedSecret(true);
      window.setTimeout(() => {
        if (kind === "embed") setCopied(false);
        else setCopiedSecret(false);
      }, 2_000);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  function handleSecretAction(): void {
    if (
      identitySettings?.customerIdentitySecretConfigured &&
      !window.confirm(
        "Rotate this secret? Newly presented tokens signed with the old secret will stop working.",
      )
    ) {
      return;
    }
    rotateSecret.mutate();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-hidden p-0 sm:max-w-2xl"
      >
        <SheetHeader className="px-6 pb-4 pt-6 pr-14">
          <SheetTitle className="text-balance text-lg">Installation</SheetTitle>
          <SheetDescription className="text-pretty">
            Install the widget and securely connect signed customer identity.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-8">
          <WidgetSectionCard
            title="Embed Code"
            description="Add this script tag just before your site's closing body tag."
            icon={Code}
          >
            <div className="relative">
              <pre className="overflow-x-auto rounded-xl bg-muted/50 p-3 pr-14 font-mono text-xs">
                {embedSnippet}
              </pre>
              <button
                type="button"
                onClick={() => void copyText(embedSnippet, "embed")}
                className="absolute right-1.5 top-1.5 flex size-10 items-center justify-center rounded-lg bg-background transition-[background-color,scale] hover:bg-muted active:scale-[0.96]"
                aria-label="Copy embed code"
              >
                {copied ? (
                  <Check className="size-4 text-emerald-400" />
                ) : (
                  <Copy className="size-4" />
                )}
              </button>
            </div>
            <p className="text-pretty text-xs text-muted-foreground">
              The widget loads asynchronously and won&apos;t slow down your site.
            </p>
          </WidgetSectionCard>

          <WidgetSectionCard
            title="Customer continuity"
            description="Sign customer data on your server so support threads stay together across devices."
            icon={ShieldCheck}
          >
            <div className="rounded-2xl bg-muted/40 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.05)]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/12 text-brand">
                    <KeyRound className="size-4" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {identitySettings?.customerIdentitySecretConfigured
                        ? "Customer signing secret configured"
                        : "Create a customer signing secret"}
                    </p>
                    <p className="mt-0.5 text-pretty text-xs text-muted-foreground">
                      The plaintext is shown once. Store it only in your
                      server-side secret manager—never in browser code.
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSecretAction}
                  disabled={rotateSecret.isPending}
                  className="min-h-10 shrink-0 transition-transform duration-150 ease-out active:scale-[0.96]"
                >
                  {rotateSecret.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <RotateCcw />
                  )}
                  {identitySettings?.customerIdentitySecretConfigured
                    ? "Rotate secret"
                    : "Create secret"}
                </Button>
              </div>

              {identitySecret ? (
                <div className="mt-4 rounded-xl bg-background/65 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <code className="min-w-0 break-all text-xs text-foreground">
                      {identitySecret}
                    </code>
                    <button
                      type="button"
                      onClick={() => void copyText(identitySecret, "secret")}
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/55 transition-[background-color,scale] duration-150 ease-out hover:bg-muted active:scale-[0.96]"
                      aria-label="Copy customer signing secret"
                    >
                      {copiedSecret ? (
                        <Check className="size-4 text-emerald-400" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </button>
                  </div>
                  <p className="mt-2 text-pretty text-xs font-medium text-amber-300">
                    Copy this now. ReplyMaven will not show it again.
                  </p>
                </div>
              ) : null}
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">Sign on your server</p>
                <p className="mt-1 text-pretty text-xs text-muted-foreground">
                  Fill these fields from your authenticated user record. Start
                  with a stable external ID, then include email, name, phone,
                  and custom fields as they become available. Tokens should
                  live for 15 minutes and may never exceed one hour.
                </p>
              </div>
              <pre className="overflow-x-auto rounded-xl bg-muted/50 p-3 font-mono text-xs leading-5">
                {identityServerSnippet}
              </pre>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium">
                  Identify through the user lifecycle
                </p>
                <p className="mt-1 text-pretty text-xs text-muted-foreground">
                  Identify as soon as authenticated data exists. Fetch a fresh
                  token and identify again after profile or account fields
                  change. The stable external ID keeps every device together.
                </p>
              </div>
              <pre className="overflow-x-auto rounded-xl bg-muted/50 p-3 font-mono text-xs leading-5">
                {identityBrowserSnippet}
              </pre>
            </div>

            <div className="rounded-2xl bg-muted/35 p-4">
              <p className="text-sm font-medium">Trust boundary</p>
              <ul className="mt-2 space-y-1.5 text-pretty text-xs text-muted-foreground">
                <li>The signing secret never belongs in browser code.</li>
                <li>Prefer your stable application user ID as externalId.</li>
                <li>
                  Unsigned identity updates only the current thread and cannot
                  attach earlier threads.
                </li>
                <li>Call reset before logout or account switching.</li>
              </ul>
            </div>
          </WidgetSectionCard>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default WidgetInstallationDrawer;
