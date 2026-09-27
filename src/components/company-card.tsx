import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RowCard } from "@/components/ui/row-card";
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetHeaderActions,
  SheetHeaderContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface CompanySettings {
  companyName: string | null;
  companyUrl: string | null;
  companyContext: string | null;
  workingHours: string | null;
  avgResponseTime: string | null;
}

interface CompanyForm {
  companyName: string;
  companyUrl: string;
  companyContext: string;
  workingHours: string;
  avgResponseTime: string;
}

function formFrom(settings: CompanySettings): CompanyForm {
  return {
    companyName: settings.companyName ?? "",
    companyUrl: settings.companyUrl ?? "",
    companyContext: settings.companyContext ?? "",
    workingHours: settings.workingHours ?? "",
    avgResponseTime: settings.avgResponseTime ?? "",
  };
}

function companySummary(form: CompanyForm): string {
  const host = form.companyUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const parts = [form.companyName, host, form.workingHours].filter((part) => part.trim() !== "");
  return parts.length > 0 ? parts.join(" · ") : "Add your company details";
}

const EMPTY_FORM: CompanyForm = {
  companyName: "",
  companyUrl: "",
  companyContext: "",
  workingHours: "",
  avgResponseTime: "",
};

export function CompanyCard({
  projectId,
  hasResources,
}: {
  projectId: string;
  hasResources: boolean;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CompanyForm>(EMPTY_FORM);
  const [open, setOpen] = useState(false);

  const { data: settings } = useQuery<CompanySettings>({
    queryKey: ["project-settings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/settings`);
      if (!res.ok) throw new Error("Failed to fetch project settings");
      return res.json();
    },
    enabled: Boolean(projectId),
  });

  const saved = settings ? formFrom(settings) : EMPTY_FORM;
  const dirty = (Object.keys(form) as (keyof CompanyForm)[]).some(
    (key) => form[key] !== saved[key],
  );

  function update(patch: Partial<CompanyForm>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: form.companyName.trim() || null,
          companyUrl: form.companyUrl.trim() || null,
          companyContext: form.companyContext.trim() || null,
          workingHours: form.workingHours.trim() || null,
          avgResponseTime: form.avgResponseTime.trim() || null,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to save company details");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-settings", projectId] });
      setOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const refreshContext = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/context/refresh`, {
        method: "POST",
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to refresh context");
      }
      return res.json() as Promise<{ context: string; source: "resources" | "website" }>;
    },
    onSuccess: (data) => {
      update({ companyContext: data.context });
      queryClient.invalidateQueries({ queryKey: ["project-settings", projectId] });
      toast.success(
        data.source === "resources"
          ? "Company context regenerated from sources"
          : "Company context refreshed from website",
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canRefreshContext = hasResources || Boolean(form.companyUrl.trim());

  function openDrawer() {
    setForm(saved);
    setOpen(true);
  }

  return (
    <>
      <RowCard
        icon={<Building2 className="size-4" />}
        title="Company"
        summary={companySummary(saved)}
        onClick={openDrawer}
      />

      <Sheet open={open} onOpenChange={(next) => !save.isPending && setOpen(next)}>
        <SheetContent side="right" aria-describedby={undefined} className="sm:max-w-xl">
          <SheetHeader>
            <SheetHeaderContent>
              <SheetTitle>Company</SheetTitle>
            </SheetHeaderContent>
            <SheetHeaderActions>
              <SheetCloseButton label="Close company details" />
            </SheetHeaderActions>
          </SheetHeader>

          <SheetBody className="space-y-5 px-6 py-5">
            <p className="text-sm text-muted-foreground">
              Maven reads this on every reply, before searching sources.
            </p>
            <div className="space-y-2">
              <Label htmlFor="company-name">Company name</Label>
              <Input
                id="company-name"
                value={form.companyName}
                onChange={(e) => update({ companyName: e.target.value })}
                placeholder="Your company name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-url">Website URL</Label>
              <Input
                id="company-url"
                type="url"
                value={form.companyUrl}
                onChange={(e) => update({ companyUrl: e.target.value })}
                placeholder="https://example.com"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="company-context">Company context</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => refreshContext.mutate()}
                  disabled={refreshContext.isPending || !canRefreshContext}
                  className="-mr-2"
                >
                  <RefreshCw className={cn("size-4", refreshContext.isPending && "animate-spin")} />
                  {hasResources ? "Regenerate" : "Refresh"}
                </Button>
              </div>
              <Textarea
                id="company-context"
                value={form.companyContext}
                onChange={(e) => update({ companyContext: e.target.value })}
                rows={8}
                placeholder="Describe your business, products, policies, and anything Maven should know."
                className="min-h-0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="working-hours">
                Working hours
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="working-hours"
                value={form.workingHours}
                onChange={(e) => update({ workingHours: e.target.value.slice(0, 200) })}
                placeholder="e.g. Mon-Fri, 9:00-18:00 CET"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="avg-response-time">
                Average response time
                <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="avg-response-time"
                value={form.avgResponseTime}
                onChange={(e) => update({ avgResponseTime: e.target.value.slice(0, 200) })}
                placeholder="e.g. under 2 hours on business days"
              />
            </div>
          </SheetBody>

          <SheetFooter>
            <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
              {save.isPending && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
