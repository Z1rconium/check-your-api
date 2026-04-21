# Repository Guidelines

## Project Structure & Module Organization
This repo is a TypeScript monorepo-style app with a React frontend and an Express proxy.

- `src/`: Vite + React UI (`App.tsx`, `main.tsx`, `styles.css`)
- `server/`: local Node proxy entry and app wiring (`index.ts`, `app.ts`, `core.ts`)
- `api/`: serverless handlers for Vercel (`models.ts`, `check.ts`)
- `.server-build/`: compiled server output from `npm run build:server`
- `dist/`: compiled frontend output from `npm run build:web`

Keep API/proxy behavior changes aligned across `server/` and `api/` when relevant.

## Build, Test, and Development Commands
- `npm run dev`: starts both proxy (`:8787`) and web (`:5173`) in watch mode.
- `npm run dev:proxy`: runs only the local proxy with `tsx watch`.
- `npm run dev:web`: runs only the Vite frontend.
- `npm run build`: type-checks and builds both frontend and server outputs.
- `npm run build:web`: builds frontend into `dist/`.
- `npm run build:server`: compiles server/API TypeScript into `.server-build/`.
- `npm run start`: runs production server from `.server-build/server/index.js`.
- `npm run preview`: previews built frontend.

## Coding Style & Naming Conventions
- Language: strict TypeScript (`strict: true`, unused checks enabled).
- Indentation: 2 spaces; keep existing semicolon and double-quote style in TS/TSX.
- Components/types: `PascalCase` (`App`, `CheckResult`); variables/functions: `camelCase`.
- Prefer small pure helpers in `src/App.tsx` and shared request logic in `server/core.ts`/`api/*`.
- Keep imports ESM-compatible (`type: module`, NodeNext/Bundler resolution).

## Testing Guidelines
There is currently no dedicated test framework configured. Minimum contribution bar:

- Run `npm run build` before opening a PR (acts as type + build gate).
- Manually smoke test: fetch models, batch check, and latency labels in `npm run dev`.
- If adding non-trivial logic, include lightweight validation (e.g., isolated helper functions) and document manual verification steps in the PR.

## Commit & Pull Request Guidelines
- Follow existing commit style: short, imperative subject line (e.g., `Add model picker for batch checks`).
- Scope each commit to one logical change; avoid mixing refactor + feature + formatting.
- PRs should include:
  - what changed and why
  - local verification steps/commands
  - screenshots or short recordings for UI changes in `src/`
  - any config/runtime impact (`PORT`, Vercel behavior, API compatibility)
