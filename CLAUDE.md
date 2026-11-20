# Petal (placeholder name) — student life planner for the web

## Standing rules (from owner's setup prompt; apply to all agents/subagents)
- Be blunt and concise. Push back on flawed reasoning. No flattery.
- Prefer editing existing code over new files. Run tests before claiming done; report real output.
- Never read/write/echo credentials, `.env*` (except `.env.example`), or anything under `~/finance/`. Owner runs auth steps.
- Ask before installing tools or editing global settings. Show diffs for edits to existing config.
- Delegate bulk reading/review to cheaper subagents (`.claude/agents/`); main session plans and builds.
- One task per worktree, one Claude session per worktree.
- MCPs: add one only when a feature can't be built with a plain API call. The app itself uses none at runtime.

## Commands
- Install: `npm install` · Dev: `npm run dev` (http://localhost:5173)
- Tests (fast, node): `npm test` · Typecheck: `npm run typecheck` · Build: `npm run build`
- Screenshots for UI review: `npm run build && npx vite preview --port 4173 & node scripts/screenshots.mjs screenshots`

## Architecture
- Vite + React 19 + TypeScript, `wouter` routing, `zustand` state, `date-fns`. No UI kit; one CSS file.
- `src/store/store.ts`: single zustand store persisted to IndexedDB (`idb-keyval`, debounced 250ms writes).
  Ships demo data relative to today; Settings → "Clear all" removes it. `main.tsx` waits for hydration.
- `src/lib/blobs.ts`: images/files live in a separate IndexedDB store as Blobs (images downscaled to WebP on upload).
  State only holds ids. Backup JSON does NOT include blobs yet.
- `src/lib/dates.ts`: recurrence (`occursOn`/`expand`) — dates are local `yyyy-MM-dd` strings, never Date objects in state.
- `src/lib/agenda.ts` `useAgenda(from,to)`: merges items + workouts + Google events into sorted `Entry[]`. Use it for any dated view.
- `src/lib/google.ts`: Google Identity Services token flow (browser-only). Reads events (filtered to enabled calendars),
  pushes items (create/update/delete) tagged with `extendedProperties.private.petalId` so they aren't shown twice.
- `src/lib/sync.ts`: the only place UI should push/delete/skip against Google. Rules: never resurrect items deleted
  mid-request, keep `gcal` when Google is unreachable (avoids orphans/duplicates), surface failures in the toast.
- `src/lib/mealdb.ts`: TheMealDB client (CORS-enabled, no auth; key "1" is dev-only → `VITE_MEALDB_KEY` for production).
  Recipes from it keep `external.id` so re-saving doesn't duplicate. Remote images use the `/small` thumbnail in grids.
- Accounts/sync (`src/lib/cloud/`, `supabase/`): Supabase Auth (Google + email magic link, PKCE) and one `records` table with
  RLS (`user_id = auth.uid()`). `records.ts` maps state ↔ rows (pure); `engine.ts` = local-first sync (pull rev>cursor,
  per-record last-writer-wins via `push_records` RPC, mass-delete guard); `cloud.ts` = auth + triggers; supabase-js is lazy-loaded.
  Tests run the real migration on PGlite (`__tests__/rls.test.ts`, `engine.test.ts`). Setup steps: `supabase/README.md`.
  Never ship the service_role key. Sign-out wipes local data + sync meta (meta without data would push deletes).
- `src/lib/ics.ts`: .ics timetable import → items (lectures→class, "exam/midterm"→exam with countdown).
- Theming: each page/class has one accent hex; all tints derive via `color-mix` in CSS (`--accent-soft`, `--accent-ink`).
  Presets in `src/theme/themes.ts`. Covers: `preset:<key>` | blob id | `none`. Icons: emoji | `img:<blobId>`.
- Pages are lazy-loaded except Today. Keep the main chunk lean (currently ~81 KB gzip).

## Deploy
- GitHub Pages via `.github/workflows/deploy.yml` (push to main or manual run). Owner setup: Settings → Pages → Source "GitHub Actions".
- `BASE_PATH` sets the sub-path (default `/<repo>/`; repo variable `PAGES_BASE_PATH=/` for a custom domain). Use `asset()` /
  `ROUTER_BASE` from `src/config.ts` for any absolute URL. `dist/404.html` = index.html so deep links survive refresh.
- `npm run devices` checks 10 iPhone/iPad sizes; run it after any layout change.

## Gotchas
- Apple Health: no web API. iOS Shortcut → clipboard ("Sync from Health") or `#health=` link (Safari only — iOS Home Screen
  apps have separate storage). Parser in `src/lib/health.ts`. Google Fit web API is being shut down; Health Connect has no web access.
- Google: `fetchEvents` uses allSettled (one bad calendar doesn't hide the rest); `removePushed` throws on anything but 404/410.
  Tests in `src/lib/__tests__/google.test.ts` + `sync.test.ts` stub fetch/GIS — run them after any Google change.
- Google tokens last ~1h, no silent refresh without a backend; user must press Reconnect. Proper fix = small backend w/ refresh tokens.
- Google OAuth needs `VITE_GOOGLE_CLIENT_ID` (or entered in Settings) and the deploy origin in Authorized JS origins.
- Without an account, data is per-browser (clearing site data wipes it). Signed in, everything but files/images syncs via Supabase.
- `.ics` TZID times are treated as local wall time; UTC (`Z`) times are converted.
- App name lives only in `src/config.ts`, `index.html` <title>, and the IndexedDB names (`petal-*`) — renaming the DB names loses existing data.
