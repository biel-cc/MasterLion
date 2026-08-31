CREATE TABLE "aihub_readiness_leases" (
	"user_id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "new_api_bindings" ADD COLUMN "error_code" varchar(64);--> statement-breakpoint
ALTER TABLE "new_api_bindings" ADD COLUMN "error_kind" varchar(32);--> statement-breakpoint
ALTER TABLE "new_api_bindings" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "new_api_bindings" ADD COLUMN "last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "new_api_bindings" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "new_api_bindings" ADD COLUMN "readiness_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "aihub_readiness_leases" ADD CONSTRAINT "aihub_readiness_leases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
