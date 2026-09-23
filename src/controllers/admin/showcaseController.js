import db from '../../config/db.js';

// Helper to generate URL-safe slugs
const slugify = (text) => {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

// 1. Get All Brand Showcases (Admin)
export const getShowcases = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        id,
        brand_key AS "brandKey",
        name,
        tagline,
        description,
        badge_text AS "badgeText",
        accent_color AS "accentColor",
        logo_url AS "logoUrl",
        bg_image_url AS "bgImageUrl",
        shop_link AS "shopLink",
        products,
        sort_order AS "sortOrder",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM brand_showcases
      WHERE status != 2
      ORDER BY sort_order ASC, id ASC
    `);

    const showcases = rows.map((s) => ({
      ...s,
      status: s.status === 1 ? 'Active' : 'Inactive',
      products: Array.isArray(s.products) ? s.products : [],
      productCount: Array.isArray(s.products) ? s.products.length : 0,
    }));

    return res.json({
      success: true,
      count: showcases.length,
      showcases,
    });
  } catch (err) {
    console.error('Get Showcases Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch brand showcases.' });
  }
};

// 2. Get Public Active Showcases (Storefront rotation)
export const getPublicShowcases = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        id,
        brand_key AS "brandKey",
        name,
        tagline,
        description,
        badge_text AS "badgeText",
        accent_color AS "accentColor",
        logo_url AS "logoUrl",
        bg_image_url AS "bgImageUrl",
        shop_link AS "shopLink",
        products,
        sort_order AS "sortOrder"
      FROM brand_showcases
      WHERE status = 1
      ORDER BY sort_order ASC, id ASC
    `);

    const showcases = rows.map((s) => ({
      ...s,
      products: Array.isArray(s.products) ? s.products : [],
    }));

    return res.json({
      success: true,
      count: showcases.length,
      showcases,
    });
  } catch (err) {
    console.error('Get Public Showcases Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch active showcases.' });
  }
};

// 3. Create Brand Showcase (Admin)
export const createShowcase = async (req, res) => {
  try {
    const {
      name,
      brandKey,
      tagline,
      description,
      badgeText,
      accentColor,
      logoUrl,
      bgImageUrl,
      shopLink,
      products,
      sortOrder,
      status,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Brand name is required.' });
    }

    const cleanName = name.trim();
    const finalBrandKey = (brandKey && brandKey.trim())
      ? slugify(brandKey)
      : `${slugify(cleanName)}-${Date.now().toString().slice(-4)}`;

    const statusInt = (status === 1 || status === '1' || status === true || String(status || 'Active').toLowerCase() === 'active') ? 1 : 0;
    const orderInt = parseInt(sortOrder, 10) || 0;
    const productsJson = Array.isArray(products) ? JSON.stringify(products) : '[]';

    const { rows } = await db.query(
      `INSERT INTO brand_showcases
       (brand_key, name, tagline, description, badge_text, accent_color, logo_url, bg_image_url, shop_link, products, sort_order, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, NOW())
       RETURNING id, brand_key AS "brandKey", name, tagline, description, badge_text AS "badgeText", 
                 accent_color AS "accentColor", logo_url AS "logoUrl", bg_image_url AS "bgImageUrl", 
                 shop_link AS "shopLink", products, sort_order AS "sortOrder", status, created_at AS "createdAt"`,
      [
        finalBrandKey,
        cleanName,
        tagline || '',
        description || '',
        badgeText || '',
        accentColor || '#0071e3',
        logoUrl || null,
        bgImageUrl || null,
        shopLink || `/user/products?brand=${encodeURIComponent(cleanName)}`,
        productsJson,
        orderInt,
        statusInt,
      ]
    );

    const created = rows[0];
    created.status = created.status === 1 ? 'Active' : 'Inactive';
    created.products = Array.isArray(created.products) ? created.products : [];

    return res.status(201).json({
      success: true,
      message: 'Brand showcase created successfully.',
      showcase: created,
    });
  } catch (err) {
    console.error('Create Showcase Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create brand showcase.' });
  }
};

// 4. Update Brand Showcase (Admin)
export const updateShowcase = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      brandKey,
      tagline,
      description,
      badgeText,
      accentColor,
      logoUrl,
      bgImageUrl,
      shopLink,
      products,
      sortOrder,
      status,
    } = req.body;

    const checkRes = await db.query('SELECT id, brand_key FROM brand_showcases WHERE id = $1 AND status != 2', [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Brand showcase not found.' });
    }

    const cleanName = (name && name.trim()) ? name.trim() : 'Brand Showcase';
    const finalBrandKey = (brandKey && brandKey.trim()) ? slugify(brandKey) : checkRes.rows[0].brand_key;
    const statusInt = (status === 1 || status === '1' || status === true || String(status || 'Active').toLowerCase() === 'active') ? 1 : 0;
    const orderInt = parseInt(sortOrder, 10) || 0;
    const productsJson = Array.isArray(products) ? JSON.stringify(products) : '[]';

    const { rows } = await db.query(
      `UPDATE brand_showcases
       SET brand_key = $1,
           name = $2,
           tagline = $3,
           description = $4,
           badge_text = $5,
           accent_color = $6,
           logo_url = $7,
           bg_image_url = $8,
           shop_link = $9,
           products = $10::jsonb,
           sort_order = $11,
           status = $12,
           updated_at = NOW()
       WHERE id = $13
       RETURNING id, brand_key AS "brandKey", name, tagline, description, badge_text AS "badgeText", 
                 accent_color AS "accentColor", logo_url AS "logoUrl", bg_image_url AS "bgImageUrl", 
                 shop_link AS "shopLink", products, sort_order AS "sortOrder", status, updated_at AS "updatedAt"`,
      [
        finalBrandKey,
        cleanName,
        tagline || '',
        description || '',
        badgeText || '',
        accentColor || '#0071e3',
        logoUrl || null,
        bgImageUrl || null,
        shopLink || `/user/products?brand=${encodeURIComponent(cleanName)}`,
        productsJson,
        orderInt,
        statusInt,
        id,
      ]
    );

    const updated = rows[0];
    updated.status = updated.status === 1 ? 'Active' : 'Inactive';
    updated.products = Array.isArray(updated.products) ? updated.products : [];

    return res.json({
      success: true,
      message: 'Brand showcase updated successfully.',
      showcase: updated,
    });
  } catch (err) {
    console.error('Update Showcase Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update brand showcase.' });
  }
};

// 5. Delete Brand Showcase (Soft Delete, status = 2)
export const deleteShowcase = async (req, res) => {
  try {
    const { id } = req.params;

    const { rowCount } = await db.query(
      `UPDATE brand_showcases SET status = 2, updated_at = NOW() WHERE id = $1 AND status != 2`,
      [id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Brand showcase not found or already deleted.' });
    }

    return res.json({
      success: true,
      message: 'Brand showcase deleted successfully.',
      id: parseInt(id, 10),
    });
  } catch (err) {
    console.error('Delete Showcase Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete brand showcase.' });
  }
};
