import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { Plus, X } from "lucide-react";
import type { MarkdownSerializerState } from "prosemirror-markdown";
import type { Node as PMNode } from "@tiptap/pm/model";

/**
 * API doc blocks. Each is an atom node whose structured data round-trips
 * through markdown as a fenced code block with a custom lang:
 *
 *   ```api-endpoint
 *   {"method":"POST","path":"/v1/messages","description":"..."}
 *   ```
 *
 * The worker renders these langs into styled HTML (apiBlocksExtension in
 * render-markdown.ts) — keep the data shapes in sync.
 */

export const API_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

// Mirrors the langs registered with highlight.js on the render side.
const EXAMPLE_LANGUAGES = [
  "bash",
  "javascript",
  "typescript",
  "json",
  "html",
  "css",
  "python",
  "sql",
  "text",
];

export interface ApiEndpointData {
  method: string;
  path: string;
  description: string;
}
export interface ApiStatusData {
  rows: { code: string; description: string }[];
}
export interface ApiParamsData {
  rows: { name: string; type: string; required: boolean; description: string }[];
}
export interface ApiExamplesData {
  examples: { label: string; language: string; code: string }[];
}

interface ApiNodeSpec {
  name: string;
  lang: string;
  defaultData: Record<string, unknown>;
  component: (props: NodeViewProps) => React.ReactNode;
}

function rewriteApiFences(element: HTMLElement, lang: string) {
  const selector = `pre > code.language-${lang}`;
  for (const code of Array.from(element.querySelectorAll(selector))) {
    const div = element.ownerDocument.createElement("div");
    div.setAttribute(`data-${lang}`, "");
    div.setAttribute("data-json", code.textContent ?? "");
    code.closest("pre")?.replaceWith(div);
  }
}

function createApiNode(spec: ApiNodeSpec) {
  return Node.create({
    name: spec.name,
    group: "block",
    atom: true,
    selectable: true,

    addAttributes() {
      return {
        data: {
          default: spec.defaultData,
          parseHTML: (element) => {
            try {
              const parsed = JSON.parse(
                element.getAttribute("data-json") ?? "",
              ) as unknown;
              if (typeof parsed === "object" && parsed !== null) return parsed;
            } catch {
              // fall through to default
            }
            return spec.defaultData;
          },
          renderHTML: (attrs) => ({ "data-json": JSON.stringify(attrs.data) }),
        },
      };
    },

    parseHTML() {
      return [{ tag: `div[data-${spec.lang}]` }];
    },

    renderHTML({ HTMLAttributes }) {
      return [
        "div",
        mergeAttributes(HTMLAttributes, { [`data-${spec.lang}`]: "" }),
      ];
    },

    addNodeView() {
      return ReactNodeViewRenderer(spec.component);
    },

    addStorage() {
      return {
        markdown: {
          serialize(state: MarkdownSerializerState, node: PMNode) {
            const json = JSON.stringify(node.attrs.data ?? spec.defaultData);
            const runs = json.match(/`+/g) ?? [];
            const fence = "`".repeat(
              Math.max(3, ...runs.map((r) => r.length + 1)),
            );
            state.write(`${fence}${spec.lang}`);
            state.ensureNewLine();
            state.text(json, false);
            state.ensureNewLine();
            state.write(fence);
            state.closeBlock(node);
          },
          parse: {
            updateDOM(element: HTMLElement) {
              rewriteApiFences(element, spec.lang);
            },
          },
        },
      };
    },
  });
}

/* ─── Shared form chrome ─────────────────────────────────────────────────── */

function ApiCard({
  label,
  onDelete,
  children,
}: {
  label: string;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  return (
    <NodeViewWrapper className="help-editor-api">
      <div contentEditable={false}>
        <div className="help-editor-api-head">
          <span className="help-editor-api-kind">{label}</span>
          <button
            type="button"
            className="help-editor-api-remove"
            onClick={onDelete}
            aria-label={`Remove ${label} block`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {children}
      </div>
    </NodeViewWrapper>
  );
}

function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="help-editor-api-add" onClick={onClick}>
      <Plus className="w-3.5 h-3.5" />
      {label}
    </button>
  );
}

