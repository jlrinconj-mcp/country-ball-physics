# Country Ball Physics Simulator

A deterministic 2D physics simulator where every ball is a country. Balls carry real flags, bounce, collide and get eliminated inside arenas and tracks. It's built to produce repeatable vertical (9:16) videos for YouTube Shorts, Instagram Reels and TikTok.

<p align="center">
  <img src="docs/screenshots/lcs-ring.png" width="240" alt="Last Country Standing, spinning ring">
  <img src="docs/screenshots/lcs-triple-ring.png" width="240" alt="Triple ring with 64 countries">
  <img src="docs/screenshots/lcs-ring-eyes.png" width="240" alt="Countryball eyes option">
  <img src="docs/screenshots/lcs-winner.png" width="240" alt="Winner screen">
</p>

> **Status:** Phase 1 (MVP) is done: Last Country Standing with real physics, flags, eliminations and automatic winners. Phase 2 (races, tracks, follow cameras) is next.

## Goal

Pick a mode, a set of countries and a seed, then press play. **The same configuration and the same seed always produce the same simulation**, whether it plays in a browser at 60 or 144 FPS, at 0.25× or 4× speed, or headless in Node. That makes every video reproducible, and later lets you batch-generate them.

## Features

- **Real country data:** 250 countries and territories (194 sovereign), with names, ISO codes, region, subregion and continent.
- **Real flags,** cover-fitted into circles without distortion, with shading and an outline.
- **Real physics (Matter.js):** gravity, ball–ball and ball–wall collisions, restitution, friction, air drag, a speed cap, rotation, and kinematic (moving) obstacles that push balls.
- **Last Country Standing,** with three scenarios: *Spinning Ring*, *Double Ring* and *Triple Ring*. Escape the outer ring and you're eliminated inside the engine; the last country left wins. Gaps slowly widen, so every run ends.
- **Seeds.** All randomness (participant sampling, order, spawn points, initial velocities, ring spin, random kicks) comes from one seeded generator.
- **Output formats:** 9:16 (1080×1920), plus 4:5, 1:1 and 16:9, with platform safe areas.
- **Minimal HUD** drawn on the canvas (so a screen capture includes it): headline, countries remaining, event line, timer, optional live ranking, and a winner screen.
- **Country selector:** search, presets (All, continents, Random 16/32/64), continent and region filters, manual picks, exclusions and territories.
- **Configurable:** mode, scenario, participants, gravity, bounciness, friction, drag, ball size, max speed, chaos, time limit, camera, labels, theme, HUD toggles and playback speed.
- **Determinism check:** each run shows a result fingerprint, and replaying a config reports whether the result was identical.
- **Headless rendering:** `npm run render:frames` writes PNG frames with no browser (the README screenshots were made this way).

## Tech stack

