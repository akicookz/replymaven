import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import {
  CreditCard,
  Users,
  ArrowLeft,
  LogOut,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { signOut, useSession } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

const accountNav = [
  { label: "Billing", href: "/app/account/billing", icon: CreditCard },
  { label: "Members", href: "/app/account/members", icon: Users },
];

function AccountLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: session } = useSession();

  async function handleSignOut() {
    await signOut();
    navigate("/");
  }

  const userName = session?.user?.name ?? "User";
  const userEmail = session?.user?.email ?? "";

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="flex flex-col border-r border-sidebar-border bg-sidebar w-60">
        {/* Logo */}
        <div className="flex items-center px-4 h-14">
          <Link to="/app">
            <Logo size="sm" />
          </Link>
        </div>

        {/* Back to dashboard */}
        <div className="px-3 pb-3">
          <Link
            to="/app"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Link>
        </div>

        {/* Account Navigation */}
        <nav className="flex-1 overflow-y-auto px-3">
          <p className="px-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
            Account
          </p>
          <div className="space-y-0.5">
            {accountNav.map((item) => {
              const active = location.pathname === item.href;
              return (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors",
                    active
                      ? "glow-surface-subtle text-card-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <item.icon className={cn("w-[18px] h-[18px] shrink-0", active && "text-card-foreground")} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* User */}
        <div className="px-3 pb-3 pt-2 border-t border-sidebar-border">
          <div className="flex items-center gap-3 px-2 py-2">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
              {userName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-foreground truncate">
                {userName}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {userEmail}
              </p>
            </div>
            <button
              onClick={handleSignOut}
              className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export default AccountLayout;
