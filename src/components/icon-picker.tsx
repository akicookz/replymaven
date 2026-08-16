import { useRef, useState } from "react";
import {
  Image as ImageIconLucide,
  Loader2,
  Search,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  HELP_ICON_NAMES,
  HELP_ICON_SVGS,
  type HelpIconName,
  isHelpIconName,
  isImageIcon,
} from "../../shared/help-icons";

interface IconPickerProps {
  value: string | null;
  onChange: (value: string | null) => void;
}

/** Inline one of the shared lucide-markup strings, sized by the wrapper. */
function IconGlyph({
  name,
  className,
}: {
  name: HelpIconName;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block h-6 w-6 [&>svg]:h-full [&>svg]:w-full",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: HELP_ICON_SVGS[name] }}
    />
  );
}

/**
 * Render a category icon — either an uploaded image (fills its parent) or a
 * Lucide glyph. Falls back to BookOpen when unset/unknown.
 */
export function CategoryIcon({
  icon,
  className,
}: {
  icon: string | null | undefined;
  className?: string;
}) {
  if (isImageIcon(icon)) {
    return (
      <img
        src={icon as string}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
      />
    );
  }
  const name: HelpIconName =
    icon && isHelpIconName(icon) ? icon : "BookOpen";
  return <IconGlyph name={name} className={className} />;
}

function IconPicker({ value, onChange }: IconPickerProps) {
  const initialTab = isImageIcon(value) ? "image" : "icon";
  const [tab, setTab] = useState<"icon" | "image">(initialTab);
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedIcon: HelpIconName | null =
    value && !isImageIcon(value) && isHelpIconName(value) ? value : null;
  const imageUrl = isImageIcon(value) ? value : null;

  const normalizedSearch = search.trim().toLowerCase();
  const filtered = HELP_ICON_NAMES.filter((name) =>
    normalizedSearch === ""
      ? true
      : name.toLowerCase().includes(normalizedSearch),
  );

  function handlePickIcon(name: HelpIconName) {
    onChange(name);
  }

  async function handleFileSelected(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Upload failed" }));
        throw new Error(
          (err as { error?: string }).error ?? "Upload failed",
        );
      }
      const { url } = (await res.json()) as { url: string };
      onChange(url);
      toast.success("Image uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFileSelected(file);
  }

  function handleRemoveImage() {
    onChange(null);
  }

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => setTab(v as "icon" | "image")}
      className="gap-3"
    >
      <TabsList>
        <TabsTrigger value="icon">Icon</TabsTrigger>
        <TabsTrigger value="image">Image</TabsTrigger>
      </TabsList>

      <TabsContent value="icon" className="space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search icons"
            className="pl-9"
          />
        </div>
        <div className="grid grid-cols-7 sm:grid-cols-9 gap-1.5 max-h-56 overflow-y-auto pr-1">
          {filtered.map((name) => {
            const isSelected = selectedIcon === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => handlePickIcon(name)}
                title={name}
                aria-label={name}
                aria-pressed={isSelected}
                className={cn(
                  "aspect-square flex items-center justify-center rounded-lg transition-colors",
                  isSelected
                    ? "ring-2 ring-brand text-brand bg-brand/10"
                    : "text-muted-foreground bg-muted/50 hover:bg-muted",
                )}
              >
                <IconGlyph name={name} className="w-5 h-5" />
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="col-span-full text-sm text-muted-foreground text-center py-6">
              No icons match "{search}"
            </p>
          )}
        </div>
      </TabsContent>

      <TabsContent value="image" className="space-y-3">
        {imageUrl ? (
          <div className="space-y-3">
            <div className="relative aspect-[4/5] max-w-[220px] overflow-hidden rounded-xl bg-muted/30">
              <img
                src={imageUrl}
                alt="Category cover"
                className="w-full h-full object-cover"
              />
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(to top, var(--overlay-strong) 0%, var(--overlay-mid) 45%, transparent 100%)",
                }}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                Replace
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRemoveImage}
                disabled={uploading}
              >
                <X className="w-4 h-4" />
                Remove
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className={cn(
              "w-full flex flex-col items-center justify-center gap-2 rounded-xl bg-muted/40 px-6 py-10 text-center transition-colors",
              "hover:bg-muted/60 disabled:opacity-60",
            )}
          >
            {uploading ? (
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            ) : (
              <ImageIconLucide className="w-6 h-6 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-medium">Upload an image</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                JPG, PNG, WebP up to 10MB. Used as a full-bleed category cover.
              </p>
            </div>
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />
      </TabsContent>
    </Tabs>
  );
}

export default IconPicker;
