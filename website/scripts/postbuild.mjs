// GitHub Pages doesn't rewrite unknown paths to index.html. It serves 404.html
// instead, so we ship a byte-identical copy of the built index.html as 404.html.
// This lets BrowserRouter deep links like /docs/introduction load the SPA for
// any path a visitor types or is sent, then the client router renders it.
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const dist = resolve(process.cwd(), 'dist')
const src = resolve(dist, 'index.html')
const dest = resolve(dist, '404.html')

if (!existsSync(src)) {
  console.error('dist/index.html not found — run `vite build` first.')
  process.exit(1)
}
copyFileSync(src, dest)
console.log('Copied dist/index.html → dist/404.html')
