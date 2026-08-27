# Steam Family Multi Compare v4

This version removes CSV as the primary workflow.

## What changed

- Paste Steam profile URLs directly in the public web page.
- Compare 2 to 8 people at once.
- Each profile has an optional nickname.
- If nickname is blank, the Steam profile username is used automatically.
- Multi-person metrics:
  - combined unique games
  - owned by everyone
  - owned by exactly one person
  - new/missing games for each person
- Filter the Games page by:
  - all games
  - shortlist
  - owned by 1
  - shared by some
  - owned by everyone
  - games missing for a particular person
- Sort by title, owner count, and total playtime.
- Star any game and export only the shortlist to PNG.

## Why there are two parts

GitHub Pages is static hosting. Do NOT put your Steam Web API key in `index.html`,
`config.js`, a GitHub Actions build variable that gets injected into browser JS,
or any other public frontend file.

The safe setup is:

- GitHub Pages = frontend
- Cloudflare Worker = tiny API backend
- `STEAM_API_KEY` = encrypted Worker secret

## Part 1 — Deploy the Cloudflare Worker

### Easiest: Cloudflare dashboard

1. Sign in to Cloudflare.
2. Go to **Workers & Pages**.
3. Create a Worker.
4. Replace the default Worker code with `backend/worker.js`.
5. Deploy it.
6. Open the Worker → **Settings** → **Variables and Secrets**.
7. Add:
   - `STEAM_API_KEY` → Type: **Secret** → your Steam Web API key
   - `ALLOWED_ORIGIN` → normal text variable → your GitHub Pages origin

Examples for `ALLOWED_ORIGIN`:
- User site: `https://YOURNAME.github.io`
- Custom domain: `https://example.com`

Do not include the final `/`.

8. Deploy the settings change.
9. Copy the Worker URL, for example:
   `https://steam-family-compare-api.YOURNAME.workers.dev`

### Wrangler alternative

Inside the `backend` folder:

```bash
npm install -g wrangler
wrangler login
wrangler secret put STEAM_API_KEY
wrangler deploy
```

Before deploying, edit `wrangler.jsonc` and set `ALLOWED_ORIGIN` to your real
GitHub Pages origin.

For local Worker development, copy `.dev.vars.example` to `.dev.vars` and put
your API key there. `.dev.vars` is gitignored.

## Part 2 — Connect GitHub Pages to the Worker

Edit `config.js`:

```js
window.APP_CONFIG = {
  API_BASE_URL: "https://YOUR-WORKER.YOURNAME.workers.dev"
};
```

Then commit these files to the root of your GitHub Pages repository:

- `index.html`
- `config.js`
- `.nojekyll`

Your current Pages setting can remain:

- Source: Deploy from a branch
- Branch: main
- Folder: /(root)

GitHub will redeploy after the commit.

## Steam privacy

Steam's GetOwnedGames endpoint only returns owned games when that account's
owned games / Game details are visible to the API.

## Limits

This version intentionally caps a comparison at 8 profiles to keep requests
fast and reduce accidental API abuse. You can change the limit in both
`index.html` and `backend/worker.js` if needed.

## Security note

CORS restricts normal browser calls to your configured GitHub Pages origin, but
a public Worker endpoint can still be called directly by a determined client.
The Worker exposes only the fixed comparison operation and never returns your
Steam API key. For a heavily shared/public site, add Cloudflare rate limiting
or authentication.
