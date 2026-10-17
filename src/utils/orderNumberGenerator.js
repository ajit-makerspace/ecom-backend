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
 */
export async function generateOrderNumber(clientOrDb = db, date = new Date()) {
  const fy = getFiscalYearCode(date);
  const prefix = `MSM${fy}`;

  try {
    // Find the maximum sequence number for the current fiscal year prefix
    const { rows } = await clientOrDb.query(
      `SELECT COALESCE(
        MAX(NULLIF(regexp_replace(order_number, '^MSM' || $1, ''), '')::bigint),
        1000
      ) AS max_seq
      FROM orders
      WHERE order_number ~ ('^MSM' || $1 || '[0-9]+$')`,
      [fy]
    );

    const maxSeq = rows[0]?.max_seq ? parseInt(rows[0].max_seq, 10) : 1000;
    const nextSeq = Math.max(maxSeq, 1000) + 1;
    return `${prefix}${nextSeq}`;
  } catch (err) {
    console.error('Error in generateOrderNumber query:', err);
    try {
      const countRes = await clientOrDb.query(
        `SELECT COUNT(*)::int AS count FROM orders WHERE order_number LIKE $1`,
        [`${prefix}%`]
      );
      const count = countRes.rows[0]?.count || 0;
      return `${prefix}${1001 + count}`;
    } catch (fallbackErr) {
      console.error('Error in generateOrderNumber fallback:', fallbackErr);
      return `${prefix}${Math.floor(1001 + Math.random() * 8999)}`;
    }
  }
}

export default {
  getFiscalYearCode,
  generateOrderNumber,
};
