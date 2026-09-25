#!/usr/bin/env python3
"""Prove the control-plane row policies enforce. Run from the host that holds the panel container:

    python3 prisma/rls/verify-rls.py

Requires the policies to have been applied first:

    docker exec -i <db-container> psql -U <user> -d supabase_multitenant \
      -v ON_ERROR_STOP=1 < prisma/rls/2026-09-25-control-plane-rls.sql

Exits non-zero if any check fails. See issue #133.
"""
"""Prove the control-plane row policies actually enforce.

Queried as the restricted role, with the request's user set the way the panel will set it:

  1. a user sees THEIR organizations and projects
  2. they see NONE of another organization's rows
  3. with no user set at all -> NOTHING (fail closed, never fail open)

A database-level test on purpose: the property under test is "the database refuses", which cannot
be demonstrated from application code.
"""
import subprocess

sh = lambda c: subprocess.run(c, shell=True, capture_output=True, text=True).stdout.strip()
DB = sh("docker ps --format '{{.Names}}' | grep -iE '^db-fmhych' | head -1")
PANEL = sh("docker ps --format '{{.Names}}' | grep -i panel-fmhych | head -1")
U = sh(f"docker exec {PANEL} sh -c 'echo $DATABASE_URL' | sed -E 's|postgresql://([^:]+):.*|\\1|'")
D = "supabase_multitenant"


def sql(q, as_app=False, user=None):
    """Query, optionally as the restricted role. `-q` keeps psql from echoing command tags."""
    if as_app:
        # SET LOCAL takes a custom GUC directly and prints nothing, unlike select set_config(...).
        body = "begin;\nset local role smbt_app;\n"
        if user:
            body += f"set local app.user_id = '{user}';\n"
        body += q + ";\nrollback;"
    else:
        body = q
    open('/tmp/_rls.sql', 'w').write(body)
    r = subprocess.run(f"docker exec -i {DB} psql -q -U {U} -d {D} -t -A -f -",
                       shell=True, stdin=open('/tmp/_rls.sql'), capture_output=True, text=True)
    if r.returncode != 0 or 'ERROR' in r.stderr:
        return ['ERROR: ' + r.stderr.strip()[:120]]
    return [l for l in r.stdout.splitlines() if l.strip()]


def resolve(email):
    return sql(f"select id from users where email='{email}'")[0]


A_EMAIL = 'webboxes.com@gmail.com'      # owns Atlas Labs, org202
B_EMAIL = 'teammate@webboxes.com'       # owns Usecase Check, nothing else
A_ID, B_ID = resolve(A_EMAIL), resolve(B_EMAIL)

print(f"  subject A: {A_EMAIL}  ({A_ID[:8]}…)")
print(f"  subject B: {B_EMAIL}  ({B_ID[:8]}…)\n")

results = []


def check(label, condition, evidence):
    results.append(bool(condition))
    print(f"  [{'PASS' if condition else 'FAIL'}] {label:<52} {evidence}")


print("  as the restricted role, with the request user set:")
a_orgs = sql("select name from organizations order by name", True, A_ID)
b_orgs = sql("select name from organizations order by name", True, B_ID)
print(f"    A sees: {a_orgs}")
print(f"    B sees: {b_orgs}\n")

check("A sees their own organizations", 'Atlas Labs' in a_orgs, f"{len(a_orgs)} org(s)")
check("B does NOT see A's organizations",
      not any(o in b_orgs for o in ('Atlas Labs', 'org202')), f"{len(b_orgs)} org(s)")
check("B sees their own organization", 'Usecase Check' in b_orgs, f"{len(b_orgs)} org(s)")

a_pr = sql("select name from projects order by name", True, A_ID)
b_pr = sql("select name from projects order by name", True, B_ID)
print(f"\n    A projects: {a_pr}")
print(f"    B projects: {b_pr}\n")

check("A sees their own projects", len(a_pr) > 0, f"{len(a_pr)}")
check("B does NOT see A's projects",
      not any(p in b_pr for p in ('project101-of-org202-1790168723120', 'playgroundsb1-1788963289601')),
      f"{len(b_pr)}")

# A must not be able to read B's membership row, even knowing the row exists.
cross = sql(f"select \"organizationId\" from organization_members where \"userId\"='{B_ID}'", True, A_ID)
check("A querying B's membership row directly returns nothing", cross == [], f"{cross}")

# The secrets tables.
env_a = sql("select count(*) from project_env_vars", True, A_ID)
env_b = sql("select count(*) from project_env_vars", True, B_ID)
print(f"\n    env vars visible: A={env_a}  B={env_b}")
check("each subject only sees its own project env vars",
      env_a != env_b or env_a == ['0'], f"A={env_a} B={env_b}")

print("\n  with NO request user set — the forgotten-check case:")
none = {
    'organizations': sql("select name from organizations", True, None),
    'projects': sql("select name from projects", True, None),
    'memberships': sql("select count(*) from organization_members", True, None),
    'project_env_vars': sql("select count(*) from project_env_vars", True, None),
    'function_secrets': sql("select count(*) from project_function_secrets", True, None),
    'invitations': sql("select count(*) from invitations", True, None),
    'audit_logs': sql("select count(*) from audit_logs", True, None),
}
for table, rows in none.items():
    empty = rows == [] or rows == ['0']
    check(f"no identity -> nothing from {table}", empty, f"{rows}")

# And confirm a privileged connection is unaffected, so the running panel cannot break from this.
priv = sql("select count(*) from organizations")
check("privileged (panel) connection still sees everything", priv != ['0'], f"{priv} org(s)")

print(f"\n  {sum(results)}/{len(results)} checks passed")
raise SystemExit(0 if all(results) else 1)
