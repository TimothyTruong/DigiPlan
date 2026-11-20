// Test harness: real Postgres (PGlite, WASM) with a minimal stand-in for Supabase's auth schema and roles,
// so the production migration and its RLS policies run unmodified.
import { PGlite } from '@electric-sql/pglite'
import MIGRATION from '../../../../supabase/migrations/20261120000000_records.sql?raw'

export async function makeDb() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
  `)
  await db.exec(MIGRATION)
  return db
}

/** Run `fn` as a signed-in user (or signed out when userId is null), like PostgREST does per request. */
export async function as<T>(db: PGlite, userId: string | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId ?? ''}', false); set role ${userId ? 'authenticated' : 'anon'};`)
  try { return await fn() } finally { await db.exec('reset role;') }
}

export async function addUser(db: PGlite, id: string) { await db.query('insert into auth.users (id) values ($1)', [id]) }
