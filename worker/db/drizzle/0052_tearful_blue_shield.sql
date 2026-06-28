ALTER TABLE `conversations` ADD `snoozed_until` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD `priority` text DEFAULT 'medium' NOT NULL;