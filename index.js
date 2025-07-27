// File: app.js
import readline from 'readline';
import axios from 'axios';
import pkg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const { Client } = pkg;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const db = new Client({
  connectionString: process.env.DATABASE_URL
});
await db.connect();

const replicate = axios.create({
  baseURL: 'https://api.replicate.com/v1/predictions',
  headers: {
    Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
    'Content-Type': 'application/json'
  }
});

const SCHEMA_CONTEXT = `
Tabel:
- users(id, name, email, password, role)
- customers(id, name, phone, email)
- categories(id, name)
- products(id, name, category_id, price, stock)
- orders(id, user_id, customer_id, order_date, total_amount, status)
- order_items(id, order_id, product_id, quantity, unit_price, subtotal)
- payments(id, order_id, payment_method, paid_amount, paid_at)
Gunakan PostgreSQL syntax.
`;

const ask = (q) => new Promise(res => rl.question(q, res));

while (true) {
  const question = await ask('\nPertanyaan (natural language / "exit" untuk keluar): ');
  if (question.trim().toLowerCase() === 'exit') break;

  const prompt = `Ubah pertanyaan menjadi SQL query.\n${SCHEMA_CONTEXT}\nPertanyaan:\n${question}\nJawaban hanya berupa SQL query.`;

  try {
    const { data } = await replicate.post('', {
      version: process.env.GRANITE_MODEL_VERSION,
      input: {
        prompt,
        max_tokens: 300,
        temperature: 0.2
      }
    });

    const predictionUrl = data.urls.get;
    let result;
    do {
      await new Promise(r => setTimeout(r, 2000));
      result = await axios.get(predictionUrl, {
        headers: { Authorization: `Token ${process.env.REPLICATE_API_TOKEN}` }
      });
    } while (result.data.status !== 'succeeded' && result.data.status !== 'failed');

    const outputRaw = result.data.output;
    const raw = Array.isArray(outputRaw) ? outputRaw.join('') : String(outputRaw);
    const sqlOnly = raw.split(/Explanation:/i)[0].trim();

    console.log('\nSQL:\n' + sqlOnly + '\n');

    const lowerSQL = sqlOnly.toLowerCase();
    if (lowerSQL.startsWith('select')) {
      const rows = (await db.query(sqlOnly)).rows;
      console.table(rows);
    } else if (
      lowerSQL.startsWith('insert') ||
      lowerSQL.startsWith('update') ||
      lowerSQL.startsWith('delete')
    ) {
      const result = await db.query(sqlOnly);
      console.log(`\nQuery berhasil dijalankan. Baris terpengaruh: ${result.rowCount}`);
    } else {
      console.error('Query tidak dikenali atau tidak didukung.');
    }

  } catch (err) {
    console.error('Terjadi error:', err.message);
  }
}

rl.close();
db.end();
