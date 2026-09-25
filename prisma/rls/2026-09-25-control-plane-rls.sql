-- Control-plane row-level security.
--
-- Requirement this satisfies: a forgotten authorization check on a single code path must be
-- *incapable* of leaking another organization's rows. Today the rule lives in src/lib/authz.ts —
-- correct, verified, but only as good as every route remembering to call it.
--
-- Design (ours; derived from the requirement, not from anyone's SQL):
--
--   * Reads are enforced by policy. The policies key off a per-request setting, `app.user_id`,
--     which the request path sets inside a transaction. A query with no setting returns NOTHING,
--     so the failure mode is "no data", never "someone else's data".
--   * The membership test lives in a SECURITY DEFINER function so the check itself is not filtered
--     by the policy it supports (that would recurse).
--   * Writes stay governed by the application's permission checks. They are already gated per
--     route, and the property we are buying here is that existing rows cannot be *read* across
--     organizations. The insert/update/delete policies mirror membership so the panel keeps
--     working once it is switched onto the restricted role.
--
-- Applied deliberately, NOT at boot: a column change or policy landing during startup is how the
-- panel ends up in a crash loop (see issue #75). The migration is idempotent so re-running is safe.
--
-- This file changes nothing for the panel today: it connects as a superuser with BYPASSRLS, so
-- policies do not apply to it. Arming it means running request queries as `smbt_app` with
-- `app.user_id` set — see src/lib/rls.ts.

begin;

-- ---------------------------------------------------------------------------
-- The restricted role the request path assumes.
-- NOLOGIN: it is entered with SET LOCAL ROLE from the pool's existing connection, so it needs no
-- credential of its own and cannot be connected to directly.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'smbt_app') then
    create role smbt_app nologin;
  end if;
end
$$;

grant usage on schema public to smbt_app;
grant select, insert, update, delete on all tables in schema public to smbt_app;
alter default privileges in schema public grant select, insert, update, delete on tables to smbt_app;

-- ---------------------------------------------------------------------------
-- Helpers.
-- ---------------------------------------------------------------------------
create or replace function public.current_app_user() returns text
language sql stable
as $$
  select nullif(current_setting('app.user_id', true), '')
$$;

-- Is the current request's user a member of this organization?
-- SECURITY DEFINER: the lookup must see organization_members regardless of the caller's policies,
-- otherwise the policy that calls it filters its own input and returns nothing.
create or replace function public.is_org_member(target_org text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    where m."organizationId" = target_org
      and m."userId" = public.current_app_user()
  )
$$;

-- Does the current request's user own this organization?
create or replace function public.is_org_owner(target_org text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organizations o
    where o.id = target_org
      and o."ownerId" = public.current_app_user()
  )
$$;

-- Is this project visible to the current request's user?
--
-- Two ways in, because projects are not uniformly owned:
--   * through the project's organization, when it has one;
--   * as the project's own owner, which is what covers the projects that have NO organization.
-- The second arm is not a convenience: 2 of 8 live projects are org-less, so a membership-only rule
-- would hide them from the very person who created them. Removing the org-less state entirely is
-- issue #143; until then the policy has to admit it.
create or replace function public.is_project_visible(target_project text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = target_project
      and (
        (p."organizationId" is not null and public.is_org_member(p."organizationId"))
        or (p."ownerId" is not null and p."ownerId" = public.current_app_user())
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- Organizations: an organization is visible to its members.
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;

drop policy if exists org_members_read on public.organizations;
create policy org_members_read on public.organizations
  for select using (public.is_org_member(id));

drop policy if exists org_creator_insert on public.organizations;
create policy org_creator_insert on public.organizations
  for insert with check ("ownerId" = public.current_app_user());

drop policy if exists org_owner_write on public.organizations;
create policy org_owner_write on public.organizations
  for update using (public.is_org_owner(id)) with check (public.is_org_owner(id));

drop policy if exists org_owner_delete on public.organizations;
create policy org_owner_delete on public.organizations
  for delete using (public.is_org_owner(id));

-- ---------------------------------------------------------------------------
-- Organization-scoped data. A row is visible only through its organization.
-- ---------------------------------------------------------------------------
alter table public.organization_members enable row level security;
drop policy if exists org_members_read on public.organization_members;
create policy org_members_read on public.organization_members
  for select using (public.is_org_member("organizationId"));
drop policy if exists org_members_write on public.organization_members;
create policy org_members_write on public.organization_members
  for all using (public.is_org_member("organizationId"))
  with check (public.is_org_member("organizationId"));

-- ---------------------------------------------------------------------------
-- Projects: visible through their organization, or to their own owner.
-- ---------------------------------------------------------------------------
alter table public.projects enable row level security;
drop policy if exists project_visible_read on public.projects;
create policy project_visible_read on public.projects
  for select using (public.is_project_visible(id));
drop policy if exists project_owner_insert on public.projects;
create policy project_owner_insert on public.projects
  for insert with check ("ownerId" = public.current_app_user());
drop policy if exists project_visible_write on public.projects;
create policy project_visible_write on public.projects
  for update using (public.is_project_visible(id)) with check (public.is_project_visible(id));
drop policy if exists project_visible_delete on public.projects;
create policy project_visible_delete on public.projects
  for delete using (public.is_project_visible(id));

-- ---------------------------------------------------------------------------
-- Organization-scoped tables: a row is visible only through its organization.
-- These carry `organizationId` themselves.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  scoped constant text[] := array['audit_logs', 'custom_roles', 'invitations'];
begin
  foreach t in array scoped loop
    if exists (select 1 from information_schema.tables
               where table_schema = 'public' and table_name = t) then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists org_scoped_read on public.%I', t);
      execute format(
        'create policy org_scoped_read on public.%I for select '
        'using (public.is_org_member("organizationId"))', t);
      execute format('drop policy if exists org_scoped_write on public.%I', t);
      execute format(
        'create policy org_scoped_write on public.%I for all '
        'using (public.is_org_member("organizationId")) '
        'with check (public.is_org_member("organizationId"))', t);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Project-scoped tables: these reach their organization through the project.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  scoped constant text[] := array['project_env_vars', 'project_backups', 'project_function_secrets'];
begin
  foreach t in array scoped loop
    if exists (select 1 from information_schema.tables
               where table_schema = 'public' and table_name = t) then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists project_scoped_read on public.%I', t);
      execute format(
        'create policy project_scoped_read on public.%I for select '
        'using (public.is_project_visible("projectId"))', t);
      execute format('drop policy if exists project_scoped_write on public.%I', t);
      execute format(
        'create policy project_scoped_write on public.%I for all '
        'using (public.is_project_visible("projectId")) '
        'with check (public.is_project_visible("projectId"))', t);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Everything else: no policy, therefore no access for the restricted role.
--
-- The authentication tables (users, accounts, sessions, password_reset_tokens,
-- verification_tokens, panel_settings, team_members) are deliberately left alone in this pass:
-- the sign-in flow legitimately reads them *before* an identity exists, so they need their own
-- design rather than a mechanical membership rule. Until then the restricted role cannot see them
-- at all, which fails closed.
-- ---------------------------------------------------------------------------

commit;
