
function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}

async function steamGet(path,params){
  const url=new URL(`https://api.steampowered.com${path}`);
  for(const [k,v] of Object.entries(params||{})){
    if(v!==undefined&&v!==null)url.searchParams.set(k,String(v));
  }
  const res=await fetch(url.toString(),{
    headers:{"user-agent":"SteamFamilyComparePages/8.0"}
  });
  if(!res.ok){
    const body=(await res.text()).slice(0,300);
    throw new Error(`Steam API HTTP ${res.status}${body?`: ${body}`:""}`);
  }
  return res.json();
}

async function resolveSteamId(value,apiKey){
  const input=String(value||"").trim();
  if(/^\d{17}$/.test(input))return input;

  let url;
  try{url=new URL(input)}catch{throw new Error("Enter a valid Steam profile URL or SteamID64.")}

  const host=url.hostname.toLowerCase();
  if(host!=="steamcommunity.com"&&host!=="www.steamcommunity.com"){
    throw new Error("Profile URL must use steamcommunity.com.");
  }

  const parts=url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if(parts.length<2)throw new Error("Use a Steam /profiles/STEAMID or /id/NAME URL.");

  const kind=parts[0].toLowerCase();
  const ident=parts[1];

  if(kind==="profiles"&&/^\d{17}$/.test(ident))return ident;

  if(kind==="id"&&ident){
    const data=await steamGet("/ISteamUser/ResolveVanityURL/v1/",{
      key:apiKey,vanityurl:ident,url_type:1
    });
    const r=data?.response||{};
    if(r.success!==1||!r.steamid)throw new Error(r.message||`Could not resolve ${ident}`);
    return String(r.steamid);
  }

  throw new Error("Unsupported Steam profile URL.");
}

async function getSummaries(ids,apiKey){
  const data=await steamGet("/ISteamUser/GetPlayerSummaries/v2/",{
    key:apiKey,steamids:ids.join(",")
  });
  return new Map((data?.response?.players||[]).map(p=>[String(p.steamid),p]));
}

async function getOwnedGames(steamid,apiKey,includeFree){
  const data=await steamGet("/IPlayerService/GetOwnedGames/v1/",{
    key:apiKey,
    steamid,
    include_appinfo:"true",
    include_played_free_games:includeFree?"true":"false",
    format:"json"
  });

  const r=data?.response||{};
  const visible=Array.isArray(r.games)||typeof r.game_count==="number";
  if(!visible)return {visible:false,games:[]};

  return {
    visible:true,
    games:(r.games||[]).map(g=>({
      appid:Number(g.appid)||0,
      name:String(g.name||`App ${g.appid||""}`),
      playtime_minutes:Math.max(0,Number(g.playtime_forever)||0)
    })).filter(g=>g.appid>0)
  };
}

export async function onRequestPost(context){
  try{
    const apiKey=context.env.STEAM_API_KEY;
    if(!apiKey)return json({error:"STEAM_API_KEY secret is not configured."},500);

    const body=await context.request.json();
    const entries=Array.isArray(body?.profiles)?body.profiles:[];
    const includeFree=Boolean(body?.include_free);

    if(entries.length<2)return json({error:"Add at least 2 Steam profiles."},400);
    if(entries.length>8)return json({error:"Maximum 8 profiles."},400);

    const clean=entries.map((p,i)=>({
      url:String(p?.url||"").trim().slice(0,500),
      nickname:String(p?.nickname||"").trim().slice(0,40),
      index:i
    }));

    if(clean.some(p=>!p.url))return json({error:"Every profile needs a Steam profile URL."},400);

    const resolved=await Promise.all(clean.map(async p=>({
      ...p,
      steamid:await resolveSteamId(p.url,apiKey)
    })));

    const duplicate=resolved.find((p,i)=>resolved.findIndex(x=>x.steamid===p.steamid)!==i);
    if(duplicate)return json({error:"The same Steam account was added more than once."},400);

    const summaries=await getSummaries(resolved.map(p=>p.steamid),apiKey);

    const profiles=[];
    for(const p of resolved){
      const summary=summaries.get(p.steamid)||{};
      const library=await getOwnedGames(p.steamid,apiKey,includeFree);

      if(!library.visible){
        return json({
          error:`Could not read owned games for ${p.nickname||summary.personaname||p.steamid}. Their Game details may be private.`
        },400);
      }

      profiles.push({
        steamid:p.steamid,
        profileurl:summary.profileurl||p.url,
        avatar:summary.avatarfull||summary.avatarmedium||"",
        steam_username:summary.personaname||p.steamid,
        display_name:p.nickname||summary.personaname||p.steamid,
        nickname_provided:Boolean(p.nickname),
        games:library.games
      });
    }

    return json({profiles,generated_at:new Date().toISOString()});
  }catch(err){
    return json({error:err instanceof Error?err.message:"Unexpected comparison error."},500);
  }
}
