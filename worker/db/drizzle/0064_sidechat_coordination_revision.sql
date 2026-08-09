ALTER TABLE `conversations` ADD `sidechat_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `conversations`
SET
	`sidechat_status` = CASE
		WHEN `sidechat_status` = 'working' THEN 'failed'
		ELSE `sidechat_status`
	END,
	`sidechat_run_id` = NULL,
	`sidechat_lease_expires_at` = NULL,
	`sidechat_updated_at` = unixepoch(),
	`sidechat_revision` = `sidechat_revision` + 1
WHERE `archived_at` IS NOT NULL
	AND (
		`sidechat_status` = 'working'
		OR `sidechat_run_id` IS NOT NULL
		OR `sidechat_lease_expires_at` IS NOT NULL
	);
