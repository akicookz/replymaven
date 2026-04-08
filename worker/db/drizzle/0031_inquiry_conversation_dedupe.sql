ALTER TABLE `inquiries` ADD COLUMN `conversation_id` text REFERENCES `conversations`(`id`) ON DELETE set null;
ALTER TABLE `inquiries` ADD COLUMN `title` text DEFAULT 'Inquiry' NOT NULL;
CREATE UNIQUE INDEX `idx_inquiries_conversation` ON `inquiries` (`conversation_id`);
