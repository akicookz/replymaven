/** @jsxImportSource hono/jsx */
import consentCss from "./consent.css?inline";
import {
  MCP_OAUTH_SCOPE_INFO,
  type McpOAuthScope,
} from "../services/mcp-oauth-service";

// Mirrors the boot script in index.html: same storage key, same dark default,
// so the consent page matches the dashboard the user just came from.
const THEME_BOOT_SCRIPT = `(function(){var t="dark";try{var s=localStorage.getItem("rm-theme");if(s==="light"||s==="dark")t=s;}catch(e){}document.documentElement.classList.add(t);})();`;

const CONSENT_SCRIPT = `(function(){var f=document.getElementById("rm-consent");if(!f)return;var allow=document.getElementById("rm-allow");var boxes=f.querySelectorAll('input[name="scope"]');function sync(){var any=false;boxes.forEach(function(b){if(b.checked)any=true;});allow.disabled=!any;}boxes.forEach(function(b){b.addEventListener("change",sync);});sync();f.addEventListener("submit",function(e){var b=e.submitter;if(b)b.textContent=b.value==="allow"?"Authorizing":"Denying";f.setAttribute("data-pending","true");});})();`;

export interface ConsentPageProps {
  clientName: string;
  userName: string;
  scopes: McpOAuthScope[];
  hiddenFields: Record<string, string>;
}

export function renderMcpConsentPage(props: ConsentPageProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>Authorize {props.clientName}</title>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
        <style dangerouslySetInnerHTML={{ __html: consentCss }} />
      </head>
      <body class="grid min-h-dvh place-items-center bg-background p-5 text-foreground antialiased">
        <main class="w-full max-w-[26rem]">
          <form
            id="rm-consent"
            method="post"
            action="/api/mcp/authorize"
            class="space-y-6 rounded-2xl bg-card p-6 shadow-xl inset-ring-1 inset-ring-border"
          >
            {Object.entries(props.hiddenFields).map(([name, value]) => (
              <input type="hidden" name={name} value={value} />
            ))}

            <div class="space-y-1">
              <h1 class="text-xl leading-tight font-semibold tracking-tight break-words">
                Authorize {props.clientName}
              </h1>
              <p class="text-sm text-muted-foreground">
                Signed in as {props.userName}
              </p>
            </div>

            <div class="space-y-1">
              {props.scopes.map((scope) => (
                <label class="flex cursor-pointer items-center gap-4 rounded-lg p-3 transition-colors hover:bg-muted/60">
                  <span class="min-w-0 flex-1 space-y-1">
                    <span class="block text-sm leading-none font-medium">
                      {MCP_OAUTH_SCOPE_INFO[scope].title}
                    </span>
                    <span class="block text-[0.8125rem] leading-snug text-muted-foreground">
                      {MCP_OAUTH_SCOPE_INFO[scope].detail}
                    </span>
                  </span>
                  <input
                    type="checkbox"
                    name="scope"
                    value={scope}
                    checked
                    class="peer sr-only"
                  />
                  <span class="rm-switch inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent bg-input shadow-xs transition-colors peer-focus-visible:ring-[3px] peer-focus-visible:ring-ring/50">
                    <span class="block size-4 rounded-full bg-foreground transition-transform" />
                  </span>
                </label>
              ))}
            </div>

            <div class="grid grid-cols-2 gap-2.5">
              <button
                type="submit"
                name="decision"
                value="deny"
                class="h-10 rounded-lg bg-secondary text-sm font-medium text-secondary-foreground transition-colors inset-ring-1 inset-ring-border hover:bg-accent"
              >
                Deny
              </button>
              <button
                id="rm-allow"
                type="submit"
                name="decision"
                value="allow"
                class="h-10 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                Authorize
              </button>
            </div>
          </form>
        </main>
        <script dangerouslySetInnerHTML={{ __html: CONSENT_SCRIPT }} />
      </body>
    </html>
  );
}
