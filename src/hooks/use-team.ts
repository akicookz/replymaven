import { useQuery } from "@tanstack/react-query";

interface TeamMember {
  id: string;
  ownerId: string;
  userId: string | null;
  email: string;
  role: "admin" | "member";
  status: "pending" | "accepted" | "revoked";
  invitedAt: string;
  acceptedAt: string | null;
}

interface TeamData {
  members: TeamMember[];
  ownerId: string;
}

export type { TeamMember };

export function useTeam() {
  return useQuery<TeamData>({
    queryKey: ["team"],
    queryFn: async () => {
      const res = await fetch("/api/team");
      if (!res.ok) throw new Error("Failed to fetch team");
      return res.json();
    },
  });
}
