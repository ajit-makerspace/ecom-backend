-- Migration script 20261123_part2: Complete schema integrity for all active controllers

-- 1. Products table extensions
ALTER TABLE products ADD COLUMN IF NOT EXISTS module_id INTEGER REFERENCES modules(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_id INTEGER REFERENCES brand_logos(id) ON DELETE SET NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS returnable SMALLINT NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_products_module_id ON products(module_id);
CREATE INDEX IF NOT EXISTS idx_products_brand_id ON products(brand_id);

-- Backfill module_id from categories
UPDATE products p
SET module_id = c.module_id
FROM categories c
WHERE p.category_id = c.id AND p.module_id IS NULL;

-- 2. Users table extensions for OAuth
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 3. Orders table extensions for shipping & GST
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shiprocket_order_id VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shiprocket_shipment_id VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shiprocket_awb_code VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shiprocket_courier_name VARCHAR(150);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_label_url TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_status VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS requires_gst_invoice BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_gstin VARCHAR(15);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_business_name VARCHAR(255);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS billing_address JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS place_of_supply_state_code VARCHAR(2);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(50);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_date TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date TIMESTAMPTZ;

-- 4. Warehouse Locations
CREATE TABLE IF NOT EXISTS warehouse_locations (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  contact_name VARCHAR(150),
  phone VARCHAR(50),
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city VARCHAR(100) NOT NULL,
  state VARCHAR(100) NOT NULL,
  postal_code VARCHAR(20) NOT NULL,
  country VARCHAR(100) NOT NULL DEFAULT 'India',
  shiprocket_pickup_location VARCHAR(150),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_warehouse_default ON warehouse_locations(is_default, is_active);

-- Seed default warehouse location if none exists
INSERT INTO warehouse_locations (name, contact_name, phone, address_line1, city, state, postal_code, country, is_default, is_active)
SELECT 'Main Hub', 'Maker Store Manager', '+91 9876543210', 'Plot 42, Electronics City', 'Bangalore', 'Karnataka', '560100', 'India', TRUE, TRUE
WHERE NOT EXISTS (SELECT 1 FROM warehouse_locations WHERE is_default = TRUE);

-- 5. Shipments
CREATE TABLE IF NOT EXISTS shipments (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shiprocket_order_id VARCHAR(100),
  shipment_id VARCHAR(100),
  awb_code VARCHAR(100),
  courier_id VARCHAR(100),
  courier_name VARCHAR(150),
  label_url TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'ORDER_CREATED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shipments_order_id ON shipments(order_id);

-- 6. Competitions
CREATE TABLE IF NOT EXISTS competitions (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  competition_date DATE,
  registration_start_date DATE,
  topic VARCHAR(255),
  advisor_organizer VARCHAR(255),
  competition_url TEXT,
  overview TEXT,
  objective TEXT,
  participants TEXT,
  image_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_competitions_is_active ON competitions(is_active);

-- 7. Prototype Requests
CREATE TABLE IF NOT EXISTS prototype_requests (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  request_number VARCHAR(100) UNIQUE NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_email VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50),
  model_name VARCHAR(255),
  model_file_url TEXT,
  model_file_size BIGINT,
  support_files JSONB DEFAULT '[]',
  material VARCHAR(100),
  color VARCHAR(100),
  color_mode VARCHAR(50),
  color_hex VARCHAR(50),
  quality VARCHAR(100),
  quantity INTEGER NOT NULL DEFAULT 1,
  scale VARCHAR(50),
  units VARCHAR(50),
  instructions TEXT,
  admin_notes TEXT,
  quote_amount NUMERIC(10, 2),
  quote_breakdown JSONB,
  estimated_days INTEGER,
  status VARCHAR(50) NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_prototype_requests_status ON prototype_requests(status);
CREATE INDEX IF NOT EXISTS idx_prototype_requests_user ON prototype_requests(user_id);
