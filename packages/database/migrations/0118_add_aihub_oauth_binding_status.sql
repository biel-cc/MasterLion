ALTER TABLE "new_api_bindings" ADD COLUMN "iam_oauth_binding_status" varchar(16) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "new_api_bindings" ADD COLUMN "iam_oauth_binding_error_code" varchar(64);--> statement-breakpoint
ALTER TABLE "new_api_bindings" ADD COLUMN "iam_oauth_binding_error" text;--> statement-breakpoint
ALTER TABLE "new_api_bindings" ADD COLUMN "iam_oauth_binding_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "new_api_bindings_iam_oauth_status_idx" ON "new_api_bindings" USING btree ("iam_oauth_binding_status");
