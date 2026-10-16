CREATE TABLE `connection_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `connection_limits_expiry` ON `connection_limits` (`expires_at`);--> statement-breakpoint
ALTER TABLE `camera_sessions` ADD `generation` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `camera_sessions` ADD `sender_candidates` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `camera_sessions` ADD `receiver_candidates` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `camera_sessions` ADD `restart_requested` integer DEFAULT 0 NOT NULL;