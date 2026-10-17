import db from '../../config/db.js';

const BRAND_LOGO_COLUMNS = `
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

const toApiBrandLogo = (brandLogo) => ({
  ...brandLogo,
  status: Number(brandLogo.status) === 1 ? 'Active' : 'Inactive',
  sortOrder: Number(brandLogo.sortOrder ?? 0),
});

/* Get all non-deleted logos for the admin */
export const getBrandLogos = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT ${BRAND_LOGO_COLUMNS}
      FROM brand_logos
      WHERE status <> 2
      ORDER BY sort_order ASC, id ASC
    `);

    const brandLogos = rows.map(toApiBrandLogo);

    return res.json({
      success: true,
      count: brandLogos.length,
      brandLogos,
    });
  } catch (err) {
    console.error('Get Brand Logos Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch brand logos.',
    });
  }
};

/* Get active logos for the storefront ribbon */
export const getUserBrandLogos = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT ${BRAND_LOGO_COLUMNS}
      FROM brand_logos
      WHERE status = 1
      ORDER BY sort_order ASC, id ASC
    `);

    const brandLogos = rows.map(toApiBrandLogo);

    return res.json({
      success: true,
      count: brandLogos.length,
      brandLogos,
    });
  } catch (err) {
    console.error('Get Public Brand Logos Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch active brand logos.',
    });
  }
};

/* Get one logo */
export const getBrandLogoById = async (req, res) => {
  try {
    const id = parseId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'A valid brand logo ID is required.',
      });
    }

    const { rows } = await db.query(
      `SELECT ${BRAND_LOGO_COLUMNS}
       FROM brand_logos
       WHERE id = $1
         AND status <> 2`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Brand logo not found.',
      });
    }

    return res.json({
      success: true,
      brandLogo: toApiBrandLogo(rows[0]),
    });
  } catch (err) {
    console.error('Get Brand Logo Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch brand logo.',
    });
  }
};

/* Create a logo */
export const createBrandLogo = async (req, res) => {
  try {
    const body = req.body || {};
    const name = text(body.name);
    const logoUrl = text(body.logoUrl);

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Brand name is required.',
      });
    }

    if (!logoUrl) {
      return res.status(400).json({
        success: false,
        message: 'Brand logo URL is required.',
      });
    }

    const status = toStatusInt(body.status, 1);

    if (status === null) {
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
        FROM brand_logos
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
      `INSERT INTO brand_logos (
         name,
         logo_url,
         sort_order,
         status,
         updated_at
       )
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING ${BRAND_LOGO_COLUMNS}`,
      [name, logoUrl, sortOrder, status]
    );

    return res.status(201).json({
      success: true,
      message: 'Brand logo created successfully.',
      brandLogo: toApiBrandLogo(rows[0]),
    });
  } catch (err) {
    console.error('Create Brand Logo Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to create brand logo.',
    });
  }
};

/* Update a logo; omitted fields are preserved */
export const updateBrandLogo = async (req, res) => {
  try {
    const id = parseId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'A valid brand logo ID is required.',
      });
    }

    const body = req.body || {};

    const currentResult = await db.query(
      `SELECT ${BRAND_LOGO_COLUMNS}
       FROM brand_logos
       WHERE id = $1
         AND status <> 2`,
      [id]
    );

    if (currentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Brand logo not found.',
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
        message: 'Brand name is required.',
      });
    }

    if (!logoUrl) {
      return res.status(400).json({
        success: false,
        message: 'Brand logo URL is required.',
      });
    }

    const status = toStatusInt(
      pick('status'),
      Number(current.status) === 1 ? 1 : 0
    );

    if (status === null) {
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
      `UPDATE brand_logos
       SET name = $1,
           logo_url = $2,
           sort_order = $3,
           status = $4,
           updated_at = NOW()
       WHERE id = $5
         AND status <> 2
       RETURNING ${BRAND_LOGO_COLUMNS}`,
      [name, logoUrl, sortOrder, status, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Brand logo not found.',
      });
    }

    return res.json({
      success: true,
      message: 'Brand logo updated successfully.',
      brandLogo: toApiBrandLogo(rows[0]),
    });
  } catch (err) {
    console.error('Update Brand Logo Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to update brand logo.',
    });
  }
};

/* Soft-delete a logo by setting status = 2 */
export const deleteBrandLogo = async (req, res) => {
  try {
    const id = parseId(req.params.id);

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'A valid brand logo ID is required.',
      });
    }

    const { rowCount } = await db.query(
      `UPDATE brand_logos
       SET status = 2,
           updated_at = NOW()
       WHERE id = $1
         AND status <> 2`,
      [id]
    );

    if (rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Brand logo not found or already deleted.',
      });
    }

    return res.json({
      success: true,
      message: 'Brand logo deleted successfully.',
      id,
    });
  } catch (err) {
    console.error('Delete Brand Logo Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to delete brand logo.',
    });
  }
};