/**
 * Create the multi-user test accounts.
 *
 * Two ordinary accounts that belong to the SAME organization, so sharing can be exercised for real:
 * two independent logins, one tenant, different permissions. They are deliberately indistinguishable
 * from accounts created through the UI — uuid ids, a `$2b$12$` bcrypt hash, no flag marking them as
 * fixtures — because a test account that behaves differently from a real one tests nothing.
 *
 * Run:  npx tsx scripts/create-test-accounts.ts
 */
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import bcrypt from 'bcryptjs'

import { prisma } from '../src/lib/db'

const ORG_SLUG = 'org202'

/** `crypto.randomBytes` rather than a word list: these are real credentials in a real sign-in form. */
function generatePassword(): string {
  return randomBytes(18).toString('base64url')
}

const ACCOUNTS = [
  { email: 'alice@webboxes.com', name: 'Alice (test)', memberRole: 'admin' },
  { email: 'bob@webboxes.com', name: 'Bob (test)', memberRole: 'developer' },
]

async function main() {
  const organization = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true },
  })
  if (!organization) throw new Error(`No organization with slug "${ORG_SLUG}"`)

  const created: Array<{ email: string; password: string; role: string; name: string }> = []

  for (const account of ACCOUNTS) {
    const password = generatePassword()
    const passwordHash = await bcrypt.hash(password, 12)

    const user = await prisma.user.upsert({
      where: { email: account.email },
      // A re-run issues a fresh password rather than leaving an unknown one in place.
      update: { password: passwordHash, name: account.name, role: 'member', disabled: false },
      create: {
        email: account.email,
        name: account.name,
        password: passwordHash,
        role: 'member', // a platform member: no system view, organizations only
      },
      select: { id: true, email: true },
    })

    await prisma.organizationMember.upsert({
      where: {
        organizationId_userId: { organizationId: organization.id, userId: user.id },
      },
      update: { role: account.memberRole },
      create: {
        organizationId: organization.id,
        userId: user.id,
        role: account.memberRole,
      },
    })

    created.push({
      email: user.email,
      password,
      role: account.memberRole,
      name: account.name,
    })
    console.log(`  ${user.email.padEnd(24)} role=${account.memberRole}`)
  }

  // The pin is generated from this file so the credentials live in exactly one place.
  writeFileSync(
    '/home/z370n/.secure-upload/test-accounts.json',
    JSON.stringify({ organization: organization.name, slug: ORG_SLUG, accounts: created }, null, 2),
    { mode: 0o600 }
  )
  console.log(`  written to ~/.secure-upload/test-accounts.json (0600)`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
