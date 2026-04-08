DROP INDEX "users_email_unique";--> statement-breakpoint
ALTER TABLE `connections` ALTER COLUMN "host" TO "host" text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
ALTER TABLE `connections` ALTER COLUMN "port" TO "port" integer;--> statement-breakpoint
ALTER TABLE `connections` ALTER COLUMN "database" TO "database" text;--> statement-breakpoint
ALTER TABLE `connections` ALTER COLUMN "username" TO "username" text;--> statement-breakpoint
ALTER TABLE `connections` ALTER COLUMN "password_encrypted" TO "password_encrypted" blob;--> statement-breakpoint
ALTER TABLE `connections` ADD `file_path` text;