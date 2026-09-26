-- The authentication path's own role, and the boundary between it and the tenant-scoped role.
--
-- Sign-in reads tables that hold no organization scope, and it does so *before* an identity exists —
-- so it cannot run under the tenant-scoped role, whose whole design is "you see what your declared
-- user may see". Until now that had no answer, which is why the policies were installed but never
-- armed: `smbt_app` could reach the credential tables (`users`, `accounts`, `sessions`,
-- verification and reset tokens) directly, so a forgotten check there was still a live leak.
--
-- The split:
--   smbt_auth  — used ONLY by the sign-in flow. Reaches the credential tables and nothing else.
--                No organization, project, environment, secret, invitation or audit table is
--                reachable from it. Its protection is the *grant boundary*, not row policies: the
--                credential tables are global by nature (one person spans organizations), so scoping
--                them per-organization is meaningless. What matters is that nothing else may touch
--                them, and that it cannot reach tenant data at all.
--   smbt_app   — every request that acts for a signed-in user. Loses `accounts`, `sessions` and the
--                two token tables entirely: it has no business reading credentials. `users` stays
--                reachable but narrowed to peers.
--
-- Applied deliberately, not at boot (#75).

-- ---------------------------------------------------------------------------
-- Is this user visible to the current request's user?
--
-- Self-contained and SECURITY DEFINER on purpose. The obvious version of this rule — writing the
-- membership join straight into the policy — breaks the sign-in role: a policy expression is
-- evaluated as the role asking the question, and that role has no business holding a grant on
-- `organization_members`, so reading `users` failed outright with "permission denied". Encapsulating
-- the rule in a definer function keeps the policy a single call and keeps the granted surface small.
-- ---------------------------------------------------------------------------
create or replace function is_user_visible(target_user text) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select
    target_user = nullif(current_setting('app.user_id', true), '')
    or exists (
      select 1
      from organization_members mine
      join organization_members theirs
        on theirs."organizationId" = mine."organizationId"
      where mine."userId" = nullif(current_setting('app.user_id', true), '')
        and theirs."userId" = target_user
    )
$$;

-- ---------------------------------------------------------------------------
-- Who may read the user table, and how much of it.
--
-- Two policies, each scoped to one role, because the two roles need genuinely different answers and
-- collapsing them would hand the strictest rule to the role that cannot function under it.
-- ---------------------------------------------------------------------------
alter table users enable row level security;

-- The sign-in flow has to find an account before any identity exists, and has to be able to write to
-- it (password reset, profile). It is trusted for these tables; the guarantee is that it can reach
-- nothing else.
drop policy if exists users_for_signin on users;
create policy users_for_signin on users
  for all to smbt_auth
  using (true) with check (true);

-- A request acting for a signed-in user sees the people they share an organization with, plus
-- themselves — the same rule that governs every other table here. Someone signed in but in no
-- organization yet sees only themselves, which is what onboarding needs.
drop policy if exists users_visible_to_org_peers on users;
create policy users_visible_to_org_peers on users
  for select to smbt_app
  using (is_user_visible(id));

-- ---------------------------------------------------------------------------
-- The credential surface leaves the tenant-scoped role.
--
-- Sessions and tokens are the material of authentication itself. Nothing a signed-in request does
-- needs them, and a route that could read them could forge a session. Revoking is the point of this
-- file: the tenant role must fail closed here regardless of any policy.
-- ---------------------------------------------------------------------------
revoke all on accounts, sessions, verification_tokens, password_reset_tokens from smbt_app;

-- ---------------------------------------------------------------------------
-- The sign-in role.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'smbt_auth') then
    create role smbt_auth nologin;
  end if;
end $$;

grant usage on schema public to smbt_auth;

-- Exactly what sign-in touches: locate the account, read/rotate credentials, open and close a
-- session, consume a verification or reset token, read panel settings.
grant select, insert, update, delete on
  users,
  accounts,
  sessions,
  verification_tokens,
  password_reset_tokens,
  panel_settings
to smbt_auth;

-- No grant reaches tenant data, so these succeed only in the sense that there is nothing to revoke.
-- Stated explicitly because the boundary is the guarantee, not a side effect of omission.
revoke all on
  organizations,
  organization_members,
  projects,
  project_env_vars,
  project_backups,
  project_function_secrets,
  invitations,
  custom_roles,
  audit_logs,
  team_members
from smbt_auth;

-- ---------------------------------------------------------------------------
-- `team_members` is legacy (retired in #31) and holds no tenant scope. It is left reachable by
-- neither role on purpose: nothing should be reading it, and removing the temptation is cheaper
-- than auditing it.
-- ---------------------------------------------------------------------------
revoke all on team_members from smbt_app;
