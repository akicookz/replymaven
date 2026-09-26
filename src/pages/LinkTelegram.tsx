import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useSession } from "@/lib/auth-client";
import AuthModal from "@/components/AuthModal";

interface LinkPreview {
  telegramName: string | null;
  telegramUsername: string | null;
  email: string;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return data?.error ?? fallback;
}

// Opened from the one-time link the bot posts after the link command in
// Telegram. Shows whose Telegram account the link is for and links it only
// when the signed-in user confirms it is theirs.
function LinkTelegram() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const navigate = useNavigate();
  const { data: session, isPending: sessionLoading } = useSession();
  const [authOpen, setAuthOpen] = useState(false);

  const preview = useQuery<LinkPreview>({
    queryKey: ["telegram-link-preview", token],
    enabled: Boolean(token && session?.user),
    retry: false,
    queryFn: async () => {
      const res = await fetch(
        `/api/team/link/telegram?token=${encodeURIComponent(token)}`,
      );
      if (!res.ok) throw new Error(await readError(res, "Could not read this link."));
      return res.json();
    },
  });

  const link = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/team/link/telegram?token=${encodeURIComponent(token)}`,
        { method: "POST" },
      );
      if (!res.ok) throw new Error(await readError(res, "Could not link Telegram."));
    },
  });

  if (sessionLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const account = preview.data
    ? [preview.data.telegramName, preview.data.telegramUsername && `@${preview.data.telegramUsername}`]
      .filter(Boolean)
      .join(" ") || "this Telegram account"
    : "";

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        {!session?.user && (
          <>
            <CardHeader>
              <CardTitle>Sign in to link Telegram</CardTitle>
            </CardHeader>
            <CardFooter>
              <Button onClick={() => setAuthOpen(true)}>Sign in</Button>
              <AuthModal
                open={authOpen}
                onOpenChange={setAuthOpen}
                callbackURL={`/app/link/telegram?token=${encodeURIComponent(token)}`}
              />
            </CardFooter>
          </>
        )}

        {session?.user && !token && (
          <CardHeader>
            <CardTitle>This link is incomplete</CardTitle>
            <CardDescription>Send the link command in Telegram again.</CardDescription>
          </CardHeader>
        )}

        {session?.user && token && preview.isPending && (
          <CardContent className="flex justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </CardContent>
        )}

        {session?.user && preview.isError && (
          <>
            <CardHeader>
              <CardTitle>Link failed</CardTitle>
              <CardDescription>{preview.error.message}</CardDescription>
            </CardHeader>
            <CardFooter>
              <Button variant="outline" onClick={() => navigate("/app")}>
                Back to dashboard
              </Button>
            </CardFooter>
          </>
        )}

        {preview.data && !link.isSuccess && (
          <>
            <CardHeader>
              <CardTitle>Link {account}?</CardTitle>
              <CardDescription>
                Messages from it will count as {preview.data.email}.
              </CardDescription>
            </CardHeader>
            {link.isError && (
              <CardContent className="text-sm text-destructive">
                {link.error.message}
              </CardContent>
            )}
            <CardFooter className="gap-2">
              <Button
                onClick={() => link.mutate()}
                disabled={link.isPending}
              >
                {link.isPending && <Loader2 className="animate-spin" />}
                Link this account
              </Button>
              <Button variant="outline" onClick={() => navigate("/app")}>
                Not my account
              </Button>
            </CardFooter>
          </>
        )}

        {link.isSuccess && (
          <>
            <CardHeader>
              <CheckCircle2 className="size-6 text-primary" />
              <CardTitle>Telegram linked</CardTitle>
            </CardHeader>
            <CardFooter>
              <Button variant="outline" onClick={() => navigate("/app")}>
                Back to dashboard
              </Button>
            </CardFooter>
          </>
        )}
      </Card>
    </div>
  );
}

export default LinkTelegram;
