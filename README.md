# Dapur Kita — Website Restoran Indonesia
Stack: Cloudflare Pages + Pages Functions + D1 + (opsional) R2 + WhatsApp Cloud API.

## Fitur
- Website pelanggan responsif, menu, keranjang, checkout.
- Stok menu tersimpan di D1 dan dikurangi saat pesanan berhasil dibuat.
- Riwayat transaksi/pesanan, detail item, status, dan timeline perubahan status.
- Panel admin dengan login, CRUD menu, stok, status tersedia, foto menu, pengelolaan pesanan.
- Upload foto menu ke Cloudflare R2 (bukan menyimpan file gambar di database).
- Notifikasi WhatsApp melalui Meta WhatsApp Cloud API jika konfigurasi tersedia.
- Server menghitung harga dari database; harga dari browser tidak dipercaya.

## Struktur
```text
dapur-kita-cloudflare/
├── schema.sql
├── wrangler.toml.example
├── README.md
├── public/
│   ├── index.html
│   ├── admin.html
│   └── _routes.json
└── functions/
    └── api/
        ├── menu.js
        ├── orders.js
        └── admin/
            └── [[path]].js
```

## A. Siapkan database D1
1. Cloudflare Dashboard → Storage & databases → D1 SQL Database → Create database, nama misalnya `dapur-kita-db`.
2. Buka database → Console, jalankan seluruh isi `schema.sql`.
3. Pages project → Settings → Functions → D1 database bindings.
4. Tambahkan binding variable name **DB**, pilih database `dapur-kita-db`.

## B. Deploy ke Cloudflare Pages
1. Upload seluruh folder ini ke GitHub repository.
2. Cloudflare Dashboard → Workers & Pages → Create application → Pages → Connect to Git.
3. Build command kosong; Build output directory `public`.
4. Deploy.
5. Settings → Functions → D1 database bindings, pastikan binding `DB` sudah terpasang.
6. Tambahkan variables/secrets sesuai bagian keamanan di bawah, lalu redeploy.

## C. Rahasia admin wajib
Pages project → Settings → Variables and Secrets:
- `ADMIN_USERNAME` (Text): username admin, bukan `admin` kalau website publik.
- `ADMIN_PASSWORD` (Secret): password panjang dan unik.
- `SESSION_SECRET` (Secret): string acak minimal 32 karakter. Contoh buat lokal: `openssl rand -base64 48`.
Jangan memasukkan nilai rahasia ke HTML, GitHub, atau file yang bisa diunduh. Setelah mengubah secret, redeploy.

Sesi admin disimpan dalam cookie HttpOnly, Secure, SameSite=Strict dengan masa berlaku 8 jam. Login dilindungi jeda setelah beberapa kegagalan sederhana per IP; gunakan proteksi tambahan/rate limiting Cloudflare untuk produksi.

## D. Upload foto menu via R2
1. Cloudflare Dashboard → R2 Object Storage → Create bucket, misalnya `dapur-kita-images`.
2. Untuk Pages project → Settings → Functions → R2 bucket bindings, tambahkan binding **MENU_IMAGES** ke bucket itu.
3. Untuk menampilkan foto dari browser, buat custom domain untuk bucket R2, misalnya `images.domainkamu.com`, atau gunakan domain publik R2 jika sesuai kebijakanmu.
4. Set Pages variable `MENU_IMAGE_BASE_URL` ke base URL publik tersebut, tanpa slash di akhir. Contoh `https://images.domainkamu.com`.
5. Endpoint upload mengirim file ke bucket melalui binding R2 dan mengembalikan URL publik. Jika R2 tidak dipasang, admin tetap bisa memasukkan URL foto eksternal.
6. Batasi ukuran gambar 5 MB dan tipe JPEG/PNG/WebP. URL publik harus benar-benar mengarah ke domain bucket milikmu.

## E. Notifikasi WhatsApp (opsional)
Gunakan Meta WhatsApp Cloud API resmi.
Pages variables/secrets:
- `WHATSAPP_TOKEN` (Secret): access token WhatsApp Cloud API.
- `WHATSAPP_PHONE_NUMBER_ID` (Text): Phone Number ID dari Meta.
- `WHATSAPP_TO` (Text): nomor penerima notifikasi admin dalam format internasional digit saja, mis. `62812...`.
- `WHATSAPP_API_VERSION` (Text, opsional): versi Graph API yang aktif di aplikasi Meta, mis. `v23.0` (gunakan versi yang didukung akunmu).
Pesan dikirim ke nomor admin saat pesanan baru dibuat. Pastikan akun/nomor WhatsApp Business sudah dikonfigurasi dan penerima dapat menerima pesan sesuai aturan WhatsApp. Untuk pesan bisnis di luar jendela layanan 24 jam, kebijakan Meta mungkin mewajibkan template pesan yang disetujui. Implementasi ini menggunakan pesan teks biasa dan kegagalan pengiriman tidak membatalkan pesanan.
Jangan gunakan endpoint ini untuk spam atau mengirim pesan tanpa izin.

## F. Pengujian
- Buka `/` dan pastikan menu tampil.
- Buka `/admin.html`, login.
- Tambah menu dengan stok, lalu buat pesanan dari halaman pelanggan.
- Pastikan stok berkurang dan pesanan muncul di panel admin.
- Ubah status pesanan; timeline riwayat status harus bertambah.
- Uji upload foto setelah binding R2 dan URL publik disetel.
- Uji WhatsApp setelah semua variabel API dikonfigurasi.

## Catatan produksi
- Checkout ini mencatat pesanan, belum memproses pembayaran otomatis QRIS/kartu.
- Jangan menyimpan data kartu atau OTP.
- Rekomendasi: pasang custom domain, Cloudflare Turnstile/rate limiting, backup D1, kebijakan privasi, persetujuan penggunaan nomor pelanggan, serta monitoring.
- Ini starter yang dapat dijalankan, tetapi integrasi Meta/R2 memerlukan akun dan konfigurasi Cloudflare/Meta milikmu.
