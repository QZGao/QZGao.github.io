# Quinn Gao — research and projects

The source for [supergrey.uk](https://supergrey.uk), built with Astro and deployed as a static site through GitHub Pages.

## Working locally

Use the Node version in `.node-version`, then run:

```sh
npm install
npm run dev
```

`npm run verify` runs the focused tests, Astro type/content checks, the production build, an internal-link audit, and a dry-run bundle of the QQ Music Worker.

## Adding content

- Research notes live in `src/content/research/`.
- Projects live in `src/content/projects/`; set `category` to `academic`, `toolkit`, or `wikipedia` to place an entry in the project index.
- Profile and notebook links live in `src/data/site.ts`.
- An interactive project gets one route in `src/pages/projects/` and an isolated client module in `src/features/`.

Use Markdown for prose. Use MDX only when the document itself must embed an interactive component.

## Architectural constraints

- Static HTML is the default; browser JavaScript belongs only to interactive tools.
- `SiteLayout`, `ProseLayout`, and `ProjectLayout` define the public page vocabulary.
- Global CSS contains tokens, document typography, and shared primitives. Tool-specific styles stay with the tool page.
- Project metadata has one canonical content entry. Lists and routes do not maintain separate registries.
- The QQ Music API Worker is an independent project under `workers/qqmusic-api/`.
- Legacy `/toolbox/*.html` addresses are compatibility redirects only, generated from `public/toolbox/`.

The website deploys through `.github/workflows/deploy.yml`. The Worker has a separate Wrangler configuration and is never deployed as a side effect of publishing the site.
