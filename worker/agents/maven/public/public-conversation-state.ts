import type { PublicConversationRecord } from "../../../../shared/maven-conversation";

type SqlBinding = string | number | null;

export interface PublicConversationStateSql {
  execute<T>(query: string, bindings: SqlBinding[]): T[];
}

export interface StoredPublicConversationState extends PublicConversationRecord {
  revision: number;
  legacyChecksum: string | null;
  runtimeVersion: number;
  externalActionLeaseId: string | null;
  retentionScheduleId: string | null;
  autoCloseScheduleId: string | null;
}

interface PublicConversationStateRow {
  conversation_id: string;
  project_id: string;
  customer_id: string | null;
  visitor_id: string;
  visitor_name: string | null;
  visitor_email: string | null;
  status: string;
  close_reason: string | null;
  telegram_thread_id: string | null;
  metadata_json: string;
  chat_state_json: string;
  last_activity_at: number;
  visitor_last_seen_at: number | null;
  visitor_presence: string;
  visitor_last_online_at: number | null;
  snoozed_until: number | null;
  archived_at: number | null;
  purge_started_at: number | null;
  external_action_started_at: number | null;
  external_action_lease_id: string | null;
  priority: string;
  assignee_id: string | null;
  created_at: number;
  updated_at: number;
  ownership_revision: number;
  revision: number;
  legacy_checksum: string | null;
  runtime_version: number;
  retention_schedule_id: string | null;
  auto_close_schedule_id: string | null;
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function mapStateRow(
  row: PublicConversationStateRow,
): StoredPublicConversationState {
  return {
    id: row.conversation_id,
    projectId: row.project_id,
    customerId: row.customer_id,
    visitorId: row.visitor_id,
    visitorName: row.visitor_name,
    visitorEmail: row.visitor_email,
    status: row.status as PublicConversationRecord["status"],
    closeReason: row.close_reason as PublicConversationRecord["closeReason"],
    telegramThreadId: row.telegram_thread_id,
    metadata: parseJsonRecord(row.metadata_json),
    chatState: parseJsonRecord(row.chat_state_json),
    lastActivityAt: row.last_activity_at,
    visitorLastSeenAt: row.visitor_last_seen_at,
    visitorPresence: row.visitor_presence as PublicConversationRecord["visitorPresence"],
    visitorLastOnlineAt: row.visitor_last_online_at,
    snoozedUntil: row.snoozed_until,
    archivedAt: row.archived_at,
    purgeStartedAt: row.purge_started_at,
    externalActionStartedAt: row.external_action_started_at,
    priority: row.priority as PublicConversationRecord["priority"],
    assigneeId: row.assignee_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownershipRevision: row.ownership_revision,
    revision: row.revision,
    legacyChecksum: row.legacy_checksum,
    runtimeVersion: row.runtime_version,
    externalActionLeaseId: row.external_action_lease_id,
    retentionScheduleId: row.retention_schedule_id,
    autoCloseScheduleId: row.auto_close_schedule_id,
  };
}

function stateBindings(state: StoredPublicConversationState): SqlBinding[] {
  return [
    state.id,
    state.projectId,
    state.customerId,
    state.visitorId,
    state.visitorName,
    state.visitorEmail,
    state.status,
    state.closeReason,
    state.telegramThreadId,
    JSON.stringify(state.metadata),
    JSON.stringify(state.chatState),
    state.lastActivityAt,
    state.visitorLastSeenAt,
    state.visitorPresence,
    state.visitorLastOnlineAt,
    state.snoozedUntil,
    state.archivedAt,
    state.purgeStartedAt,
    state.externalActionStartedAt,
    state.externalActionLeaseId,
    state.priority,
    state.assigneeId,
    state.createdAt,
    state.updatedAt,
    state.ownershipRevision,
    state.revision,
    state.legacyChecksum,
    state.runtimeVersion,
    state.retentionScheduleId,
    state.autoCloseScheduleId,
  ];
}

export class PublicConversationStateStore {
  constructor(private readonly sql: PublicConversationStateSql) {
    this.ensureSchema();
  }

