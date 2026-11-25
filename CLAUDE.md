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
- `net/` Supabase room join, presence, 10 Hz state broadcast, interpolation of remote players
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
- Never commit secrets. Only `VITE_` public keys go in `.env.local`, which is gitignored.
- Keep the "© OpenStreetMap contributors" credit visible in-game.
- Before saying a task is done: `npm run build` passes, `npm run typecheck` passes, and you ran the game and checked the task's acceptance criteria.
- Small commits, one per task. Branch per bigger feature.
- At session end: update `PROGRESS.md`, tick `TASKS.md`, log choices in `DECISIONS.md`.
- Ask Bunny when stuck or when a decision is not covered by the docs. Do not guess on scope.

## Current focus
Two parallel tracks, each in its own session and branch (see PROGRESS.md 2026-11-25):
- Kurnool accuracy: Phase K, starting at K.1
- Multiplayer: Phase 3, starting at 3.1
Never merge into `main` from a track session; the coordinator session merges.

## Gotchas
(add repeated mistakes here as rules)
