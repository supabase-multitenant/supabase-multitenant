// Post-build steps for the site's dist/ output.
//
// 1. GitHub Pages doesn't rewrite unknown paths to index.html — it serves
//    404.html instead. We ship a byte-identical copy of the built index.html
//    as 404.html so BrowserRouter deep links work (any unknown path loads the
//    SPA, then the client router renders the right page).
// 2. Publish the installer as /get so `curl -sSL <site>/get | sh` works. The
//    source install.sh lives at the repository root (one directory above the
//    website package), so we copy it into dist/get.
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const dist = resolve(process.cwd(), 'dist')

// 1. SPA fallback
const index = resolve(dist, 'index.html')
if (!existsSync(index)) {
  console.error('dist/index.html not found — run `vite build` first.')
  process.exit(1)
}
copyFileSync(index, resolve(dist, '404.html'))
console.log('Copied dist/index.html → dist/404.html')

// 2. Installer entrypoint at /get
const installSh = resolve(process.cwd(), '..', 'install.sh')
if (!existsSync(installSh)) {
  console.warn(`WARNING: ${installSh} not found — /get will not be published.`)
} else {
  copyFileSync(installSh, resolve(dist, 'get'))
  console.log('Copied install.sh → dist/get')
}
