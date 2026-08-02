import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check,
  Code,
  Copy,
  Globe,
  KeyRound,
  Loader2,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import PageVisibilityInput from "@/components/PageVisibilityInput";
import {
  WidgetPageShell,
  WidgetPreviewPanel,
  WidgetSectionCard,
  WidgetSettingsLoading,
} from "@/components/WidgetSettings";
import { useWidgetSettings } from "@/hooks/use-widget-settings";
import {
  identityBrowserSnippet,
  identityServerSnippet,
} from "@/lib/widget-installation-snippets";

const PAGE_TITLE = "Installation";
const PAGE_DESCRIPTION =
  "Embed the widget on your site and control which pages it appears on.";

function WidgetInstallation() {
  const { projectId } = useParams<{ projectId: string }>();
  const state = useWidgetSettings(projectId ?? "");
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
    enabled: Boolean(projectId),
  });

  const rotateSecret = useMutation({
    mutationFn: async () => {
      const response = await fetch(
        `/api/projects/${projectId}/customer-identity-secret/rotate`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("Could not rotate customer signing secret");
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

  if (state.isLoading) {
    return (
      <WidgetSettingsLoading
        title={PAGE_TITLE}
        description={PAGE_DESCRIPTION}
      />
    );
  }

  const widgetPages = (state.form.allowedPages ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  function setWidgetPages(next: string[]) {
    state.updateForm({
      allowedPages: next.length > 0 ? next.join(",") : null,
    });
  }

  function copyEmbedSnippet() {
    navigator.clipboard.writeText(state.embedSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

  function copyIdentitySecret(): void {
    if (!identitySecret) return;
    navigator.clipboard.writeText(identitySecret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2_000);
  }

  return (
    <WidgetPageShell
      title={PAGE_TITLE}
      description={PAGE_DESCRIPTION}
      save={state.save}
      sidebar={
        <WidgetPreviewPanel
          iframeRef={state.iframeRef}
          position={state.form.position}
          previewHtml={state.previewHtml}
          previewMode={state.previewMode}
          setPreviewMode={state.setPreviewMode}
          pagePath={state.previewPagePath}
          onPagePathChange={state.setPreviewPagePath}
          onReplay={state.replayPreview}
        />
      }
    >
      <WidgetSectionCard
        title="Embed Code"
        description="Add this script tag to your website's HTML, just before the closing </body> tag."
        icon={Code}
      >
        <div className="relative">
          <pre className="bg-muted/50 rounded-xl p-3 pr-12 text-xs font-mono overflow-x-auto">
            {state.embedSnippet}
          </pre>
          <button
            onClick={copyEmbedSnippet}
            className="absolute top-1.5 right-1.5 p-1.5 rounded-lg bg-background hover:bg-muted"
            title="Copy embed code"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-green-600" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          The widget loads asynchronously and won't slow down your site.
        </p>
      </WidgetSectionCard>

      <WidgetSectionCard
        title="Customer continuity"
        description="Sign customer data on your server so the widget can safely keep support threads together across devices."
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
                  The plaintext is shown once. Store it only in your server-side
                  secret manager—never in browser code.
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
                  onClick={copyIdentitySecret}
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
              Fill these fields from your own authenticated user record whenever
              they are available. Start with a stable external ID, then include
              email, name, phone, and custom fields as your app learns them.
              Tokens should live for 15 minutes and may never exceed one hour.
            </p>
          </div>
          <pre className="overflow-x-auto rounded-xl bg-muted/50 p-3 text-xs font-mono leading-5">
            {identityServerSnippet}
          </pre>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Identify through the user lifecycle</p>
            <p className="mt-1 text-pretty text-xs text-muted-foreground">
              Call identify as soon as authenticated data exists. Fetch a fresh
              token and identify again after profile or account fields change.
              The stable external ID keeps every device on the same customer.
            </p>
          </div>
          <pre className="overflow-x-auto rounded-xl bg-muted/50 p-3 text-xs font-mono leading-5">
            {identityBrowserSnippet}
          </pre>
        </div>

        <div className="rounded-2xl bg-muted/35 p-4">
          <p className="text-sm font-medium">Trust boundary</p>
          <ul className="mt-2 space-y-1.5 text-pretty text-xs text-muted-foreground">
            <li>The signing secret never belongs in browser code.</li>
            <li>Use your stable application user ID as externalId whenever possible.</li>
            <li>Unsigned name or email updates only the current thread and cannot attach earlier threads.</li>
            <li>Call reset before logout or account switching on shared browsers.</li>
          </ul>
        </div>
      </WidgetSectionCard>

      <WidgetSectionCard
        title="Page Visibility"
        description="Control which pages the widget appears on."
        icon={Globe}
      >
        <PageVisibilityInput
          value={widgetPages}
          onChange={setWidgetPages}
          emptyHint="No page rules set. The widget will show on all pages."
        />
      </WidgetSectionCard>
    </WidgetPageShell>
  );
}

export default WidgetInstallation;
