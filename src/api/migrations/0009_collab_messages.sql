CREATE TABLE `collab_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`query_id` text NOT NULL,
	`user_id` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL DEFAULT (datetime('now')),
	FOREIGN KEY (`query_id`) REFERENCES `saved_queries`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_collab_msg_query_created` ON `collab_messages` (`query_id`, `created_at` ASC);
