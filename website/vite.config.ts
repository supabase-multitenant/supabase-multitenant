import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// `base` must be `/` for a user/org `.github.io` site served at the domain
// root. Set VITE_BASE (e.g. `/repo-name/`) when deploying as a project site.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react(), tailwindcss()],
})
