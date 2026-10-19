import type { Database } from 'sql.js'

export const DATASET_VERSION = 'retail-synthetic-v1'
export type DatasetId = 'small' | 'retail'

export interface ColumnInfo {
  name: string
  type: string
  description: string
}
export interface TableInfo {
  name: string
  description: string
  columns: ColumnInfo[]
}

export const tables: TableInfo[] = [
  { name: 'categories', description: 'Kategori produk. Satu kategori memiliki banyak produk.', columns: [
    { name: 'category_id', type: 'INTEGER PRIMARY KEY', description: 'Identitas unik kategori.' },
    { name: 'name', type: 'TEXT NOT NULL', description: 'Nama kategori produk.' },
  ] },
  { name: 'customers', description: 'Satu baris per pelanggan terdaftar; sebagian belum bertransaksi.', columns: [
    { name: 'customer_id', type: 'INTEGER PRIMARY KEY', description: 'Identitas unik pelanggan.' },
    { name: 'name', type: 'TEXT NOT NULL', description: 'Nama sintetis pelanggan.' },
    { name: 'city', type: 'TEXT', description: 'Kota pelanggan; NULL berarti belum diketahui.' },
    { name: 'email', type: 'TEXT', description: 'Email sintetis; dapat kosong atau berulang untuk latihan kualitas data.' },
    { name: 'joined_at', type: 'TEXT NOT NULL', description: 'Tanggal pendaftaran dengan format YYYY-MM-DD.' },
    { name: 'referrer_id', type: 'INTEGER REFERENCES customers', description: 'Pelanggan pemberi referensi; NULL berarti tidak ada.' },
  ] },
  { name: 'products', description: 'Katalog produk. Harga katalog bukan pengganti harga saat transaksi.', columns: [
    { name: 'product_id', type: 'INTEGER PRIMARY KEY', description: 'Identitas unik produk.' },
    { name: 'name', type: 'TEXT NOT NULL', description: 'Nama produk.' },
    { name: 'category_id', type: 'INTEGER REFERENCES categories', description: 'Kategori produk.' },
    { name: 'price', type: 'INTEGER NOT NULL', description: 'Harga katalog dalam rupiah, tanpa angka desimal.' },
  ] },
  { name: 'orders', description: 'Satu baris per pesanan, bukan per produk. KPI penjualan hanya memakai status completed.', columns: [
    { name: 'order_id', type: 'INTEGER PRIMARY KEY', description: 'Identitas unik pesanan.' },
    { name: 'customer_id', type: 'INTEGER REFERENCES customers', description: 'Pelanggan pemesan.' },
    { name: 'order_date', type: 'TEXT NOT NULL', description: 'Tanggal pesanan dengan format YYYY-MM-DD.' },
    { name: 'status', type: 'TEXT NOT NULL', description: 'completed, cancelled, atau pending.' },
  ] },
  { name: 'order_details', description: 'Satu baris per produk dalam pesanan. Penjualan bersih = quantity × unit_price − discount; diskon adalah total rupiah per baris.', columns: [
    { name: 'detail_id', type: 'INTEGER PRIMARY KEY', description: 'Identitas unik baris transaksi.' },
    { name: 'order_id', type: 'INTEGER REFERENCES orders', description: 'Pesanan induk.' },
    { name: 'product_id', type: 'INTEGER REFERENCES products', description: 'Produk yang dibeli.' },
    { name: 'quantity', type: 'INTEGER NOT NULL', description: 'Jumlah unit positif.' },
    { name: 'unit_price', type: 'INTEGER NOT NULL', description: 'Harga per unit saat transaksi, dalam rupiah.' },
    { name: 'discount', type: 'INTEGER NOT NULL', description: 'Potongan total untuk baris ini, bukan per unit dan bukan persen.' },
  ] },
]

