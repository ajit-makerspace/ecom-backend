
import db from '../../config/db.js';

export async function ensureCustomerLogosTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS customer_logos (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        logo_url TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        status SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  } catch (err) {
    console.warn('[Customer Logos] Schema check notice:', err.message);
  }
}
ensureCustomerLogosTable();

const CUSTOMER_LOGO_COLUMNS = `
  id,
  name,
  logo_url AS "logoUrl",
  sort_order AS "sortOrder",
  status,
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const hasOwn = (object, key) =>
  Object.prototype.hasOwnProperty.call(object, key);

const text = (value) =>
  typeof value === 'string' ? value.trim() : '';

const parseId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

const toStatusInt = (status, fallback = 1) => {
  if (status === undefined || status === null || status === '') {
    return fallback;
  }

  if (status === 1 || status === '1' || status === true) return 1;
  if (status === 0 || status === '0' || status === false) return 0;

  const normalized = String(status).trim().toLowerCase();

  if (normalized === 'active') return 1;
  if (normalized === 'inactive') return 0;

  return null;
};

const toNonNegativeInt = (value, fallback = 0) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const number = Number(value);

  return Number.isSafeInteger(number) && number >= 0
    ? number
    : null;
};

const toApiCustomerLogo = (customerLogo) => ({
  ...customerLogo,
  status: Number(customerLogo.status) === 1 ? 'Active' : 'Inactive',
  sortOrder: Number(customerLogo.sortOrder ?? 0),
});

/* Get all non-deleted customer logos for the admin */
export const getCustomerLogos = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT ${CUSTOMER_LOGO_COLUMNS}
      FROM customer_logos
      WHERE status <> 2
      ORDER BY sort_order ASC, id ASC
    `);

    const customerLogos = rows.map(toApiCustomerLogo);

    return res.json({
      success: true,
      count: customerLogos.length,
      customerLogos,
    });
  } catch (err) {
    console.error('Get Customer Logos Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch customer logos.',
    });
  }
};

/* Get active customer logos for the storefront ribbon */
export const getUserCustomerLogos = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT ${CUSTOMER_LOGO_COLUMNS}
      FROM customer_logos
      WHERE status = 1
      ORDER BY sort_order ASC, id ASC
    `);

    const customerLogos = rows.map(toApiCustomerLogo);

    return res.json({
      success: true,
      count: customerLogos.length,
      customerLogos,
    });
  } catch (err) {
    console.error('Get Public Customer Logos Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch active customer logos.',
    });
  }
};

/* Get one non-deleted customer logo */
export const getCustomerLogoById = async (req, res) => {
  try {
    const id = parseId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'A valid customer logo ID is required.',
      });
    }

    const { rows } = await db.query(
      `SELECT ${CUSTOMER_LOGO_COLUMNS}
       FROM customer_logos
       WHERE id = $1
         AND status <> 2`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer logo not found.',
      });
    }

    return res.json({
      success: true,
      customerLogo: toApiCustomerLogo(rows[0]),
    });
  } catch (err) {
    console.error('Get Customer Logo Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch customer logo.',
    });
  }
};

/* Create a customer logo */
export const createCustomerLogo = async (req, res) => {
  try {
    const body = req.body || {};
    const name = text(body.name);
    const logoUrl = text(body.logoUrl);

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Customer name is required.',
      });
    }

    if (!logoUrl) {
      return res.status(400).json({
        success: false,
        message: 'Customer logo URL is required.',
      });
    }

    const status = toStatusInt(body.status, 1);

    if (status === null || status === 2) {
      return res.status(400).json({
        success: false,
        message: 'Status must be Active or Inactive.',
      });
    }

    let sortOrder;

    if (
      body.sortOrder === undefined ||
      body.sortOrder === null ||
      body.sortOrder === ''
    ) {
      const { rows } = await db.query(`
        SELECT COALESCE(MAX(sort_order), 0) + 1 AS "nextSortOrder"
        FROM customer_logos
        WHERE status <> 2
      `);

      sortOrder = Number(rows[0]?.nextSortOrder ?? 1);
    } else {
      sortOrder = toNonNegativeInt(body.sortOrder, null);

      if (sortOrder === null) {
        return res.status(400).json({
          success: false,
          message: 'Sort order must be a non-negative integer.',
        });
      }
    }

    const { rows } = await db.query(
      `INSERT INTO customer_logos (
         name,
         logo_url,
         sort_order,
         status,
         updated_at
       )
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING ${CUSTOMER_LOGO_COLUMNS}`,
      [name, logoUrl, sortOrder, status]
    );

    return res.status(201).json({
      success: true,
      message: 'Customer logo created successfully.',
      customerLogo: toApiCustomerLogo(rows[0]),
    });
  } catch (err) {
    console.error('Create Customer Logo Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to create customer logo.',
    });
  }
};

/* Update a customer logo; omitted fields are preserved */
export const updateCustomerLogo = async (req, res) => {
  try {
    const id = parseId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'A valid customer logo ID is required.',
      });
    }

    const body = req.body || {};

    const currentResult = await db.query(
      `SELECT ${CUSTOMER_LOGO_COLUMNS}
       FROM customer_logos
       WHERE id = $1
         AND status <> 2`,
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer logo not found.',
      });
    }

    const current = currentResult.rows[0];

    const pick = (key) =>
      hasOwn(body, key) && body[key] !== undefined
        ? body[key]
        : current[key];

    const name = text(pick('name'));
    const logoUrl = text(pick('logoUrl'));

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Customer name is required.',
      });
    }

    if (!logoUrl) {
      return res.status(400).json({
        success: false,
        message: 'Customer logo URL is required.',
      });
    }

    const status = toStatusInt(
      pick('status'),
      Number(current.status) === 1 ? 1 : 0
    );

    if (status === null || status === 2) {
      return res.status(400).json({
        success: false,
        message: 'Status must be Active or Inactive.',
      });
    }

    const sortOrder = toNonNegativeInt(
      pick('sortOrder'),
      Number(current.sortOrder ?? 0)
    );

    if (sortOrder === null) {
      return res.status(400).json({
        success: false,
        message: 'Sort order must be a non-negative integer.',
      });
    }

    const { rows } = await db.query(
      `UPDATE customer_logos
       SET name = $1,
           logo_url = $2,
           sort_order = $3,
           status = $4,
           updated_at = NOW()
       WHERE id = $5
         AND status <> 2
       RETURNING ${CUSTOMER_LOGO_COLUMNS}`,
      [name, logoUrl, sortOrder, status, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer logo not found.',
      });
    }

    return res.json({
      success: true,
      message: 'Customer logo updated successfully.',
      customerLogo: toApiCustomerLogo(rows[0]),
    });
  } catch (err) {
    console.error('Update Customer Logo Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to update customer logo.',
    });
  }
};

/* Soft-delete a customer logo by setting status = 2 */
export const deleteCustomerLogo = async (req, res) => {
  try {
    const id = parseId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'A valid customer logo ID is required.',
      });
    }

    const { rowCount } = await db.query(
      `UPDATE customer_logos
       SET status = 2,
           updated_at = NOW()
       WHERE id = $1
         AND status <> 2`,
      [id]
    );

    if (rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Customer logo not found or already deleted.',
      });
    }

    return res.json({
      success: true,
      message: 'Customer logo deleted successfully.',
      id,
    });
  } catch (err) {
    console.error('Delete Customer Logo Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to delete customer logo.',
    });
  }
};
