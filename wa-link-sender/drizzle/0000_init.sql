CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` integer NOT NULL,
	`actor_user_id` integer,
	`actor_username` text NOT NULL,
	`actor_role` text,
	`ip` text,
	`user_agent` text,
	`session_id` text,
	`action` text NOT NULL,
	`category` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`outcome` text NOT NULL,
	`reason` text,
	`details` text,
	`connection_id` integer
);
--> statement-breakpoint
CREATE INDEX `audit_ts_idx` ON `audit_log` (`ts`);--> statement-breakpoint
CREATE INDEX `audit_actor_idx` ON `audit_log` (`actor_user_id`,`ts`);--> statement-breakpoint
CREATE INDEX `audit_category_idx` ON `audit_log` (`category`,`ts`);--> statement-breakpoint
CREATE INDEX `audit_outcome_idx` ON `audit_log` (`outcome`,`ts`);--> statement-breakpoint
CREATE TABLE `connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`label` text NOT NULL,
	`client_id` text NOT NULL,
	`status` text NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`phone` text,
	`push_name` text,
	`added_at` integer NOT NULL,
	`added_by` integer,
	`linked_at` integer,
	`last_error` text,
	`last_error_at` integer,
	`retired_at` integer,
	`retired_by` integer,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`retired_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connections_client_uq` ON `connections` (`client_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `connections_one_active_uq` ON `connections` (`is_active`) WHERE "connections"."is_active" = 1;--> statement-breakpoint
CREATE TABLE `groups` (
	`connection_id` integer NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`read_only` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `group_id`),
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`url` text NOT NULL,
	`platform` text NOT NULL,
	`template_id` integer,
	`preset_ids` text DEFAULT '[]' NOT NULL,
	`status` text NOT NULL,
	`wait_reason` text,
	`parent_job_id` integer,
	`requested_connection_id` integer,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`cancelled_by` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requested_connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`cancelled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_url_idx` ON `jobs` (`url`);--> statement-breakpoint
CREATE INDEX `jobs_user_idx` ON `jobs` (`user_id`);--> statement-breakpoint
CREATE TABLE `login_throttle` (
	`username` text PRIMARY KEY NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`locked_until` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `preset_access` (
	`user_id` integer NOT NULL,
	`preset_id` integer NOT NULL,
	PRIMARY KEY(`user_id`, `preset_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preset_id`) REFERENCES `presets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `preset_groups` (
	`preset_id` integer NOT NULL,
	`group_id` text NOT NULL,
	`group_name` text NOT NULL,
	PRIMARY KEY(`preset_id`, `group_id`),
	FOREIGN KEY (`preset_id`) REFERENCES `presets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `presets_name_uq` ON `presets` (lower("name"));--> statement-breakpoint
CREATE TABLE `send_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`group_id` text NOT NULL,
	`group_name` text NOT NULL,
	`status` text NOT NULL,
	`message` text,
	`error` text,
	`connection_id` integer,
	`attempted_at` integer,
	`day` text,
	`audit_id` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`audit_id`) REFERENCES `audit_log`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `send_results_job_idx` ON `send_results` (`job_id`);--> statement-breakpoint
CREATE INDEX `send_results_day_idx` ON `send_results` (`connection_id`,`day`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	`revoked_at` integer,
	`revoke_reason` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_uq` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`password_hash` text NOT NULL,
	`must_change_password` integer DEFAULT false NOT NULL,
	`disabled` integer DEFAULT false NOT NULL,
	`last_login_at` integer,
	`password_changed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_uq` ON `users` (lower("username"));