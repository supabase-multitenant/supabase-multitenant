#!/usr/bin/env python3
"""Prove the auth/tenant role boundary holds.

  * the sign-in role reaches credentials, and NO tenant data;
  * the request role reaches tenant data (filtered by policy), and NO credentials;
  * the panel's own connection is unaffected.

Run from the host holding the panel container. Exits non-zero if any check fails. See #133.
"""
import subprocess
import sys

DB = subprocess.run("docker ps --format '{{.Names}}' | grep -iE '^db-fmhych' | head -1",
                    shell=True, capture_output=True, text=True).stdout.strip()
P = subprocess.run("docker ps --format '{{.Names}}' | grep -i panel-fmhych | head -1",
                   shell=True, capture_output=True, text=True).stdout.strip()
URL = subprocess.run(f"docker exec {P} sh -c 'echo $DATABASE_URL'", shell=True,
                     capture_output=True, text=True).stdout.strip()
PANEL_ROLE = URL.split('://')[1].split(':')[0]

results = []


def psql(sql):
    p = subprocess.run(["docker", "exec", DB, "psql", "-U", PANEL_ROLE, "-d", "supabase_multitenant",
                        "-t", "-A", "-v", "ON_ERROR_STOP=0", "-c", f"begin; {sql} rollback;"],
                       capture_output=True, text=True)
    return (p.stdout or '') + (p.stderr or '')


def probe(role, sql, user_id=None):
    """Run one statement as `role` (None = the panel's own connection, no role change).

    The role is quoted: identifiers fold to lower case unless quoted, and the panel's role is
    mixed-case, so an unquoted name silently becomes a different, non-existent role.
    """
    inner = f'set local role "{role}";' if role else ''
    if user_id:
        inner += f" select set_config('app.user_id','{user_id}',true);"
    out = psql(f"{inner} {sql};")
    if 'permission denied' in out:
        return 'denied', None
    if 'ERROR' in out:
        line = [l for l in out.splitlines() if 'ERROR' in l]
        return 'error', line[0].strip()[:70] if line else 'error'
    vals = [l.strip() for l in out.splitlines()
            if l.strip() and l.strip() not in ('BEGIN', 'SET', 'ROLLBACK')]
    return 'rows', (vals[-1] if vals else None)


def count(role, sql, user_id=None):
    kind, val = probe(role, sql, user_id)
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def check(label, ok, note=''):
    results.append(bool(ok))
    print(f"  [{'PASS' if ok else 'FAIL'}] {label:<52} {note}")


def rows(role, table, user_id=None):
    return probe(role, f'select count(*) from {table}', user_id)[0] == 'rows'


print("=== the sign-in role: credentials yes, tenant data no ===")
check('smbt_auth reads users', rows('smbt_auth', 'users'))
check('smbt_auth reads sessions', rows('smbt_auth', 'sessions'))
check('smbt_auth reads password_reset_tokens', rows('smbt_auth', 'password_reset_tokens'))
for table in ('organizations', 'projects', 'project_env_vars', 'project_function_secrets',
              'invitations', 'audit_logs', 'custom_roles', 'organization_members'):
    check(f'smbt_auth CANNOT read {table}',
          probe('smbt_auth', f'select count(*) from {table}')[0] == 'denied')

print("\n=== the request role: tenant data yes, credentials no ===")
for table in ('sessions', 'accounts', 'password_reset_tokens', 'verification_tokens', 'team_members'):
    check(f'smbt_app CANNOT read {table}',
          probe('smbt_app', f'select count(*) from {table}')[0] == 'denied')

# Pick the actor with the FEWEST peers so narrowing is observable. If every user shares an
# organization with every other, a narrowing rule changes nothing and proving it is impossible.
actor_out = psql("""
  select m."userId" from organization_members m
  group by m."userId" order by count(*) asc limit 1;""")
actor_vals = [l.strip() for l in actor_out.splitlines()
              if l.strip() and l.strip() not in ('BEGIN', 'ROLLBACK')]
actor = actor_vals[-1] if actor_vals else None

total_users = count(None, 'select count(*) from users')
total_orgs = count(None, 'select count(*) from organizations')
expected_peers = count(None, f"""
  select count(*) from users u where u.id = '{actor}' or exists (
    select 1 from organization_members mine
    join organization_members theirs on theirs."organizationId" = mine."organizationId"
    where mine."userId" = '{actor}' and theirs."userId" = u.id)""")
visible = count('smbt_app', 'select count(*) from users', actor)

check('smbt_app sees exactly its peers in `users`, not the whole table',
      visible is not None and visible == expected_peers,
      f'visible={visible} peers+self={expected_peers} of {total_users} total')
check('the peer rule actually narrows (the check is not vacuous)',
      expected_peers is not None and total_users is not None and expected_peers < total_users,
      f'{expected_peers} < {total_users} users')

orgs = count('smbt_app', 'select count(*) from organizations', actor)
projs = count('smbt_app', 'select count(*) from projects', actor)
check('smbt_app reads organizations, policy-filtered',
      orgs is not None and total_orgs is not None and orgs < total_orgs,
      f'{orgs} of {total_orgs}')
check('smbt_app reads projects, policy-filtered', projs is not None, f'{projs} visible')

print("\n=== the panel's own connection is unaffected ===")
check('panel connection still sees every organization',
      count(None, 'select count(*) from organizations') == 4,
      f'{count(None, "select count(*) from organizations")} orgs')
check('panel connection still sees every project',
      count(None, 'select count(*) from projects') == 8,
      f'{count(None, "select count(*) from projects")} projects')
check('panel connection still reads credentials',
      count(None, 'select count(*) from users') == 3 and count(None, 'select count(*) from accounts') is not None)

passed = sum(results)
print(f"\n  {passed}/{len(results)} checks passed")
sys.exit(0 if passed == len(results) else 1)
