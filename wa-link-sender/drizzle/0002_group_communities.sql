ALTER TABLE `groups` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `kind` text DEFAULT 'group' NOT NULL;--> statement-breakpoint
ALTER TABLE `groups` ADD `community_id` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `community_name` text;--> statement-breakpoint
ALTER TABLE `groups` ADD `participants` integer;