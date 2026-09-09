# Supabase Multitenant — Website

The public marketing + documentation site for **Supabase Multitenant**, built to
match the dark, green-accented aesthetic of supabase.com. It explains what the
product is, how the architecture works, and ships a full docs section with a
sidebar and fuzzy search.

## Stack

- **Vite 8** + **React 19** + **TypeScript**
- **Tailwind CSS v4** via `@tailwindcss/vite` (design tokens in `src/index.css`)
- **react-router-dom** for client-side routing
- **react-markdown** + **remark-gfm** for the docs
- **fuse.js** for the docs fuzzy search
- **oxlint** for linting

## Project layout

```
src/
├── lib/
│   ├── docs.ts        # docs content + navigation + searchable index
│   ├── search.ts      # fuse.js search over the docs
│   └── site.ts        # product identity & external links (repo, install URL)
├── components/
│   ├── Navbar.tsx  Footer.tsx  Logo.tsx  BrandMark.tsx
│   ├── DocsLayout.tsx  SearchBox.tsx  RichText.tsx  ArchDiagram.tsx
│   └── ScrollToTop.tsx
└── pages/
    ├── Home.tsx        # landing page
    ├── HowItWorks.tsx  # architecture / product explanation
    ├── Docs.tsx        # /docs → first page redirect
    ├── DocPage.tsx     # /docs/:slug
    └── NotFound.tsx
public/
├── favicon.svg         # brand mark
── (404.html generated at build time)
```

## Developing

```bash
cd website
npm install
npm run dev        # http://localhost:5173
```

## Building

```bash
npm run build      # type-checks, builds to dist/, writes dist/404.html
npm run preview    # serve the production build locally
```

The `build` script runs `tsc -b`, then `vite build`, then copies
`dist/index.html` → `dist/404.html`. The 404 fallback lets BrowserRouter deep
links like `/docs/introduction` load the SPA from GitHub Pages.

## Deploying to GitHub Pages

The deploy workflow lives at `.github/workflows/pages.yml`.

- **Org/user site at the domain root** (`https://<org>.github.io`, the
  `supabase-multitenant.github.io` target): place the workflow in the
  `<org>.github.io` repository. It checks out the source from the app repo,
  builds `website/`, and publishes at `/`. This is the default (`VITE_BASE=/`).
- **Project site** (`https://<org>.github.io/<repo>`): keep the workflow in the
  app repo, set Pages source to **GitHub Actions**, and set `VITE_BASE` to the
  repo name.

The build picks the base URL from `VITE_BASE` (see `vite.config.ts`). Default is
`/`, which is correct for a root-level org/user site.
