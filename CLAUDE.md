# Kurnool Chaos

Browser multiplayer open-city driving game, just for fun with friends. Map is real Kurnool (OpenStreetMap), stylized low-poly, dusk lighting. Phones and laptops.

## Stack
- Vite + TypeScript + Three.js (npm, no CDN)
- Supabase Realtime (broadcast + presence) for rooms, one Supabase table for race results
- Vercel static hosting, auto-deploy from GitHub `main`
- Map data: OSM exported once by `scripts/osm/*` into `public/map/kurnool.json`. The game never calls OSM at runtime.

## Modules (src/)
- `map/` load kurnool.json, build road, building, water and landmark meshes, spatial grid for collision
- `vehicles/` one physics model, per-type params (car, auto, bike, bus, lorry)
- `player/` on-foot movement, enter/exit vehicles, camera
- `ai/` local traffic on the road graph (keep left), local cops and heat
- `net/` Supabase room join, presence, state broadcast (rate in ARCHITECTURE), interpolation of remote players
- `race/` race setup, checkpoints, countdown, results
- `ui/` HUD, minimap, touch controls, menus, signboards (English + Telugu)

## Read before working
- `docs/PRD.md` what v1 is and is not
- `docs/ARCHITECTURE.md` data shapes and flows
- `docs/MAP-SPEC.md` map area, landmarks, airport, scale
- `TASKS.md` pick the next unchecked task. `PROGRESS.md` last session's state.
- `reference/port-meridian-demo.html` the original single-file prototype. Reuse its car handling, cops, heat and HUD ideas.

## Rules
- Stay in scope of the current task. Do not touch unrelated files.
- No new dependencies without asking Bunny first.
- No silent mocks or fallbacks. If data or a service is missing, show a clear error.
- Never commit secrets. Only the public `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` go in `.env.local` (gitignored); `vite.config.ts` passes exactly those two into the game.
- Keep the "© OpenStreetMap contributors" credit visible in-game.
- Before saying a task is done: `npm run build`, `npm run typecheck` and `npm test` pass, and you ran the game and checked the task's acceptance criteria.
- Small commits, one per task. Branch per bigger feature.
- At session end: update `PROGRESS.md`, tick `TASKS.md`, log choices in `DECISIONS.md`.
- Ask Bunny when stuck or when a decision is not covered by the docs. Do not guess on scope.

## Current focus
Phase 3 and Phase K are merged into `main` (2026-11-27). Open: phone check for K.1-K.3 and K.5, K.4 (needs a real correction), G.1 lobby on the real Jagannatha Gattu, G.5. Phase M (phone controls, moves, fighting): M.1-M.12 built on branch `phase-m` (M.1-M.5 merged); M.13-M.14 next. Track sessions work on their own branches; the coordinator session merges into `main`.

## Gotchas
(add repeated mistakes here as rules)
- A leftover gitignored `scripts/osm/raw.json` from an older map box made `npm run map:build` produce an older map. `loadRaw()` now ignores it when its box differs, with a warning. After a rebuild, check the map and terrain files match what is committed before pushing.
