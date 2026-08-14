CREATE TABLE `conversation_runtime_migrations` (
	`project_id` text PRIMARY KEY NOT NULL,
	`directory_cursor` text,
	`directory_complete_at` integer,
	`last_verified_at` integer,
	`mismatch_count` integer DEFAULT 0 NOT NULL,
	`verification_cursor` text,
	`verification_started_at` integer,
	`verification_legacy_count` integer DEFAULT 0 NOT NULL,
	`verification_agent_count` integer DEFAULT 0 NOT NULL,
	`verification_legacy_only_count` integer DEFAULT 0 NOT NULL,
	`verification_agent_only_count` integer DEFAULT 0 NOT NULL,
	`verification_operational_mismatch_count` integer DEFAULT 0 NOT NULL,
	`verification_transcript_mismatch_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
