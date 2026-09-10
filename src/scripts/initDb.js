import bcrypt from 'bcryptjs';
import db from '../config/db.js';

async function initDb() {
  console.log('🚀 Starting PostgreSQL Database Initialization (Raw SQL Schema Creation with Modules)...');

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

    // 3. Create modules table
    await db.query(`
      CREATE TABLE IF NOT EXISTS modules (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        slug VARCHAR(180) NOT NULL UNIQUE,
        code VARCHAR(4),
        description TEXT,
        image_url TEXT,
        status SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await db.query('CREATE INDEX IF NOT EXISTS idx_modules_code ON modules(code);');

    // 4. Create categories table
    await db.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        module_id INTEGER,
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
          ON DELETE SET NULL,
        CONSTRAINT fk_categories_module
          FOREIGN KEY (module_id)
          REFERENCES modules(id)
          ON DELETE CASCADE
      );
    `);

    await db.query('ALTER TABLE categories ADD COLUMN IF NOT EXISTS code VARCHAR(4);');
    await db.query('ALTER TABLE categories ADD COLUMN IF NOT EXISTS module_id INTEGER;');

    // 5. Create subcategories table
    await db.query(`
      CREATE TABLE IF NOT EXISTS subcategories (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        category_id INTEGER NOT NULL,
        name VARCHAR(150) NOT NULL,
        slug VARCHAR(180) NOT NULL UNIQUE,
        code VARCHAR(4),
        image_url TEXT,
        status SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_subcategories_category
          FOREIGN KEY (category_id)
          REFERENCES categories(id)
          ON DELETE CASCADE
      );
    `);

    await db.query('ALTER TABLE subcategories ADD COLUMN IF NOT EXISTS code VARCHAR(4);');

    // 6. Create products table
    await db.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        category_id INTEGER NOT NULL,
        sub_category_id INTEGER,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(300) NOT NULL UNIQUE,
        sku VARCHAR(100) UNIQUE,
        description TEXT,
        brand VARCHAR(150),
        price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        old_price NUMERIC(10, 2),
        weight NUMERIC(8, 3),
        has_variants BOOLEAN NOT NULL DEFAULT FALSE,
        is_featured BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        meta_title VARCHAR(255),
        meta_description TEXT,
        image_url TEXT,
        status SMALLINT NOT NULL DEFAULT 2,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_products_category
          FOREIGN KEY (category_id)
          REFERENCES categories(id)
          ON DELETE RESTRICT,
        CONSTRAINT fk_products_subcategory
          FOREIGN KEY (sub_category_id)
          REFERENCES subcategories(id)
          ON DELETE SET NULL
      );
    `);

    // Ensure all columns exist for existing installations
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS sub_category_id INTEGER;');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS sku VARCHAR(100);');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2) NOT NULL DEFAULT 0.00;');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS old_price NUMERIC(10, 2);');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS weight NUMERIC(8, 3);');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS brand VARCHAR(150);');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS description TEXT;');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT;');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS has_variants BOOLEAN DEFAULT FALSE;');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT FALSE;');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_title VARCHAR(255);');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_description TEXT;');

    // 7. Create orders table
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

    // 8. Seed Super Admin User (superadmin@aura.com / admin123)
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

    // 9. Seed Default Module if modules table is empty
    const modCheck = await db.query('SELECT COUNT(*)::int FROM modules');
    if (modCheck.rows[0].count === 0) {
      await db.query(`
        INSERT INTO modules (name, slug, code, description, status)
        VALUES ('E-Commerce', 'e-commerce', '1000', 'Main E-Commerce Store Module', 1)
      `);
      console.log('✅ Seeded default module: E-Commerce (code = 1000)');
    }

    console.log('🎉 Database initialization complete!');
  } catch (err) {
    console.error('❌ Database Initialization Error:', err);
  } finally {
    await db.pool.end();
  }
}

initDb();
