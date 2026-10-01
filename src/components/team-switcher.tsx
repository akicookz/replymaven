import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Users } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTeams } from "@/hooks/use-teams";
import { cn } from "@/lib/utils";

// Switch the active team. Renders nothing when the user has only one team,
// so callers show their own label for that case. Use variant "title" inside a
// page heading and "toolbar" beside ghost buttons in a top bar.
export function TeamSwitcher({
  variant = "title",
  align = "start",
}: {
  variant?: "title" | "toolbar";
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const { data } = useTeams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const teams = data?.teams ?? [];
  if (teams.length <= 1) return null;
  const activeTeam = teams.find((team) => team.isActive) ?? teams[0];
  const name = activeTeam?.name ?? "Team";

  async function switchTeam(teamId: string) {
    setOpen(false);
    if (isSwitching || teamId === data?.activeTeamId) return;

    setIsSwitching(true);
    try {
      const response = await fetch("/api/teams/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId }),
      });
      if (!response.ok) throw new Error("Failed to switch team");

      queryClient.clear();
      navigate("/app");
    } finally {
      setIsSwitching(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isSwitching}
          aria-label={`Switch team, current team ${name}`}
          className={cn(
            "flex h-8 min-w-0 max-w-64 items-center gap-1.5 rounded-glass px-2 text-sm transition-colors disabled:opacity-60",
            variant === "title" &&
              "-ml-2 font-semibold text-ink-1 hover:bg-glass-button",
            variant === "toolbar" &&
              "font-medium text-muted-foreground hover:bg-glass-button hover:text-foreground",
          )}
        >
          <Users className="size-3.5 shrink-0 text-ink-5" strokeWidth={1.75} />
          <span className="truncate">{name}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-ink-5" strokeWidth={1.5} />
        </button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-60 p-1">
        <div className="space-y-0.5">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => switchTeam(team.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                team.isActive
                  ? "bg-glass-button font-medium text-ink-1"
                  : "text-ink-5 hover:bg-glass-button hover:text-ink-1",
              )}
            >
              <span className="flex-1 truncate">
                {team.name}
                {team.own && (
                  <span className="text-muted-foreground"> (you)</span>
                )}
              </span>
              <span className="shrink-0 text-[11px] capitalize text-muted-foreground">
                {team.role}
              </span>
              {team.isActive && (
                <Check className="h-4 w-4 shrink-0 text-primary" />
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
