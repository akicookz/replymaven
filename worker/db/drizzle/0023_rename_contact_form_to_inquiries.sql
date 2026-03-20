ALTER TABLE `contact_form_config` RENAME TO `inquiry_config`;--> statement-breakpoint
ALTER TABLE `contact_form_submissions` RENAME TO `inquiries`;--> statement-breakpoint
UPDATE `quick_actions` SET `type` = 'inquiry' WHERE `type` = 'contact_form';--> statement-breakpoint
DELETE FROM `quick_actions` WHERE `type` = 'booking';--> statement-breakpoint
DROP INDEX IF EXISTS `idx_contact_form_config_project`;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inquiry_config_project` ON `inquiry_config` (`project_id`);--> statement-breakpoint
DROP INDEX IF EXISTS `idx_contact_form_submissions_project`;--> statement-breakpoint
CREATE INDEX `idx_inquiries_project` ON `inquiries` (`project_id`);
