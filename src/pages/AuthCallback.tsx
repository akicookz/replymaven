import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function handleCallback() {
      try {
        const callbackUrl = window.location.pathname + window.location.search;

        const response = await fetch(callbackUrl, {
          credentials: "include",
          redirect: "manual",
        });

        if (
          response.type === "opaqueredirect" ||
          response.status === 302 ||
          response.status === 301
        ) {
          const redirectUrl = response.headers.get("location");

          if (redirectUrl) {
            try {
              const url = new URL(redirectUrl, window.location.origin);
              if (url.origin === window.location.origin) {
                navigate(url.pathname + url.search, { replace: true });
                return;
              }
              window.location.href = redirectUrl;
              return;
            } catch {
              navigate(redirectUrl, { replace: true });
              return;
            }
          }

          navigate("/app", { replace: true });
          return;
        }

        if (response.ok) {
          try {
            const data = await response.json();
            if (data?.url || data?.redirectTo || data?.redirect) {
              const redirectTo = data.url || data.redirectTo || data.redirect;
              navigate(redirectTo, { replace: true });
              return;
            }
          } catch {
            // Response was not JSON, that's fine
          }
          navigate("/app", { replace: true });
          return;
        }

        setError("Authentication failed. Please try again.");
      } catch (err) {
        console.error("Auth callback error:", err);
        setError("Something went wrong during authentication.");
      }
    }

    handleCallback();
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <p className="text-destructive">{error}</p>
          <button
            type="button"
            onClick={() => navigate("/?show_auth=true", { replace: true })}
            className="text-sm text-muted-foreground hover:text-foreground underline"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Completing sign in...</p>
      </div>
    </div>
  );
}

export default AuthCallback;
