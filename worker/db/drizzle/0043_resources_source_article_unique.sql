-- Idempotency: remove any duplicate source_article_id bridge rows before adding the unique constraint.
DELETE FROM resources
 WHERE source_article_id IS NOT NULL
   AND rowid NOT IN (
     SELECT MIN(rowid) FROM resources
      WHERE source_article_id IS NOT NULL
      GROUP BY source_article_id
   );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_resources_source_article_id_unique` ON `resources` (`source_article_id`) WHERE `source_article_id` IS NOT NULL;
