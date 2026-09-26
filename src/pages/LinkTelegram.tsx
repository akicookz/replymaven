import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import AuthModal from "@/components/AuthModal";

// Opened from the one-time link Maven posts after `@Maven link` in Telegram.
// Binds that Telegram account to the signed-in ReplyMaven user.
function LinkTelegram() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();
  const { data: session, isPending: sessionLoading } = useSession();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const startedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token || sessionLoading || !session?.user) return;
    if (startedRef.current === token) return;
    startedRef.current = token;
    (async () => {
      const res = await fetch(
        `/api/team/link/telegram?token=${encodeURIComponent(token)}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setStatus("error");
        setErrorMessage(data?.error ?? "Could not link Telegram.");
        return;
      }
      setStatus("success");
    })();
  }, [token, session, sessionLoading]);

  if (sessionLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session?.user) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4 rounded-2xl bg-card/50 p-6 text-center backdrop-blur-xl">
          <h1 className="font-heading text-xl">Sign in to link Telegram</h1>
          <Button onClick={() => setAuthOpen(true)}>Sign in</Button>
          <AuthModal
            open={authOpen}
            onOpenChange={setAuthOpen}
            callbackURL={`/app/link/telegram?token=${encodeURIComponent(token)}`}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 rounded-2xl bg-card/50 p-6 text-center backdrop-blur-xl">
        {status === "loading" && (
          <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        )}
        {status === "success" && (
          <>
            <CheckCircle2 className="mx-auto size-8 text-primary" />
            <h1 className="font-heading text-xl">Telegram linked</h1>
            <p className="text-sm text-muted-foreground">
              Maven now knows it is you when you write in the group.
            </p>
          </>
        )}
        {status === "error" && (
          <>
            <XCircle className="mx-auto size-8 text-destructive" />
            <h1 className="font-heading text-xl">Link failed</h1>
            <p className="text-sm text-muted-foreground">{errorMessage}</p>
          </>
        )}
        {!token && (
          <p className="text-sm text-muted-foreground">
            This link is missing its token. Send @Maven link in Telegram again.
          </p>
        )}
        <Button variant="outline" onClick={() => navigate("/app")}>
          Back to dashboard
        </Button>
      </div>
    </div>
  );
}

export default LinkTelegram;
