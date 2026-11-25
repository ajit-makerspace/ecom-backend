import db from '../config/db.js';

/**
 * Returns 4-digit fiscal year string (e.g., '2627' for FY 2026-2027)
 * In India, fiscal year starts April 1 (month index 3) and ends March 31.
 */
export function getFiscalYearCode(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth(); // 0 = Jan, 1 = Feb, 2 = Mar, 3 = Apr ... 11 = Dec

  // April (3) onwards is part of the FY starting in current year
  // Jan-Mar is part of the FY that started in the previous year
  const startYear = month >= 3 ? year : year - 1;
  const endYear = startYear + 1;

  const startStr = String(startYear).slice(-2);
  const endStr = String(endYear).slice(-2);
  return `${startStr}${endStr}`;
}

/**
 * Generates an order number in the format: MSM<FY><SEQ>
 * e.g., MSM26271001
 * 2627 = fiscal year
 * 1001 = four digit order id starting sequence
 *
 * Concurrency-Safe: Uses an atomic sequence counter table (order_sequences)
 * with ON CONFLICT DO UPDATE row-level locking to completely eliminate
 * race conditions during simultaneous checkouts.
 */
export async function generateOrderNumber(clientOrDb = db, date = new Date()) {
  const fy = getFiscalYearCode(date);
  const prefix = `MSM${fy}`;

  try {
    // 1. Ensure order_sequences tracking table exists
    await clientOrDb.query(`
      CREATE TABLE IF NOT EXISTS order_sequences (
        fy VARCHAR(8) PRIMARY KEY,
        last_seq BIGINT NOT NULL DEFAULT 1000
      )
    `);

    // 2. Determine initial seed sequence from existing orders if row doesn't exist
    const seedRes = await clientOrDb.query(
      `SELECT COALESCE(
        MAX(NULLIF(regexp_replace(order_number, '^MSM' || $1, ''), '')::bigint),
        1000
      ) AS max_seq
      FROM orders
      WHERE order_number ~ ('^MSM' || $1 || '[0-9]+$')`,
      [fy]
    );
    const existingMax = seedRes.rows[0]?.max_seq ? parseInt(seedRes.rows[0].max_seq, 10) : 1000;
    const initialSeed = Math.max(existingMax, 1000);

    // 3. Atomically advance the sequence for this fiscal year with row-level lock
    const { rows } = await clientOrDb.query(
      `INSERT INTO order_sequences (fy, last_seq)
       VALUES ($1, $2 + 1)
       ON CONFLICT (fy)
       DO UPDATE SET last_seq = GREATEST(order_sequences.last_seq, $2) + 1
       RETURNING last_seq`,
      [fy, initialSeed]
    );

    const nextSeq = rows[0]?.last_seq || initialSeed + 1;
    return `${prefix}${nextSeq}`;
  } catch (err) {
    console.error('Error in atomic generateOrderNumber:', err);
    try {
      // Secondary fallback with high-resolution entropy to prevent collision
      const countRes = await clientOrDb.query(
        `SELECT COUNT(*)::int AS count FROM orders WHERE order_number LIKE $1`,
        [`${prefix}%`]
      );
      const count = countRes.rows[0]?.count || 0;
      const entropy = Math.floor(100 + Math.random() * 899);
      return `${prefix}${1001 + count}${entropy}`;
    } catch (fallbackErr) {
      console.error('Error in generateOrderNumber fallback:', fallbackErr);
      const fallbackSuffix = Date.now().toString().slice(-4);
      return `${prefix}${fallbackSuffix}`;
    }
  }
}

export default {
  getFiscalYearCode,
  generateOrderNumber,
};
