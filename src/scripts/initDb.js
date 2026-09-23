import bcrypt from 'bcryptjs';
import db from '../config/db.js';

export async function initDb() {
  console.log('🚀 Starting PostgreSQL Database Initialization (Raw SQL Schema & Seeds)...');

  try {
    // 1. Extensions
    await db.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    await db.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    // 2. admin_users
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

    // 3. users (Customers)
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        phone VARCHAR(50),
        date_of_birth DATE,
        gender VARCHAR(20),
        profile_image_url TEXT,
        role SMALLINT NOT NULL DEFAULT 1,
        status SMALLINT NOT NULL DEFAULT 1,
        last_login_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Drop legacy plaintext password column if it exists in users
    await db.query('ALTER TABLE users DROP COLUMN IF EXISTS password;');
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS role SMALLINT NOT NULL DEFAULT 1;');
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS status SMALLINT NOT NULL DEFAULT 1;');

    // 4. user_addresses
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_addresses (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        address_type VARCHAR(50) NOT NULL DEFAULT 'shipping',
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        phone VARCHAR(50),
        address_line_1 VARCHAR(255) NOT NULL,
        address_line_2 VARCHAR(255),
        city VARCHAR(100) NOT NULL,
        state VARCHAR(100) NOT NULL,
        postal_code VARCHAR(50) NOT NULL,
        country VARCHAR(100) NOT NULL DEFAULT 'India',
        is_default BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 5. modules
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

    // 6. categories
    await db.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        slug VARCHAR(180) NOT NULL UNIQUE,
        code VARCHAR(4),
        description TEXT,
        parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        image_url TEXT,
        status SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await db.query('ALTER TABLE categories ADD COLUMN IF NOT EXISTS code VARCHAR(4);');
    await db.query('ALTER TABLE categories ADD COLUMN IF NOT EXISTS module_id INTEGER;');

    // 7. subcategories
    await db.query(`
      CREATE TABLE IF NOT EXISTS subcategories (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        slug VARCHAR(180) NOT NULL UNIQUE,
        code VARCHAR(4),
        image_url TEXT,
        status SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await db.query('ALTER TABLE subcategories ADD COLUMN IF NOT EXISTS code VARCHAR(4);');

    // 8. products
    await db.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
        sub_category_id INTEGER REFERENCES subcategories(id) ON DELETE SET NULL,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(300) NOT NULL UNIQUE,
        sku VARCHAR(100) UNIQUE,
        description TEXT,
        brand VARCHAR(150),
        price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        old_price NUMERIC(10, 2),
        stock INTEGER NOT NULL DEFAULT 100,
        weight NUMERIC(8, 3),
        rating NUMERIC(3, 2) DEFAULT 5.0,
        reviews_count INTEGER DEFAULT 0,
        has_variants BOOLEAN NOT NULL DEFAULT FALSE,
        is_featured BOOLEAN NOT NULL DEFAULT FALSE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        meta_title VARCHAR(255),
        meta_description TEXT,
        image_url TEXT,
        status SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Ensure products column types & defaults
    await db.query('ALTER TABLE products ALTER COLUMN status SET DEFAULT 1;');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS stock INTEGER NOT NULL DEFAULT 100;');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS rating NUMERIC(3, 2) DEFAULT 5.0;');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS reviews_count INTEGER DEFAULT 0;');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS is_kit BOOLEAN NOT NULL DEFAULT FALSE;');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS specifications JSONB DEFAULT \'{}\';');
    await db.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS kit_discount_percentage NUMERIC(5, 2) DEFAULT 0.00;');
    await db.query('CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_products_is_kit ON products(is_kit);');

    // 8b. kit_items (Links kits to constituent products with quantities & specifications)
    await db.query(`
      CREATE TABLE IF NOT EXISTS kit_items (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        kit_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL DEFAULT 1,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(kit_id, product_id)
      );
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_kit_items_kit_id ON kit_items(kit_id);');
    await db.query('CREATE INDEX IF NOT EXISTS idx_kit_items_product_id ON kit_items(product_id);');

    // 9. orders
    await db.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        order_number VARCHAR(50) NOT NULL UNIQUE,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        customer_name VARCHAR(150) NOT NULL,
        customer_email VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(50),
        shipping_address TEXT NOT NULL,
        shipping_city VARCHAR(100),
        shipping_state VARCHAR(100),
        shipping_postal_code VARCHAR(50),
        shipping_country VARCHAR(100) DEFAULT 'India',
        subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        shipping_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        tax NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        status VARCHAR(50) NOT NULL DEFAULT 'Pending',
        payment_status VARCHAR(50) NOT NULL DEFAULT 'Paid',
        payment_method VARCHAR(50) NOT NULL DEFAULT 'Credit Card',
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Add extra order columns if table already existed
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(50);');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address TEXT DEFAULT \'\';');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_city VARCHAR(100);');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_state VARCHAR(100);');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_postal_code VARCHAR(50);');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_country VARCHAR(100) DEFAULT \'India\';');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10, 2) DEFAULT 0.00;');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(10, 2) DEFAULT 0.00;');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS tax NUMERIC(10, 2) DEFAULT 0.00;');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50) DEFAULT \'Credit Card\';');
    await db.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes TEXT;');
    await db.query('CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);');

    // 10. order_items
    await db.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        product_name VARCHAR(255) NOT NULL,
        product_sku VARCHAR(100),
        product_image TEXT,
        price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        quantity INTEGER NOT NULL DEFAULT 1,
        total_price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);');

    // 11. user_logs
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_logs (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        login_time TIMESTAMPTZ DEFAULT NOW(),
        browser VARCHAR(255),
        ip_address INET,
        location VARCHAR(255),
        latitude NUMERIC(10, 7),
        longitude NUMERIC(10, 7),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 12. banners
    await db.query(`
      CREATE TABLE IF NOT EXISTS banners (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        subtitle TEXT,
        cta_text VARCHAR(100) DEFAULT 'Explore Hardware',
        cta_link VARCHAR(255) DEFAULT '/user/products',
        secondary_text VARCHAR(100),
        secondary_link VARCHAR(255),
        image_url TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        status SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_banners_status_sort ON banners(status, sort_order);');

    // 13. brand_showcases
    await db.query(`
      CREATE TABLE IF NOT EXISTS brand_showcases (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        brand_key VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(150) NOT NULL,
        tagline VARCHAR(255),
        description TEXT,
        badge_text VARCHAR(100),
        accent_color VARCHAR(50) DEFAULT '#0071e3',
        logo_url TEXT,
        bg_image_url TEXT,
        shop_link VARCHAR(255) DEFAULT '/user/products',
        products JSONB NOT NULL DEFAULT '[]'::jsonb,
        sort_order INTEGER DEFAULT 0,
        status SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await db.query('CREATE INDEX IF NOT EXISTS idx_brand_showcases_status_sort ON brand_showcases(status, sort_order);');

    // ==========================================
    // SEEDING DATA
    // ==========================================

    // 1. Seed Super Admin (superadmin@aura.com / admin123)
    const adminCheck = await db.query('SELECT id FROM admin_users WHERE LOWER(email) = $1', ['superadmin@aura.com']);
    if (adminCheck.rows.length === 0) {
      const passwordHash = await bcrypt.hash('admin123', 10);
      await db.query(
        `INSERT INTO admin_users (email, password_hash, first_name, last_name, user_type, status)
         VALUES ($1, $2, $3, $4, 1, 1)`,
        ['superadmin@aura.com', passwordHash, 'Super', 'Admin']
      );
      console.log('✅ Seeded Super Admin: superadmin@aura.com / admin123');
    }

    // 2. Seed Default Customer (customer@makerspace.com / customer123)
    let sampleUserId = null;
    const custCheck = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', ['customer@makerspace.com']);
    if (custCheck.rows.length === 0) {
      const custHash = await bcrypt.hash('customer123', 10);
      const res = await db.query(
        `INSERT INTO users (email, password_hash, first_name, last_name, phone, role, status)
         VALUES ($1, $2, $3, $4, $5, 1, 1)
         RETURNING id`,
        ['customer@makerspace.com', custHash, 'Alex', 'Maker', '+91 98765 43210']
      );
      sampleUserId = res.rows[0].id;
      console.log('✅ Seeded Demo Customer: customer@makerspace.com / customer123');

      // Seed customer address
      await db.query(
        `INSERT INTO user_addresses (user_id, address_type, first_name, last_name, phone, address_line_1, city, state, postal_code, country, is_default)
         VALUES ($1, 'shipping', 'Alex', 'Maker', '+91 98765 43210', '42 Innovation Drive, Tech Park', 'Bengaluru', 'Karnataka', '560100', 'India', true)`,
        [sampleUserId]
      );
    } else {
      sampleUserId = custCheck.rows[0].id;
    }

    // 3. Seed Default Module
    let defaultModuleId = 1;
    const modCheck = await db.query('SELECT id FROM modules LIMIT 1');
    if (modCheck.rows.length === 0) {
      const modRes = await db.query(`
        INSERT INTO modules (name, slug, code, description, status)
        VALUES ('E-Commerce', 'e-commerce', '1000', 'Main E-Commerce Store Module', 1)
        RETURNING id;
      `);
      defaultModuleId = modRes.rows[0].id;
      console.log('✅ Seeded module: E-Commerce');
    } else {
      defaultModuleId = modCheck.rows[0].id;
    }

    // 4. Seed Categories & Subcategories & Products if empty
    const prodCountRes = await db.query('SELECT COUNT(*)::int FROM products WHERE status != 2');
    if (prodCountRes.rows[0].count === 0) {
      console.log('🌱 Populating initial store categories, subcategories, and products...');

      const initialCategoriesData = [
        {
          name: '3D Printing & Laser',
          slug: '3d-print',
          code: '1001',
          description: 'High precision 3D printers, laser cutters, filaments, and parts',
          image_url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=800&q=80',
          subcategories: ['FDM 3D Printers', 'Resin 3D Printers', 'Filaments & Resins', 'Hotends & Nozzles'],
          products: [
            {
              name: 'Creality Ender-3 V3 SE High-Speed 3D Printer',
              price: 249.99,
              old_price: 299.99,
              brand: 'Creality',
              sku: 'PRD-1001-01',
              image_url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=800&q=80',
              description: 'Capable of 250mm/s print speed, direct drive extruder, and automatic bed leveling for rapid prototyping.',
              is_featured: true,
              rating: 4.8,
              reviews_count: 124,
            },
            {
              name: 'Elegoo Saturn 3 Ultra 12K Resin Printer',
              price: 499.00,
              old_price: 549.00,
              brand: 'Elegoo',
              sku: 'PRD-1001-02',
              image_url: 'https://images.unsplash.com/photo-1563245372-f21724e3856d?w=800&q=80',
              description: 'Ultra-high resolution 12K mono LCD screen for miniature modeling and intricate dental craft.',
              is_featured: true,
              rating: 4.9,
              reviews_count: 88,
            },
          ],
        },
        {
          name: 'Drone Parts & Aerospace',
          slug: 'drone-parts',
          code: '1002',
          description: 'Flight controllers, brushless motors, ESCs, props, and FPV transmitters',
          image_url: 'https://images.unsplash.com/photo-1527977966376-1c8408f9f108?w=800&q=80',
          subcategories: ['Brushless Motors', 'Flight Controllers', 'FPV Cameras', 'Propellers'],
          products: [
            {
              name: 'Apex 5-Inch Freestyle FPV Racing Drone Frame Kit',
              price: 89.50,
              old_price: 110.00,
              brand: 'ImpulseRC',
              sku: 'PRD-1002-01',
              image_url: 'https://images.unsplash.com/photo-1527977966376-1c8408f9f108?w=800&q=80',
              description: 'Ultra-stiff carbon fiber quadcopter frame engineered for extreme acrobatics and resilience.',
              is_featured: true,
              rating: 4.7,
              reviews_count: 45,
            },
            {
              name: 'T-Motor F60 PRO IV 1950KV Brushless Motor Set',
              price: 74.99,
              old_price: 84.99,
              brand: 'T-Motor',
              sku: 'PRD-1002-02',
              image_url: 'https://images.unsplash.com/photo-1508614589041-895b88991e3e?w=800&q=80',
              description: 'High torque, heat resistant windings designed for 6S freestyle and racing drones.',
              is_featured: false,
              rating: 4.9,
              reviews_count: 62,
            },
          ],
        },
        {
          name: 'Mechatronics & Robotics AI',
          slug: 'mechtronics-robotic-ai-iot-electronics',
          code: '1003',
          description: 'Microcontrollers, servo motors, LIDAR sensors, and robotic development platforms',
          image_url: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=800&q=80',
          subcategories: ['Robotic Arms', 'LIDAR & Vision', 'Servos & Steppers', 'Arduino & ESP32'],
          products: [
            {
              name: '6-DOF Aluminum Robotic Arm with Digital Servos',
              price: 189.00,
              old_price: 219.00,
              brand: 'MakerArm',
              sku: 'PRD-1003-01',
              image_url: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=800&q=80',
              description: 'Full metal robotic arm kit with high torque MG996R servos and inverse kinematics support.',
              is_featured: true,
              rating: 4.8,
              reviews_count: 37,
            },
            {
              name: 'ESP32-S3 AI Vision Dual-Core IoT Development Board',
              price: 22.50,
              old_price: 28.00,
              brand: 'Espressif',
              sku: 'PRD-1003-02',
              image_url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80',
              description: 'Built-in 2MP camera, microphone array, Wi-Fi 4 and Bluetooth 5 LE for on-device machine learning.',
              is_featured: true,
              rating: 4.9,
              reviews_count: 142,
            },
          ],
        },
        {
          name: 'Electronic Components & SmartElex',
          slug: 'electronic-components',
          code: '1004',
          description: 'Sensors, power supplies, displays, ICs, passives and breadboard essentials',
          image_url: 'https://images.unsplash.com/photo-1517055729441-db3aab135867?w=800&q=80',
          subcategories: ['Sensors & Modules', 'Displays & OLEDs', 'Power Modules', 'Passive Components'],
          products: [
            {
              name: '0.96 Inch I2C 128x64 OLED Display Module (Blue/Yellow)',
              price: 6.99,
              old_price: 9.99,
              brand: 'SmartElex',
              sku: 'PRD-1004-01',
              image_url: 'https://images.unsplash.com/photo-1517055729441-db3aab135867?w=800&q=80',
              description: 'Crisp, high contrast self-illuminating graphical display module for microcontroller projects.',
              is_featured: false,
              rating: 4.7,
              reviews_count: 210,
            },
            {
              name: 'Regulated DC Bench Power Supply 30V 10A LED Display',
              price: 98.00,
              old_price: 125.00,
              brand: 'KPS',
              sku: 'PRD-1004-02',
              image_url: 'https://images.unsplash.com/photo-1581092335397-9583fe92d232?w=800&q=80',
              description: 'Low ripple laboratory switching DC power supply with coarse and fine voltage controls.',
              is_featured: true,
              rating: 4.8,
              reviews_count: 59,
            },
          ],
        },
        {
          name: 'Wood Working & Precision Metal',
          slug: 'wood-working',
          code: '1005',
          description: 'CNC routers, carving chisels, rotary tools, clamps, and finishes',
          image_url: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=800&q=80',
          subcategories: ['CNC Routers', 'Carving Tools', 'Precision Measuring', 'Finishing & Adhesives'],
          products: [
            {
              name: 'Desktop CNC 3018-PRO Router Machine with Offline Controller',
              price: 219.00,
              old_price: 259.00,
              brand: 'Genmitsu',
              sku: 'PRD-1005-01',
              image_url: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=800&q=80',
              description: 'Milling, cutting, and engraving machine for acrylic, PCB, PVC, and hardwood.',
              is_featured: true,
              rating: 4.6,
              reviews_count: 73,
            },
          ],
        },
      ];

      for (const catData of initialCategoriesData) {
        // Insert category
        const catRes = await db.query(
          `INSERT INTO categories (module_id, name, slug, code, description, image_url, status)
           VALUES ($1, $2, $3, $4, $5, $6, 1)
           ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
           RETURNING id;`,
          [defaultModuleId, catData.name, catData.slug, catData.code, catData.description, catData.image_url]
        );
        const catId = catRes.rows[0].id;

        // Insert subcategories
        let firstSubCatId = null;
        let subIndex = 1;
        for (const subName of catData.subcategories) {
          const subSlug = `${catData.slug}-${subIndex}`;
          const subCode = String(2000 + subIndex);
          const subRes = await db.query(
            `INSERT INTO subcategories (category_id, name, slug, code, status)
             VALUES ($1, $2, $3, $4, 1)
             ON CONFLICT (slug) DO NOTHING
             RETURNING id;`,
            [catId, subName, subSlug, subCode]
          );
          if (subRes.rows[0] && !firstSubCatId) {
            firstSubCatId = subRes.rows[0].id;
          }
          subIndex++;
        }

        // Insert products
        for (const prod of catData.products) {
          const prodSlug = `${prod.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString().slice(-4)}`;
          await db.query(
            `INSERT INTO products (
               category_id, sub_category_id, name, slug, sku, description, brand, price, old_price,
               stock, rating, reviews_count, is_featured, image_url, status
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 100, $10, $11, $12, $13, 1)
             ON CONFLICT (sku) DO NOTHING;`,
            [
              catId,
              firstSubCatId,
              prod.name,
              prodSlug,
              prod.sku,
              prod.description,
              prod.brand,
              prod.price,
              prod.old_price,
              prod.rating,
              prod.reviews_count,
              prod.is_featured,
              prod.image_url,
            ]
          );
        }
      }
      console.log('✅ Seeded categories, subcategories, and realistic maker products!');
    }

    // 5. Seed an Initial Completed Order if orders table is empty
    const orderCountRes = await db.query('SELECT COUNT(*)::int FROM orders');
    if (orderCountRes.rows[0].count === 0 && sampleUserId) {
      const firstProd = await db.query('SELECT id, name, sku, price, image_url FROM products LIMIT 1');
      if (firstProd.rows.length > 0) {
        const p = firstProd.rows[0];
        const orderRes = await db.query(
          `INSERT INTO orders (
             order_number, user_id, customer_name, customer_email, customer_phone,
             shipping_address, shipping_city, shipping_state, shipping_postal_code,
             subtotal, shipping_fee, tax, total_amount, status, payment_status, payment_method
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
           ) RETURNING id;`,
          [
            'MS-948120',
            sampleUserId,
            'Alex Maker',
            'customer@makerspace.com',
            '+91 98765 43210',
            '42 Innovation Drive, Tech Park',
            'Bengaluru',
            'Karnataka',
            '560100',
            p.price,
            0.00,
            0.00,
            p.price,
            'Processing',
            'Paid',
            'Credit Card',
          ]
        );
        const orderId = orderRes.rows[0].id;

        await db.query(
          `INSERT INTO order_items (order_id, product_id, product_name, product_sku, product_image, price, quantity, total_price)
           VALUES ($1, $2, $3, $4, $5, $6, 1, $7);`,
          [orderId, p.id, p.name, p.sku, p.image_url, p.price, p.price]
        );
        console.log('✅ Seeded initial sample order MS-948120 with line item');
      }
    }

    // 6. Seed Detailed Product Specifications for Catalog Products
    const specsMap = {
      'PRD-1001-01': {
        'Build Volume': '256 x 256 x 256 mm',
        'Max Hotend Temp': '300 °C',
        'Max Bed Temp': '110 °C',
        'Max Print Speed': '500 mm/s',
        'Acceleration': '20,000 mm/s²',
        'Camera': '1080p AI Camera with LiDAR',
        'Filament Compatibility': 'PLA, PETG, TPU, ABS, Carbon Fiber'
      },
      'PRD-1001-02': {
        'Screen Size': '10-inch 12K Mono LCD',
        'XY Resolution': '19 x 24 microns',
        'Build Volume': '218.88 x 122.88 x 260 mm',
        'Max Printing Speed': 'Up to 150 mm/h',
        'Light Source': 'COB + Refractive Fresnel Lens',
        'Connectivity': 'Wi-Fi (2.4G/5G), USB Drive'
      },
      'PRD-1002-01': {
        'Wheelbase': '225 mm',
        'Material': 'Toray 3K Full Carbon Fiber',
        'Arm Thickness': '5.5 mm',
        'Top/Bottom Plate': '2.0 mm',
        'Propeller Size': '5.0 to 5.2 inch',
        'Weight': '115g (Hardware Included)',
        'Motor Mount Pattern': '16x16 mm / 19x19 mm'
      },
      'PRD-1002-02': {
        'KV Rating': '1950 KV',
        'Configuration': '12N14P',
        'Shaft Diameter': '4.0 mm Hollow Titanium',
        'Rated Voltage': '6S LiPo (24V)',
        'Max Continuous Power': '820W',
        'Peak Current': '45A (60s)',
        'Weight': '31.5g per motor'
      },
      'PRD-1003-01': {
        'Degrees of Freedom': '6-DOF (Full Spatial Motion)',
        'Structure Material': 'Hard Anodized Aluminum Alloy 2.0mm',
        'Servos Included': '6x MG996R Metal Gear Digital Servos',
        'Operating Voltage': '4.8V - 7.2V DC',
        'Payload Capacity': '500g Max Gripper Load',
        'Working Radius': '390 mm Semi-Spherical Reach',
        'Control Interface': 'PWM / Serial Bus / Arduino Compatible'
      },
      'PRD-1003-02': {
        'Processor': 'Xtensa 32-bit LX7 Dual-Core up to 240 MHz',
        'Memory': '512 KB SRAM + 8 MB PSRAM + 16 MB Flash',
        'Wireless Connectivity': 'Wi-Fi 802.11 b/g/n + Bluetooth 5.0 (LE)',
        'Camera Sensor': 'OV2640 2-Megapixel Camera Module',
        'Microphone': 'Integrated Digital I2S MEMS Microphone',
        'GPIO Pins': '28 Multifunction GPIOs, SPI, I2C, UART, ADC'
      },
      'PRD-1004-01': {
        'Display Type': 'Monochrome OLED Graphics Display',
        'Resolution': '128 x 64 pixels',
        'Driver Chip': 'SSD1306',
        'Interface Bus': 'I2C (Default Address 0x3C, configurable to 0x3D)',
        'Supply Voltage': '3.3V to 5.0V DC Built-in LDO Regulator',
        'Viewing Angle': '> 160 Degrees Wide Viewing',
        'Active Current': '0.04W Typical (All Pixels Active)'
      },
      'PRD-1004-02': {
        'Output Voltage Range': '0 - 30.00 V (0.01V Resolution)',
        'Output Current Range': '0 - 10.00 A (0.001A Resolution)',
        'Display Precision': '4-Digit High-Precision LED Dual Display',
        'Ripple & Noise': '<= 30 mVrms / <= 20 mArms',
        'Cooling Method': 'Intelligent Temperature-Controlled Fan',
        'Protection Features': 'OVP (Over Voltage), OCP (Over Current), OTP (Thermal)'
      },
      'PRD-1005-01': {
        'Effective Working Area': '300 x 180 x 45 mm',
        'Frame Dimensions': '400 x 330 x 240 mm (Aluminum + Bakelite)',
        'Spindle Motor': '775 High-Speed Spindle (12-36V, 10,000 RPM)',
        'Stepper Motors': 'NEMA 17 Stepper Motors (1.33A, 0.25 N.m)',
        'Controller Board': 'GRBL 1.1f Integrated 3-Axis Driver',
        'Offline Controller': '1.8-inch TFT Color Display with SD Slot'
      }
    };

    for (const [sku, specs] of Object.entries(specsMap)) {
      await db.query(
        'UPDATE products SET specifications = $1 WHERE sku = $2',
        [JSON.stringify(specs), sku]
      );
    }
    console.log('✅ Updated specifications for all catalog products!');

    // 7. Seed 3 Maker Kits with Constituent Products & Quantities
    const kitsToSeed = [
      {
        name: 'IoT AI Smart Home Starter Kit',
        slug: 'iot-ai-smart-home-starter-kit',
        sku: 'KIT-1003-IOT',
        brand: 'MakerKit Labs',
        price: 34.99,
        old_price: 49.99,
        categorySlug: 'mechtronics-robotic-ai-iot-electronics',
        image_url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80',
        description: 'Complete all-in-one IoT developer starter pack with AI vision camera, dual high-contrast OLED displays, and dual-core Wi-Fi & Bluetooth compute. Perfect for smart home automations, facial recognition, and sensor logging.',
        rating: 5.0,
        reviews_count: 54,
        is_featured: true,
        specifications: {
          'Microcontroller': 'ESP32-S3 Dual-Core 240MHz with 8MB PSRAM',
          'Sensors & Displays': '2x 0.96" I2C OLED (128x64) Displays + 2MP Vision Sensor',
          'Connectivity': 'Dual-Band Wi-Fi 4 + Bluetooth 5.0 LE Mesh',
          'Power Supply': '5V 2A USB-C Cable Included',
          'Tutorials': '12 Interactive Open-Source Cloud Starter Projects'
        },
        items: [
          { sku: 'PRD-1003-02', quantity: 1 }, // ESP32-S3 AI Vision
          { sku: 'PRD-1004-01', quantity: 2 }, // 2x 0.96 OLED Display
        ]
      },
      {
        name: 'Pro FPV Drone Speed & Flight Power Kit',
        slug: 'pro-fpv-drone-speed-flight-power-kit',
        sku: 'KIT-1002-FPV',
        brand: 'AeroMaker Pro',
        price: 149.00,
        old_price: 184.99,
        categorySlug: 'drone-parts',
        image_url: 'https://images.unsplash.com/photo-1527977966376-1c8408f9f108?w=800&q=80',
        description: 'Engineered competition-grade FPV kit pairing the ultra-resilient 5-inch 3K carbon fiber Apex frame with 4x high-thrust T-Motor F60 PRO IV 1950KV brushless motors. Built for 6S freestyle and racing.',
        rating: 4.9,
        reviews_count: 41,
        is_featured: true,
        specifications: {
          'Frame Material': 'Japanese Toray 3K Matte Carbon Fiber',
          'Arm Thickness': '5.5 mm Chamfered Quick-Swap Arms',
          'Motor Configuration': '4x T-Motor F60 PRO IV (1950 KV, 6S Rated)',
          'Total Maximum Thrust': 'Over 7.2 kg Combined Peak Thrust',
          'Included Accessories': 'Battery Strap, Hardware Kit, TPU Antenna Mount'
        },
        items: [
          { sku: 'PRD-1002-01', quantity: 1 }, // Apex 5-Inch Frame
          { sku: 'PRD-1002-02', quantity: 1 }, // T-Motor F60 Pro IV Set
        ]
      },
      {
        name: 'Automated Maker Mechatronics Lab Kit',
        slug: 'automated-maker-mechatronics-lab-kit',
        sku: 'KIT-1003-ROBO',
        brand: 'RoboCraft',
        price: 289.00,
        old_price: 349.00,
        categorySlug: 'mechtronics-robotic-ai-iot-electronics',
        image_url: 'https://images.unsplash.com/photo-1485827404703-89b55fcc595e?w=800&q=80',
        description: 'Flagship engineering laboratory kit! Combines a 6-DOF metallic robotic arm, ESP32-S3 AI vision processing board for real-time target tracking, and a 30V 10A regulated bench power supply for workshop prototyping.',
        rating: 5.0,
        reviews_count: 29,
        is_featured: true,
        specifications: {
          'Robotic Kinematics': '6-DOF Aluminum Arm with 6x MG996R Metal Servos',
          'Vision Tracking': 'ESP32-S3 AI Camera Board with Color & Object Tracking',
          'Laboratory Power': '30V 10A Low-Ripple Regulated DC Bench Supply',
          'Supported Protocols': 'Python, ROS 2, Arduino C++, WebSockets',
          'Payload Capacity': '500 grams with High-Friction Silicone Gripper'
        },
        items: [
          { sku: 'PRD-1003-01', quantity: 1 }, // 6-DOF Robotic Arm
          { sku: 'PRD-1003-02', quantity: 1 }, // ESP32-S3 AI Board
          { sku: 'PRD-1004-02', quantity: 1 }, // Regulated DC Power Supply
        ]
      }
    ];

    for (const kit of kitsToSeed) {
      const catRes = await db.query('SELECT id FROM categories WHERE slug = $1', [kit.categorySlug]);
      const catId = catRes.rows[0]?.id || 1;

      const kitProdRes = await db.query(
        `INSERT INTO products (
           category_id, name, slug, sku, description, brand, price, old_price,
           stock, rating, reviews_count, is_featured, is_kit, specifications, image_url, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 50, $9, $10, $11, true, $12, $13, 1)
         ON CONFLICT (sku) DO UPDATE SET
           name = EXCLUDED.name,
           price = EXCLUDED.price,
           old_price = EXCLUDED.old_price,
           is_kit = true,
           specifications = EXCLUDED.specifications,
           description = EXCLUDED.description
         RETURNING id;`,
        [
          catId,
          kit.name,
          kit.slug,
          kit.sku,
          kit.description,
          kit.brand,
          kit.price,
          kit.old_price,
          kit.rating,
          kit.reviews_count,
          kit.is_featured,
          JSON.stringify(kit.specifications),
          kit.image_url,
        ]
      );
      const kitId = kitProdRes.rows[0].id;

      await db.query('DELETE FROM kit_items WHERE kit_id = $1', [kitId]);

      let sortOrder = 0;
      for (const item of kit.items) {
        const prodRes = await db.query('SELECT id FROM products WHERE sku = $1', [item.sku]);
        if (prodRes.rows.length > 0) {
          const compId = prodRes.rows[0].id;
          await db.query(
            `INSERT INTO kit_items (kit_id, product_id, quantity, sort_order)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (kit_id, product_id) DO UPDATE SET quantity = EXCLUDED.quantity;`,
            [kitId, compId, item.quantity, sortOrder++]
          );
        }
      }
    }
    console.log('✅ Seeded 3 Maker Kits with constituent items and component amounts!');

    // 7. Seed Initial Banners
    const bannerCountRes = await db.query('SELECT COUNT(*)::int as count FROM banners WHERE status != 2');
    if (bannerCountRes.rows[0].count === 0) {
      await db.query(`
        INSERT INTO banners (title, subtitle, cta_text, cta_link, secondary_text, secondary_link, image_url, sort_order, status)
        VALUES 
        (
          'Create Without Limits',
          'Power your next prototype with precision components, modules, and complete engineering kits.',
          'Explore Hardware',
          '/user/products',
          'Explore Maker Kits',
          '/user/kits',
          '/hero-banner-2.png',
          1,
          1
        ),
        (
          'Build. Prototype. Innovate.',
          'Everything you need for embedded systems, robotics, IoT, and maker innovation.',
          'Explore Maker Kits',
          '/user/kits',
          'Explore Hardware',
          '/user/products',
          '/hero-banner-1.png',
          2,
          1
        );
      `);
      console.log('✅ Seeded 2 Initial Hero Banners!');
    }

    // 8. Seed Initial Brand Showcases (LEGO & Hot Wheels)
    const showcaseCountRes = await db.query('SELECT COUNT(*)::int as count FROM brand_showcases WHERE status != 2');
    if (showcaseCountRes.rows[0].count === 0) {
      const legoProducts = [
        { id: 'lego-101', name: 'LEGO Technic 4x4 X-treme Off-Roader', price: 229.99, oldPrice: 269.99, categoryName: 'LEGO Technic', rating: 5, brand: 'LEGO', image: 'https://images.unsplash.com/photo-1585366119957-e9730b6d0f60?w=500&q=80', isKit: true },
        { id: 'lego-102', name: 'LEGO Mindstorms Robot Inventor Coding Set', price: 359.99, oldPrice: 399.99, categoryName: 'LEGO Robotics', rating: 5, brand: 'LEGO', image: 'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=500&q=80', isKit: true },
        { id: 'lego-103', name: 'LEGO Technic Heavy-Duty Pneumatic Crane', price: 189.99, oldPrice: 219.99, categoryName: 'LEGO Engineering', rating: 4.9, brand: 'LEGO', image: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=500&q=80', isKit: false },
        { id: 'lego-104', name: 'LEGO NASA Apollo Saturn V Rocket Scale 1:110', price: 139.99, oldPrice: 159.99, categoryName: 'LEGO Aerospace', rating: 5, brand: 'LEGO', image: 'https://images.unsplash.com/photo-1579202673506-ca3ce28943ef?w=500&q=80', isKit: false },
        { id: 'lego-105', name: 'LEGO Technic Ferrari Daytona SP3 Hypercar 1:8', price: 449.99, oldPrice: 499.99, categoryName: 'LEGO Supercars', rating: 5, brand: 'LEGO', image: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=500&q=80', isKit: true },
        { id: 'lego-106', name: 'LEGO Star Wars Millennium Falcon Collector Edition', price: 169.99, oldPrice: 199.99, categoryName: 'LEGO Star Wars', rating: 4.9, brand: 'LEGO', image: 'https://images.unsplash.com/photo-1618336753974-aae8e04506aa?w=500&q=80', isKit: false },
        { id: 'lego-107', name: 'LEGO Technic Bugatti Bolide Racing Edition', price: 79.99, oldPrice: 94.99, categoryName: 'LEGO Speed Champions', rating: 5, brand: 'LEGO', image: 'https://images.unsplash.com/photo-1585366119957-e9730b6d0f60?w=500&q=80', isKit: false },
        { id: 'lego-108', name: 'LEGO Boost Creative Robotics Toolbox', price: 159.99, oldPrice: 179.99, categoryName: 'LEGO Robotics', rating: 4.8, brand: 'LEGO', image: 'https://images.unsplash.com/photo-1587654780291-39c9404d746b?w=500&q=80', isKit: true },
      ];

      const hwProducts = [
        { id: 'hw-201', name: 'Hot Wheels City Ultimate Garage with 100-Car Storage', price: 119.99, oldPrice: 139.99, categoryName: 'Mega Sets', rating: 5, brand: 'Hot Wheels', image: 'https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=500&q=80', isKit: true },
        { id: 'hw-202', name: 'Hot Wheels Track Builder Unlimited Triple Loop Booster', price: 49.99, oldPrice: 59.99, categoryName: 'Stunt Tracks', rating: 4.9, brand: 'Hot Wheels', image: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=500&q=80', isKit: false },
        { id: 'hw-203', name: 'Hot Wheels R/C 1:10 Scale Cyber-Truck High Torque Edition', price: 99.99, oldPrice: 119.99, categoryName: 'RC Vehicles', rating: 5, brand: 'Hot Wheels', image: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=500&q=80', isKit: true },
        { id: 'hw-204', name: 'Hot Wheels Monster Trucks Wreckin Raceway Giant Arena', price: 69.99, oldPrice: 84.99, categoryName: 'Monster Trucks', rating: 4.8, brand: 'Hot Wheels', image: 'https://images.unsplash.com/photo-1534088568595-a066f410bcda?w=500&q=80', isKit: false },
        { id: 'hw-205', name: 'Hot Wheels Smart AI Intelligent Stunt Racetrack System', price: 179.99, oldPrice: 199.99, categoryName: 'Smart Tracks', rating: 5, brand: 'Hot Wheels', image: 'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=500&q=80', isKit: true },
        { id: 'hw-206', name: 'Hot Wheels Mario Kart Rainbow Road 8-Foot Track', price: 129.99, oldPrice: 149.99, categoryName: 'Speed Circuits', rating: 4.9, brand: 'Hot Wheels', image: 'https://images.unsplash.com/photo-1594787318286-3d835c1d207f?w=500&q=80', isKit: false },
        { id: 'hw-207', name: 'Hot Wheels 50-Car Precision Die-Cast Collector Pack', price: 59.99, oldPrice: 74.99, categoryName: 'Die-Cast Cars', rating: 5, brand: 'Hot Wheels', image: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=500&q=80', isKit: false },
        { id: 'hw-208', name: 'Hot Wheels Sky Crash Tower Motorized Booster Track', price: 54.99, oldPrice: 69.99, categoryName: 'Motorized Tracks', rating: 4.8, brand: 'Hot Wheels', image: 'https://images.unsplash.com/photo-1534088568595-a066f410bcda?w=500&q=80', isKit: false },
      ];

      await db.query(`
        INSERT INTO brand_showcases (brand_key, name, tagline, description, badge_text, accent_color, logo_url, bg_image_url, shop_link, products, sort_order, status)
        VALUES
        (
          'lego',
          'LEGO',
          'Technic & Engineering Master Series',
          'Precision mechanical gearing, pneumatic robotics, and authentic scale models engineered for master builders worldwide.',
          'Official LEGO Engineering',
          '#E3000B',
          '/logo-lego.png',
          'https://images.unsplash.com/photo-1585366119957-e9730b6d0f60?w=1200&q=80',
          '/user/products?brand=LEGO',
          $1,
          1,
          1
        ),
        (
          'hot-wheels',
          'Hot Wheels',
          'Velocity & Extreme Track Engineering',
          'High-speed booster tracks, precision die-cast supercars, and motorized stunt circuits engineered for maximum velocity.',
          'Ultimate Velocity Speed Lab',
          '#0066CC',
          '/logo-hotwheels.png',
          'https://images.unsplash.com/photo-1568605117036-5fe5e7bab0b7?w=1200&q=80',
          '/user/products?brand=Hot+Wheels',
          $2,
          2,
          1
        );
      `, [JSON.stringify(legoProducts), JSON.stringify(hwProducts)]);
      console.log('✅ Seeded 2 Initial Brand Showcases (LEGO & Hot Wheels with 8 products each)!');
    }

    console.log('🎉 PostgreSQL Database Initialization and Seed Complete!');
  } catch (err) {
    console.error('❌ Database Initialization Error:', err);
    throw err;
  }
}

// Run if called directly
if (process.argv[1]?.endsWith('initDb.js')) {
  initDb()
    .then(() => {
      console.log('Done.');
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
