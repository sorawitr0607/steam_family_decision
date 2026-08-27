
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

async function storeMetadata(appid){
  const url=new URL("https://store.steampowered.com/api/appdetails");
  url.searchParams.set("appids",String(appid));
  url.searchParams.set("cc","us");
  url.searchParams.set("l","english");

  const res=await fetch(url.toString(),{
    headers:{"user-agent":"SteamFamilyComparePages/8.0"}
  });
  if(!res.ok)throw new Error(`Store metadata HTTP ${res.status}`);

  const data=await res.json();
  const entry=data?.[String(appid)];
  if(!entry?.success||!entry.data)throw new Error("Store metadata unavailable");

  const d=entry.data;
  return {
    type:d.type||"",
    is_free:Boolean(d.is_free),
    short_description:d.short_description||"",
    developers:Array.isArray(d.developers)?d.developers:[],
    publishers:Array.isArray(d.publishers)?d.publishers:[],
    platforms:d.platforms||{},
    metacritic:d.metacritic?.score??null,
    genres:Array.isArray(d.genres)?d.genres.map(x=>x.description).filter(Boolean):[],
    categories:Array.isArray(d.categories)?d.categories.map(x=>x.description).filter(Boolean):[],
    release_date:d.release_date?.date||"",
    coming_soon:Boolean(d.release_date?.coming_soon),
    price:d.price_overview?.final_formatted||"",
    header_image:d.header_image||""
  };
}

async function reviewSummary(appid){
  const url=new URL(`https://store.steampowered.com/appreviews/${appid}`);
  for(const [k,v] of Object.entries({
    json:"1",filter:"all",language:"all",day_range:"365",
    review_type:"all",purchase_type:"all",num_per_page:"3"
  }))url.searchParams.set(k,v);

  const res=await fetch(url.toString(),{
    headers:{"user-agent":"SteamFamilyComparePages/8.0"}
  });
  if(!res.ok)throw new Error(`Reviews HTTP ${res.status}`);

  const data=await res.json();
  const q=data?.query_summary||{};
  const total=Number(q.total_reviews)||0;
  const pos=Number(q.total_positive)||0;

  return {
    score_desc:q.review_score_desc||"",
    review_score:Number(q.review_score)||0,
    total_reviews:total,
    total_positive:pos,
    total_negative:Number(q.total_negative)||0,
    positive_percent:total?Math.round(pos/total*100):null,
    reviews:(Array.isArray(data?.reviews)?data.reviews:[]).slice(0,3).map(r=>({
      voted_up:Boolean(r.voted_up),
      votes_up:Number(r.votes_up)||0,
      language:r.language||"",
      review:String(r.review||"").slice(0,700),
      playtime_minutes:Number(r.author?.playtime_forever)||0,
      developer_response:String(r.developer_response||"").slice(0,500)
    }))
  };
}

async function currentPlayers(appid){
  try{
    const data=await steamGet("/ISteamUserStats/GetNumberOfCurrentPlayers/v1/",{appid});
    return Number(data?.response?.player_count)||0;
  }catch{
    return null;
  }
}

async function globalAchievementPercentages(appid){
  try{
    const data=await steamGet("/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v2/",{
      gameid:appid
    });
    const list=data?.achievementpercentages?.achievements;
    if(!Array.isArray(list))return {};
    return Object.fromEntries(list.map(x=>[x.name,Number(x.percent)||0]));
  }catch{
    return {};
  }
}

async function playerAchievements(apiKey,steamid,appid){
  try{
    const data=await steamGet("/ISteamUserStats/GetPlayerAchievements/v1/",{
      key:apiKey,steamid,appid,l:"english"
    });
    const ps=data?.playerstats;
    if(!ps?.success||!Array.isArray(ps.achievements))return null;

    return {
      total:ps.achievements.length,
      unlocked:ps.achievements.filter(a=>Number(a.achieved)===1).length,
      achievements:ps.achievements
    };
  }catch{
    return null;
  }
}

export async function onRequestGet(context){
  try{
    const url=new URL(context.request.url);
    const appid=Number(url.searchParams.get("appid"));
    const scope=url.searchParams.get("scope")||"meta";

    if(!Number.isFinite(appid)||appid<=0)return json({error:"Valid appid is required."},400);

    if(scope==="meta"){
      const results=await Promise.allSettled([
        storeMetadata(appid),
        reviewSummary(appid),
        currentPlayers(appid)
      ]);

      return json({
        appid,
        store:results[0].status==="fulfilled"?results[0].value:null,
        reviews:results[1].status==="fulfilled"?results[1].value:null,
        current_players:results[2].status==="fulfilled"?results[2].value:null,
        errors:[
          results[0].status==="rejected"?"store":null,
          results[1].status==="rejected"?"reviews":null,
          results[2].status==="rejected"?"players":null
        ].filter(Boolean)
      });
    }

    if(scope==="globalachievements"){
      return json({
        appid,
        global_achievement_percentages:await globalAchievementPercentages(appid)
      });
    }

    if(scope==="achievement"){
      const apiKey=context.env.STEAM_API_KEY;
      if(!apiKey)return json({error:"STEAM_API_KEY secret is not configured."},500);

      const steamid=String(url.searchParams.get("steamid")||"").trim();
      if(!/^\d{17}$/.test(steamid))return json({error:"Valid steamid is required."},400);

      const [player,global]=await Promise.all([
        playerAchievements(apiKey,steamid,appid),
        globalAchievementPercentages(appid)
      ]);

      return json({
        appid,
        steamid,
        player_achievement:player,
        global_achievement_percentages:global
      });
    }

    return json({error:"Unsupported scope."},400);

  }catch(err){
    return json({error:err instanceof Error?err.message:"Unexpected game-data error."},500);
  }
}
