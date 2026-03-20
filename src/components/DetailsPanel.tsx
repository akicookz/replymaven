import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DetailsPanelProps {
  /** Top-level identity fields (name, email, phone) shown first */
  identity?: { label: string; value: string }[];
  /** Key-value fields (inquiry form data or custom metadata) */
  fields?: Record<string, string>;
  /** Optional section header for fields, e.g. "Custom Metadata" */
  fieldsLabel?: string;
  /** System metadata (device/geo info), rendered in a collapsible section */
  systemFields?: Record<string, string>;
  /** Whether system fields are expanded by default */
  systemDefaultOpen?: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMetaKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

// ─── Copiable Card ────────────────────────────────────────────────────────────

function CopyCard({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div
      onClick={handleCopy}
      className="bg-muted/50 rounded-lg p-3 cursor-pointer hover:bg-muted/70 transition-colors relative group"
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">
          {label}
        </span>
        <span
          className={cn(
            "transition-opacity",
            copied ? "opacity-100" : "opacity-0 group-hover:opacity-60",
          )}
        >
          {copied ? (
            <Check className="w-3 h-3 text-emerald-400" />
          ) : (
            <span className="text-[10px] text-muted-foreground">Click to copy</span>
          )}
        </span>
      </div>
      <p className="text-sm text-foreground whitespace-pre-wrap break-words">
        {value}
      </p>
    </div>
  );
}

// ─── System Info (Collapsible) ────────────────────────────────────────────────

function SystemSection({
  fields,
  defaultOpen,
}: {
  fields: Record<string, string>;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (Object.keys(fields).length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 cursor-pointer hover:bg-muted/30 rounded-lg px-2 py-1.5 -mx-2 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
        <Monitor className="w-3.5 h-3.5" />
        System Info
      </button>
      {open && (
        <div className="space-y-1.5 mt-2">
          {Object.entries(fields).map(([key, value]) => (
            <CopyCard key={key} label={formatMetaKey(key)} value={value} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

function DetailsPanel({
  identity,
  fields,
  fieldsLabel,
  systemFields,
  systemDefaultOpen = false,
}: DetailsPanelProps) {
  const hasIdentity = identity && identity.length > 0;
  const fieldEntries = fields ? Object.entries(fields) : [];
  const hasFields = fieldEntries.length > 0;
  const hasSystem = systemFields && Object.keys(systemFields).length > 0;

  return (
    <div className="space-y-5">
      {/* Identity fields (name, email, phone) */}
      {hasIdentity && (
        <div className="space-y-1.5">
          {identity.map((item) => (
            <CopyCard key={item.label} label={item.label} value={item.value} />
          ))}
        </div>
      )}

      {/* Custom fields / form data */}
      {hasFields && (
        <div>
          {fieldsLabel && (
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5 px-1">
              {fieldsLabel}
            </h4>
          )}
          <div className="space-y-1.5">
            {fieldEntries.map(([key, value]) => (
              <CopyCard key={key} label={key} value={value} />
            ))}
          </div>
        </div>
      )}

      {/* System metadata (collapsible) */}
      {hasSystem && (
        <SystemSection
          fields={systemFields}
          defaultOpen={systemDefaultOpen}
        />
      )}
    </div>
  );
}

export { DetailsPanel, CopyCard, formatMetaKey };
export default DetailsPanel;
