import { useQuery } from "@tanstack/react-query";

export interface TeamSummary {
  /** Owner id of the team (the user's own id for their own team). */
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
  own: boolean;
  isActive: boolean;
}

interface TeamsResponse {
  teams: TeamSummary[];
  /** Owner id of the team currently resolved as active (matches the `isActive` team). */
  activeTeamId: string;
}

export function useTeams() {
  return useQuery<TeamsResponse>({
    queryKey: ["teams"],
    queryFn: async () => {
      const res = await fetch("/api/teams");
      if (!res.ok) throw new Error("Failed to fetch teams");
      return res.json();
    },
  });
}
