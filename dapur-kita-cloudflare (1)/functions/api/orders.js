const MAX_ITEMS = 30;
const paymentMethods = new Set(["Bayar saat diterima", "Transfer bank (konfirmasi manual)", "QRIS (konfirmasi manual)"]);

async function sendWhatsApp(env, order) {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !env.WHATSAPP_TO) return;
  const version = env.WHATSAPP_API_VERSION || "v23.0";
  const itemLines = order.items.map(i => `- ${i.name} x${i.quantity}: Rp${i.line_total.toLocaleString("id-ID")}`).join("\n");
  const message = `Pesanan baru Dapur Kita #${order.id}\nPelanggan: ${order.customer_name}\nTelepon: ${order.phone}\nAlamat: ${order.address || "-"}\n${itemLines}\nTotal: Rp${order.total.toLocaleString("id-ID")}\nPembayaran: ${order.payment_method}`;
  try {
    await fetch(`https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: String(env.WHATSAPP_TO).replace(/\D/g, ""),
        type: "text",
        text: { preview_url: false, body: message.slice(0, 4000) }
      })
    });
  } catch {
    // Notifikasi gagal tidak boleh membatalkan pesanan yang sudah tersimpan.
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const customer_name = String(body.customer_name || "").trim().slice(0, 120);
    const phone = String(body.phone || "").trim().slice(0, 40);
    const address = String(body.address || "").trim().slice(0, 1000);
    const notes = String(body.notes || "").trim().slice(0, 1000);
    const payment_method = String(body.payment_method || "Bayar saat diterima");
    if (!customer_name || !phone || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_ITEMS)
      return Response.json({ error: "Nama, nomor telepon, dan item pesanan wajib diisi." }, { status: 400 });
    if (!paymentMethods.has(payment_method)) return Response.json({ error: "Metode pembayaran tidak valid." }, { status: 400 });

    const quantities = new Map();
    for (const item of body.items) {
      const id = Number(item.id), quantity = Math.floor(Number(item.quantity));
      if (!Number.isSafeInteger(id) || id < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 30)
        return Response.json({ error: "Item pesanan tidak valid." }, { status: 400 });
      quantities.set(id, (quantities.get(id) || 0) + quantity);
    }
    if (quantities.size > MAX_ITEMS) return Response.json({ error: "Terlalu banyak jenis menu." }, { status: 400 });

    const ids = [...quantities.keys()];
    const placeholders = ids.map(() => "?").join(",");
    const { results: menuRows } = await env.DB.prepare(
      `SELECT id,name,price,stock,available FROM menu_items WHERE id IN (${placeholders})`
    ).bind(...ids).all();
    const byId = new Map(menuRows.map(row => [row.id, row]));
    let total = 0;
    const cleanItems = [];
    for (const [id, quantity] of quantities) {
      const m = byId.get(id);
      if (!m || !m.available) return Response.json({ error: "Ada menu yang tidak tersedia. Muat ulang halaman." }, { status: 409 });
      if (m.stock < quantity) return Response.json({ error: `Stok ${m.name} tidak cukup. Sisa stok: ${m.stock}.` }, { status: 409 });
      const line_total = Number(m.price) * quantity;
      total += line_total;
      cleanItems.push({ id, name: m.name, price: Number(m.price), quantity, line_total });
    }
    if (!Number.isSafeInteger(total) || total > 100000000) return Response.json({ error: "Total pesanan tidak valid." }, { status: 400 });

    // D1 batch menjalankan statements dalam satu transaksi. Stok juga memakai syarat stock>=quantity.
    const statements = [];
    for (const item of cleanItems) {
      statements.push(env.DB.prepare(
        "UPDATE menu_items SET stock=stock-?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND stock>=? AND available=1"
      ).bind(item.quantity, item.id, item.quantity));
    }
    // Cek perubahan stok setelah batch; jika ada konflik, batalkan checkout sebelum menyimpan order.
    const stockResults = await env.DB.batch(statements);
    if (stockResults.some(r => (r.meta?.changes ?? 0) !== 1)) {
      // Kembalikan hanya stok yang benar-benar berkurang; jangan menambah stok untuk update yang gagal.
      const rollback = cleanItems.filter((item, i) => (stockResults[i]?.meta?.changes ?? 0) === 1).map(item =>
        env.DB.prepare("UPDATE menu_items SET stock=stock+?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(item.quantity, item.id)
      );
      if (rollback.length) await env.DB.batch(rollback);
      return Response.json({ error: "Stok berubah saat checkout. Muat ulang menu lalu coba lagi." }, { status: 409 });
    }

    let inserted;
    try {
      inserted = await env.DB.prepare(
        "INSERT INTO orders(customer_name,phone,address,notes,items_json,subtotal,total,payment_method,status) VALUES(?,?,?,?,?,?,?,?,'Menunggu')"
      ).bind(customer_name, phone, address, notes, JSON.stringify(cleanItems), total, total, payment_method).run();
      await env.DB.prepare(
        "INSERT INTO order_status_history(order_id,old_status,new_status,changed_by,note) VALUES(?,NULL,'Menunggu','system','Pesanan dibuat')"
      ).bind(inserted.meta.last_row_id).run();
    } catch (e) {
      await env.DB.batch(cleanItems.map(item => env.DB.prepare(
        "UPDATE menu_items SET stock=stock+?, updated_at=CURRENT_TIMESTAMP WHERE id=?"
      ).bind(item.quantity, item.id)));
      throw e;
    }

    const order = { id: inserted.meta.last_row_id, customer_name, phone, address, items: cleanItems, total, payment_method };
    await sendWhatsApp(env, order);
    return Response.json({ id: order.id, total }, { status: 201 });
  } catch (e) {
    return Response.json({ error: "Pesanan gagal disimpan. Periksa konfigurasi database lalu coba lagi." }, { status: 500 });
  }
}
