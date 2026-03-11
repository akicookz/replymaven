import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Mail, AlertCircle } from "lucide-react";
import { MobileMenuButton } from "@/components/PageHeader";

interface ContactFormSubmission {
  id: string;
  visitorId: string | null;
  data: string;
  createdAt: string;
}

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
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ContactFormSubmissions() {
  const { projectId } = useParams<{ projectId: string }>();

  const {
    data: submissions,
    isLoading,
    isError,
  } = useQuery<ContactFormSubmission[]>({
    queryKey: ["contact-form-submissions", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/contact-form/submissions`);
      if (!res.ok) throw new Error("Failed to fetch submissions");
      return res.json();
    },
  });

  // Collect all unique field labels across submissions
  function getAllFields(subs: ContactFormSubmission[]): string[] {
    const fieldSet = new Set<string>();
    for (const s of subs) {
      try {
        const parsed = JSON.parse(s.data);
        for (const key of Object.keys(parsed)) {
          fieldSet.add(key);
        }
      } catch {
        // ignore
      }
    }
    return Array.from(fieldSet);
  }

  function parseData(raw: string): Record<string, string> {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  const allFields = submissions ? getAllFields(submissions) : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <MobileMenuButton />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">Contact Form Submissions</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            View responses submitted through the contact form widget.
          </p>
        </div>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-card border border-border animate-pulse" />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="bg-destructive/10 text-destructive rounded-xl p-4 flex items-center gap-2 text-sm">
          <AlertCircle className="w-4 h-4" />
          Failed to load submissions. Please try again.
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && submissions && submissions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
            <Mail className="w-6 h-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">No submissions yet.</p>
        </div>
      )}

      {/* Submissions Table */}
      {submissions && submissions.length > 0 && (
        <div className="bg-card rounded-xl border border-border overflow-hidden">
          {/* Table Header */}
          <div
            className="hidden sm:grid gap-4 px-5 py-3 border-b border-border text-[12px] font-medium text-muted-foreground uppercase tracking-wider"
            style={{
              gridTemplateColumns: `${allFields.map(() => "1fr").join(" ")} 100px`,
            }}
          >
            {allFields.map((field) => (
              <span key={field}>{field}</span>
            ))}
            <span className="text-right">Time</span>
          </div>

          {submissions.map((submission) => {
            const parsed = parseData(submission.data);
            return (
              <div
                key={submission.id}
                className="grid gap-4 items-center px-5 py-4 border-b border-border last:border-b-0 hover:bg-accent/30 transition-colors"
                style={{
                  gridTemplateColumns: `${allFields.map(() => "1fr").join(" ")} 100px`,
                }}
              >
                {allFields.map((field) => (
                  <div key={field} className="min-w-0">
                    <span className="sm:hidden text-[11px] text-muted-foreground font-medium uppercase">
                      {field}:{" "}
                    </span>
                    <span className="text-[13px] text-foreground truncate block">
                      {parsed[field] ?? "—"}
                    </span>
                  </div>
                ))}
                <span className="text-[12px] text-muted-foreground text-right">
                  {formatTimeAgo(submission.createdAt)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ContactFormSubmissions;
