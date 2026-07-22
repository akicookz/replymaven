import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  ChevronsUpDown,
  UserPlus,
  Loader2,
  Mail,
  Shield,
  User,
  MoreHorizontal,
  Trash2,
  Clock,
  CheckCircle2,
  Link,
  Check,
  Lock,
  Layers,
  Folder,
  Settings2,
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useTeam, type TeamMember } from "@/hooks/use-team";
import { useTeams } from "@/hooks/use-teams";
import { useSubscription } from "@/hooks/use-subscription";
import { useSession } from "@/lib/auth-client";
import {
  createProjectAccess,
  getSelectedProjectIds,
  type ProjectAccessSelection,
} from "@/lib/project-access";
import { formatProjectAccessLabel } from "@/lib/team-permissions";
import { cn } from "@/lib/utils";
import { MobileMenuButton } from "@/components/PageHeader";

// ─── Project access types & helpers ─────────────────────────────────────────────

interface ProjectLite {
  id: string;
  name: string;
  domain: string | null;
}

function useProjectsList() {
  return useQuery<ProjectLite[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      const res = await fetch("/api/projects");
      if (!res.ok) throw new Error("Failed to fetch projects");
      return res.json();
    },
  });
}

// ─── Project Access Picker ──────────────────────────────────────────────────────

function ProjectAccessPicker({
  projects,
  value,
  onChange,
}: {
  projects: ProjectLite[];
  value: ProjectAccessSelection;
  onChange: (next: ProjectAccessSelection) => void;
}) {
  const allProjectIds = projects.map((project) => project.id);
  const selected = new Set(
    getSelectedProjectIds(value, allProjectIds),
  );

  function toggleProject(projectId: string, checked: boolean): void {
    const next = new Set(selected);
    if (checked) next.add(projectId);
    else next.delete(projectId);
    onChange(createProjectAccess(allProjectIds, [...next]));
  }

  return (
    <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
      {projects.length === 0 ? (
        <p className="rounded-xl bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
          No projects yet.
        </p>
      ) : (
        projects.map((project) => {
          const checked = selected.has(project.id);
          return (
            <label
              key={project.id}
              className={cn(
                "flex min-h-16 cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 transition-[background-color,box-shadow]",
                checked
                  ? "bg-primary/10 shadow-[inset_0_0_0_1px_var(--primary)]"
                  : "bg-muted/40 shadow-[inset_0_0_0_1px_transparent] hover:bg-muted/60",
              )}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={(nextChecked) =>
                  toggleProject(project.id, nextChecked === true)
                }
                aria-label={`Select ${project.name}`}
                className="size-5 rounded-md"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">
                  {project.name}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {project.domain ?? "Customer support project"}
                </span>
              </span>
            </label>
          );
        })
      )}
    </div>
  );
}

// ─── Invite Form ──────────────────────────────────────────────────────────────

