ALTER TABLE `query_groups` ADD COLUMN `collaborative` integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `query_users` ADD COLUMN `collaborative` integer NOT NULL DEFAULT 0;
