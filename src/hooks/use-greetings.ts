import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

export type GreetingImageAspect = "landscape" | "square";

// Must match worker/lib/greeting-media.ts.
const VIDEO_EXTENSIONS = /\.(?:mp4|webm|ogv|ogg)(?:$|[?#])/i;

export function isGreetingVideoUrl(url: string | null | undefined): boolean {
  return Boolean(url && VIDEO_EXTENSIONS.test(url));
}

export interface GreetingData {
  id: string;
  enabled: boolean;
  /** Artwork when there is no video, poster frame when there is. */
  imageUrl: string | null;
  videoUrl: string | null;
  mediaType?: "image" | "video" | null;
  imagePosition: string | null;
  imageAspect: GreetingImageAspect | null;
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
  videoUrl?: string | null;
  imagePosition?: string | null;
  imageAspect?: GreetingImageAspect | null;
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
  uploadMedia: (file: File) => Promise<string>;
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

  async function uploadMedia(file: File): Promise<string> {
    const allowedImage = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
    const allowedVideo = ["video/mp4", "video/webm", "video/ogg"].includes(file.type);
    if (!allowedImage && !allowedVideo) {
      throw new Error("Choose a JPG, PNG, WebP, MP4, WebM, or OGG file");
    }
    const maxBytes = allowedVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error(`File too large (max ${allowedVideo ? "50MB" : "10MB"})`);
    }
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
    uploadMedia,
  };
}
