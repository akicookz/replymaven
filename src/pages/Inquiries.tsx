import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Inbox,
  AlertCircle,
  Copy,
  Check,
  Sparkles,
  ChevronDown,
  ArrowLeft,
  Loader2,
  Mail,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { MobileMenuButton } from "@/components/PageHeader";
import { DetailsPanel } from "@/components/DetailsPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InquirySubmission {
  id: string;
  visitorId: string | null;
  data: Record<string, string>;
  status: "new" | "replied" | "closed";
  createdAt: string;
}

interface ComposeReply {
  subject: string;
  body: string;
}

type MailClient = "default" | "gmail" | "outlook" | "proton";

const MAIL_CLIENTS: { key: MailClient; label: string }[] = [
  { key: "default", label: "Default" },
  { key: "gmail", label: "Gmail" },
  { key: "outlook", label: "Outlook" },
  { key: "proton", label: "Proton Mail" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTimeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getPrimaryField(
  data: Record<string, string>,
): { label: string; value: string } | null {
  for (const key of Object.keys(data)) {
    if (key.toLowerCase().includes("name")) {
      return { label: key, value: data[key] };
    }
  }
  for (const key of Object.keys(data)) {
    if (key.toLowerCase().includes("email")) {
      return { label: key, value: data[key] };
    }
  }
  const firstKey = Object.keys(data)[0];
  if (firstKey) return { label: firstKey, value: data[firstKey] };
  return null;
}

function getSubtitle(
  data: Record<string, string>,
  primaryKey: string | null,
): string {
  const entries = Object.entries(data).filter(([k]) => k !== primaryKey);
  if (entries.length === 0) return "";
  const [, val] = entries[0];
  return val.length > 80 ? val.slice(0, 80) + "…" : val;
}

function getVisitorEmail(data: Record<string, string>): string | null {
  for (const key of Object.keys(data)) {
    if (key.toLowerCase().includes("email")) {
      const val = data[key];
      if (val && val.includes("@")) return val;
    }
  }
  return null;
}

function buildMailUrl(
  client: MailClient,
  to: string,
  subject: string,
  body: string,
): string {
  const encodedSubject = encodeURIComponent(subject);
  const encodedBody = encodeURIComponent(body);
  switch (client) {
    case "gmail":
      return `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(to)}&su=${encodedSubject}&body=${encodedBody}`;
    case "outlook":
      return `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(to)}&subject=${encodedSubject}&body=${encodedBody}`;
    case "proton":
      return `https://mail.proton.me/u/0/compose?to=${encodeURIComponent(to)}&Subject=${encodedSubject}&Body=${encodedBody}`;
    default:
      return `mailto:${to}?subject=${encodedSubject}&body=${encodedBody}`;
  }
}

const STATUS_CONFIG = {
  new: {
    label: "New",
    className: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  replied: {
    label: "Replied",
    className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
  closed: {
    label: "Closed",
    className: "bg-muted text-muted-foreground border-border",
  },
};

// ─── Main Component ───────────────────────────────────────────────────────────

function Inquiries() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();

  const [selectedInquiry, setSelectedInquiry] =
    useState<InquirySubmission | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [view, setView] = useState<"details" | "compose">("details");
  const [composeData, setComposeData] = useState<ComposeReply | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editBody, setEditBody] = useState("");

  // Reset view when sheet closes
  useEffect(() => {
    if (!sheetOpen) {
      setTimeout(() => {
        setView("details");
        setComposeData(null);
      }, 200);
    }
  }, [sheetOpen]);

  // ─── Queries ────────────────────────────────────────────────────────────────

  const {
    data: submissions,
    isLoading,
    isError,
  } = useQuery<InquirySubmission[]>({
    queryKey: ["inquiries", projectId],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/inquiries/submissions`,
      );
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const statusMutation = useMutation({
    mutationFn: async ({
      inquiryId,
      status,
    }: {
      inquiryId: string;
      status: "new" | "replied" | "closed";
    }) => {
      const res = await fetch(
        `/api/projects/${projectId}/inquiries/${inquiryId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) throw new Error("Failed to update");
      return res.json();
    },
    onSuccess: (updated: InquirySubmission) => {
      queryClient.setQueryData<InquirySubmission[]>(
        ["inquiries", projectId],
        (old) =>
          old?.map((s) => (s.id === updated.id ? updated : s)) ?? [],
      );
      if (selectedInquiry?.id === updated.id) {
        setSelectedInquiry(updated);
      }
    },
  });

  const composeMutation = useMutation({
    mutationFn: async (inquiryId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/inquiries/${inquiryId}/compose`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Failed to compose");
      return res.json() as Promise<ComposeReply>;
    },
    onSuccess: (data: ComposeReply) => {
      setComposeData(data);
      setEditSubject(data.subject);
      setEditBody(data.body);
      setView("compose");
    },
  });

  // ─── Handlers ───────────────────────────────────────────────────────────────

  function handleOpenInquiry(inquiry: InquirySubmission) {
    setSelectedInquiry(inquiry);
    setView("details");
    setComposeData(null);
    setSheetOpen(true);
  }

  function handleCompose() {
    if (!selectedInquiry) return;
    composeMutation.mutate(selectedInquiry.id);
  }

  function handleOpenInMail(client: MailClient) {
    if (!selectedInquiry) return;
    const email = getVisitorEmail(selectedInquiry.data);
    if (!email) return;
    const url = buildMailUrl(client, email, editSubject, editBody);
    window.open(url, "_blank");

    // Save preference
    localStorage.setItem("replymaven:mailClient", client);

    // Auto-mark as replied
    if (selectedInquiry.status !== "replied") {
      statusMutation.mutate({
        inquiryId: selectedInquiry.id,
        status: "replied",
      });
    }
  }

  function handleCopyBody() {
    navigator.clipboard.writeText(editBody);
  }

  const savedClient = (localStorage.getItem("replymaven:mailClient") ||
    "default") as MailClient;

  // ─── Render ─────────────────────────────────────────────────────────────────

  const sorted = submissions
    ? [...submissions].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <MobileMenuButton />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">
            Inquiries
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            View and respond to inquiry submissions from your widget.
          </p>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-16 rounded-xl bg-muted animate-pulse"
            />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="bg-destructive/10 text-destructive rounded-xl p-4 flex items-center gap-2 text-sm">
          <AlertCircle className="w-4 h-4" />
          Failed to load inquiries. Please try again.
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && sorted.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
            <Inbox className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No inquiries yet.</p>
        </div>
      )}

      {/* Card List */}
      {sorted.length > 0 && (
        <div className="space-y-2">
          {sorted.map((inquiry) => {
            const primary = getPrimaryField(inquiry.data);
            const subtitle = getSubtitle(
              inquiry.data,
              primary?.label ?? null,
            );
            const statusCfg = STATUS_CONFIG[inquiry.status];

            return (
              <div
                key={inquiry.id}
                onClick={() => handleOpenInquiry(inquiry)}
                className="flex items-center gap-3 px-4 py-3 bg-card/50 rounded-xl border border-border cursor-pointer hover:bg-accent/30 transition-colors group"
              >
                {/* Icon */}
                <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Inbox className="w-4 h-4 text-muted-foreground" />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">
                      {primary?.value ?? "Inquiry"}
                    </p>
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] shrink-0", statusCfg.className)}
                    >
                      {statusCfg.label}
                    </Badge>
                  </div>
                  {subtitle && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {subtitle}
                    </p>
                  )}
                </div>

                {/* Time */}
                <span className="text-[12px] text-muted-foreground shrink-0">
                  {formatTimeAgo(inquiry.createdAt)}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── Detail / Compose Sheet ──────────────────────────────────────── */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="right"
          className="sm:max-w-lg w-full flex flex-col"
        >
          {selectedInquiry && view === "details" && (
            <DetailView
              inquiry={selectedInquiry}
              onCompose={handleCompose}
              isComposing={composeMutation.isPending}
              onStatusChange={(status) =>
                statusMutation.mutate({
                  inquiryId: selectedInquiry.id,
                  status,
                })
              }
              isUpdatingStatus={statusMutation.isPending}
            />
          )}

          {selectedInquiry && view === "compose" && (
            <ComposeView
              inquiry={selectedInquiry}
              composeData={composeData}
              isLoading={composeMutation.isPending}
              editSubject={editSubject}
              editBody={editBody}
              onSubjectChange={setEditSubject}
              onBodyChange={setEditBody}
              onBack={() => setView("details")}
              onCopyBody={handleCopyBody}
              onOpenInMail={handleOpenInMail}
              savedClient={savedClient}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ─── Detail View ──────────────────────────────────────────────────────────────

function DetailView({
  inquiry,
  onCompose,
  isComposing,
  onStatusChange,
  isUpdatingStatus,
}: {
  inquiry: InquirySubmission;
  onCompose: () => void;
  isComposing: boolean;
  onStatusChange: (status: "new" | "replied" | "closed") => void;
  isUpdatingStatus: boolean;
}) {
  const statusCfg = STATUS_CONFIG[inquiry.status];

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <SheetTitle>Inquiry Details</SheetTitle>
          <Badge
            variant="outline"
            className={cn("text-[10px]", statusCfg.className)}
          >
            {statusCfg.label}
          </Badge>
        </div>
        <SheetDescription>
          Submitted {formatTimeAgo(inquiry.createdAt)}
        </SheetDescription>
      </SheetHeader>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto px-4 py-2">
        <DetailsPanel fields={inquiry.data} />
      </div>

      {/* Footer */}
      <SheetFooter className="flex-row gap-2 pt-2">
        {/* Compose Reply */}
        <Button
          variant="outline"
          size="sm"
          onClick={onCompose}
          disabled={isComposing}
          className="gap-1.5"
        >
          {isComposing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          {isComposing ? "Composing…" : "Compose Reply"}
        </Button>

        {/* Close as Replied — split button */}
        <div className="flex items-center ml-auto">
          <Button
            size="sm"
            onClick={() => onStatusChange("replied")}
            disabled={isUpdatingStatus || inquiry.status === "replied"}
            className="gap-1.5 rounded-r-none"
          >
            {isUpdatingStatus ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            Close as Replied
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                className="rounded-l-none border-l border-primary-foreground/20 px-2"
                disabled={isUpdatingStatus}
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {(["new", "replied", "closed"] as const).map((s) => (
                <DropdownMenuItem
                  key={s}
                  disabled={inquiry.status === s}
                  onSelect={() => onStatusChange(s)}
                >
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] mr-2",
                      STATUS_CONFIG[s].className,
                    )}
                  >
                    {STATUS_CONFIG[s].label}
                  </Badge>
                  {inquiry.status === s && (
                    <span className="text-xs text-muted-foreground ml-auto">
                      Current
                    </span>
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </SheetFooter>
    </>
  );
}

// ─── Compose View ─────────────────────────────────────────────────────────────

function ComposeView({
  inquiry,
  composeData,
  isLoading,
  editSubject,
  editBody,
  onSubjectChange,
  onBodyChange,
  onBack,
  onCopyBody,
  onOpenInMail,
  savedClient,
}: {
  inquiry: InquirySubmission;
  composeData: ComposeReply | null;
  isLoading: boolean;
  editSubject: string;
  editBody: string;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onBack: () => void;
  onCopyBody: () => void;
  onOpenInMail: (client: MailClient) => void;
  savedClient: MailClient;
}) {
  const [bodyCopied, setBodyCopied] = useState(false);
  const email = getVisitorEmail(inquiry.data);

  function handleCopy() {
    onCopyBody();
    setBodyCopied(true);
    setTimeout(() => setBodyCopied(false), 1500);
  }

  function handleOpenInMail(client: MailClient) {
    onOpenInMail(client);
  }

  return (
    <>
      <SheetHeader>
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="p-1 rounded-md hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground" />
          </button>
          <SheetTitle>Compose Reply</SheetTitle>
        </div>
        {email && (
          <SheetDescription>
            To: {email}
          </SheetDescription>
        )}
      </SheetHeader>

      <div className="flex-1 overflow-y-auto space-y-4 px-4 py-2">
        {isLoading && !composeData && (
          <div className="space-y-3">
            <div className="h-10 rounded-lg bg-muted/50 animate-pulse" />
            <div className="h-48 rounded-xl bg-muted/50 animate-pulse" />
            <p className="text-xs text-muted-foreground text-center">
              Composing reply…
            </p>
          </div>
        )}

        {composeData && (
          <>
            {/* Subject */}
            <div>
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-1.5 block">
                Subject
              </label>
              <Input
                value={editSubject}
                onChange={(e) => onSubjectChange(e.target.value)}
                className="text-sm"
              />
            </div>

            {/* Body */}
            <div>
              <label className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium mb-1.5 block">
                Body
              </label>
              <textarea
                value={editBody}
                onChange={(e) => onBodyChange(e.target.value)}
                className="w-full min-h-[240px] bg-muted/30 rounded-xl p-4 text-sm text-foreground resize-y focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      {composeData && (
        <SheetFooter className="flex-row gap-2 pt-2">
          {/* Copy */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="gap-1.5"
          >
            {bodyCopied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {bodyCopied ? "Copied" : "Copy"}
          </Button>

          {/* Open in Mail — split button */}
          <div className="flex items-center ml-auto">
            <Button
              size="sm"
              onClick={() => handleOpenInMail(savedClient)}
              className="gap-1.5 rounded-r-none"
              disabled={!email}
            >
              <Send className="w-3.5 h-3.5" />
              Open in{" "}
              {MAIL_CLIENTS.find((c) => c.key === savedClient)?.label ??
                "Mail"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="rounded-l-none border-l border-primary-foreground/20 px-2"
                  disabled={!email}
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {MAIL_CLIENTS.map((client) => (
                  <DropdownMenuItem
                    key={client.key}
                    onSelect={() => handleOpenInMail(client.key)}
                  >
                    <Mail className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                    {client.label}
                    {client.key === savedClient && (
                      <Check className="w-3 h-3 ml-auto text-emerald-400" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </SheetFooter>
      )}
    </>
  );
}

export default Inquiries;
