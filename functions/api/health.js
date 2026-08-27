
function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store"
    }
  });
}

export async function onRequestGet(context){
  return json({
    ok:true,
    configured:Boolean(context.env.STEAM_API_KEY),
    mode:"cloudflare-pages-functions"
  });
}
