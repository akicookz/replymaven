import { useRef, useState } from "react";
import {
  Activity,
  Bell,
  Book,
  BookOpen,
  BookText,
  Box,
  CircleAlert,
  CircleHelp,
  Cloud,
  Code,
  Cog,
  Cpu,
  CreditCard,
  Database,
  DollarSign,
  FileText,
  Folder,
  Globe,
  GraduationCap,
  Hammer,
  Heart,
  Image as ImageIconLucide,
  Key,
  Layers,
  Lightbulb,
  Loader2,
  Lock,
  type LucideIcon,
  Mail,
  MessageCircle,
  MessageSquare,
  Mic,
  Package,
  Phone,
  Rocket,
  Search,
  Settings,
  Shield,
  ShoppingCart,
  Sparkles,
  Star,
  Tag,
  Terminal,
  Upload,
  User,
  Users,
  Video,
  Wallet,
  Workflow,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  HELP_ICON_NAMES,
  type HelpIconName,
  isHelpIconName,
  isImageIcon,
} from "../../shared/help-icons";

interface IconPickerProps {
  value: string | null;
  onChange: (value: string | null) => void;
}

const ICON_MAP: Record<HelpIconName, LucideIcon> = {
  BookOpen,
  Book,
  BookText,
  GraduationCap,
  Lightbulb,
  Rocket,
  Settings,
  Cog,
  User,
  Users,
  CreditCard,
  DollarSign,
  Wallet,
  MessageCircle,
  MessageSquare,
  Mail,
  Phone,
  Code,
  Terminal,
  Database,
  Cloud,
  Cpu,
  Globe,
  Lock,
  Shield,
  Key,
  CircleAlert,
  CircleHelp,
  FileText,
  Folder,
  Image: ImageIconLucide,
  Video,
  Mic,
  Tag,
  Sparkles,
  Wrench,
  Hammer,
  Box,
  Package,
  ShoppingCart,
  Heart,
  Star,
  Zap,
  Bell,
  Activity,
  Layers,
  Workflow,
};

function getLucideIcon(name: HelpIconName): LucideIcon | null {
  return Object.prototype.hasOwnProperty.call(ICON_MAP, name)
    ? ICON_MAP[name]
    : null;
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

  function handleClearIcon() {
    onChange(null);
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
        <div className="grid grid-cols-6 sm:grid-cols-8 gap-2 max-h-64 overflow-y-auto pr-1">
          {filtered.map((name) => {
            const Icon = getLucideIcon(name);
            if (!Icon) return null;
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
                  "aspect-square flex items-center justify-center rounded-lg bg-muted/50 transition-colors",
                  "hover:bg-muted",
                  isSelected
                    ? "ring-2 ring-brand text-brand bg-brand/10"
                    : "text-muted-foreground",
                )}
              >
                <Icon className="w-5 h-5" />
              </button>
            );
          })}
          {filtered.length === 0 && (
            <p className="col-span-full text-sm text-muted-foreground text-center py-6">
              No icons match "{search}"
            </p>
          )}
        </div>
        {selectedIcon && (
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
            <span className="text-sm">
              Selected:{" "}
              <span className="font-medium text-foreground">{selectedIcon}</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClearIcon}
            >
              Clear
            </Button>
          </div>
        )}
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