function InviteForm({
  onClose,
  projects,
}: {
  onClose: () => void;
  projects: ProjectLite[];
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [access, setAccess] = useState<ProjectAccessSelection>({
    accessAllProjects: true,
    projectIds: [],
  });
  const [inviteData, setInviteData] = useState<{ id: string; emailSent: boolean; emailError?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  // Members can be scoped to specific projects; admins always get full access.
  const scoped = role === "member" && !access.accessAllProjects;

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          role,
          accessAllProjects: role === "admin" ? true : access.accessAllProjects,
          projectIds: scoped ? access.projectIds : [],
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error: string };
        throw new Error(data.error);
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["team"] });
      setInviteData(data);
    },
  });

  const copyInviteLink = () => {
    if (!inviteData) return;
    const inviteUrl = `${window.location.origin}/app/team/accept/${inviteData.id}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (inviteData) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl bg-green-500/10 p-4">
          <p className="text-sm font-medium text-green-600 mb-1">Invitation sent!</p>
          <p className="text-sm text-muted-foreground">
            {inviteData.emailSent
              ? `We've sent an invitation email to ${email}.`
              : `The invitation was created but the email couldn't be sent. Share the link below:`}
          </p>
          {(!inviteData.emailSent || inviteData.emailError) && (
            <p className="text-xs text-yellow-600 mt-2">
              {inviteData.emailError || "Email might have landed in spam. Share the invite link manually."}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">Invite Link</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={`${window.location.origin}/app/team/accept/${inviteData.id}`}
              readOnly
              className="flex-1 px-4 py-2.5 rounded-xl border border-input bg-muted/50 text-foreground text-sm font-mono"
            />
            <Button
              variant="outline"
              onClick={copyInviteLink}
              className="shrink-0"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 mr-2" />
                  Copied!
                </>
              ) : (
                <>
                  <Link className="w-4 h-4 mr-2" />
                  Copy
                </>
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            This link will remain valid for 7 days.
          </p>
        </div>

        <Button onClick={onClose} className="w-full">
          Done
        </Button>
      </div>
    );
  }

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

      {role === "member" && (
        <ProjectAccessPicker
          projects={projects}
          value={access}
          onChange={setAccess}
        />
      )}

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
          disabled={
            !email.trim() ||
            inviteMutation.isPending ||
            (scoped && access.projectIds.length === 0)
          }
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
  projects,
}: {
  member: TeamMember;
  isOwnerView: boolean;
  projects: ProjectLite[];
}) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [accessDraft, setAccessDraft] = useState<ProjectAccessSelection>({
    accessAllProjects: member.accessAllProjects,
    projectIds: member.projectIds,
  });

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

  const accessMutation = useMutation({
    mutationFn: async (next: ProjectAccessSelection) => {
      const res = await fetch(`/api/team/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: member.role,
          accessAllProjects: next.accessAllProjects,
          projectIds: next.accessAllProjects ? [] : next.projectIds,
        }),
      });
      if (!res.ok) throw new Error("Failed to update project access");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team"] });
      setAccessOpen(false);
    },
  });

  function openAccessDialog() {
    setAccessDraft({
      accessAllProjects: member.accessAllProjects,
      projectIds: member.projectIds,
    });
    setAccessOpen(true);
  }

  const isPending = member.status === "pending";
  const canScope = member.role === "member";

  const copyInviteLink = () => {
    const inviteUrl = `${window.location.origin}/app/team/accept/${member.id}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <tr className="hover:bg-muted/20 transition-colors">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
            {member.email.charAt(0).toUpperCase()}
          </div>
          <span className="text-sm font-medium text-foreground truncate">
            {member.email}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm text-muted-foreground capitalize flex items-center gap-1.5">
          {member.role === "admin" ? (
            <Shield className="w-3.5 h-3.5" />
          ) : (
            <User className="w-3.5 h-3.5" />
          )}
          {member.role}
        </span>
      </td>
      <td className="px-4 py-3">
        {isPending ? (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-yellow-500 bg-yellow-500/15">
            <Clock className="w-3 h-3" />
            Pending
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-green-500 bg-green-500/15">
            <CheckCircle2 className="w-3 h-3" />
            Accepted
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {member.role === "admin" || member.accessAllProjects ? (
            <Layers className="w-3.5 h-3.5" />
          ) : (
            <Folder className="w-3.5 h-3.5" />
          )}
          {formatProjectAccessLabel(member)}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
        {isPending && (
          <button
            onClick={copyInviteLink}
            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors"
            title="Copy invite link"
          >
            {copied ? (
              <Check className="w-4 h-4 text-green-600" />
            ) : (
              <Link className="w-4 h-4" />
            )}
          </button>
        )}

        {isOwnerView && (
          <Popover>
            <PopoverTrigger asChild>
              <button className="p-1.5 rounded-md hover:bg-accent text-muted-foreground transition-colors">
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1">
              {isPending && (
                <>
                  <button
                    onClick={copyInviteLink}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    <Link className="w-4 h-4 shrink-0" />
                    Copy Invite Link
                  </button>
                  <div className="h-px bg-muted my-1" />
                </>
              )}
              {!isPending && (
                <button
                  onClick={() =>
                    roleMutation.mutate(
                      member.role === "admin" ? "member" : "admin",
                    )
                  }
                  disabled={roleMutation.isPending}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <Shield className="w-4 h-4 shrink-0" />
                  {member.role === "admin" ? "Demote to Member" : "Promote to Admin"}
                </button>
              )}
              {canScope && (
                <button
                  onClick={openAccessDialog}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <Settings2 className="w-4 h-4 shrink-0" />
                  Manage Access
                </button>
              )}
              <button
                onClick={() => removeMutation.mutate()}
                disabled={removeMutation.isPending}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="w-4 h-4 shrink-0" />
                {isPending ? "Cancel Invite" : "Remove"}
              </button>
            </PopoverContent>
          </Popover>
        )}
        </div>

      <Dialog open={accessOpen} onOpenChange={setAccessOpen}>
        <DialogContent className="gap-4 rounded-2xl p-5 sm:max-w-[420px]">
          <DialogHeader className="gap-1 pr-8">
            <DialogTitle className="text-lg leading-tight">
              Manage access
            </DialogTitle>
            <DialogDescription>
              Select the projects {member.email} can access.
            </DialogDescription>
          </DialogHeader>
          <ProjectAccessPicker
            projects={projects}
            value={accessDraft}
            onChange={setAccessDraft}
          />
          {accessMutation.isError && (
            <p className="text-sm text-destructive">
              {accessMutation.error.message}
            </p>
          )}
          <DialogFooter className="mt-1 flex-row justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAccessOpen(false)}
              className="active:scale-[0.96]"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => accessMutation.mutate(accessDraft)}
              disabled={
                accessMutation.isPending ||
                (!accessDraft.accessAllProjects &&
                  accessDraft.projectIds.length === 0)
              }
              className="active:scale-[0.96]"
            >
              {accessMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </td>
    </tr>
  );
}

// ─── Team Page ────────────────────────────────────────────────────────────────

function TeamSwitcher() {
  const [open, setOpen] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const { data } = useTeams();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const teams = data?.teams ?? [];
  const activeTeam = teams.find((team) => team.isActive);

  if (teams.length <= 1) return null;

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
          className="inline-flex h-8 min-w-0 max-w-56 items-center gap-2 rounded-lg bg-card/70 px-2.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-card disabled:opacity-60"
        >
          <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{activeTeam?.name ?? "Select team"}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">
        <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Teams
        </p>
        <div className="space-y-0.5">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => switchTeam(team.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                team.isActive
                  ? "bg-accent font-medium text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
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

function Team() {
  const [showInvite, setShowInvite] = useState(false);
  const { data: teamData, isLoading } = useTeam();
  const { data: subData } = useSubscription();
  const { data: session } = useSession();
  const { data: projects } = useProjectsList();
  const projectList = projects ?? [];

  if (isLoading) {
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
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <MobileMenuButton />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="shrink-0 text-xl font-bold text-foreground md:text-2xl">
                Team
              </h1>
              <TeamSwitcher />
            </div>
            <p className="text-xs md:text-sm text-muted-foreground mt-1">
              {seatCurrent} of {seatMax} seat{seatMax !== 1 ? "s" : ""} used
            </p>
          </div>
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
        <div className="rounded-2xl bg-card p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">
            Invite a team member
          </h3>
          <InviteForm
            onClose={() => setShowInvite(false)}
            projects={projectList}
          />
        </div>
      )}

      {/* Members Table */}
      <div className="rounded-2xl bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-4 pt-4 pb-2 font-medium">Member</th>
              <th className="px-4 pt-4 pb-2 font-medium">Role</th>
              <th className="px-4 pt-4 pb-2 font-medium">Status</th>
              <th className="px-4 pt-4 pb-2 font-medium">Access</th>
              <th className="px-4 pt-4 pb-2" />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                    {(session?.user?.name ?? session?.user?.email ?? "O").charAt(0).toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-foreground truncate">
                    {isOwner ? "You" : session?.user?.email ?? "Owner"}
                  </span>
                </div>
              </td>
              <td className="px-4 py-3">
                <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" />
                  Owner
                </span>
              </td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium text-green-500 bg-green-500/15">
                  <CheckCircle2 className="w-3 h-3" />
                  Active
                </span>
              </td>
              <td className="px-4 py-3">
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Layers className="w-3.5 h-3.5" />
                  All projects
                </span>
              </td>
              <td className="px-4 py-3" />
            </tr>
            {members.map((member) => (
              <MemberRow
                key={member.id}
                member={member}
                isOwnerView={isOwner}
                projects={projectList}
              />
            ))}
          </tbody>
        </table>
        {members.length === 0 && !showInvite && (
          <p className="px-4 pb-4 text-sm text-muted-foreground">
            No team members yet. Invite your team to collaborate on projects.
          </p>
        )}
      </div>

      {seatCurrent >= seatMax && (
        <div className="flex items-center gap-3 rounded-2xl bg-primary/5 px-4 py-3">
          <Lock className="w-4 h-4 text-primary shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">Seat limit reached</p>
            <p className="text-xs text-muted-foreground">
              You&apos;re using all {seatMax} seat{seatMax !== 1 ? "s" : ""} on your current plan. Upgrade to invite more team members.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { window.location.href = "/app/onboarding?step=4"; }}
          >
            Upgrade
          </Button>
        </div>
      )}
    </div>
  );
}

export default Team;
