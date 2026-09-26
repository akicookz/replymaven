import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  UserPlus,
  Loader2,
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
  Plus,
  X,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetCloseButton,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetHeaderContent,
  SheetTitle,
} from "@/components/ui/sheet";
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
  compact = false,
}: {
  projects: ProjectLite[];
  value: ProjectAccessSelection;
  onChange: (next: ProjectAccessSelection) => void;
  compact?: boolean;
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
    <div className={cn("grid max-h-64 gap-2 overflow-y-auto pr-1", compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3")}>
      {projects.length === 0 ? (
        <p className="rounded-xl glass-card px-3 py-4 text-sm text-muted-foreground">
          No projects yet.
        </p>
      ) : (
        projects.map((project) => {
          const checked = selected.has(project.id);
          return (
            <label
              key={project.id}
              className={cn(
                "glass-button flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5",
                checked && "bg-glass-raised inset-ring inset-ring-hairline-strong",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-foreground">
                  {project.name}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {project.domain ?? "Customer support project"}
                </span>
              </span>
              <Checkbox
                checked={checked}
                onCheckedChange={(nextChecked) =>
                  toggleProject(project.id, nextChecked === true)
                }
                aria-label={`Select ${project.name}`}
              />
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
  maxInvites,
}: {
  onClose: () => void;
  projects: ProjectLite[];
  maxInvites: number;
}) {
  const [invites, setInvites] = useState<Array<{ id: string; email: string; role: "admin" | "member" }>>([
    { id: crypto.randomUUID(), email: "", role: "member" },
  ]);
  const [access, setAccess] = useState<ProjectAccessSelection>({
    accessAllProjects: true,
    projectIds: [],
  });
  const [inviteData, setInviteData] = useState<Array<{ id: string; email: string; role: "admin" | "member"; emailSent: boolean; emailError?: string }> | null>(null);
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const scoped = !access.accessAllProjects;

  const inviteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/team/invite/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invites: invites.map(({ email, role }) => ({ email: email.trim(), role })),
          accessAllProjects: access.accessAllProjects,
          projectIds: scoped ? access.projectIds : [],
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error: string };
        throw new Error(data.error);
      }
      return (await res.json()) as { invites: Array<{ id: string; email: string; role: "admin" | "member"; emailSent: boolean; emailError?: string }> };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["team"] });
      queryClient.invalidateQueries({ queryKey: ["subscription"] });
      setInviteData(data.invites);
    },
  });

  if (inviteData) {
    return (
      <>
      <SheetBody className="px-5 py-5">
        <div className="space-y-3">
          {inviteData.map((invite) => (
            <div key={invite.id} className="rounded-xl glass-card p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{invite.email}</p>
                  <p className="text-xs text-muted-foreground">{invite.emailSent ? "Invitation email sent" : "Invite created. Email could not be sent."}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/app/team/accept/${invite.id}`);
                  setCopiedInviteId(invite.id);
                  setTimeout(() => setCopiedInviteId(null), 2000);
                }}>
                  {copiedInviteId === invite.id ? <Check className="mr-1.5 size-4" /> : <Link className="mr-1.5 size-4" />}
                  {copiedInviteId === invite.id ? "Copied" : "Copy link"}
                </Button>
              </div>
              {(!invite.emailSent || invite.emailError) && <p className="mt-2 text-xs text-yellow-600">{invite.emailError || "Share the invite link manually."}</p>}
            </div>
          ))}
        </div>
      </SheetBody>
      <SheetFooter className="px-5 pb-5">
        <Button onClick={onClose}>Done</Button>
      </SheetFooter>
      </>
    );
  }

  return (
    <>
    <SheetBody className="space-y-6 px-5 py-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor={`invite-email-${invites[0]?.id}`}>Email addresses</Label>
          <Button type="button" variant="ghost" size="sm" disabled={invites.length >= maxInvites} onClick={() => setInvites((rows) => [...rows, { id: crypto.randomUUID(), email: "", role: "member" }])} className="-mr-2 text-muted-foreground hover:text-foreground">
            <Plus /> Add email
          </Button>
        </div>
        <div className="space-y-2">
          {invites.map((invite, index) => (
            <div key={invite.id} className="flex items-center gap-2">
              <Input id={`invite-email-${invite.id}`} type="email" value={invite.email} placeholder="teammate@company.com" aria-label={`Email address ${index + 1}`} onChange={(event) => setInvites((rows) => rows.map((row) => row.id === invite.id ? { ...row, email: event.target.value } : row))} />
              <Select value={invite.role} onValueChange={(value) => setInvites((rows) => rows.map((row) => row.id === invite.id ? { ...row, role: value as "admin" | "member" } : row))}>
                <SelectTrigger className="w-28 shrink-0" aria-label={`Role for email ${index + 1}`}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="admin">Admin</SelectItem><SelectItem value="member">Member</SelectItem></SelectContent>
              </Select>
              {invites.length > 1 && <Button type="button" variant="ghost" size="icon" aria-label={`Remove email ${index + 1}`} onClick={() => setInvites((rows) => rows.filter((row) => row.id !== invite.id))} className="shrink-0 text-muted-foreground hover:text-foreground"><X /></Button>}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Project access</Label>
        <ProjectAccessPicker projects={projects} value={access} onChange={setAccess} />
      </div>

      {inviteMutation.isError && (
        <p className="text-sm text-destructive">
          {inviteMutation.error.message}
        </p>
      )}

    </SheetBody>
    <SheetFooter className="px-5 pb-5">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => inviteMutation.mutate()}
          disabled={
            invites.some((invite) => !invite.email.trim()) ||
            invites.length > maxInvites ||
            new Set(invites.map((invite) => invite.email.trim().toLowerCase())).size !== invites.length ||
            inviteMutation.isPending ||
            (scoped && access.projectIds.length === 0)
          }
        >
          {inviteMutation.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <UserPlus />
          )}
          {invites.length > 1 ? "Send invites" : "Send invite"}
        </Button>
    </SheetFooter>
    </>
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
  const [actionsOpen, setActionsOpen] = useState(false);
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
    setActionsOpen(false);
    window.setTimeout(() => setAccessOpen(true), 0);
  }

  const isPending = member.status === "pending";
  const copyInviteLink = () => {
    const inviteUrl = `${window.location.origin}/app/team/accept/${member.id}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <tr className="hover:bg-glass-card transition-colors">
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
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] text-xs font-medium text-yellow-500 bg-yellow-500/15">
            <Clock className="w-3 h-3" />
            Pending
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] text-xs font-medium text-green-500 bg-green-500/15">
            <CheckCircle2 className="w-3 h-3" />
            Accepted
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          {member.accessAllProjects ? (
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
          <Popover open={actionsOpen} onOpenChange={setActionsOpen}>
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
              {isOwnerView && (
                <button
                  type="button"
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
            compact
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isSwitching}
          aria-label="Switch team"
          className="min-w-0 max-w-56 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
        >
          <span className="truncate">{activeTeam?.name ?? "Select team"}</span>
          <ChevronDown
            className={cn(
              "size-3.5 transition-transform",
              open && "rotate-180",
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">
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
        {isOwner && (
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

      <Sheet open={showInvite} onOpenChange={setShowInvite}>
        <SheetContent className="sm:max-w-2xl">
          <SheetHeader>
            <SheetHeaderContent>
              <SheetTitle>Invite team members</SheetTitle>
            </SheetHeaderContent>
            <SheetCloseButton />
          </SheetHeader>
          {showInvite && <InviteForm onClose={() => setShowInvite(false)} projects={projectList} maxInvites={Math.max(0, seatMax - seatCurrent)} />}
        </SheetContent>
      </Sheet>

      {/* Members Table */}
      <div className="glass-card rounded-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
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
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] text-xs font-medium text-green-500 bg-green-500/15">
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
