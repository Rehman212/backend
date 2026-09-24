/**
 * One-shot: fix blog heading sequence H2 → H3 → H4 (not all H2).
 *
 * Usage: node --env-file=.env scripts/fix-blog-headings.mjs
 */
import pg from 'pg';

const { Client } = pg;

function stripHtmlText(html) {
  return (html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeParagraph(innerHtml) {
  const text = stripHtmlText(innerHtml);
  if (!text) return false;
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words >= 18) return true;
  if (text.length >= 140) return true;
  if (words >= 12 && /[.!]$/.test(text)) return true;
  return false;
}

const HEADING_CYCLE = ['h2', 'h3', 'h4'];

function normalizeBlogContent(html) {
  if (!html) return '';
  let out = html.replace(
    /<(h[1-6])(\b[^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, _tag, attrs, inner) => {
      if (looksLikeParagraph(inner)) return `<p${attrs || ''}>${inner}</p>`;
      return match;
    },
  );
  let index = 0;
  out = out.replace(
    /<(h[1-6])(\b[^>]*)>([\s\S]*?)<\/\1>/gi,
    (_match, _tag, attrs, inner) => {
      const level = HEADING_CYCLE[index % HEADING_CYCLE.length];
      index += 1;
      return `<${level}${attrs || ''}>${inner}</${level}>`;
    },
  );
  return out;
}

const connectionString =
  process.env.DATABASE_URL ||
  (process.env.DB_HOST
    ? `postgres://${process.env.DB_USERNAME ?? 'postgres'}:${process.env.DB_PASSWORD ?? ''}@${process.env.DB_HOST}:${process.env.DB_PORT ?? 5432}/${process.env.DB_NAME ?? 'postgres'}`
    : undefined);

if (!connectionString) {
  console.error('Set DATABASE_URL (or DB_HOST/DB_USERNAME/DB_PASSWORD/DB_NAME)');
  process.exit(1);
}

const client = new Client({
  connectionString,
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
});

await client.connect();
const { rows } = await client.query('SELECT id, slug, content FROM blog_posts ORDER BY id');
let updated = 0;

for (const row of rows) {
  const next = normalizeBlogContent(row.content ?? '');
  if (next !== (row.content ?? '')) {
    await client.query(
      'UPDATE blog_posts SET content = $1, "updatedAt" = NOW() WHERE id = $2',
      [next, row.id],
    );
    updated += 1;
    console.log('Fixed:', row.id, row.slug);
  }
}

console.log(`Done. ${updated}/${rows.length} posts updated.`);
await client.end();
