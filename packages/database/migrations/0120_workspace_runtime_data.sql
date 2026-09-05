CREATE TABLE "project_workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" text,
	"kind" varchar(16) NOT NULL,
	"device_id" varchar(64),
	"root_path" text NOT NULL,
	"scope_key" text NOT NULL,
	"display_name" text,
	"repo_type" varchar(16),
	"env" jsonb,
	"env_files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skill_policy" jsonb,
	"scan" jsonb,
	"scanned_at" timestamp with time zone,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_workspaces_identity_check" CHECK ((
        ("project_workspaces"."kind" = 'sandbox' AND "project_workspaces"."device_id" IS NULL AND "project_workspaces"."root_path" = '/workspace') OR
        ("project_workspaces"."kind" IN ('device', 'scratch') AND "project_workspaces"."device_id" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE "workspace_access_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"device_id" varchar(64) NOT NULL,
	"root_path" text NOT NULL,
	"modes" jsonb NOT NULL,
	"scope" varchar(16) DEFAULT 'topic' NOT NULL,
	"requested_via" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_access_grants_scope_check" CHECK ("workspace_access_grants"."scope" = 'topic'),
	CONSTRAINT "workspace_access_grants_modes_check" CHECK (jsonb_typeof("workspace_access_grants"."modes") = 'array'
        AND jsonb_array_length("workspace_access_grants"."modes") > 0
        AND "workspace_access_grants"."modes" <@ '["read", "write", "exec"]'::jsonb)
);
--> statement-breakpoint
ALTER TABLE "project_workspaces" ADD CONSTRAINT "project_workspaces_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_workspaces" ADD CONSTRAINT "project_workspaces_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_access_grants" ADD CONSTRAINT "workspace_access_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_access_grants" ADD CONSTRAINT "workspace_access_grants_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_workspaces_user_scope_key_unique" ON "project_workspaces" USING btree ("user_id","scope_key");--> statement-breakpoint
CREATE INDEX "project_workspaces_user_id_idx" ON "project_workspaces" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_workspaces_device_id_idx" ON "project_workspaces" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_access_grants_scope_unique" ON "workspace_access_grants" USING btree ("user_id","topic_id","device_id","root_path");--> statement-breakpoint
CREATE INDEX "workspace_access_grants_topic_device_idx" ON "workspace_access_grants" USING btree ("user_id","topic_id","device_id");--> statement-breakpoint
CREATE INDEX "workspace_access_grants_expires_at_idx" ON "workspace_access_grants" USING btree ("expires_at");