-- Step 1: Recreate quick_actions with new columns (type, show_on_home, icon default)
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_quick_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text DEFAULT 'prompt' NOT NULL,
	`label` text NOT NULL,
	`action` text DEFAULT '' NOT NULL,
	`icon` text DEFAULT 'link' NOT NULL,
	`show_on_home` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint

-- Migrate existing quick_actions (keep as type=prompt, not shown on home)
INSERT INTO `__new_quick_actions`("id", "project_id", "type", "label", "action", "icon", "show_on_home", "sort_order", "created_at")
SELECT "id", "project_id", 'prompt', "label", "action", COALESCE("icon", 'sparkle'), 0, "sort_order", "created_at" FROM `quick_actions`;--> statement-breakpoint

-- Migrate quick_topics into quick_actions as type=prompt
INSERT INTO `__new_quick_actions`("id", "project_id", "type", "label", "action", "icon", "show_on_home", "sort_order", "created_at")
SELECT "id", "project_id", 'prompt', "label", "prompt", 'sparkle', 0, "sort_order", "created_at" FROM `quick_topics`;--> statement-breakpoint

-- Migrate home_links into quick_actions as type=link, shown on home
INSERT INTO `__new_quick_actions`("id", "project_id", "type", "label", "action", "icon", "show_on_home", "sort_order", "created_at")
SELECT "id", "project_id", 'link', "label", "url", "icon", 1, "sort_order", "created_at" FROM `home_links`;--> statement-breakpoint

-- Auto-create contact_form quick actions for projects with enabled contact forms
INSERT INTO `__new_quick_actions`("id", "project_id", "type", "label", "action", "icon", "show_on_home", "sort_order", "created_at")
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  "project_id", 'contact_form', 'Leave a message', '', 'mail', 1, 100, unixepoch()
FROM `contact_form_config` WHERE "enabled" = 1;--> statement-breakpoint

-- Auto-create booking quick actions for projects with enabled bookings
INSERT INTO `__new_quick_actions`("id", "project_id", "type", "label", "action", "icon", "show_on_home", "sort_order", "created_at")
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
  "project_id", 'booking', 'Book a meeting', '', 'calendar', 1, 101, unixepoch()
FROM `booking_config` WHERE "enabled" = 1;--> statement-breakpoint

-- Drop old tables and swap
DROP TABLE `quick_actions`;--> statement-breakpoint
ALTER TABLE `__new_quick_actions` RENAME TO `quick_actions`;--> statement-breakpoint
DROP TABLE `home_links`;--> statement-breakpoint
DROP TABLE `quick_topics`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_quick_actions_project` ON `quick_actions` (`project_id`);
