import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  UserPlus,
  Loader2,
  Mail,
  Shield,
  User,
  MoreHorizontal,
  Trash2,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useTeam, type TeamMember } from "@/hooks/use-team";
import { useSubscription } from "@/hooks/use-subscription";
import { useSession } from "@/lib/auth-client";

// ─── Invite Dialog ────────────────────────────────────────────────────────────

function InviteForm({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const queryClient = useQueryClient();

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error: string };
        throw new Error(data.error);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team"] });
      onClose();
    },
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">
          Email Address
        </label>
        <div className="relative">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@company.com"
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Role</label>
        <Select value={role} onValueChange={(v) => setRole(v as "admin" | "member")}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Admin — Full access, can invite others
              </div>
            </SelectItem>
            <SelectItem value="member">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Member — Can manage projects
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {inviteMutation.isError && (
        <p className="text-sm text-destructive">
          {inviteMutation.error.message}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <Button variant="outline" onClick={onClose} className="flex-1">
          Cancel
        </Button>
        <Button
          onClick={() => inviteMutation.mutate()}
          disabled={!email.trim() || inviteMutation.isPending}
          className="flex-1"
        >
          {inviteMutation.isPending ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <UserPlus className="w-4 h-4 mr-2" />
          )}
          Send Invite
        </Button>
      </div>
    </div>
  );
}

// ─── Member Row ───────────────────────────────────────────────────────────────

function MemberRow({
  member,
  isOwnerView,
}: {
  member: TeamMember;
  isOwnerView: boolean;
}) {
  const queryClient = useQueryClient();

  const removeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/team/${member.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove member");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team"] });
    },
  });

  const roleMutation = useMutation({
    mutationFn: async (newRole: "admin" | "member") => {
      const res = await fetch(`/api/team/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (!res.ok) throw new Error("Failed to update role");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team"] });
    },
  });

  const isPending = member.status === "pending";

  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-xl border border-border">
      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
        {member.email.charAt(0).toUpperCase()}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">
          {member.email}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground capitalize flex items-center gap-1">
            {member.role === "admin" ? (
              <Shield className="w-3 h-3" />
            ) : (
              <User className="w-3 h-3" />
            )}
            {member.role}
          </span>
          {isPending ? (
            <span className="flex items-center gap-1 text-xs text-yellow-600">
              <Clock className="w-3 h-3" />
              Pending
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 className="w-3 h-3" />
              Accepted
            </span>
          )}
        </div>
      </div>

      {isOwnerView && (
        <Popover>
          <PopoverTrigger asChild>
            <button className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-48 p-1">
            <button
              onClick={() =>
                roleMutation.mutate(
                  member.role === "admin" ? "member" : "admin",
                )
              }
              disabled={roleMutation.isPending}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <Shield className="w-4 h-4" />
              {member.role === "admin" ? "Demote to Member" : "Promote to Admin"}
            </button>
            <button
              onClick={() => removeMutation.mutate()}
              disabled={removeMutation.isPending}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Remove
            </button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

// ─── Members Page ─────────────────────────────────────────────────────────────

function Members() {
  const [showInvite, setShowInvite] = useState(false);
  const { data: teamData, isLoading: teamLoading } = useTeam();
  const { data: subData } = useSubscription();
  const { data: session } = useSession();

  if (teamLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const members = teamData?.members ?? [];
  const ownerId = teamData?.ownerId;
  const isOwner = session?.user?.id === ownerId;
  const seatMax = subData?.limits?.maxSeats ?? 1;
  const seatCurrent = subData?.seats?.current ?? 1;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Team Members</h1>
          <p className="text-muted-foreground mt-1">
            {seatCurrent} of {seatMax} seat{seatMax !== 1 ? "s" : ""} used
          </p>
        </div>
        {(isOwner || subData?.role === "admin") && (
          <Button
            onClick={() => setShowInvite(true)}
            disabled={seatCurrent >= seatMax}
            className="w-full sm:w-auto"
          >
            <UserPlus className="w-4 h-4 mr-2" />
            Invite Member
          </Button>
        )}
      </div>

      {/* Invite Form */}
      {showInvite && (
        <div className="rounded-xl border border-border p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">
            Invite a team member
          </h3>
          <InviteForm onClose={() => setShowInvite(false)} />
        </div>
      )}

      {/* Owner Row */}
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted-foreground px-1">Owner</p>
        <div className="flex items-center gap-4 px-4 py-3 rounded-xl border border-border bg-muted/30">
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
            {(session?.user?.name ?? session?.user?.email ?? "O").charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {isOwner ? "You" : session?.user?.email ?? "Owner"}
            </p>
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Shield className="w-3 h-3" />
              Owner
            </span>
          </div>
        </div>
      </div>

      {/* Team Members */}
      {members.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground px-1">
            Members
          </p>
          <div className="space-y-2">
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                isOwnerView={isOwner}
              />
            ))}
          </div>
        </div>
      )}

      {members.length === 0 && !showInvite && (
        <div className="rounded-xl border border-border p-8 text-center space-y-3">
          <Users className="w-10 h-10 text-muted-foreground mx-auto" />
          <div className="space-y-1">
            <p className="font-medium text-foreground">No team members yet</p>
            <p className="text-sm text-muted-foreground">
              Invite your team to collaborate on projects.
            </p>
          </div>
        </div>
      )}

      {seatCurrent >= seatMax && (
        <p className="text-sm text-muted-foreground text-center">
          You've reached your seat limit. Upgrade your plan for more seats.
        </p>
      )}
    </div>
  );
}

export default Members;
