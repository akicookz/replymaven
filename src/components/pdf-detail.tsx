import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Loader2, RefreshCw, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PdfDetailProps {
  projectId: string;
  resourceId: string;
  resourceTitle: string;
  onReindex?: () => void;
}

function PdfResourceDetail({
  projectId,
  resourceId,
  resourceTitle,
  onReindex,
}: PdfDetailProps) {
  const queryClient = useQueryClient();
  const [editedContent, setEditedContent] = useState<string>("");
  const [hasEdits, setHasEdits] = useState(false);
  const [originalContent, setOriginalContent] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const { isLoading } = useQuery<{ content: string | null }>({
    queryKey: ["resource-content", projectId, resourceId],
    queryFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}/content`,
      );
      if (!res.ok) throw new Error("Failed to fetch content");
      const data = (await res.json()) as { content: string | null };
      const text = data.content ?? "";
      setOriginalContent(text);
      setEditedContent(text);
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      setError(null);
      const res = await fetch(
        `/api/projects/${projectId}/resources/${resourceId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: editedContent,
          }),
        },
      );
      if (!res.ok) {
        const err = await res
          .json()
          .catch(() => ({ error: "Failed to save" }));
        throw new Error((err as { error?: string }).error ?? "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      setOriginalContent(editedContent);
      setHasEdits(false);
      queryClient.invalidateQueries({
        queryKey: ["resource-content", projectId, resourceId],
      });
      queryClient.invalidateQueries({
        queryKey: ["resources", projectId],
      });
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 px-2">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          Loading extracted text...
        </span>
      </div>
    );
  }

  if (!originalContent && !editedContent) {
    return (
      <div className="py-4 px-2 space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileText className="w-4 h-4" />
          <span>
            No text could be extracted from this PDF. You can re-index to try
            again or manually enter the content below.
          </span>
        </div>
        <div className="space-y-2">
          <textarea
            value={editedContent}
            onChange={(e) => {
              setEditedContent(e.target.value);
              setHasEdits(true);
            }}
            placeholder="Paste or type the PDF content here..."
            rows={8}
            className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex gap-2">
            {hasEdits && (
              <Button
                size="sm"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Save
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onReindex}>
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Re-extract
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 py-2">
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="w-3.5 h-3.5" />
          <span>
            Extracted text from{" "}
            <span className="font-medium text-foreground">{resourceTitle}</span>
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={onReindex}>
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
          Re-extract
        </Button>
      </div>

      <textarea
        value={editedContent}
        onChange={(e) => {
          setEditedContent(e.target.value);
          setHasEdits(e.target.value !== originalContent);
        }}
        rows={12}
        className="w-full px-3 py-2 rounded-lg border border-input bg-background text-sm font-mono resize-y focus:outline-none focus:ring-2 focus:ring-ring"
      />

      {hasEdits && (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            Save Changes
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditedContent(originalContent);
              setHasEdits(false);
            }}
          >
            Discard
          </Button>
        </div>
      )}
    </div>
  );
}

export default PdfResourceDetail;
