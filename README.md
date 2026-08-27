# Steam Family Decision v8 — Cloudflare Pages

## Files

public/
  index.html

functions/
  api/
    compare.js
    game.js
    health.js

README.md

## Cloudflare Pages setup

Create a Pages project from this GitHub repo.

Recommended settings:
- Production branch: main
- Framework preset: None
- Build command: exit 0
- Build output directory: public

Then add this secret in the Pages project:
- STEAM_API_KEY = your Steam Web API key

Do not put the API key in index.html.

## Endpoints

- /api/health
- /api/compare
- /api/game?appid=APPID&scope=meta
- /api/game?appid=APPID&scope=achievement&steamid=STEAMID64
- /api/game?appid=APPID&scope=globalachievements

The frontend uses same-origin /api/... requests, so no config.js is needed.
