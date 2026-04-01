import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Loader2, User, CheckCircle2, Pencil } from "lucide-react";
import { MobileMenuButton } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";

interface ProfileData {
  id: string;
  name: string;
  email: string;
  image: string | null;
  profilePicture: string | null;
  workTitle: string | null;
}

// ─── Email Change Section ─────────────────────────────────────────────────────

type EmailChangeState = "idle" | "editing" | "otp";

function EmailChangeSection({ currentEmail }: { currentEmail: string }) {
  const queryClient = useQueryClient();
  const { refetch: refetchSession } = useSession();
  const [state, setState] = useState<EmailChangeState>("idle");
  const [newEmail, setNewEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  function reset() {
    setState("idle");
    setNewEmail("");
    setOtp("");
    setError(null);
    setResendCooldown(0);
  }

  function startResendCooldown() {
    setResendCooldown(30);
    const interval = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  const requestMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/profile/change-email/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ newEmail }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Failed to send verification code");
      }
    },
    onSuccess: () => {
      setError(null);
      setOtp("");
      setState("otp");
      startResendCooldown();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: async (): Promise<{ code?: string }> => {
      const res = await fetch("/api/profile/change-email/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ otp }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string; code?: string };
        const err = new Error(data.error ?? "Verification failed");
        (err as Error & { code?: string }).code = data.code;
        throw err;
      }
      return res.json();
    },
    onSuccess: async () => {
      setSuccess(true);
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      await refetchSession();
      setTimeout(() => {
        setSuccess(false);
        reset();
      }, 2000);
    },
    onError: (err: Error & { code?: string }) => {
      setError(err.message);
      if (err.code === "too_many_attempts") {
        setOtp("");
        setState("editing");
      }
    },
  });

  if (success) {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Email</label>
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-brand/5">
          <CheckCircle2 className="w-4 h-4 text-brand shrink-0" />
          <p className="text-sm text-foreground">Email updated successfully</p>
        </div>
      </div>
    );
  }

  if (state === "otp") {
    return (
      <div className="space-y-3">
        <label className="text-sm font-medium text-foreground">
          Verification Code
        </label>
        <p className="text-xs text-muted-foreground">
          Enter the 6-digit code sent to{" "}
          <span className="font-medium text-foreground">{newEmail}</span>
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (otp.length === 6 && !verifyMutation.isPending) {
              verifyMutation.mutate();
            }
          }}
        >
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              pattern="[0-9]*"
              value={otp}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setOtp(v);
                setError(null);
              }}
              placeholder="000000"
              className="w-36 px-4 py-2.5 rounded-xl border border-input bg-background text-foreground text-center font-mono text-lg tracking-[0.3em] placeholder:text-muted-foreground placeholder:tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
            <Button
              type="submit"
              disabled={otp.length !== 6 || verifyMutation.isPending}
              size="default"
            >
              {verifyMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Verify"
              )}
            </Button>
          </div>
        </form>
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setOtp("");
              setError(null);
              requestMutation.mutate();
            }}
            disabled={requestMutation.isPending || resendCooldown > 0}
            className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {requestMutation.isPending
              ? "Sending..."
              : resendCooldown > 0
                ? `Resend code (${resendCooldown}s)`
                : "Resend code"}
          </button>
          <button
            type="button"
            onClick={reset}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (state === "editing") {
    return (
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">New Email</label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newEmail.trim() && newEmail !== currentEmail && !requestMutation.isPending) {
              requestMutation.mutate();
            }
          }}
        >
          <div className="flex gap-2">
            <input
              type="email"
              value={newEmail}
              onChange={(e) => {
                setNewEmail(e.target.value);
                setError(null);
              }}
              placeholder="new@example.com"
              className="flex-1 px-4 py-2.5 rounded-xl border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
            <Button
              type="submit"
              disabled={
                !newEmail.trim() ||
                newEmail === currentEmail ||
                requestMutation.isPending
              }
              size="default"
            >
              {requestMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Send code"
              )}
            </Button>
          </div>
        </form>
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
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
          onClick={() => setState("editing")}
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
