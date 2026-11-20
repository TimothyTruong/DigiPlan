-- Petal: per-user record store. Every planner entity (item, course, recipe, habit, …) is one row.
-- Security model: row-level security on every operation — a signed-in user can only ever touch rows where
-- user_id = auth.uid(). The anon (signed-out) role has no access at all. Apply with the Supabase SQL editor
-- or `supabase db push`.

create sequence if not exists public.records_rev_seq;

create table if not exists public.records (
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  kind       text    not null check (kind ~ '^[a-z]{2,20}$'),
  id         text    not null check (length(id) between 1 and 100),
  data       jsonb,
  deleted    boolean not null default false,
  updated_at bigint  not null,                                    -- client ms clock; last-writer-wins per row
  rev        bigint  not null default nextval('public.records_rev_seq'), -- server change order; sync cursor
  primary key (user_id, kind, id),
  constraint records_data_size check (pg_column_size(data) < 512000)
);
create index if not exists records_user_rev on public.records (user_id, rev);

alter table public.records enable row level security;
alter table public.records force row level security;

drop policy if exists "records: own select" on public.records;
drop policy if exists "records: own insert" on public.records;
drop policy if exists "records: own update" on public.records;
drop policy if exists "records: own delete" on public.records;
create policy "records: own select" on public.records for select to authenticated using (user_id = auth.uid());
create policy "records: own insert" on public.records for insert to authenticated with check (user_id = auth.uid());
create policy "records: own update" on public.records for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "records: own delete" on public.records for delete to authenticated using (user_id = auth.uid());

revoke all on public.records from anon, public;
grant select, insert, update, delete on public.records to authenticated;
grant usage on sequence public.records_rev_seq to authenticated;

-- Every write gets a fresh rev so clients can pull "everything after my cursor".
create or replace function public.records_bump_rev() returns trigger
language plpgsql set search_path = public as $$
begin
  new.rev := nextval('public.records_rev_seq');
  return new;
end $$;
drop trigger if exists records_bump_rev on public.records;
create trigger records_bump_rev before insert or update on public.records
  for each row execute function public.records_bump_rev();

-- Batch upsert with last-writer-wins: a row is only overwritten by a write with an equal or newer updated_at.
-- SECURITY INVOKER, so the caller's RLS policies apply; user_id always comes from auth.uid(), never the payload.
-- Returns the rows that were applied (stale writes are silently skipped and simply not returned).
create or replace function public.push_records(rows jsonb)
returns table (kind text, id text, rev bigint)
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 500 then
    raise exception 'rows must be an array of at most 500 records' using errcode = '22023';
  end if;
  return query
  insert into public.records as r (user_id, kind, id, data, deleted, updated_at)
  select auth.uid(), x.kind, x.id, case when x.deleted then null else x.data end, coalesce(x.deleted, false), x.updated_at
  from jsonb_to_recordset(rows) as x(kind text, id text, data jsonb, deleted boolean, updated_at bigint)
  on conflict (user_id, kind, id) do update
    set data = excluded.data, deleted = excluded.deleted, updated_at = excluded.updated_at
    where r.updated_at <= excluded.updated_at
  returning r.kind, r.id, r.rev;
end $$;

revoke all on function public.push_records(jsonb) from anon, public;
grant execute on function public.push_records(jsonb) to authenticated;
