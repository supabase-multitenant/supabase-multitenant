import fs from 'node:fs/promises'

/**
 * Edit individual variables in a `.env` file, leaving everything else alone.
 *
 * The panel's existing writer (`updateProjectEnvVars`) writes the file from only the variables it is
 * handed, so adding one setting through it deletes the project's ports, database password and JWT
 * secret. Any code that touches a `.env` it does not own must preserve the lines it did not name —
 * so that is what this does, and nothing else. A `null` value removes a line, which is different
 * from setting it empty: an empty `OPENAI_BASE_URL` is still a URL as far as the SDK is concerned.
 */
export async function mergeEnvFile(
  envFilePath: string,
  entries: Record<string, string | null>
): Promise<void> {
  let existing = ''
  try {
    existing = await fs.readFile(envFilePath, 'utf8')
  } catch {
    existing = ''
  }

  const seen = new Set<string>()
  const lines: string[] = []

  for (const line of existing.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(line)
    if (!match || !(match[1] in entries)) {
      lines.push(line)
      continue
    }
    const key = match[1]
    seen.add(key)
    const value = entries[key]
    if (value === null) continue
    lines.push(`${key}=${value}`)
  }

  for (const [key, value] of Object.entries(entries)) {
    if (seen.has(key) || value === null) continue
    lines.push(`${key}=${value}`)
  }

  const content = lines.join('\n').replace(/\n{3,}/g, '\n\n')
  await fs.writeFile(envFilePath, content.endsWith('\n') ? content : `${content}\n`)
}
