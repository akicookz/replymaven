import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Segmented } from "@/components/ui/segmented";

// URL row shared by the HTTP connector and the MCP server form. The HTTP
// connector shows the method and a timeout; MCP is always POST with a fixed
// timeout, so it passes neither and gets the same layout with just the URL.

type HttpMethod = "POST" | "GET";

const METHOD_OPTIONS = [
  { value: "POST" as const, label: "POST" },
  { value: "GET" as const, label: "GET" },
];

interface EndpointFieldProps {
  label: string;
  url: string;
  onUrlChange: (url: string) => void;
  placeholder?: string;
  required?: boolean;
  method?: HttpMethod;
  onMethodChange?: (method: HttpMethod) => void;
  timeout?: number;
  timeoutOptions?: readonly number[];
  onTimeoutChange?: (timeout: number) => void;
}

function EndpointField({
  label,
  url,
  onUrlChange,
  placeholder,
  required = false,
  method,
  onMethodChange,
  timeout,
  timeoutOptions,
  onTimeoutChange,
}: EndpointFieldProps) {
  const showMethod = method !== undefined && onMethodChange !== undefined;
  const showTimeout =
    timeout !== undefined &&
    timeoutOptions !== undefined &&
    onTimeoutChange !== undefined;

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <div className="flex flex-wrap gap-2 sm:flex-nowrap">
        {showMethod && (
          <Segmented
            label="Request method"
            value={method}
            options={METHOD_OPTIONS}
            onValueChange={onMethodChange}
          />
        )}
        <Input
          type="url"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          className="order-3 sm:order-none sm:w-auto sm:min-w-0 sm:flex-1"
        />
        {showTimeout && (
          <Select
            value={String(timeout)}
            onValueChange={(next) => onTimeoutChange(Number(next))}
          >
            <SelectTrigger
              className="w-32 shrink-0"
              title="Request timeout"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {timeoutOptions.map((ms) => (
                <SelectItem key={ms} value={String(ms)}>
                  {ms / 1000}s timeout
                </SelectItem>
              ))}
              {!timeoutOptions.includes(timeout) && (
                <SelectItem value={String(timeout)}>
                  {timeout / 1000}s timeout
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

export { EndpointField };
