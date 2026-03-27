import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ProfileData {
  id: string;
  name: string;
  email: string;
  image: string | null;
  profilePicture: string | null;
  workTitle: string | null;
  profileSetupCompletedAt: string | null;
  profileSetupDismissedAt: string | null;
}

function ProfileSetupDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: profile } = useQuery<ProfileData>({
    queryKey: ["profile"],
    queryFn: async () => {
      const res = await fetch("/api/profile");
      if (!res.ok) throw new Error("Failed to fetch profile");
      return res.json();
    },
  });

  const [name, setName] = useState("");
  const [workTitle, setWorkTitle] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name ?? "");
    setWorkTitle(profile.workTitle ?? "");
    setAvatarPreview(profile.profilePicture ?? profile.image ?? null);
    setAvatarUrl(profile.profilePicture ?? null);
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || undefined,
          workTitle: workTitle.trim() || null,
          profilePicture: avatarUrl,
        }),
      });
      if (!res.ok) throw new Error("Failed to update profile");
      return res.json();
    },
    onSuccess: (data: ProfileData) => {
      queryClient.setQueryData(["profile"], data);
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      onOpenChange(false);
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/profile/setup/dismiss", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to dismiss profile setup");
      return res.json();
    },
    onSuccess: (data: ProfileData) => {
      queryClient.setQueryData(["profile"], data);
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      onOpenChange(false);
    },
  });

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    // Preview
    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);

    // Upload
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = (await res.json()) as { url: string };
      setAvatarUrl(data.url);
    } catch {
      // Revert preview on error
      setAvatarPreview(profile?.profilePicture ?? profile?.image ?? null);
    } finally {
      setUploading(false);
    }
  }

  const currentAvatar = avatarPreview;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 backdrop-blur-sm bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content className="fixed top-[50%] left-[50%] z-50 translate-x-[-50%] translate-y-[-50%] bg-background w-full max-w-[calc(100%-2rem)] sm:max-w-md rounded-2xl border p-6 shadow-xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 duration-200">
        <DialogHeader>
          <DialogTitle>Set up your profile</DialogTitle>
          <DialogDescription>
            This helps your team and visitors know who you are.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Avatar */}
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="relative w-20 h-20 rounded-full bg-muted flex items-center justify-center overflow-hidden group transition-colors hover:bg-muted/80"
              disabled={uploading}
            >
              {currentAvatar ? (
                <img
                  src={currentAvatar}
                  alt="Avatar"
                  className="w-full h-full object-cover"
                />
              ) : (
                <User className="w-8 h-8 text-muted-foreground" />
              )}
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {uploading ? (
                  <Loader2 className="w-5 h-5 text-white animate-spin" />
                ) : (
                  <Camera className="w-5 h-5 text-white" />
                )}
              </div>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarUpload}
            />
            <p className="text-xs text-muted-foreground">
              Click to upload a profile picture
            </p>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Work Title */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Work Title
              <span className="text-muted-foreground font-normal ml-1">(optional)</span>
            </label>
            <input
              type="text"
              value={workTitle}
              onChange={(e) => setWorkTitle(e.target.value)}
              placeholder="e.g. Support Engineer, CEO"
              className="w-full px-4 py-2.5 rounded-xl border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => dismissMutation.mutate()}
              disabled={dismissMutation.isPending || saveMutation.isPending}
              className="flex-1"
            >
              {dismissMutation.isPending ? "Skipping..." : "Skip"}
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={
                dismissMutation.isPending ||
                saveMutation.isPending ||
                uploading ||
                !name.trim()
              }
              className="flex-1"
            >
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : null}
              Save
            </Button>
          </div>
        </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </Dialog>
  );
}

export default ProfileSetupDialog;
