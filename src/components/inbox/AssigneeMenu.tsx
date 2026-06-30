import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Check, ChevronDownIcon, UserIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// Mirrors the shape returned by GET /api/projects/:id/assignable-users
// (TicketService.getAssignableUsers) — reused for conversation assignment.
interface AssignableUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "owner" | "admin" | "member";
}

interface AssigneeMenuProps {
  value: string | null;
  onChange: (assigneeId: string | null) => void;
}

function initials(name: string, email: string): string {
  const src = name?.trim() || email || "?";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return src[0]?.toUpperCase() ?? "?";
}

function Avatar({ user, size = 18 }: { user: AssignableUser; size?: number }) {
  if (user.image) {
    return (
      <img
        src={user.image}
        alt=""
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="rounded-full bg-glass-raised text-ink-2 flex items-center justify-center font-semibold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {initials(user.name, user.email)}
    </span>
  );
}

export default function AssigneeMenu({ value, onChange }: AssigneeMenuProps) {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: users } = useQuery<AssignableUser[]>({
    queryKey: ["assignable-users", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/assignable-users`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectId,
    staleTime: 60_000,
  });

  const list = users ?? [];
  const current = value ? (list.find((u) => u.id === value) ?? null) : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Assign conversation"
          aria-pressed={!!current}
          className={cn(
            "glass-button rounded-glass flex items-center gap-1.5 pl-1.5 pr-2 h-8 text-[12.5px] cursor-pointer select-none outline-none shrink-0 transition-colors",
            current ? "text-[--brand] bg-glass-raised" : "text-ink-3",
          )}
          title="Assign to a teammate"
        >
          {current ? (
            <Avatar user={current} />
          ) : (
            <UserIcon className="size-4 text-ink-6" />
          )}
          <span className="max-w-[96px] truncate">
            {current ? current.name || current.email : "Assign"}
          </span>
          <ChevronDownIcon className="size-3 text-ink-6" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[210px]">
        <DropdownMenuItem onSelect={() => onChange(null)}>
          <UserIcon className="size-4 text-ink-6" />
          <span className="flex-1">Unassigned</span>
          {value == null && <Check className="size-4 text-[--brand]" />}
        </DropdownMenuItem>
        {list.map((u) => (
          <DropdownMenuItem key={u.id} onSelect={() => onChange(u.id)}>
            <Avatar user={u} size={20} />
            <span className="flex-1 min-w-0 truncate">{u.name || u.email}</span>
            {value === u.id && <Check className="size-4 text-[--brand] shrink-0" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