  get(): StoredPublicConversationState | null {
    const rows = this.sql.execute<PublicConversationStateRow>(
      "SELECT * FROM public_conversation_state WHERE singleton = 1 LIMIT 1",
      [],
    );
    return rows[0] ? mapStateRow(rows[0]) : null;
  }

  initialize(
    conversation: PublicConversationRecord,
    legacyChecksum: string | null,
  ): { created: boolean; state: StoredPublicConversationState } {
    const state: StoredPublicConversationState = {
      ...structuredClone(conversation),
      revision: 0,
      legacyChecksum,
      runtimeVersion: 1,
      externalActionLeaseId: null,
      retentionScheduleId: null,
      autoCloseScheduleId: null,
    };
    const rows = this.sql.execute<{ conversation_id: string }>(
      `INSERT OR IGNORE INTO public_conversation_state (
         singleton, conversation_id, project_id, customer_id, visitor_id,
         visitor_name, visitor_email, status, close_reason,
         telegram_thread_id, metadata_json, chat_state_json,
         last_activity_at, visitor_last_seen_at, visitor_presence,
         visitor_last_online_at, snoozed_until, archived_at, purge_started_at,
         external_action_started_at, external_action_lease_id, priority,
         assignee_id, created_at, updated_at, ownership_revision, revision,
         legacy_checksum, runtime_version, retention_schedule_id,
         auto_close_schedule_id
       ) VALUES (
         1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?, ?
       ) RETURNING conversation_id`,
      stateBindings(state),
    );
    return {
      created: rows.length === 1,
      state: rows.length === 1 ? state : this.get()!,
    };
  }

  save(
    state: StoredPublicConversationState,
    expectedRevision: number,
  ): StoredPublicConversationState | null {
    const rows = this.sql.execute<PublicConversationStateRow>(
      `UPDATE public_conversation_state SET
         conversation_id = ?, project_id = ?, customer_id = ?, visitor_id = ?,
         visitor_name = ?, visitor_email = ?, status = ?, close_reason = ?,
         telegram_thread_id = ?, metadata_json = ?, chat_state_json = ?,
         last_activity_at = ?, visitor_last_seen_at = ?, visitor_presence = ?,
         visitor_last_online_at = ?, snoozed_until = ?, archived_at = ?,
         purge_started_at = ?, external_action_started_at = ?,
         external_action_lease_id = ?, priority = ?, assignee_id = ?,
         created_at = ?, updated_at = ?, ownership_revision = ?, revision = ?,
         legacy_checksum = ?, runtime_version = ?, retention_schedule_id = ?,
         auto_close_schedule_id = ?
       WHERE singleton = 1 AND revision = ?
       RETURNING *`,
      [...stateBindings(state), expectedRevision],
    );
    return rows[0] ? mapStateRow(rows[0]) : null;
  }

  private ensureSchema(): void {
    this.sql.execute(`CREATE TABLE IF NOT EXISTS public_conversation_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      conversation_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL,
      customer_id TEXT,
      visitor_id TEXT NOT NULL,
      visitor_name TEXT,
      visitor_email TEXT,
      status TEXT NOT NULL,
      close_reason TEXT,
      telegram_thread_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      chat_state_json TEXT NOT NULL DEFAULT '{}',
      last_activity_at INTEGER NOT NULL,
      visitor_last_seen_at INTEGER,
      visitor_presence TEXT NOT NULL DEFAULT 'active',
      visitor_last_online_at INTEGER,
      snoozed_until INTEGER,
      archived_at INTEGER,
      purge_started_at INTEGER,
      external_action_started_at INTEGER,
      external_action_lease_id TEXT,
      priority TEXT NOT NULL DEFAULT 'medium',
      assignee_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      ownership_revision INTEGER NOT NULL DEFAULT 0,
      revision INTEGER NOT NULL DEFAULT 0,
      legacy_checksum TEXT,
      runtime_version INTEGER NOT NULL DEFAULT 1,
      retention_schedule_id TEXT,
      auto_close_schedule_id TEXT
    )`, []);
  }
}
