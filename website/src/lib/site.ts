// Single source of truth for product identity and external links used across
// the site. Update here to change the GitHub org/repo, install URL, etc.
export const REPO_ORG = 'supabase-multitenant'
export const REPO_NAME = 'supabase-multitenant'
export const REPO = `${REPO_ORG}/${REPO_NAME}`
export const REPO_URL = `https://github.com/${REPO}`
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`
export const SITE_URL = 'https://supabase-multitenant.github.io'
// One-line installer, served by the site itself at /get (see scripts/postbuild.mjs,
// which copies the repo's install.sh into dist/get during build).
export const INSTALL_URL = `${SITE_URL}/get`