- [Next.js](https://nextjs.org) 16 (App Router) + React 19
- TypeScript (strict, `noUncheckedIndexedAccess`)
- Tailwind CSS 4
- [Matter.js](https://brm.io/matter-js/) 0.20 for 2D rigid-body physics
- Vitest for tests, ESLint
- [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) (dev only) for headless frames

## Getting started

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. A simulation starts automatically as soon as the country data loads.

Keyboard shortcuts: `Space` pause/resume · `R` restart · `N` new seed · `G` generate · `.` step one tick (while paused).

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, no emit |
| `npm test` | Unit and determinism tests (Vitest) |
| `npm run check` | Lint + typecheck + tests + build |
| `npm run probe -- ring 48 5` | Headless runs: duration, winner, CPU per tick |
| `npm run render:frames -- --seed=world-001 --times=0,5,end` | Render PNG frames to `output/frames` |

## Environment variables

Everything works without configuration. Copy `.env.example` to `.env.local` to override.

| Variable | Default | Purpose |
| --- | --- | --- |
| `RESTCOUNTRIES_API_KEY` | unset | Use REST Countries v5 (server-side only) |
| `COUNTRIES_DATASET_URL` | mledoze/countries on jsDelivr | Override the open dataset URL |

## Country data

I evaluated the options in September 2026:

- **REST Countries** shut down v1–v4 in 2026. v5 is stable but **requires an API key**: the free tier allows 1,000 requests a month, CORS is locked to each key's hostnames, and its terms cap caching at 3 days.
- **[mledoze/countries](https://github.com/mledoze/countries)** is the open dataset (ODbL-1.0) REST Countries was originally built from. It's served by jsDelivr's CDN with no key.

The app therefore uses **mledoze/countries by default** and switches to **REST Countries v5 when `RESTCOUNTRIES_API_KEY` is set** (falling back to the open dataset if v5 fails). Continents are derived from region and subregion when the provider doesn't supply them.

**Flags** come from [flagcdn.com](https://flagcdn.com), which sends `Access-Control-Allow-Origin: *`. Drawing them keeps the canvas exportable, which matters for video capture. REST Countries' own flag CDN doesn't send CORS headers.

The UI never talks to a provider directly:

```
UI ─▶ CountryService ─▶ /api/countries (Next route, 12 h in-memory cache)
        │                   └─▶ provider: open data | REST Countries v5
        └─ localStorage cache (24 h fresh; stale copy served if the API is down)
```

`CountryService` provides `getAllCountries()`, `getCountryByCode()` (alpha-2 or alpha-3), `getCountriesByRegion()`, `getCountriesByContinent()` and `searchCountries()`. It deduplicates concurrent loads, caches with a TTL, and serves the last good dataset when the upstream fails (respecting each provider's maximum stale age). The CLI uses the same service with a disk cache in `.cache/`.

## Project structure

```
src/
  app/                 Next.js app (page, layout, /api/countries route)
  countries/           CountryService, types, cache, providers, selection presets
  engine/              Framework-free simulation core
    random.ts          createRandom(seed): seeded PRNG with forked streams
    events.ts          Typed event bus
    physicsWorld.ts    Matter.js wrapper: fixed tick, sub-steps, kinematics, contacts
    simulation.ts      Simulation: entities, rules hooks, ranking, leader, results
    spawn.ts           Seeded, non-overlapping spawn placement
    camera.ts          Fixed / follow-leader / follow-action / follow-group camera
    simulationLoop.ts  requestAnimationFrame loop with accumulator + interpolation
  entities/            CountryBall, Obstacle, Zone (eliminators and goals)
  modes/               Game modes (Last Country Standing, …) and shared helpers
  render/              Canvas renderer, HUD, flag atlas, formats, themes
  runtime/             SimulationController: bridges engine ↔ canvas ↔ React
  components/          React UI (control panel, selector, live panel, viewport)
scripts/               Node tooling (probe, headless frame rendering)
```

The engine has no DOM or React dependency, so it runs identically in the browser, in tests and in Node scripts.

## Simulation architecture

- **Fixed timestep.** The simulation advances in ticks of 1/60 s, each split into 2 physics sub-steps. `Simulation.step()` has no notion of wall-clock time.
- **Accumulator loop.** In the browser, real elapsed time × playback speed fills an accumulator. Whole ticks are drained from it, and rendering interpolates between the last two ticks (`alpha`). Frame rate and speed decide *how many* ticks run per frame, never *what* happens in them.
- **Data-first worlds.** Modes describe a `WorldLayout`: obstacles, zones and spawn area as plain data (shapes, scripted motion). The engine builds Matter.js bodies from it. That keeps worlds serializable, which a future track editor and procedural generator need.
- **Kinematic obstacles.** Rotating rings and moving platforms are static bodies posed every sub-step from an absolute function of time (`poseAt(t)`), with velocity handed to the solver so they really push balls. No drift, identical on every replay.
- **Rules as hooks.** A mode provides `createLayout()` and rules (`beforeStep`, `afterStep`, `rank`, `progress`, `hud`, `onTimeout`). The engine handles eliminations, finishes, places, leader tracking (with hysteresis) and results.
- **Events.** `simulationStarted`, `countryEliminated`, `countryFinished`, `countryTakesLead`, `leaderChanged`, `raceFinished`, `winnerDeclared`, `simulationFinished`, and `impact` for audio. The HUD, UI and results subscribe; nothing listening can change the physics.
- **React stays out of the frame loop.** `SimulationController` owns the canvas and loop. React reads throttled snapshots through `useSyncExternalStore`, a few times a second at most.
- **Rendering.** Flags are pre-rendered once into circular sprites; each frame is one rotated `drawImage` per ball, with off-screen culling. Everything is drawn in the format's virtual resolution (e.g. 1080×1920) and scaled to the display.

Performance: 200 balls simulate in roughly 1–3 ms per tick on a laptop (see the `handles 200 balls` test and `npm run probe`).

## How seeds work

Every random decision goes through `createRandom(seed)` (cyrb128 hash → sfc32 generator). `Math.random()` is never used inside simulation logic. Each subsystem forks its own stream, so adding randomness in one place doesn't reshuffle the others:

| Stream | Controls |
| --- | --- |
| `participants` | Which countries take part when more are selected than the max |
| `order` | Country order, i.e. who gets which spawn point |
| `spawn` | Spawn positions |
| `velocity` | Initial velocities and spin |
| `layout` | Arena and track geometry (ring direction, speed, gap position…) |
| `forces` | Random "chaos" kicks during the run |

Countries are sorted by ISO code before seeding, so the order you picked them in doesn't matter. Matter.js's global body-id counter is reset for each world. Tests assert that the same config and seed produce an identical fingerprint and ranking.

## Roadmap

- [x] **Phase 1 (MVP):** GitHub repo, Next.js + TS, country API + cache, flags, CountryBall, Matter.js, 9:16 viewport, eliminations, counter, automatic winner, seeds
- [ ] **Phase 2:** Race mode, obstacles, ranking, follow cameras, seeded tracks, leader tracking
- [ ] **Phase 3:** Procedural track generator, track editor, Tournament, Marble Race, audio, advanced HUD
- [ ] **Phase 4, content factory:** `generateSimulation({ mode, countries, track, seed, format })`, batch runs (`npm run generate -- --count=50`), result metadata, thumbnails, titles and captions, video rendering

## License

[MIT](LICENSE). Country data © mledoze/countries contributors ([ODbL-1.0](https://opendatacommons.org/licenses/odbl/1-0/)); flags via flagcdn.com.
