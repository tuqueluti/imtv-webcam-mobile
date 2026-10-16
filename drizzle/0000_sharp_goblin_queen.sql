CREATE TABLE `camera_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`viewer_hash` text NOT NULL,
	`join_hash` text NOT NULL,
	`sender_hash` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`join_expires_at` integer NOT NULL,
	`closed` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`offer` text,
	`answer` text
);
--> statement-breakpoint
CREATE INDEX `camera_sessions_owner_expiry` ON `camera_sessions` (`owner`,`expires_at`);