import bcrypt from 'bcrypt';
import pg from 'pg';

const { Client } = pg;

const email = process.env.ADMIN_EMAIL;
const username = process.env.ADMIN_USERNAME;
const plainPassword = process.env.ADMIN_PASSWORD;
const connectionString = process.env.DATABASE_URL || (
  process.env.DB_HOST
    ? `postgres://${process.env.DB_USERNAME ?? 'postgres'}:${process.env.DB_PASSWORD ?? ''}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME ?? 'postgres'}`
    : undefined
);

if (!email || !username || !plainPassword || !connectionString) {
  console.error('Usage: set ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_PASSWORD, DATABASE_URL');
  process.exit(1);
}

const client = new Client({
  connectionString,
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
});
await client.connect();

const hash = await bcrypt.hash(plainPassword, 10);
const existing = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [email]);

if (existing.rows.length) {
  await client.query(
    'UPDATE users SET role = $1, password = $2 WHERE LOWER(email) = LOWER($3)',
    ['admin', hash, email],
  );
  console.log('Updated existing user to admin:', email);
} else {
  await client.query(
    `INSERT INTO users (email, username, password, role, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [email, username, hash, 'admin'],
  );
  console.log('Created admin user:', email);
}

await client.end();
