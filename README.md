# Country Ball Physics Simulator

A deterministic 2D physics simulator where every ball is a country. Balls carry real flags, bounce, collide and get eliminated inside arenas and tracks. It's built to produce repeatable, vertical (9:16) videos for YouTube Shorts, Instagram Reels and TikTok.

> **Status:** Phase 1 (MVP) in progress.

## Goal

Pick a mode, a set of countries and a seed, then press play. The same configuration and the same seed always produce the same simulation, so every video can be reproduced and, later, batch-generated.

## Tech stack

- [Next.js](https://nextjs.org) 16 (App Router) + React 19
- TypeScript (strict)
- Tailwind CSS 4
- [Matter.js](https://brm.io/matter-js/) for 2D rigid-body physics
- ESLint

## Getting started

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript without emitting |
| `npm run check` | Lint + typecheck + build |

## Environment variables

Copy `.env.example` to `.env.local` if you need to override defaults.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_COUNTRIES_API_URL` | `https://restcountries.com/v3.1` | Countries API base URL |

## Roadmap

- **Phase 1 (MVP):** country data, flag balls, Matter.js arena, 9:16 viewport, elimination, winner detection, seeds
- **Phase 2:** Race mode, obstacles, ranking, camera, track modules, leader tracking
- **Phase 3:** procedural tracks, track editor, Tournament, Marble Race, audio, advanced HUD
- **Phase 4:** content factory, i.e. `generateSimulation({...})` and batch video generation

## License

[MIT](LICENSE)
