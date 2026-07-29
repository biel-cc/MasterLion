CREATE TABLE IF NOT EXISTS market_schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_accounts (
  id bigserial PRIMARY KEY,
  external_user_id text NOT NULL UNIQUE,
  email text,
  name text,
  username text,
  avatar_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  role text NOT NULL DEFAULT 'submitter' CHECK (role IN ('submitter', 'reviewer', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS market_accounts_username ON market_accounts(lower(username)) WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS market_resources (
  id bigserial PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('agent', 'agent-group', 'skill', 'mcp', 'plugin', 'model', 'provider')),
  identifier text NOT NULL,
  owner_account_id bigint NOT NULL REFERENCES market_accounts(id),
  workspace_id text,
  name text NOT NULL,
  description text,
  avatar text,
  category text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('public', 'internal', 'private')),
  status text NOT NULL DEFAULT 'unpublished' CHECK (status IN ('published', 'unpublished', 'archived', 'deprecated')),
  current_version_id bigint,
  forked_from_id bigint REFERENCES market_resources(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  install_count integer NOT NULL DEFAULT 0,
  like_count integer NOT NULL DEFAULT 0,
  favorite_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(type, identifier)
);

CREATE TABLE IF NOT EXISTS market_versions (
  id bigserial PRIMARY KEY,
  resource_id bigint NOT NULL REFERENCES market_resources(id) ON DELETE CASCADE,
  version text NOT NULL,
  workflow_state text NOT NULL DEFAULT 'draft' CHECK (workflow_state IN ('draft','submitted','scanning','in_review','approved','rejected','published','deprecated')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  editor_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  manifest jsonb NOT NULL DEFAULT '{}'::jsonb,
  localizations jsonb NOT NULL DEFAULT '{}'::jsonb,
  changelog text,
  artifact_key text,
  artifact_sha256 text,
  artifact_signature text,
  scan_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_reason text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer_account_id bigint REFERENCES market_accounts(id),
  created_by bigint NOT NULL REFERENCES market_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(resource_id, version)
);

CREATE OR REPLACE FUNCTION protect_market_version_content() RETURNS trigger AS $$
BEGIN
  IF NEW.resource_id IS DISTINCT FROM OLD.resource_id
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.config IS DISTINCT FROM OLD.config
    OR NEW.editor_data IS DISTINCT FROM OLD.editor_data
    OR NEW.manifest IS DISTINCT FROM OLD.manifest
    OR NEW.localizations IS DISTINCT FROM OLD.localizations
    OR NEW.changelog IS DISTINCT FROM OLD.changelog
    OR (OLD.artifact_key IS NOT NULL AND NEW.artifact_key IS DISTINCT FROM OLD.artifact_key)
    OR (OLD.artifact_sha256 IS NOT NULL AND NEW.artifact_sha256 IS DISTINCT FROM OLD.artifact_sha256)
    OR (OLD.artifact_signature IS NOT NULL AND NEW.artifact_signature IS DISTINCT FROM OLD.artifact_signature)
  THEN
    RAISE EXCEPTION 'market version content is immutable; create a new version';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS market_versions_immutable_content ON market_versions;
CREATE TRIGGER market_versions_immutable_content
  BEFORE UPDATE ON market_versions
  FOR EACH ROW EXECUTE FUNCTION protect_market_version_content();

ALTER TABLE market_resources
  DROP CONSTRAINT IF EXISTS market_resources_current_version_fk;
ALTER TABLE market_resources
  ADD CONSTRAINT market_resources_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES market_versions(id);

CREATE TABLE IF NOT EXISTS market_categories (
  id bigserial PRIMARY KEY,
  resource_type text NOT NULL,
  slug text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  localizations jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(resource_type, slug)
);

CREATE TABLE IF NOT EXISTS market_installs (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES market_accounts(id),
  workspace_id text,
  resource_id bigint NOT NULL REFERENCES market_resources(id),
  version_id bigint NOT NULL REFERENCES market_versions(id),
  local_resource_id text,
  installed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS market_installs_idempotency
  ON market_installs(account_id, coalesce(workspace_id, ''), resource_id, version_id);

CREATE TABLE IF NOT EXISTS market_forks (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES market_accounts(id),
  workspace_id text,
  source_resource_id bigint NOT NULL REFERENCES market_resources(id),
  source_version_id bigint NOT NULL REFERENCES market_versions(id),
  fork_resource_id bigint NOT NULL REFERENCES market_resources(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS market_forks_idempotency
  ON market_forks(account_id, coalesce(workspace_id, ''), source_resource_id, source_version_id);

CREATE TABLE IF NOT EXISTS market_social (
  account_id bigint NOT NULL REFERENCES market_accounts(id),
  relation text NOT NULL CHECK (relation IN ('follow', 'favorite', 'like')),
  target_type text NOT NULL,
  target_value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, relation, target_type, target_value)
);

CREATE TABLE IF NOT EXISTS market_credentials (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES market_accounts(id),
  workspace_id text,
  key text NOT NULL,
  name text,
  description text,
  type text NOT NULL CHECK (type IN ('kv-env', 'kv-header', 'oauth', 'file')),
  encrypted_value text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS market_credentials_scope_key
  ON market_credentials(account_id, coalesce(workspace_id, ''), key);

CREATE TABLE IF NOT EXISTS market_connections (
  id bigserial PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES market_accounts(id),
  workspace_id text,
  scope_key text GENERATED ALWAYS AS (coalesce(workspace_id, '')) STORED,
  provider text NOT NULL,
  credential_id bigint REFERENCES market_credentials(id),
  status text NOT NULL DEFAULT 'active',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id, scope_key, provider)
);

CREATE TABLE IF NOT EXISTS market_connector_allowlist (
  id bigserial PRIMARY KEY,
  provider text NOT NULL,
  protocol text NOT NULL CHECK (protocol IN ('http:', 'https:')),
  hostname text NOT NULL,
  port integer,
  allow_private boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  created_by bigint REFERENCES market_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, protocol, hostname, port)
);

CREATE TABLE IF NOT EXISTS market_events (
  id bigserial PRIMARY KEY,
  account_id bigint REFERENCES market_accounts(id),
  workspace_id text,
  event_type text NOT NULL,
  resource_type text,
  resource_identifier text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_audit_logs (
  id bigserial PRIMARY KEY,
  actor_account_id bigint REFERENCES market_accounts(id),
  workspace_id text,
  action text NOT NULL,
  target_type text,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS market_resources_public_catalog
  ON market_resources(type, status, category, updated_at DESC);
CREATE INDEX IF NOT EXISTS market_versions_review_queue
  ON market_versions(workflow_state, created_at);
CREATE INDEX IF NOT EXISTS market_audit_created_at
  ON market_audit_logs(created_at DESC);
