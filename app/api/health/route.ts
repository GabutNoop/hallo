export const dynamic = 'force-dynamic'; export async function GET(){ return Response.json({ status:'ok', service:'hallo-news-platform', timestamp:new Date().toISOString() }); }
