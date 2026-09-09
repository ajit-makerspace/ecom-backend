const bcrypt = require('bcryptjs');
const db = require('../config/db');

async function initDb() {
  console.log('🚀 Starting PostgreSQL Database Initialization (Raw SQL Schema Creation)...');

  try {
    // 1. Create pgcrypto extension if available
    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    // 2. Create admin_users table
    await db.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        phone VARCHAR(20),
        user_type SMALLINT NOT NULL DEFAULT 1,
        status SMALLINT NOT NULL DEFAULT 1,
        last_login_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // 3. Create categories table
    await db.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        slug VARCHAR(180) NOT NULL UNIQUE,
        code VARCHAR(4),
        description TEXT,
        parent_id INTEGER,
        image_url TEXT,
        status SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_categories_parent
          FOREIGN KEY (parent_id)
          REFERENCES categories(id)
          ON DELETE SET NULL
      );
    `);

    await db.query('ALTER TABLE categories ADD COLUMN IF NOT EXISTS code VARCHAR(4);');

    // 4. Create products table
    await db.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        category_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(300) NOT NULL UNIQUE,
        price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        stock INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        brand_name VARCHAR(150),
        image_url TEXT,
        status SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_products_category
          FOREIGN KEY (category_id)
          REFERENCES categories(id)
          ON DELETE RESTRICT
      );
    `);

    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2) NOT NULL DEFAULT 0.00;');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 0;');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_name VARCHAR(150);');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;');

    // 5. Create orders table
    await db.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        order_number VARCHAR(50) NOT NULL UNIQUE,
        customer_name VARCHAR(150) NOT NULL,
        customer_email VARCHAR(255) NOT NULL,
        total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        status VARCHAR(50) NOT NULL DEFAULT 'Pending',
        payment_status VARCHAR(50) NOT NULL DEFAULT 'Paid',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 6. Seed Super Admin User (superadmin@aura.com / admin123)
    const superAdminEmail = 'superadmin@aura.com';
    const adminCheck = await db.query('SELECT * FROM admin_users WHERE LOWER(email) = LOWER($1)', [superAdminEmail]);

    if (adminCheck.rows.length === 0) {
      const passwordHash = await bcrypt.hash('admin123', 10);
      await db.query(
        `INSERT INTO admin_users (email, password_hash, first_name, last_name, user_type, status)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [superAdminEmail, passwordHash, 'Super', 'Admin', 1, 1]
      );
      console.log('✅ Seeded Super Admin user: superadmin@aura.com / admin123 (user_type = 1)');
    }

    // 7. Clear all dummy data from categories, products, orders
    await db.query('TRUNCATE TABLE products, orders, categories CASCADE;');
    console.log('🧹 Cleared all dummy data from products, orders, and categories tables.');

    console.log('🎉 Database initialization complete!');
  } catch (err) {
    console.error('❌ Database Initialization Error:', err);
  } finally {
    await db.pool.end();
  }
}

initDb();
