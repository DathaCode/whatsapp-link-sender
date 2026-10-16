CREATE TABLE `drafts` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`upload_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `job_main_links` (
	`job_id` integer NOT NULL,
	`link` text NOT NULL,
	PRIMARY KEY(`job_id`, `link`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `job_main_links_link_idx` ON `job_main_links` (`link`);--> statement-breakpoint
CREATE TABLE `snippets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`original_name` text NOT NULL,
	`original_size` integer NOT NULL,
	`original_type` text NOT NULL,
	`original_sha256` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `uploads_created_idx` ON `uploads` (`created_at`);--> statement-breakpoint
CREATE INDEX `uploads_orig_sha_idx` ON `uploads` (`original_sha256`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `message_text` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `message_sha256` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `text_key` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `image_id` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `image_sha256` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `send_mode` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `links` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `warnings` text;--> statement-breakpoint
CREATE INDEX `jobs_text_key_idx` ON `jobs` (`text_key`);--> statement-breakpoint
CREATE INDEX `jobs_image_sha_idx` ON `jobs` (`image_sha256`);--> statement-breakpoint
ALTER TABLE `send_results` ADD `messages_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `send_results` ADD `attempts` integer DEFAULT 0 NOT NULL;