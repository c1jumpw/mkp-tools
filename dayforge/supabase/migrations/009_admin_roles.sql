-- =============================================================================
-- MIGRATION: 009_admin_roles.sql
-- VERSION: v1 (2026-11-20)
-- PURPOSE: Adds ADMIN ROLES to DayForge.
--          - app_admins holds the accounts that are admins. Everyone else
--            signed in is a regular user.
--          - Admins see ⋮ › Admin (the change log, the automatic list of
--            every code change, and the list of admins) and the
--            admin-only items in What's new.
--          - The FIRST account ever created becomes the first admin (that's
--            the owner, who set DayForge up), so nobody is locked out.
--
-- RUN THIS ONCE in Supabase Dashboard -> SQL Editor -> New query, on top of
-- schema.sql + migrations 002 through 008. Safe to re-run: every statement
-- is guarded (if not exists / or replace / on conflict).
--
-- SECURITY MODEL
--   - Admins are stored by ACCOUNT ID (auth.users.id), not by email, so
--     someone signing up later with a matching email can't inherit admin.
--     add_admin() looks the email up once and stores the id.
--   - The table has row level security ON and NO policies: the app can't
--     read or write it directly. Everything goes through the four
--     functions below, which check is_admin() themselves (security
--     definer, fixed search_path).
--   - remove_admin() refuses to remove the last admin.
--   - Deleting an account removes its admin row (on delete cascade).
--
-- ASSUMPTIONS / EDGE CASES
--   - add_admin() only accepts an email that already has a DayForge
--     account. Ask the person to sign up first.
--   - An admin can remove themself as long as another admin remains.
-- =============================================================================

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
-- Intentionally no policies: direct table access is denied to the app.

-- ---- is_admin(): is the signed-in account an admin? ------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

-- ---- list_admins(): admins only ---------------------------------------------
create or replace function public.list_admins()
returns table (user_id uuid, email text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return query
    select a.user_id, u.email::text, a.created_at
    from public.app_admins a
    join auth.users u on u.id = a.user_id
    order by a.created_at;
end;
$$;

-- ---- add_admin(email): admins only ------------------------------------------
create or replace function public.add_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  select id into v_id from auth.users where lower(email) = lower(btrim(p_email)) limit 1;
  if v_id is null then
    raise exception 'No DayForge account uses that email yet. Ask them to sign up first.' using errcode = 'P0002';
  end if;
  insert into public.app_admins (user_id, added_by) values (v_id, auth.uid())
  on conflict (user_id) do nothing;
end;
$$;

-- ---- remove_admin(user_id): admins only, never the last one -----------------
create or replace function public.remove_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if (select count(*) from public.app_admins) <= 1
     and exists (select 1 from public.app_admins where user_id = p_user_id) then
    raise exception 'Keep at least one admin.' using errcode = 'P0001';
  end if;
  delete from public.app_admins where user_id = p_user_id;
end;
$$;

-- Only signed-in accounts may call these (each one checks admin itself).
revoke all on function public.is_admin() from public, anon;
revoke all on function public.list_admins() from public, anon;
revoke all on function public.add_admin(text) from public, anon;
revoke all on function public.remove_admin(uuid) from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.list_admins() to authenticated;
grant execute on function public.add_admin(text) to authenticated;
grant execute on function public.remove_admin(uuid) to authenticated;

-- ---- First admin: the first account ever created ---------------------------
-- Only when there are no admins yet, so re-running never adds anyone.
insert into public.app_admins (user_id)
select id from auth.users
where not exists (select 1 from public.app_admins)
order by created_at
limit 1
on conflict (user_id) do nothing;

-- On a brand-new install (no accounts yet), the first account to sign up
-- becomes the admin instead. Only the very first account: if every admin is
-- later removed, a new sign-up does NOT become admin (add one back from the
-- SQL Editor: insert into public.app_admins (user_id) values ('<id>');).
create or replace function public.claim_first_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.app_admins)
     and (select count(*) from auth.users) = 1 then
    insert into public.app_admins (user_id) values (new.id) on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.claim_first_admin() from public, anon, authenticated;

drop trigger if exists dayforge_claim_first_admin on auth.users;
create trigger dayforge_claim_first_admin
  after insert on auth.users
  for each row execute function public.claim_first_admin();

-- Make the new functions visible to the app immediately.
notify pgrst, 'reload schema';
