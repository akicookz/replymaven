import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type GreetingRow } from "./db";
import { WidgetService } from "./services/widget-service";
import { resolveGreetingMedia } from "./lib/greeting-media";
import {
  createGreetingSchema,
  reorderGreetingsSchema,
  updateGreetingSchema,
} from "./validation";
import {
  confirmedMutationSchema,
  getAccessibleProject,
  requireScope,
  serializeDate,
  textResult,
  type McpRequestContext,
} from "./mcp-tool-helpers";

export function registerWidgetTools(
  server: McpServer,
  context: McpRequestContext,
): void {
  registerListGreetingsTool(server, context);
  registerCreateGreetingTool(server, context);
  registerUpdateGreetingTool(server, context);
  registerDeleteGreetingTool(server, context);
  registerReorderGreetingsTool(server, context);
}

// Video and uploaded artwork need a stored `/api/uploads/...` path, which MCP
// has no way to produce, so these tools stay on text, CTA, and hosted images.
const greetingFields = {
  imageUrl: createGreetingSchema.shape.imageUrl.describe(
    "Publicly reachable image URL, or null for a plain card.",
  ),
  imagePosition: createGreetingSchema.shape.imagePosition.describe(
    'Image focal point as "X% Y%". Null centers it.',
  ),
  imageAspect: createGreetingSchema.shape.imageAspect.describe(
    "Image crop: landscape or square.",
  ),
  description: createGreetingSchema.shape.description.describe(
    "Body text under the title.",
  ),
  ctaText: createGreetingSchema.shape.ctaText.describe("Call to action label."),
  ctaLink: createGreetingSchema.shape.ctaLink.describe(
    "Call to action URL. Required for the label to show.",
  ),
  allowedPages: createGreetingSchema.shape.allowedPages.describe(
    "Page patterns this card shows on. Null shows it everywhere.",
  ),
  delaySeconds: createGreetingSchema.shape.delaySeconds.describe(
    "Seconds before the card appears. Defaults to 3.",
  ),
  durationSeconds: createGreetingSchema.shape.durationSeconds.describe(
    "Seconds before the card hides itself. 0 keeps it up. Defaults to 15.",
  ),
  sortOrder: createGreetingSchema.shape.sortOrder.describe(
    "Position in the stack. Defaults to last.",
  ),
};

function summarizeGreeting(row: GreetingRow) {
  return {
    id: row.id,
    enabled: row.enabled,
    ...resolveGreetingMedia(row),
    imagePosition: row.imagePosition,
    imageAspect: row.imageAspect,
    title: row.title,
    description: row.description,
    ctaText: row.ctaText,
    ctaLink: row.ctaLink,
    authorId: row.authorId,
    allowedPages: row.allowedPages
      ? (JSON.parse(row.allowedPages) as string[])
      : null,
    delaySeconds: row.delaySeconds,
    durationSeconds: row.durationSeconds,
    sortOrder: row.sortOrder,
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt),
  };
}

// ─── Read Tools ───────────────────────────────────────────────────────────────

function registerListGreetingsTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "list_greetings",
    {
      title: "List greetings",
      description:
        "List the widget's greeting cards in display order, enabled and disabled alike.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId }) => {
      requireScope(context, "projects:read");

      const project = await getAccessibleProject(context, projectId);
      const rows = await new WidgetService(context.db).getGreetings(project.id);

      return textResult({ greetings: rows.map(summarizeGreeting) });
    },
  );
}

// ─── Write Tools ──────────────────────────────────────────────────────────────

function registerCreateGreetingTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "create_greeting",
    {
      title: "Create greeting",
      description:
        "Add a greeting card to the widget. Cards with an image or a call to action render large; the rest render as a chat bubble.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        title: createGreetingSchema.shape.title.describe("Card title."),
        enabled: createGreetingSchema.shape.enabled.describe(
          "Show the card to visitors. Defaults to true.",
        ),
        ...greetingFields,
        confirm: confirmedMutationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectId, confirm, ...data }) => {
      requireScope(context, "widget:write");
      void confirm;

      const project = await getAccessibleProject(context, projectId);
      const greeting = await new WidgetService(context.db).createGreeting(
        project.id,
        data,
      );

      return textResult({ ok: true, greeting: summarizeGreeting(greeting) });
    },
  );
}

function registerUpdateGreetingTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "update_greeting",
    {
      title: "Update greeting",
      description:
        "Change one greeting card. Omitted fields keep their current value.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        greetingId: z.string().min(1).describe("Greeting card ID."),
        title: updateGreetingSchema.shape.title.describe("Replacement title."),
        enabled: updateGreetingSchema.shape.enabled.describe(
          "Show the card to visitors.",
        ),
        ...greetingFields,
        confirm: confirmedMutationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, greetingId, confirm, ...updates }) => {
      requireScope(context, "widget:write");
      void confirm;

      const project = await getAccessibleProject(context, projectId);
      const greeting = await new WidgetService(context.db).updateGreeting(
        greetingId,
        project.id,
        updates,
      );
      if (!greeting) throw new Error("Greeting not found");

      return textResult({ ok: true, greeting: summarizeGreeting(greeting) });
    },
  );
}

function registerDeleteGreetingTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "delete_greeting",
    {
      title: "Delete greeting",
      description: "Permanently remove one greeting card.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        greetingId: z.string().min(1).describe("Greeting card ID."),
        confirm: confirmedMutationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ projectId, greetingId }) => {
      requireScope(context, "widget:write");

      const project = await getAccessibleProject(context, projectId);
      const deleted = await new WidgetService(context.db).deleteGreeting(
        greetingId,
        project.id,
      );
      if (!deleted) throw new Error("Greeting not found");

      return textResult({ ok: true, greetingId });
    },
  );
}

function registerReorderGreetingsTool(
  server: McpServer,
  context: McpRequestContext,
): void {
  server.registerTool(
    "reorder_greetings",
    {
      title: "Reorder greetings",
      description:
        "Set the display order of the greeting stack. Ids not listed keep trailing positions.",
      inputSchema: {
        projectId: z.string().min(1).describe("ReplyMaven project ID."),
        ids: reorderGreetingsSchema.shape.ids.describe(
          "Greeting ids in the order they should appear.",
        ),
        confirm: confirmedMutationSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ projectId, ids }) => {
      requireScope(context, "widget:write");

      const project = await getAccessibleProject(context, projectId);
      const service = new WidgetService(context.db);
      await service.reorderGreetings(project.id, ids);
      const rows = await service.getGreetings(project.id);

      return textResult({ ok: true, greetings: rows.map(summarizeGreeting) });
    },
  );
}