export const datasetNotes = [
  'Semua data adalah data sintetis untuk pembelajaran, bukan data perusahaan atau orang nyata.',
  'Periode retail: Januari–Desember 2025. Dataset kecil: enam pesanan pada Januari–Maret 2025.',
  'Satu pesanan dapat memiliki beberapa detail: hitung transaksi dengan COUNT(DISTINCT order_id) setelah JOIN.',
  'Penjualan bersih mengecualikan pending dan cancelled. Dataset tidak memodelkan pajak, ongkir, retur, atau biaya; penjualan bukan laba.',
  'Masalah kualitas yang disengaja: kota/email NULL, dua pelanggan memakai email sama, dan pelanggan tanpa pesanan. Primary key dan foreign key tetap valid.',
  'Tanggal disimpan sebagai teks ISO. SQLite memakai strftime untuk pengelompokan bulan; bukan DATE_TRUNC.',
]

const schema = `
PRAGMA foreign_keys = ON;
CREATE TABLE categories (
 category_id INTEGER PRIMARY KEY,
 name TEXT NOT NULL
);
CREATE TABLE customers (
 customer_id INTEGER PRIMARY KEY,
 name TEXT NOT NULL,
 city TEXT,
 email TEXT,
 joined_at TEXT NOT NULL,
 referrer_id INTEGER REFERENCES customers(customer_id)
);
CREATE TABLE products (
 product_id INTEGER PRIMARY KEY,
 name TEXT NOT NULL,
 category_id INTEGER NOT NULL REFERENCES categories(category_id),
 price INTEGER NOT NULL CHECK(price >= 0)
);
CREATE TABLE orders (
 order_id INTEGER PRIMARY KEY,
 customer_id INTEGER NOT NULL REFERENCES customers(customer_id),
 order_date TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('completed', 'cancelled', 'pending'))
);
CREATE TABLE order_details (
 detail_id INTEGER PRIMARY KEY,
 order_id INTEGER NOT NULL REFERENCES orders(order_id),
 product_id INTEGER NOT NULL REFERENCES products(product_id),
 quantity INTEGER NOT NULL CHECK(quantity > 0),
 unit_price INTEGER NOT NULL CHECK(unit_price >= 0),
 discount INTEGER NOT NULL DEFAULT 0 CHECK(discount >= 0 AND discount <= quantity * unit_price),
 UNIQUE(order_id, product_id)
);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_date ON orders(order_date);
CREATE INDEX idx_details_order ON order_details(order_id);
`

const productRows: [number, string, number, number][] = [
  [1, 'Kopi Arabika 250g', 1, 65000],
  [2, 'Teh Melati 100g', 1, 28000],
  [3, 'Granola 300g', 1, 48000],
  [4, 'Tumbler 500ml', 2, 120000],
  [5, 'Kotak Makan', 2, 85000],
  [6, 'Lampu Meja', 2, 175000],
  [7, 'Buku Catatan', 3, 35000],
  [8, 'Pena Gel', 3, 12000],
  [9, 'Tas Kanvas', 3, 95000],
  [10, 'Kabel USB', 4, 45000],
  [11, 'Mouse Wireless', 4, 150000],
  [12, 'Keyboard Compact', 4, 325000],
]

function insertRows(db: Database, table: string, rows: (string | number | null)[][]) {
  if (!rows.length) return
  const statement = db.prepare(`INSERT INTO ${table} VALUES (${rows[0].map(() => '?').join(',')})`)
  try {
    for (const row of rows) statement.run(row)
  } finally {
    statement.free()
  }
}

