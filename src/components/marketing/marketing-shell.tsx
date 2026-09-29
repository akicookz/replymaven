import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogoIcon } from "@/components/Logo";
import { useSession } from "@/lib/auth-client";

// Header and footer shared by every marketing page. `onAuth` opens the page's
// AuthModal; pages add `pt-14` (or more) to clear the fixed header.

const NAV_LINKS = [
  { label: "Product", href: "/#overview" },
  { label: "Pricing", href: "/#pricing" },
  { label: "Docs", href: "/docs" },
  { label: "FAQ", href: "/#faq" },
  { label: "Talk to sales", href: "/contact-sales" },
];

const FOOTER_COLUMNS = [
  {
    heading: "Resources",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Getting started", href: "/docs" },
      { label: "FAQ", href: "/#faq" },
      { label: "Contact sales", href: "/contact-sales" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "#" },
      { label: "Terms", href: "#" },
    ],
  },
];

export function MarketingHeader({ onAuth }: { onAuth: () => void }) {
  const navigate = useNavigate();
  const { data: session } = useSession();
  const isLoggedIn = Boolean(session?.user);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-background/70 backdrop-blur-xl shadow-[0_1px_0_rgba(255,255,255,0.06)]">
      <nav className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <LogoIcon className="h-5 w-auto text-foreground" />
          <span className="font-medium tracking-tight text-[15px] text-ink-1">ReplyMaven</span>
        </Link>

        <div className="hidden md:flex items-center gap-0.5 text-[13px]">
          {NAV_LINKS.map((link) => (
            <a key={link.label} href={link.href} className="px-3 py-1.5 text-ink-5 hover:text-ink-1 rounded-md transition-colors">
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {isLoggedIn && (
            <Button variant="secondary" size="sm" onClick={() => navigate("/app")}>
              Dashboard
              <ArrowUpRight />
            </Button>
          )}
          {!isLoggedIn && <Button variant="ghost" size="sm" onClick={onAuth}>Log in</Button>}
          {!isLoggedIn && <Button size="sm" onClick={onAuth}>Start free trial</Button>}
        </div>
      </nav>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="px-6 pt-16 pb-10">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-2 space-y-3">
            <div className="flex items-center gap-2">
              <LogoIcon className="h-5 w-auto text-foreground shrink-0" />
              <span className="font-medium tracking-tight text-[15px] text-ink-1">ReplyMaven</span>
            </div>
            <p className="text-sm text-ink-6 leading-relaxed max-w-xs">Turn support into a word-of-mouth growth engine.</p>
          </div>
          {FOOTER_COLUMNS.map((col) => (
            <div key={col.heading} className="space-y-3">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] tabular-nums text-ink-7">{col.heading}</span>
              <ul className="space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <a href={l.href} className="text-sm text-ink-5 hover:text-ink-1 transition-colors">{l.label}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
