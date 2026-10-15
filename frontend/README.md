# R59 Media — Frontend

React, TypeScript and Vite. The application currently renders an empty page.

## Commands

Run these commands from the `frontend` directory. Package manager: pnpm 10.30.3.

| Command | Purpose |
| --- | --- |
| `pnpm install --frozen-lockfile` | Install the dependencies recorded in the lockfile. |
| `pnpm dev` | Start the local development server. An empty page is expected. |
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
  App.tsx        Empty application entry
  main.tsx       React bootstrap
```

The reserved directories contain only `.gitkeep` placeholders so Git can retain
them. No interface, API requests or business logic have been implemented.

The frontend and backend are separate packages within the same repository. Their
dependencies and TypeScript configurations serve different runtimes. The root
`.gitignore` excludes generated frontend files such as `node_modules/` and `dist/`.

Navigation and the footer belong to the shared page layout and can be added under
`components/` when implemented. Section folders reserve responsibilities only;
they do not define final content, visual styling or behavior.
