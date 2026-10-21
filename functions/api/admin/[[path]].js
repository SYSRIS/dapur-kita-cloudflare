const COOKIE = "dapur_admin";
const enc = new TextEncoder();
const allowedStatuses = ["Menunggu", "Diproses", "Siap diambil", "Dalam pengantaran", "Selesai", "Dibatalkan"];
const loginAttempts = new Map();

function base64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromBase64url(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(s + "=".repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));
}
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function isAdmin(request, env) {
  const raw = (request.headers.get("Cookie") || "").split(";").map(v => v.trim()).find(v => v.startsWith(COOKIE + "="));
  if (!raw || !env.SESSION_SECRET) return false;
  const parts = raw.slice(COOKIE.length + 1).split(".");
  if (parts.length !== 2) return false;
  const [payload, signature] = parts;
  try {
    if (!safeEqual(signature, await hmac(payload, env.SESSION_SECRET))) return false;
    const data = JSON.parse(new TextDecoder().decode(fromBase64url(payload)));
    return data.exp > Date.now() && data.u === env.ADMIN_USERNAME;
  } catch { return false; }
}
function json(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
function setCookie(value, maxAge) {
  return `${COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}`;
}
function clientKey(request) {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}
function checkSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}
async function notifyWhatsApp(env, message) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_TO) return;
  try {
    const version = env.WHATSAPP_API_VERSION || "v23.0";
    await fetch(`https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: String(env.WHATSAPP_TO).replace(/\D/g, ""), type: "text", text: { body: message.slice(0, 4000) } })
    });
  } catch {}
}
export async function onRequest({ request, env, params }) {
  const path = (params.path || []).join("/");
  const method = request.method;

  if (path === "login" && method === "POST") {
    if (!checkSameOrigin(request)) return json({ error: "Origin tidak valid." }, 403);
    if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD || !env.SESSION_SECRET) return json({ error: "Secret admin belum disetel di Cloudflare." }, 500);
    const key = clientKey(request), now = Date.now(), record = loginAttempts.get(key) || { count: 0, until: 0 };
    if (record.until > now) return json({ error: "Terlalu banyak percobaan login. Coba lagi beberapa menit." }, 429);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Data login tidak valid." }, 400); }
    if (body.username !== env.ADMIN_USERNAME || body.password !== env.ADMIN_PASSWORD) {
      record.count += 1;
      if (record.count >= 5) { record.until = now + 5 * 60 * 1000; record.count = 0; }
      loginAttempts.set(key, record);
      return json({ error: "Username atau password salah." }, 401);
    }
    loginAttempts.delete(key);
    const payload = base64url(enc.encode(JSON.stringify({ u: env.ADMIN_USERNAME, exp: now + 8 * 60 * 60 * 1000, nonce: crypto.randomUUID() })));
    const token = payload + "." + await hmac(payload, env.SESSION_SECRET);
    return json({ ok: true }, 200, { "Set-Cookie": setCookie(token, 8 * 60 * 60) });
  }
  if (path === "logout" && method === "POST") {
    if (!checkSameOrigin(request)) return json({ error: "Origin tidak valid." }, 403);
    return json({ ok: true }, 200, { "Set-Cookie": setCookie("", 0) });
  }
  if (path === "me" && method === "GET") return await isAdmin(request, env) ? json({ ok: true }) : json({ error: "Belum login." }, 401);
  if (!await isAdmin(request, env)) return json({ error: "Sesi admin tidak valid. Silakan login kembali." }, 401);
  if (!checkSameOrigin(request)) return json({ error: "Origin tidak valid." }, 403);
  if (!env.DB) return json({ error: "Database D1 belum terhubung." }, 500);

  if (path === "menu" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM menu_items ORDER BY id DESC").all();
    return json(results);
  }
  if (path === "menu" && method === "POST") {
    const b = await request.json();
    const name = String(b.name || "").trim(), price = Math.floor(Number(b.price)), stock = Math.floor(Number(b.stock));
    if (!name || !Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(stock) || stock < 0) return json({ error: "Nama, harga, dan stok wajib valid." }, 400);
    const r = await env.DB.prepare("INSERT INTO menu_items(name,description,category,price,image_url,stock,available) VALUES(?,?,?,?,?,?,?)")
      .bind(name.slice(0,120), String(b.description || "").slice(0,500), String(b.category || "Makanan").slice(0,50), price, String(b.image_url || "").slice(0,1000), stock, b.available ? 1 : 0).run();
    return json({ id: r.meta.last_row_id, ok: true }, 201);
  }
  let m = path.match(/^menu\/(\d+)$/);
  if (m && method === "PUT") {
    const b = await request.json(), id = Number(m[1]);
    const name = String(b.name || "").trim(), price = Math.floor(Number(b.price)), stock = Math.floor(Number(b.stock));
    if (!name || !Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(stock) || stock < 0) return json({ error: "Nama, harga, dan stok wajib valid." }, 400);
    await env.DB.prepare("UPDATE menu_items SET name=?,description=?,category=?,price=?,image_url=?,stock=?,available=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .bind(name.slice(0,120), String(b.description || "").slice(0,500), String(b.category || "Makanan").slice(0,50), price, String(b.image_url || "").slice(0,1000), stock, b.available ? 1 : 0, id).run();
    return json({ ok: true });
  }
  if (m && method === "DELETE") {
    const id = Number(m[1]);
    const used = await env.DB.prepare("SELECT id FROM orders WHERE items_json LIKE ? LIMIT 1").bind(`%"id":${id},%`).first();
    if (used) return json({ error: "Menu pernah dipesan; ubah status menjadi tidak tersedia agar riwayat tetap utuh." }, 409);
    await env.DB.prepare("DELETE FROM menu_items WHERE id=?").bind(id).run();
    return json({ ok: true });
  }
  if (path === "orders" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM orders ORDER BY id DESC LIMIT 500").all();
    return json(results);
  }
  m = path.match(/^orders\/(\d+)$/);
  if (m && method === "GET") {
    const order = await env.DB.prepare("SELECT * FROM orders WHERE id=?").bind(Number(m[1])).first();
    if (!order) return json({ error: "Pesanan tidak ditemukan." }, 404);
    const { results: history } = await env.DB.prepare("SELECT * FROM order_status_history WHERE order_id=? ORDER BY id DESC").bind(Number(m[1])).all();
    return json({ order, history });
  }
  if (m && method === "PATCH") {
    const id = Number(m[1]), b = await request.json();
    if (!allowedStatuses.includes(b.status)) return json({ error: "Status tidak valid." }, 400);
    const old = await env.DB.prepare("SELECT status FROM orders WHERE id=?").bind(id).first();
    if (!old) return json({ error: "Pesanan tidak ditemukan." }, 404);
    if (old.status !== b.status) {
      await env.DB.batch([
        env.DB.prepare("UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(b.status, id),
        env.DB.prepare("INSERT INTO order_status_history(order_id,old_status,new_status,changed_by,note) VALUES(?,?,?,?,?)").bind(id, old.status, b.status, env.ADMIN_USERNAME || "admin", String(b.note || "").slice(0,300))
      ]);
      await notifyWhatsApp(env, `Update pesanan Dapur Kita #${id}\nStatus: ${old.status} → ${b.status}`);
    }
    return json({ ok: true });
  }
  if (path === "upload" && method === "POST") {
    if (!env.MENU_IMAGES || !env.MENU_IMAGE_BASE_URL) return json({ error: "R2 MENU_IMAGES dan MENU_IMAGE_BASE_URL belum dikonfigurasi." }, 503);
    const form = await request.formData(), file = form.get("file");
    if (!file || typeof file === "string" || !file.size) return json({ error: "Pilih file gambar terlebih dahulu." }, 400);
    if (file.size > 5 * 1024 * 1024) return json({ error: "Ukuran gambar maksimal 5 MB." }, 413);
    const types = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    const ext = types[file.type];
    if (!ext) return json({ error: "Format yang didukung: JPEG, PNG, WebP." }, 415);
    const key = `menu/${crypto.randomUUID()}.${ext}`;
    await env.MENU_IMAGES.put(key, file.stream(), { httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" } });
    const base = String(env.MENU_IMAGE_BASE_URL).replace(/\/+$/, "");
    return json({ url: `${base}/${key}` }, 201);
  }
  return json({ error: "Endpoint tidak ditemukan." }, 404);
}
