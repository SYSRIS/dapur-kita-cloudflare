export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT id,name,description,category,price,image_url,stock,available FROM menu_items WHERE available=1 AND stock>0 ORDER BY category,name"
    ).all();
    return Response.json(results, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Database belum terhubung." }, { status: 500 });
  }
}
