-- Share connections with individual users
CREATE TABLE `connection_users` (
	`connection_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY (`connection_id`, `user_id`),
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
-- Share saved queries with groups
CREATE TABLE `query_groups` (
	`query_id` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY (`query_id`, `group_id`),
	FOREIGN KEY (`query_id`) REFERENCES `saved_queries`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
-- Share saved queries with individual users
CREATE TABLE `query_users` (
	`query_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY (`query_id`, `user_id`),
	FOREIGN KEY (`query_id`) REFERENCES `saved_queries`(`id`) ON DELETE CASCADE,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
