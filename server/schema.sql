CREATE TABLE IF NOT EXISTS accounts (
  subject text PRIMARY KEY,
  profile text,
  auto_authorize boolean NOT NULL DEFAULT false,
  extension_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS auto_authorize boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS mailboxes (
  subject text PRIMARY KEY REFERENCES accounts(subject) ON DELETE CASCADE,
  email text NOT NULL,
  secrets text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS oauth_states (
  digest text PRIMARY KEY,
  subject text NOT NULL REFERENCES accounts(subject) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY,
  subject text NOT NULL REFERENCES accounts(subject) ON DELETE CASCADE,
  goal jsonb NOT NULL,
  status text NOT NULL DEFAULT 'paused' CHECK (status IN ('active','paused')),
  authorized_at timestamptz,
  cursor integer NOT NULL DEFAULT 0,
  researched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaigns_owner ON campaigns(subject);
CREATE TABLE IF NOT EXISTS leads (
  id uuid PRIMARY KEY,
  subject text NOT NULL REFERENCES accounts(subject) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  email text NOT NULL,
  research jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active',
  thread_id text,
  last_inbound_id text,
  followups integer NOT NULL DEFAULT 0,
  resume_requested boolean NOT NULL DEFAULT false,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject,email)
);
CREATE INDEX IF NOT EXISTS leads_campaign ON leads(campaign_id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS resume_requested boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY,
  subject text NOT NULL REFERENCES accounts(subject) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  trigger_key text NOT NULL,
  rfc_id text NOT NULL,
  content text,
  status text NOT NULL,
  provider_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(subject,lead_id,trigger_key)
);
CREATE INDEX IF NOT EXISTS messages_owner ON messages(subject,status);
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY,
  subject text NOT NULL REFERENCES accounts(subject) ON DELETE CASCADE,
  lead_id uuid REFERENCES leads(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES campaigns(id) ON DELETE CASCADE,
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_owner ON events(subject,created_at);
