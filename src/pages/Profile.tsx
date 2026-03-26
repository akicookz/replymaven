import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, User, CheckCircle2, Pencil, Mail } from "lucide-react";
import { MobileMenuButton } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";

interface ProfileData {
  id: string;
  name: string;
  email: string;
  image: string | null;
  profilePicture: string | null;
  workTitle: string | null;
}

// ─── Email Change Section ─────────────────────────────────────────────────────

function EmailChangeSection({ currentEmail }: { currentEmail: string }) {
  const [editing, setEditing] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [sent, setSent] = useState(false);

  const changeEmailMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/change-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          newEmail,
          callbackURL: "/app/account",
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        throw new Error(data.message ?? "Failed to send verification email");
      }
    },
    onSuccess: () => {
      setSent(true);
    },
  });

  if (sent) {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Email</label>
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-brand/5">
          <Mail className="w-4 h-4 text-brand shrink-0" />
          <div className="space-y-0.5">
            <p className="text-sm text-foreground">Verification email sent</p>
            <p className="text-xs text-muted-foreground">
              Check <span className="font-medium text-foreground">{newEmail}</span> and click the link to confirm.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setEditing(false);
            setNewEmail("");
            changeEmailMutation.reset();
          }}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">New Email</label>
        <div className="flex gap-2">
          <input
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="new@example.com"
            className="flex-1 px-4 py-2.5 rounded-xl border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            autoFocus
          />
          <Button
            onClick={() => changeEmailMutation.mutate()}
            disabled={
              !newEmail.trim() ||
              newEmail === currentEmail ||
              changeEmailMutation.isPending
            }
            size="default"
          >
            {changeEmailMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              "Verify"
            )}
          </Button>
        </div>
        {changeEmailMutation.isError && (
          <p className="text-xs text-destructive">
            {changeEmailMutation.error.message}
          </p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setNewEmail("");
              changeEmailMutation.reset();
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <span className="text-xs text-muted-foreground">
            Currently: {currentEmail}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-foreground">Email</label>
      <div className="flex items-center gap-2">
        <input
          type="email"
          value={currentEmail}
          disabled
          className="flex-1 px-4 py-2.5 rounded-xl border border-input bg-muted text-muted-foreground cursor-not-allowed"
        />
        <Button
          variant="outline"
          size="default"
          onClick={() => setEditing(true)}
        >
          <Pencil className="w-3.5 h-3.5 mr-1.5" />
          Edit
        </Button>
      </div>
    </div>
  );
}

function Profile() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: profile, isLoading } = useQuery<ProfileData>({
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
    if (profile) {
      setName(profile.name ?? "");
      setWorkTitle(profile.workTitle ?? "");
      setAvatarPreview(profile.profilePicture ?? profile.image ?? null);
      setAvatarUrl(profile.profilePicture ?? null);
    }
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => setAvatarPreview(reader.result as string);
    reader.readAsDataURL(file);

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
      setAvatarPreview(profile?.profilePicture ?? profile?.image ?? null);
    } finally {
      setUploading(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <MobileMenuButton />
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground">My Profile</h1>
          <p className="text-xs md:text-sm text-muted-foreground mt-1">
            Manage your personal information and profile picture.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border p-6 space-y-6">
        {/* Avatar */}
        <div className="flex items-center gap-5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="relative w-20 h-20 rounded-full bg-muted flex items-center justify-center overflow-hidden group transition-colors hover:bg-muted/80 shrink-0"
            disabled={uploading}
          >
            {avatarPreview ? (
              <img
                src={avatarPreview}
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
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Profile picture</p>
            <p className="text-xs text-muted-foreground">
              Click to upload. Recommended: square image, at least 200x200px.
            </p>
          </div>
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

        {/* Email */}
        <EmailChangeSection currentEmail={profile?.email ?? ""} />

        {/* Save */}
        <div className="flex items-center gap-3">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || uploading || !name.trim()}
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : null}
            Save Changes
          </Button>
          {saveMutation.isSuccess && (
            <span className="flex items-center gap-1.5 text-sm text-green-600">
              <CheckCircle2 className="w-4 h-4" />
              Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default Profile;
