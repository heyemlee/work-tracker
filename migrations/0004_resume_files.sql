CREATE TABLE `resume_files` (
	`resume_id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`resume_id`) REFERENCES `resumes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `resumes` ADD `file_name` text;--> statement-breakpoint
ALTER TABLE `resumes` ADD `file_size` integer;--> statement-breakpoint
ALTER TABLE `resumes` ADD `file_uploaded_at` text;