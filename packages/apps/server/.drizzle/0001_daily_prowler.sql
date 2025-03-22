CREATE TABLE `data` (
	`id` integer PRIMARY KEY NOT NULL,
	`site` text NOT NULL,
	`name` text NOT NULL,
	`value` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `likes` (
	`id` integer PRIMARY KEY NOT NULL,
	`site` text NOT NULL,
	`reaction` text NOT NULL,
	`user_id` integer,
	`post_id` integer,
	`created_at` text DEFAULT (current_timestamp) NOT NULL,
	`updated_at` text DEFAULT (current_timestamp) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `comments` ADD `site` text NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `site` text NOT NULL;--> statement-breakpoint
ALTER TABLE `notifications` ADD `site` text NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `site` text NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `site` text NOT NULL;