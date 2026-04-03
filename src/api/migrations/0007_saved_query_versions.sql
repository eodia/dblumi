CREATE TABLE `saved_query_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`query_id` text NOT NULL,
	`sql` text NOT NULL,
	`label` text,
	`edited_by` text NOT NULL,
	`created_at` text NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (`query_id`) REFERENCES `saved_queries`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (`edited_by`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_sqv_query_created` ON `saved_query_versions` (`query_id`, `created_at` DESC);
