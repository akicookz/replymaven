UPDATE `knowledge_suggestions`
SET `type` = 'update_faq'
WHERE `type` = 'add_faq_entry';

ALTER TABLE `knowledge_suggestions`
ADD COLUMN `target_page_id` text REFERENCES `crawled_pages`(`id`) ON DELETE set null;

CREATE INDEX `idx_knowledge_suggestions_target_page`
ON `knowledge_suggestions` (`target_page_id`);
