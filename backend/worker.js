const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function corsHeaders(origin, allowedOrigin) {
  const allow = !allowedOrigin || allowedOrigin === "*" ? "*" : allowedOrigin;
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "POST, OPTIONS, GET",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    "vary": "Origin"
  };
}

function responseJson(data, status, origin, allowedOrigin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(origin, allowedOrigin) }
  });
}

function isAllowedOrigin(origin, allowedOrigin) {
  if (!allowedOrigin || allowedOrigin === "*") return true;
  if (!origin) return true; // Allows direct health checks / non-browser clients.
  return origin === allowedOrigin;
}

async function steamGet(path, params) {
  const url = new URL(`https://api.steampowered.com${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { "user-agent": "SteamFamilyMultiCompare/4.0" }
  });

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new Error(`Steam API HTTP ${res.status}${body ? `: ${body}` : ""}`);
  }
  return res.json();
}

async function resolveSteamId(value, apiKey) {
  const input = String(value || "").trim();

  if (/^\d{17}$/.test(input)) return input;

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid Steam Community profile URL or SteamID64.");
  }

  const host = url.hostname.toLowerCase();
  if (host !== "steamcommunity.com" && host !== "www.steamcommunity.com") {
    throw new Error("Profile URL must use steamcommunity.com.");
  }

  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2) {
    throw new Error("Use a Steam /profiles/STEAMID or /id/NAME profile URL.");
  }

  const kind = parts[0].toLowerCase();
  const ident = parts[1];

  if (kind === "profiles" && /^\d{17}$/.test(ident)) return ident;

  if (kind === "id" && ident) {
    const data = await steamGet("/ISteamUser/ResolveVanityURL/v1/", {
      key: apiKey,
      vanityurl: ident,
      url_type: 1
    });
    const r = data?.response || {};
    if (r.success !== 1 || !r.steamid) {
      throw new Error(r.message || `Could not resolve Steam vanity URL: ${ident}`);
    }
    return String(r.steamid);
  }

  throw new Error("Unsupported Steam profile URL.");
}

async function getSummaries(ids, apiKey) {
  const data = await steamGet("/ISteamUser/GetPlayerSummaries/v2/", {
    key: apiKey,
    steamids: ids.join(",")
  });
  const players = data?.response?.players || [];
  return new Map(players.map(p => [String(p.steamid), p]));
}

async function getOwnedGames(steamid, apiKey, includeFree) {
  const data = await steamGet("/IPlayerService/GetOwnedGames/v1/", {
    key: apiKey,
    steamid,
    include_appinfo: "true",
    include_played_free_games: includeFree ? "true" : "false",
    format: "json"
  });

  const r = data?.response || {};
  const visible = Array.isArray(r.games) || typeof r.game_count === "number";
  if (!visible) return { visible: false, games: [] };

  const games = (r.games || [])
    .map(g => ({
      appid: Number(g.appid) || 0,
      name: String(g.name || `App ${g.appid || ""}`),
      playtime_minutes: Math.max(0, Number(g.playtime_forever) || 0)
    }))
    .filter(g => g.appid > 0);

  return { visible: true, games };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = String(env.ALLOWED_ORIGIN || "*").replace(/\/$/, "");

    if (request.method === "OPTIONS") {
      if (!isAllowedOrigin(origin, allowedOrigin)) {
        return responseJson({ error: "Origin not allowed." }, 403, origin, allowedOrigin);
      }
      return new Response(null, { status: 204, headers: corsHeaders(origin, allowedOrigin) });
    }

    if (!isAllowedOrigin(origin, allowedOrigin)) {
      return responseJson({ error: "Origin not allowed." }, 403, origin, allowedOrigin);
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return responseJson({ ok: true, configured: Boolean(env.STEAM_API_KEY) }, 200, origin, allowedOrigin);
    }

    if (request.method !== "POST" || url.pathname !== "/api/compare") {
      return responseJson({ error: "Not found." }, 404, origin, allowedOrigin);
    }

    if (!env.STEAM_API_KEY) {
      return responseJson({ error: "STEAM_API_KEY secret is not configured on the Worker." }, 500, origin, allowedOrigin);
    }

    try {
      const body = await request.json();
      const entries = Array.isArray(body?.profiles) ? body.profiles : [];
      const includeFree = Boolean(body?.include_free);

      if (entries.length < 2) {
        return responseJson({ error: "Add at least 2 Steam profiles." }, 400, origin, allowedOrigin);
      }
      if (entries.length > 8) {
        return responseJson({ error: "This version supports up to 8 profiles per comparison." }, 400, origin, allowedOrigin);
      }

      const clean = entries.map((p, i) => ({
        url: String(p?.url || "").trim().slice(0, 500),
        nickname: String(p?.nickname || "").trim().slice(0, 40),
        index: i
      }));

      if (clean.some(p => !p.url)) {
        return responseJson({ error: "Every profile needs a Steam profile URL." }, 400, origin, allowedOrigin);
      }

      const resolved = await Promise.all(clean.map(async p => ({
        ...p,
        steamid: await resolveSteamId(p.url, env.STEAM_API_KEY)
      })));

      const duplicate = resolved.find((p, i) =>
        resolved.findIndex(x => x.steamid === p.steamid) !== i
      );
      if (duplicate) {
        return responseJson({ error: "The same Steam account was added more than once." }, 400, origin, allowedOrigin);
      }

      const summaryMap = await getSummaries(resolved.map(p => p.steamid), env.STEAM_API_KEY);

      const libraries = await Promise.all(resolved.map(async p => {
        const library = await getOwnedGames(p.steamid, env.STEAM_API_KEY, includeFree);
        const summary = summaryMap.get(p.steamid) || {};
        return {
          steamid: p.steamid,
          profileurl: summary.profileurl || p.url,
          avatar: summary.avatarfull || summary.avatarmedium || "",
          steam_username: summary.personaname || p.steamid,
          display_name: p.nickname || summary.personaname || p.steamid,
          nickname_provided: Boolean(p.nickname),
          library_visible: library.visible,
          games: library.games
        };
      }));

      const hidden = libraries.filter(p => !p.library_visible);
      if (hidden.length) {
        const names = hidden.map(p => p.display_name).join(", ");
        return responseJson({
          error: `Could not read owned games for: ${names}. Their Steam Game details may be private.`
        }, 400, origin, allowedOrigin);
      }

      return responseJson({
        profiles: libraries,
        generated_at: new Date().toISOString()
      }, 200, origin, allowedOrigin);

    } catch (err) {
      return responseJson(
        { error: err instanceof Error ? err.message : "Unexpected comparison error." },
        500,
        origin,
        allowedOrigin
      );
    }
  }
};