/* ─── Endpoint ───────────────────────────────────────────────────────────── */

function ApiEndpointView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const data = (node.attrs.data ?? {}) as Partial<ApiEndpointData>;
  const method = API_METHODS.includes(
    String(data.method ?? "").toUpperCase() as (typeof API_METHODS)[number],
  )
    ? String(data.method).toUpperCase()
    : "GET";
  const set = (patch: Partial<ApiEndpointData>) =>
    updateAttributes({ data: { ...data, method, ...patch } });

  return (
    <ApiCard label="API endpoint" onDelete={deleteNode}>
      <div className="help-editor-api-row">
        <select
          className={`help-editor-api-method is-${method.toLowerCase()}`}
          value={method}
          onChange={(e) => set({ method: e.target.value })}
          aria-label="HTTP method"
        >
          {API_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="help-editor-api-input help-editor-api-mono"
          value={data.path ?? ""}
          onChange={(e) => set({ path: e.target.value })}
          placeholder="/v1/resource/{id}"
          aria-label="Endpoint path"
        />
      </div>
      <input
        type="text"
        className="help-editor-api-input"
        value={data.description ?? ""}
        onChange={(e) => set({ description: e.target.value })}
        placeholder="Short description (inline markdown supported)"
        aria-label="Endpoint description"
      />
    </ApiCard>
  );
}

/* ─── Status codes ───────────────────────────────────────────────────────── */

function statusClass(code: string): string {
  const c = code.charAt(0);
  if (c === "2") return "is-2xx";
  if (c === "4") return "is-4xx";
  if (c === "5") return "is-5xx";
  return "is-other";
}

