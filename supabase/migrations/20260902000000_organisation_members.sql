-- =============================================================================
-- Migration: organisation_members
-- Multi-user workspace support: owner/admin and team members.
-- =============================================================================

create table if not exists public.organisation_members (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete cascade,
  user_id         uuid references auth.users (id) on delete cascade,
  email           text not null,
  role            text not null default 'member' check (role in ('admin', 'member')),
  status          text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  invited_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint organisation_members_org_email_unique unique (organisation_id, email)
);

create index if not exists org_members_org_id_idx
  on public.organisation_members (organisation_id);

create index if not exists org_members_user_id_idx
  on public.organisation_members (user_id);

create index if not exists org_members_email_idx
  on public.organisation_members (email);

drop trigger if exists org_members_set_updated_at on public.organisation_members;
create trigger org_members_set_updated_at
  before update on public.organisation_members
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.organisation_members enable row level security;

-- Members of an organisation (or org owner) can read all members of that org.
drop policy if exists "org_members_select" on public.organisation_members;
create policy "org_members_select"
  on public.organisation_members for select
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.organisations o
      where o.id = organisation_members.organisation_id
      and o.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.organisation_members m
      where m.organisation_id = organisation_members.organisation_id
      and m.user_id = (select auth.uid())
    )
  );

-- Only admins / org owners can insert members.
drop policy if exists "org_members_admin_insert" on public.organisation_members;
create policy "org_members_admin_insert"
  on public.organisation_members for insert
  to authenticated
  with check (
    exists (
      select 1 from public.organisations o
      where o.id = organisation_members.organisation_id
      and o.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.organisation_members m
      where m.organisation_id = organisation_members.organisation_id
      and m.user_id = (select auth.uid())
      and m.role = 'admin'
    )
  );

-- Only admins / org owners can update members.
drop policy if exists "org_members_admin_update" on public.organisation_members;
create policy "org_members_admin_update"
  on public.organisation_members for update
  to authenticated
  using (
    exists (
      select 1 from public.organisations o
      where o.id = organisation_members.organisation_id
      and o.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.organisation_members m
      where m.organisation_id = organisation_members.organisation_id
      and m.user_id = (select auth.uid())
      and m.role = 'admin'
    )
  );

-- Only admins / org owners can delete members.
drop policy if exists "org_members_admin_delete" on public.organisation_members;
create policy "org_members_admin_delete"
  on public.organisation_members for delete
  to authenticated
  using (
    exists (
      select 1 from public.organisations o
      where o.id = organisation_members.organisation_id
      and o.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.organisation_members m
      where m.organisation_id = organisation_members.organisation_id
      and m.user_id = (select auth.uid())
      and m.role = 'admin'
    )
  );

-- -----------------------------------------------------------------------------
-- Backfill existing org owners as 'admin' members
-- -----------------------------------------------------------------------------
insert into public.organisation_members (organisation_id, user_id, email, role, status)
select
  o.id,
  o.owner_id,
  coalesce(u.email, 'owner@workspace.local'),
  'admin',
  'active'
from public.organisations o
left join auth.users u on u.id = o.owner_id
on conflict (organisation_id, email) do nothing;
