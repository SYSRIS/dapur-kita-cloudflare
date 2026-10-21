PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS menu_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Makanan',
  price INTEGER NOT NULL CHECK(price >= 0),
  image_url TEXT NOT NULL DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
  available INTEGER NOT NULL DEFAULT 1 CHECK(available IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  items_json TEXT NOT NULL,
  subtotal INTEGER NOT NULL CHECK(subtotal >= 0),
  total INTEGER NOT NULL CHECK(total >= 0),
  payment_method TEXT NOT NULL DEFAULT 'Bayar saat diterima',
  status TEXT NOT NULL DEFAULT 'Menunggu',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by TEXT NOT NULL DEFAULT 'system',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_history_order_id ON order_status_history(order_id);

INSERT INTO menu_items(name,description,category,price,image_url,stock,available)
SELECT 'Nasi Goreng Spesial','Nasi goreng, telur, ayam, dan kerupuk.','Makanan',25000,
'https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=900&q=80',30,1
WHERE NOT EXISTS(SELECT 1 FROM menu_items WHERE name='Nasi Goreng Spesial');

INSERT INTO menu_items(name,description,category,price,image_url,stock,available)
SELECT 'Mie Goreng Jawa','Mie goreng gurih dengan sayuran segar.','Makanan',22000,
'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=900&q=80',25,1
WHERE NOT EXISTS(SELECT 1 FROM menu_items WHERE name='Mie Goreng Jawa');

INSERT INTO menu_items(name,description,category,price,image_url,stock,available)
SELECT 'Es Teh Manis','Teh manis dingin yang menyegarkan.','Minuman',7000,
'https://images.unsplash.com/photo-1556679343-c7306c1976bc?auto=format&fit=crop&w=900&q=80',50,1
WHERE NOT EXISTS(SELECT 1 FROM menu_items WHERE name='Es Teh Manis');
