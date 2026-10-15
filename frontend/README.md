# R59 Media — Frontend

React, TypeScript and Vite. The application currently renders the responsive hero and navigation. Background images are supplied as presentation data; backend/admin integration and animations are deferred.

## Commands

Run these commands from the `frontend` directory. Package manager: pnpm 10.30.3.

| Command | Purpose |
| --- | --- |
| `pnpm install --frozen-lockfile` | Install the dependencies recorded in the lockfile. |
| `pnpm dev` | Start the local development server. The hero and navigation are displayed. |
| `pnpm typecheck` | Check the TypeScript source and configuration. |
| `pnpm lint` | Check the code with ESLint. |
| `pnpm build` | Check TypeScript and generate the production files in `dist/`. |
| `pnpm check` | Run lint, TypeScript checking and the production build. |
| `pnpm preview` | Preview an existing production build locally. |

## Structure

```text
public/          Static public files
src/
  api/           API request functions
  assets/        Imported static assets
  components/    Shared components
  config/        Application configuration
  sections/      Page sections
    hero/        Introduction and primary session CTA
    about/       Photographer biography
    recent-photoshoot/  Most recent photoshoot highlight
    portfolio/   Photo gallery and category filters
    booking/     Service, date and time selection
    contact/     General inquiry form
  types/         TypeScript data types
  App.tsx        Hero and shared header composition
  main.tsx       React bootstrap
```

The hero uses `src/config/hero.ts` for local slides and destination configuration,
`src/types/hero.ts` for its presentation contract, and `src/styles/tokens.css` for
shared visual values. Other section directories remain placeholders. No API
requests or business logic have been implemented. Navigation targets remain
disabled until their destination sections exist.

The frontend and backend are separate packages within the same repository. Their
dependencies and TypeScript configurations serve different runtimes. The root
`.gitignore` excludes generated frontend files such as `node_modules/` and `dist/`.

Navigation lives in `components/`; the footer can join that shared layout later. Section folders reserve responsibilities only;
they do not define final content, visual styling or behavior.
