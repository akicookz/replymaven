CREATE TABLE `mcp_oauth_auth_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`client_id` text NOT NULL,
	`user_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`scope` text NOT NULL,
	`code_challenge` text NOT NULL,
	`code_challenge_method` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `mcp_oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mcp_oauth_auth_codes_hash` ON `mcp_oauth_auth_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `idx_mcp_oauth_auth_codes_client` ON `mcp_oauth_auth_codes` (`client_id`);--> statement-breakpoint
CREATE INDEX `idx_mcp_oauth_auth_codes_user` ON `mcp_oauth_auth_codes` (`user_id`);--> statement-breakpoint
CREATE TABLE `mcp_oauth_authorizations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`scope` text NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `mcp_oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mcp_oauth_authorizations_user` ON `mcp_oauth_authorizations` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_mcp_oauth_authorizations_client` ON `mcp_oauth_authorizations` (`client_id`);--> statement-breakpoint
CREATE TABLE `mcp_oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`client_name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`grant_types` text NOT NULL,
	`response_types` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mcp_oauth_clients_created` ON `mcp_oauth_clients` (`created_at`);--> statement-breakpoint
CREATE TABLE `mcp_oauth_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`authorization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`client_id` text NOT NULL,
	`access_token_hash` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`scope` text NOT NULL,
	`access_expires_at` integer NOT NULL,
	`refresh_expires_at` integer NOT NULL,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`authorization_id`) REFERENCES `mcp_oauth_authorizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `mcp_oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mcp_oauth_tokens_access_hash` ON `mcp_oauth_tokens` (`access_token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_mcp_oauth_tokens_refresh_hash` ON `mcp_oauth_tokens` (`refresh_token_hash`);--> statement-breakpoint
CREATE INDEX `idx_mcp_oauth_tokens_authorization` ON `mcp_oauth_tokens` (`authorization_id`);--> statement-breakpoint
CREATE INDEX `idx_mcp_oauth_tokens_user` ON `mcp_oauth_tokens` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_mcp_oauth_tokens_client` ON `mcp_oauth_tokens` (`client_id`);