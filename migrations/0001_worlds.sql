CREATE TABLE world_admins (user_id text PRIMARY KEY, enabled boolean NOT NULL DEFAULT true);
CREATE TABLE worlds (id uuid PRIMARY KEY, title text NOT NULL, head uuid NOT NULL, author text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE world_revisions (id uuid PRIMARY KEY, world_id uuid NOT NULL REFERENCES worlds(id), parent uuid REFERENCES world_revisions(id), author text NOT NULL, document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX world_revisions_world ON world_revisions(world_id, created_at DESC);
CREATE TABLE world_publications (id uuid PRIMARY KEY, world_id uuid NOT NULL REFERENCES worlds(id), revision_id uuid NOT NULL REFERENCES world_revisions(id), author text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION reject_world_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'World revisions and publications are immutable'; END; $$;
CREATE TRIGGER immutable_world_revision BEFORE UPDATE OR DELETE ON world_revisions FOR EACH ROW EXECUTE FUNCTION reject_world_revision_mutation();
CREATE TRIGGER immutable_world_publication BEFORE UPDATE OR DELETE ON world_publications FOR EACH ROW EXECUTE FUNCTION reject_world_revision_mutation();
-- Explicitly grant the application's restricted database role SELECT on world_admins,
-- SELECT/INSERT/UPDATE on worlds, and SELECT/INSERT on revisions/publications.
-- Administrator provisioning is an operator migration, never a sign-up side effect.