/** Internal trusted seeding only. Never pass learner SQL to this function. */
export function seedDatabase(db: Database, dataset: DatasetId, variant = 0): void {
  db.run(schema)
  db.run('BEGIN TRANSACTION')
  try {
    insertRows(db, 'categories', [[1, 'Makanan & Minuman'], [2, 'Rumah Tangga'], [3, 'Lifestyle'], [4, 'Elektronik']])
    const products = productRows.map(([id, name, category, price]) => [id, name, category, price + variant * id * 1000])
    insertRows(db, 'products', products)
    if (dataset === 'small') {
      insertRows(db, 'customers', [
        [1, 'Ayu', 'Jakarta', 'ayu@example.test', '2024-12-01', null],
        [2, 'Bima', 'Bandung', 'bima@example.test', '2024-12-03', 1],
        [3, 'Citra', 'Surabaya', null, '2024-12-05', 1],
        [4, 'Dedi', 'Jakarta', 'dedi@example.test', '2024-12-06', 2],
        [5, 'Eka', null, 'ayu@example.test', '2024-12-07', null],
        [6, 'Farah', 'Yogyakarta', 'farah@example.test', '2024-12-09', 3],
      ])
      insertRows(db, 'orders', [
        [1, 1, '2025-01-03', 'completed'], [2, 2, '2025-01-10', 'completed'],
        [3, 1, '2025-02-08', 'completed'], [4, 3, '2025-02-14', 'cancelled'],
        [5, 4, '2025-03-02', 'completed'], [6, 2, '2025-03-12', 'pending'],
      ])
      insertRows(db, 'order_details', [
        [1, 1, 1, 2 + variant, 65000, 10000], [2, 1, 4, 1, 120000, 0],
        [3, 2, 2, 3, 28000, 0], [4, 3, 7, 2, 35000, 5000],
        [5, 3, 1, 1, 65000, 0], [6, 4, 11, 1, 150000, 0],
        [7, 5, 4, 2, 120000, 20000], [8, 5, 8, 4, 12000, 0],
        [9, 6, 3, 2, 48000, 0],
      ])
      if (variant > 0) {
        insertRows(db, 'customers', [[7, 'Gilang', 'Bandung', 'gilang@example.test', '2025-01-01', 2]])
        insertRows(db, 'orders', [[7, 7, '2025-03-19', 'completed']])
        insertRows(db, 'order_details', [[10, 7, 2, 5, 28000, 0]])
      }
    } else {
      const cities = ['Jakarta', 'Bandung', 'Surabaya', 'Yogyakarta', 'Medan', 'Makassar']
      const customers = Array.from({ length: 84 }, (_, i) => {
        const id = i + 1
        return [id, `Pelanggan ${String(id).padStart(3, '0')}`, id % 13 === 0 ? null : cities[i % cities.length],
          id % 17 === 0 ? null : `pelanggan${id === 29 ? 7 : id}@example.test`,
          `2024-12-${String(1 + i % 28).padStart(2, '0')}`, id > 3 ? 1 + i % 3 : null]
      })
      insertRows(db, 'customers', customers)
      const orders: (number | string)[][] = []
      const details: number[][] = []
      let detailId = 1
      for (let id = 1; id <= 360; id++) {
        const month = 1 + Math.floor((id - 1) / 30)
        const day = 1 + ((id * 7 + month) % 28)
        orders.push([id, 1 + ((id * 17 + Math.floor(id / 11)) % 76),
          `2025-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          id % 19 === 0 ? 'cancelled' : id % 23 === 0 ? 'pending' : 'completed'])
        for (let line = 0; line < 1 + id % 4; line++) {
          const product = productRows[(id * 7 + line * 5 + month) % productRows.length]
          const quantity = 1 + (id + line + month) % 4
          const historicalPrice = product[3] - (month < 5 ? 1000 : 0)
          const discount = id % 5 === 0 ? Math.floor(quantity * historicalPrice * 0.1) : 0
          details.push([detailId++, id, product[0], quantity, historicalPrice, discount])
        }
      }
      insertRows(db, 'orders', orders)
      insertRows(db, 'order_details', details)
    }
    db.run('COMMIT')
  } catch (error) {
    db.run('ROLLBACK')
    throw error
  }
  if (db.exec('PRAGMA foreign_key_check').length) throw new Error('Relasi dataset tidak valid.')
}
