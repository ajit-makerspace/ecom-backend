import db from '../config/db.js';

const slugify = (text) =>
  text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/&/g, '-and-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

async function run() {
  try {
    const res = await db.query('SELECT id, name, slug FROM products ORDER BY id ASC');
    let updated = 0;
    for (const p of res.rows) {
      const cleanSlug = slugify(p.name);
      await db.query('UPDATE products SET slug = $1 WHERE id = $2', [cleanSlug, p.id]);
      updated++;
    }
    console.log(`Successfully updated ${updated} products with clean slugs.`);

    const check = await db.query('SELECT id, name, slug FROM products WHERE id = 48');
    console.log('Product 48:', check.rows[0]);
    process.exit(0);
  } catch (err) {
    console.error('Error updating slugs:', err);
    process.exit(1);
  }
}

run();
