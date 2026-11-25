CREATE TABLE `comment` (
	`id` text PRIMARY KEY NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`userId` text DEFAULT 'local' NOT NULL,
	`runId` text NOT NULL,
	`filePath` text NOT NULL,
	`side` text NOT NULL,
	`startLine` integer NOT NULL,
	`endLine` integer NOT NULL,
	`body` text NOT NULL,
	`published` integer DEFAULT false NOT NULL,
	`githubCommentId` text,
	FOREIGN KEY (`runId`) REFERENCES `chapter_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `comment_run_id_idx` ON `comment` (`runId`);