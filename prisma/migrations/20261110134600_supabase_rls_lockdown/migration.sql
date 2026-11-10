-- Supabase security lockdown.
-- Supabase exposes the `public` schema through its Data API (PostgREST/GraphQL) to the `anon` and `authenticated` roles.
-- This app never uses the Data API: it connects as the table owner (postgres) through Prisma, which bypasses RLS as owner.
-- 1. Enable Row Level Security on every table in `public`, with NO policies → anon/authenticated can read or write nothing.
-- 2. Revoke the default grants Supabase gives anon/authenticated on existing and future tables, sequences and functions.
-- Written as DO blocks so it also runs on plain Postgres (roles absent) and in Prisma's shadow database.
-- New tables: add `ALTER TABLE "<Table>" ENABLE ROW LEVEL SECURITY;` to their migration; `npm run db:check-rls` (run in
-- vercel-build after `migrate deploy`) fails if any public table lacks RLS.

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END $$;

DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', r);
    END IF;
  END LOOP;
END $$;
