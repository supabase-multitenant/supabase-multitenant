// Single source of truth for product identity and external links used across
// the site. Update here to change the GitHub org/repo, install URL, etc.
export const REPO_ORG = 'supabase-multitenant'
export const REPO_NAME = 'supabase-multitenant'
export const REPO = `${REPO_ORG}/${REPO_NAME}`
export const REPO_URL = `https://github.com/${REPO}`
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`
// The one-line installer script. (The short domain get.supabase-multitenant.io
// is not set up, so we point directly at the raw install.sh in the repo.)
export const INSTALL_URL = `https://raw.githubusercontent.com/${REPO}/main/install.sh`
