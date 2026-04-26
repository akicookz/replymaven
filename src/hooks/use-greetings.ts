import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

export interface GreetingData {
  id: string;
  enabled: boolean;
  imageUrl: string | null;
  title: string;
  description: string | null;
  ctaText: string | null;
  ctaLink: string | null;
  authorId: string | null;
  allowedPages: string[] | null;
  delaySeconds: number;
  durationSeconds: number;
  sortOrder: number;
}

export interface CreateGreetingInput {
  enabled?: boolean;
  imageUrl?: string | null;
  title: string;
  description?: string | null;
  ctaText?: string | null;
  ctaLink?: string | null;
  authorId?: string | null;
  allowedPages?: string[] | null;
  delaySeconds?: number;
  durationSeconds?: number;
}

export interface UpdateGreetingInput extends Partial<CreateGreetingInput> {
  sortOrder?: number;
}

export interface UseGreetingsResult {
  query: UseQueryResult<GreetingData[]>;
  greetings: GreetingData[];
  create: UseMutationResult<GreetingData, Error, CreateGreetingInput>;
  update: UseMutationResult<
    GreetingData,
    Error,
    { id: string; updates: UpdateGreetingInput }
  >;
  remove: UseMutationResult<void, Error, string>;
  reorder: UseMutationResult<void, Error, string[]>;
  uploadImage: (file: File) => Promise<string>;
}

export function useGreetings(projectId: string): UseGreetingsResult {
  const queryClient = useQueryClient();

  const query = useQuery<GreetingData[]>({
    queryKey: ["greetings", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/greetings`);
      if (!res.ok) throw new Error("Failed to fetch greetings");
      return res.json();
    },
    enabled: !!projectId,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["greetings", projectId] });
  }

  const create = useMutation<GreetingData, Error, CreateGreetingInput>({
    mutationFn: async (input) => {
      const res = await fetch(`/api/projects/${projectId}/greetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Failed to create greeting");
      }
      return res.json();
    },
    onSuccess: invalidate,
  });

  const update = useMutation<
    GreetingData,
    Error,
    { id: string; updates: UpdateGreetingInput }
  >({
    mutationFn: async ({ id, updates }) => {
      const res = await fetch(
        `/api/projects/${projectId}/greetings/${id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Failed to update greeting");
      }
      return res.json();
    },
    onSuccess: invalidate,
  });

  const remove = useMutation<void, Error, string>({
    mutationFn: async (id) => {
      const res = await fetch(
        `/api/projects/${projectId}/greetings/${id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("Failed to delete greeting");
    },
    onSuccess: invalidate,
  });

  const reorder = useMutation<void, Error, string[]>({
    mutationFn: async (ids) => {
      const res = await fetch(
        `/api/projects/${projectId}/greetings/reorder`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        },
      );
      if (!res.ok) throw new Error("Failed to reorder greetings");
    },
    onSuccess: invalidate,
  });

  async function uploadImage(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) throw new Error("Upload failed");
    const { url } = (await res.json()) as { url: string };
    return url;
  }

  return {
    query,
    greetings: query.data ?? [],
    create,
    update,
    remove,
    reorder,
    uploadImage,
  };
}