function ApiStatusView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const data = (node.attrs.data ?? {}) as Partial<ApiStatusData>;
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const setRows = (next: ApiStatusData["rows"]) =>
    updateAttributes({ data: { rows: next } });
  const updateRow = (i: number, patch: Partial<ApiStatusData["rows"][number]>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <ApiCard label="Status codes" onDelete={deleteNode}>
      {rows.map((row, i) => (
        <div className="help-editor-api-row" key={i}>
          <input
            type="text"
            className={`help-editor-api-input help-editor-api-mono help-editor-api-code ${statusClass(String(row.code ?? ""))}`}
            value={row.code ?? ""}
            onChange={(e) => updateRow(i, { code: e.target.value })}
            placeholder="200"
            aria-label="Status code"
          />
          <input
            type="text"
            className="help-editor-api-input"
            value={row.description ?? ""}
            onChange={(e) => updateRow(i, { description: e.target.value })}
            placeholder="Description"
            aria-label="Status description"
          />
          <button
            type="button"
            className="help-editor-api-row-remove"
            onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
            aria-label="Remove row"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <AddRowButton
        label="Add status"
        onClick={() => setRows([...rows, { code: "", description: "" }])}
      />
    </ApiCard>
  );
}

/* ─── Parameters ─────────────────────────────────────────────────────────── */

function ApiParamsView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const data = (node.attrs.data ?? {}) as Partial<ApiParamsData>;
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const setRows = (next: ApiParamsData["rows"]) =>
    updateAttributes({ data: { rows: next } });
  const updateRow = (i: number, patch: Partial<ApiParamsData["rows"][number]>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <ApiCard label="Parameters" onDelete={deleteNode}>
      {rows.map((row, i) => (
        <div className="help-editor-api-param-row" key={i}>
          <div className="help-editor-api-row">
            <input
              type="text"
              className="help-editor-api-input help-editor-api-mono"
              value={row.name ?? ""}
              onChange={(e) => updateRow(i, { name: e.target.value })}
              placeholder="name"
              aria-label="Parameter name"
            />
            <input
              type="text"
              className="help-editor-api-input help-editor-api-mono help-editor-api-type"
              value={row.type ?? ""}
              onChange={(e) => updateRow(i, { type: e.target.value })}
              placeholder="string"
              aria-label="Parameter type"
            />
            <label className="help-editor-api-required">
              <input
                type="checkbox"
                checked={row.required === true}
                onChange={(e) => updateRow(i, { required: e.target.checked })}
              />
              required
            </label>
            <button
              type="button"
              className="help-editor-api-row-remove"
              onClick={() => setRows(rows.filter((_, idx) => idx !== i))}
              aria-label="Remove parameter"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <input
            type="text"
            className="help-editor-api-input"
            value={row.description ?? ""}
            onChange={(e) => updateRow(i, { description: e.target.value })}
            placeholder="Description (inline markdown supported)"
            aria-label="Parameter description"
          />
        </div>
      ))}
      <AddRowButton
        label="Add parameter"
        onClick={() =>
          setRows([
            ...rows,
            { name: "", type: "string", required: false, description: "" },
          ])
        }
      />
    </ApiCard>
  );
}

/* ─── Request/response examples ──────────────────────────────────────────── */

function ApiExamplesView({ node, updateAttributes, deleteNode }: NodeViewProps) {
  const data = (node.attrs.data ?? {}) as Partial<ApiExamplesData>;
  const examples = Array.isArray(data.examples) ? data.examples : [];
  const setExamples = (next: ApiExamplesData["examples"]) =>
    updateAttributes({ data: { examples: next } });
  const updateExample = (
    i: number,
    patch: Partial<ApiExamplesData["examples"][number]>,
  ) =>
    setExamples(examples.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));

  return (
    <ApiCard label="Examples" onDelete={deleteNode}>
      {examples.map((example, i) => (
        <div className="help-editor-api-example" key={i}>
          <div className="help-editor-api-row">
            <input
              type="text"
              className="help-editor-api-input"
              value={example.label ?? ""}
              onChange={(e) => updateExample(i, { label: e.target.value })}
              placeholder="Label (e.g. cURL, Response)"
              aria-label="Example label"
            />
            <select
              className="help-editor-api-lang"
              value={example.language ?? "bash"}
              onChange={(e) => updateExample(i, { language: e.target.value })}
              aria-label="Example language"
            >
              {EXAMPLE_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {lang}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="help-editor-api-row-remove"
              onClick={() =>
                setExamples(examples.filter((_, idx) => idx !== i))
              }
              aria-label="Remove example"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <textarea
            className="help-editor-api-textarea"
            value={example.code ?? ""}
            onChange={(e) => updateExample(i, { code: e.target.value })}
            placeholder="Code…"
            rows={4}
            spellCheck={false}
            aria-label="Example code"
          />
        </div>
      ))}
      <AddRowButton
        label="Add example"
        onClick={() =>
          setExamples([...examples, { label: "", language: "bash", code: "" }])
        }
      />
    </ApiCard>
  );
}

/* ─── Nodes ──────────────────────────────────────────────────────────────── */

export const ApiEndpoint = createApiNode({
  name: "apiEndpoint",
  lang: "api-endpoint",
  defaultData: { method: "GET", path: "", description: "" },
  component: ApiEndpointView,
});

export const ApiStatus = createApiNode({
  name: "apiStatus",
  lang: "api-status",
  defaultData: { rows: [{ code: "200", description: "OK" }] },
  component: ApiStatusView,
});

export const ApiParams = createApiNode({
  name: "apiParams",
  lang: "api-params",
  defaultData: {
    rows: [{ name: "", type: "string", required: false, description: "" }],
  },
  component: ApiParamsView,
});

export const ApiExamples = createApiNode({
  name: "apiExamples",
  lang: "api-examples",
  defaultData: { examples: [{ label: "Request", language: "bash", code: "" }] },
  component: ApiExamplesView,
});
