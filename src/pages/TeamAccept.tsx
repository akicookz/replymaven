import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { Loader2, CheckCircle2, XCircle, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import AuthModal from "@/components/AuthModal";

function TeamAccept() {
  const { inviteId } = useParams<{ inviteId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session, isPending: sessionLoading } = useSession();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [authOpen, setAuthOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  // Guard against React StrictMode / re-renders firing the accept call twice.
  // The second call would hit the now-accepted invite and report "no longer
  // valid", flipping the UI to error even though the first call succeeded.
  const acceptStartedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!inviteId || sessionLoading || !session?.user) return;
    if (acceptStartedRef.current === inviteId) return;
    acceptStartedRef.current = inviteId;

    const acceptInvite = async () => {
      try {
        const res = await fetch(`/api/team/accept/${inviteId}`, {
          method: "POST",
        });

        if (!res.ok) {
          const data = (await res.json()) as { error: string };
          throw new Error(data.error || "Failed to accept invitation");
        }

        // Remove stale cached data so the dashboard sees fresh role/projects
        // for the newly-joined team member. We use removeQueries rather than
        // invalidateQueries so that the next read waits for a fresh fetch
        // instead of briefly returning stale data (which caused the guard to
        // bounce users to onboarding).
        queryClient.removeQueries({ queryKey: ["subscription"] });
        queryClient.removeQueries({ queryKey: ["projects"] });
        queryClient.removeQueries({ queryKey: ["profile"] });

        // Prefetch fresh data and wait for it before navigating so the
        // OnboardingGuard sees the correct team-member role on first render.
        await Promise.all([
          queryClient.fetchQuery({
            queryKey: ["subscription"],
            queryFn: async () => {
              const r = await fetch("/api/billing/subscription");
              if (!r.ok) throw new Error("Failed to fetch subscription");
              return r.json();
            },
          }),
          queryClient.fetchQuery({
            queryKey: ["projects"],
            queryFn: async () => {
              const r = await fetch("/api/projects");
              if (!r.ok) throw new Error("Failed to fetch projects");
              return r.json();
            },
          }),
          queryClient.fetchQuery({
            queryKey: ["profile"],
            queryFn: async () => {
              const r = await fetch("/api/profile");
              if (!r.ok) throw new Error("Failed to fetch profile");
              return r.json();
            },
          }),
        ]);

        setStatus("success");
        setTimeout(() => {
          navigate("/app?setup=profile");
        }, 1200);
      } catch (err) {
        setStatus("error");
        setErrorMessage(err instanceof Error ? err.message : "Failed to accept invitation");
      }
    };

    acceptInvite();
  }, [inviteId, session, sessionLoading, navigate, queryClient]);

  if (sessionLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!session?.user) {
    // After auth, Better Auth returns here so the accept effect runs.
    const callbackUrl = `/app/team/accept/${inviteId}`;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full space-y-6">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <UserPlus className="w-8 h-8 text-primary" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">Sign in to accept invitation</h1>
            <p className="text-muted-foreground">
              You need to sign in or create an account to accept this team invitation.
            </p>
          </div>
          <Button onClick={() => setAuthOpen(true)} className="w-full">
            Sign In
          </Button>
        </div>
        <AuthModal
          open={authOpen}
          onOpenChange={setAuthOpen}
          callbackURL={callbackUrl}
        />
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Accepting invitation...</p>
        </div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full space-y-6">
          <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center">
            <CheckCircle2 className="w-8 h-8 text-green-500" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">Welcome to the team!</h1>
            <p className="text-muted-foreground">
              You've successfully joined the team. Redirecting to dashboard...
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full space-y-6">
          <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
            <XCircle className="w-8 h-8 text-destructive" />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-foreground">Unable to accept invitation</h1>
            <p className="text-muted-foreground">{errorMessage}</p>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => navigate("/app")} className="flex-1">
              Go to Dashboard
            </Button>
            <Button onClick={() => window.location.reload()} className="flex-1">
              Try Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default TeamAccept;