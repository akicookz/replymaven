import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type HelpAnalyticsEmbed =
  | { provider: "posthog"; apiKey: string; host: "us" | "eu" }
  | { provider: "gtag"; measurementId: string }
  | { provider: "meta"; pixelId: string }
  | { provider: "custom"; src: string };

type HelpAnalyticsProvider = HelpAnalyticsEmbed["provider"];

const PROVIDER_LABELS: Record<HelpAnalyticsProvider, string> = {
  posthog: "PostHog",
  gtag: "Google Analytics (gtag)",
  meta: "Meta Pixel",
  custom: "Custom script",
};

const ALL_PROVIDERS: HelpAnalyticsProvider[] = [
  "posthog",
  "gtag",
  "meta",
  "custom",
];

interface HelpAnalyticsEditorProps {
  value: HelpAnalyticsEmbed[];
  onChange: (next: HelpAnalyticsEmbed[]) => void;
  disabled?: boolean;
}

function isHelpAnalyticsProvider(
  value: string,
): value is HelpAnalyticsProvider {
  return (
    value === "posthog" ||
    value === "gtag" ||
    value === "meta" ||
    value === "custom"
  );
}

function emptyEmbed(provider: HelpAnalyticsProvider): HelpAnalyticsEmbed {
  if (provider === "posthog") {
    return { provider: "posthog", apiKey: "", host: "us" };
  }
  if (provider === "gtag") {
    return { provider: "gtag", measurementId: "" };
  }
  if (provider === "meta") {
    return { provider: "meta", pixelId: "" };
  }
  return { provider: "custom", src: "" };
}

export function HelpAnalyticsEditor(props: HelpAnalyticsEditorProps) {
  const used = new Set(props.value.map((embed) => embed.provider));
  const available = ALL_PROVIDERS.filter((provider) => !used.has(provider));

  function updateItem(index: number, next: HelpAnalyticsEmbed) {
    props.onChange(
      props.value.map((embed, i) => (i === index ? next : embed)),
    );
  }

  function removeItem(index: number) {
    props.onChange(props.value.filter((_, i) => i !== index));
  }

  function addItem(provider: HelpAnalyticsProvider) {
    if (used.has(provider)) return;
    props.onChange([...props.value, emptyEmbed(provider)]);
  }

  return (
    <div className="space-y-4">
      {props.value.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Add PostHog, Google Analytics, Meta Pixel, or a custom script URL.
        </p>
      ) : (
        <ul className="space-y-3">
          {props.value.map((embed, index) => (
            <AnalyticsEmbedRow
              key={embed.provider}
              embed={embed}
              disabled={props.disabled}
              onChange={(next) => updateItem(index, next)}
              onRemove={() => removeItem(index)}
            />
          ))}
        </ul>
      )}
      {available.length > 0 ? (
        <Select
          key={available.join(",")}
          onValueChange={(value) => {
            if (isHelpAnalyticsProvider(value)) addItem(value);
          }}
          disabled={props.disabled}
        >
          <SelectTrigger className="w-auto min-w-48">
            <Plus className="h-4 w-4" />
            <SelectValue placeholder="Add analytics" />
          </SelectTrigger>
          <SelectContent>
            {available.map((provider) => (
              <SelectItem key={provider} value={provider}>
                {PROVIDER_LABELS[provider]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}

interface AnalyticsEmbedRowProps {
  embed: HelpAnalyticsEmbed;
  disabled?: boolean;
  onChange: (next: HelpAnalyticsEmbed) => void;
  onRemove: () => void;
}

function AnalyticsEmbedRow(props: AnalyticsEmbedRowProps) {
  const { embed } = props;
  return (
    <li className="rounded-xl bg-muted/50 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{PROVIDER_LABELS[embed.provider]}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={props.onRemove}
          disabled={props.disabled}
          aria-label={`Remove ${PROVIDER_LABELS[embed.provider]}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {embed.provider === "posthog" ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <div className="space-y-1.5">
            <Label htmlFor="help-analytics-posthog-key">Project API key</Label>
            <Input
              id="help-analytics-posthog-key"
              value={embed.apiKey}
              onChange={(event) =>
                props.onChange({ ...embed, apiKey: event.target.value })
              }
              placeholder="phc_..."
              disabled={props.disabled}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Host</Label>
            <Select
              value={embed.host}
              onValueChange={(value) =>
                props.onChange({
                  ...embed,
                  host: value === "eu" ? "eu" : "us",
                })
              }
              disabled={props.disabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="us">US</SelectItem>
                <SelectItem value="eu">EU</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}
      {embed.provider === "gtag" ? (
        <div className="space-y-1.5">
          <Label htmlFor="help-analytics-gtag-id">Measurement ID</Label>
          <Input
            id="help-analytics-gtag-id"
            value={embed.measurementId}
            onChange={(event) =>
              props.onChange({
                ...embed,
                measurementId: event.target.value.toUpperCase(),
              })
            }
            placeholder="G-XXXXXXXX"
            disabled={props.disabled}
            autoComplete="off"
          />
        </div>
      ) : null}
      {embed.provider === "meta" ? (
        <div className="space-y-1.5">
          <Label htmlFor="help-analytics-meta-pixel">Pixel ID</Label>
          <Input
            id="help-analytics-meta-pixel"
            value={embed.pixelId}
            onChange={(event) =>
              props.onChange({ ...embed, pixelId: event.target.value })
            }
            placeholder="1234567890"
            disabled={props.disabled}
            inputMode="numeric"
            autoComplete="off"
          />
        </div>
      ) : null}
      {embed.provider === "custom" ? (
        <div className="space-y-1.5">
          <Label htmlFor="help-analytics-custom-src">Script URL</Label>
          <Input
            id="help-analytics-custom-src"
            type="url"
            value={embed.src}
            onChange={(event) =>
              props.onChange({ ...embed, src: event.target.value })
            }
            placeholder="https://cdn.example.com/script.js"
            disabled={props.disabled}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            HTTPS only. Loads on your custom domain, not on replymaven.com.
          </p>
        </div>
      ) : null}
    </li>
  );
}
