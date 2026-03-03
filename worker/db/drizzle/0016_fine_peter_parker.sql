ALTER TABLE `widget_config` ADD `bot_message_bg_color` text DEFAULT '#ffffff' NOT NULL;--> statement-breakpoint
ALTER TABLE `widget_config` ADD `bot_message_text_color` text DEFAULT '#18181b' NOT NULL;--> statement-breakpoint
ALTER TABLE `widget_config` ADD `visitor_message_bg_color` text;--> statement-breakpoint
ALTER TABLE `widget_config` ADD `visitor_message_text_color` text;--> statement-breakpoint
ALTER TABLE `widget_config` ADD `background_style` text DEFAULT 'solid' NOT NULL;