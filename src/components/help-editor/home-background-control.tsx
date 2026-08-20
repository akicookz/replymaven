import { useRef, useState } from "react";
import { ImageIcon, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { ImagePositioner } from "@/components/ImagePositioner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export type HomeBackgroundFit = "cover" | "contain" | "repeat";

export function parseHomeBackgroundFit(
  value: string | null | undefined,
): HomeBackgroundFit {
  if (value === "contain" || value === "repeat") return value;
  return "cover";
}

export interface HomeBackgroundValue {
  url: string | null;
  position: string | null;
  fit: HomeBackgroundFit;
}

interface HomeBackgroundControlProps {
  value: HomeBackgroundValue;
  onChange: (value: HomeBackgroundValue) => void;
  disabled?: boolean;
}

export function HomeBackgroundControl({
  value,
  onChange,
  disabled = false,
}: HomeBackgroundControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function uploadFile(file: File): Promise<void> {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast.error("Use a JPG, PNG, WebP, or SVG image");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Image is too large (max 10MB)");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error ?? "Upload failed");
      }
      const body = (await res.json()) as { url: string };
      onChange({
        url: body.url,
        position: "50% 50%",
        fit: value.fit,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label="Home background"
        >
          <ImageIcon className="h-4 w-4" />
          <span className="hidden sm:inline">Background</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>Home background</PopoverTitle>
          <PopoverDescription>
            Stays in place and fades out down the page. Live home only.
          </PopoverDescription>
        </PopoverHeader>
        <div className="mt-3 space-y-3">
          <div className="relative overflow-hidden rounded-lg bg-muted aspect-[16/9]">
            {value.url ? (
              <ImagePositioner
                src={value.url}
                alt=""
                position={value.position}
                onChange={(position) => onChange({ ...value, position })}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <ImageIcon className="h-5 w-5" />
              </div>
            )}
          </div>
          {value.url ? (
            <div className="space-y-1.5">
              <Label htmlFor="help-home-bg-fit">Fit</Label>
              <Select
                value={value.fit}
                onValueChange={(fit) =>
                  onChange({ ...value, fit: fit as HomeBackgroundFit })
                }
                disabled={disabled || uploading}
              >
                <SelectTrigger id="help-home-bg-fit" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cover">Cover</SelectItem>
                  <SelectItem value="contain">Contain</SelectItem>
                  <SelectItem value="repeat">Tile</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_IMAGE_TYPES.join(",")}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void uploadFile(file);
            }}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={disabled || uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {value.url ? "Replace" : "Upload"}
            </Button>
            {value.url ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled || uploading}
                onClick={() =>
                  onChange({ url: null, position: null, fit: "cover" })
                }
                aria-label="Remove background"
              >
                <X className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
