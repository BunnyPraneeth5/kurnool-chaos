# Progress log

Newest entry on top. Each session ends with an entry: what got done, what is half done, what is next, any blockers or questions for Bunny.

## 2026-11-18: Task 1.3 OSM fetch
- Done: `scripts/osm/fetch.mjs` (Overpass download, retries on busy/network errors, per-part cache in `scripts/osm/.cache/` keyed by bbox), `report.mjs` (counts, landmarks, rivers, bridges), `preview-template.html` -> `preview.html` (gitignored). `npm run osm:fetch` / `npm run osm:report`. Snapshot `scripts/osm/raw.json.gz` (1.2 MB) committed.
- Bunny check: Bunny chose to stretch the box north (and a little west) so the NH44 Tungabhadra bridge is inside. New box S15.805 W78.003 N15.870 E78.065, 6.6 x 7.2 km.
- Results: 3201 drivable roads (638 km), 12006 buildings (251 per km2, sparse, parks and filler needed), 51 road bridges incl. the two NH44 Tungabhadra bridges (~635 m). 8 of 9 point landmarks found and inside the box. Handri river and KC Canal run through the city.
- overpass-api.de was at capacity. Used `OVERPASS_URL=https://overpass.private.coffee/api/interpreter`. The main query once took over 3 hours of queueing and retries. If it is slow again, Bunny can run `npm run osm:fetch` himself.
- Still open: Abdullah Khan Estate is not in OSM. Waiting for Bunny's pin (lat, lon); add it by hand in 2.1. Telugu spellings still unverified.
- Next: 2.1 map build script.

## 2026-11-11: Task 1.2 GitHub repo
- Done: public repo https://github.com/BunnyPraneeth5/kurnool-chaos created with `gh` and pushed. `main` tracks `origin/main`. Docs visible on GitHub.
- Commits use Bunny's GitHub noreply email (set in this repo's local git config only). The first 2 commits were rewritten before the first push to remove the personal email.
- Next: 1.3 OSM fetch.

## 2026-11-11: Task 1.1 Scaffold
- Done: Vite + TypeScript + Three.js scaffold with a spinning cube, dusk colours and the OSM credit. `npm run typecheck` and `npm run build` pass. Checked in the in-app browser at desktop and phone size. First git commit.
- Phone check: Bunny confirmed the cube spins on his phone over Wi-Fi (`http://<laptop Wi-Fi IP>:5173`, was 192.168.1.35 this session). 1.1 ticked.
- Next: 1.2 GitHub repo.
- Notes: build warns the JS bundle is over 500 kB. That is Three.js itself (132 kB gzipped). Fine for now, revisit in the performance pass.

## 2026-11-11: Plan review
- Done: critiqued the plan. Bunny approved the simplifications. Updated PRD, MAP-SPEC, ARCHITECTURE, TASKS (reordered: multiplayer moved to Phase 3, races to Phase 6) and DECISIONS.
- Half done: nothing. No code yet.
- Next: task 1.1 Scaffold.
- Blockers: none. Still open: Telugu spellings, map area at 1.3, race routes after the map, Supabase message limits at 3.1.

## 2026-11-11: Handoff
- Done: planning in Claude chat. All docs written: CLAUDE.md, PRD, ARCHITECTURE, MAP-SPEC, TASKS, DECISIONS. Reference demo saved in `reference/`.
- Half done: nothing.
- Next: task 1.1 Scaffold.
- Blockers: none. Bunny still needs to verify Telugu spellings and confirm the map area at task 1.3.
