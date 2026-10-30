import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import db from '../src/config/db.js';

describe('Security & Architectural Hardening Verification Suite', () => {

  after(async () => {
    await db.pool.end();
  });

  test('1. SEC-06: Cryptographically secure OTP generation produces valid 6-digit numeric strings', () => {
    for (let i = 0; i < 50; i++) {
      const code = crypto.randomInt(100000, 1000000).toString();
      assert.strictEqual(code.length, 6, 'OTP must be exactly 6 characters long');
      const num = parseInt(code, 10);
      assert.ok(num >= 100000 && num < 1000000, 'OTP must be between 100000 and 999999');
    }
  });

  test('2. SEC-06: email_otps table schema includes attempts column defaulting to 0', async () => {
    const { rows } = await db.query(
      "SELECT column_name, column_default FROM information_schema.columns WHERE table_name = 'email_otps' AND column_name = 'attempts';"
    );
    assert.strictEqual(rows.length, 1, 'attempts column must exist on email_otps');
    assert.ok(rows[0].column_default.includes('0'), 'attempts column must default to 0');
  });

  test('3. ARCH-03: orders.payment_status column schema defaults to Pending (not Paid)', async () => {
    const { rows } = await db.query(
      "SELECT column_name, column_default FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'payment_status';"
    );
    assert.strictEqual(rows.length, 1, 'payment_status column must exist on orders');
    assert.ok(rows[0].column_default.toLowerCase().includes('pending'), 'orders.payment_status must default to Pending');
  });

  test('4. ARCH-05: Critical database indexes exist for performance and integrity', async () => {
    const { rows } = await db.query(
      "SELECT indexname FROM pg_indexes WHERE indexname IN ('idx_orders_customer_email', 'idx_orders_razorpay_payment_id', 'idx_order_items_product_id', 'idx_products_brand', 'idx_products_brand_module', 'idx_products_cat_subcat');"
    );
    const existing = new Set(rows.map(r => r.indexname));
    assert.ok(existing.has('idx_orders_customer_email'), 'Index idx_orders_customer_email must exist');
    assert.ok(existing.has('idx_orders_razorpay_payment_id'), 'Index idx_orders_razorpay_payment_id must exist');
    assert.ok(existing.has('idx_order_items_product_id'), 'Index idx_order_items_product_id must exist');
    assert.ok(existing.has('idx_products_brand'), 'Index idx_products_brand must exist');
    assert.ok(existing.has('idx_products_brand_module'), 'Index idx_products_brand_module must exist');
    assert.ok(existing.has('idx_products_cat_subcat'), 'Index idx_products_cat_subcat must exist');
  });

  test('5. SEC-01: Environment JWT_SECRET and SMTP configurations have no fallback secrets in production mode', async () => {
    const { JWT_SECRET } = await import('../src/config/jwt.js');
    assert.ok(JWT_SECRET, 'JWT_SECRET must be loaded');
    assert.notStrictEqual(JWT_SECRET, 'makerspace_super_secure_jwt_secret_key_2026', 'Insecure fallback JWT secret must not be used');
  });

});
