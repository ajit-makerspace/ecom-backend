
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

// Kit Showcase type
const KIT_SHOWCASE_TYPE = 1;

// 1. Get All Kit Showcases (Admin)
export const getKitShowcases = async (req, res) => {
  try {
    const { rows } = await db.query(
      `
      SELECT 
        id,
        brand_key AS "kitKey",
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
        type,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM brand_showcases
      WHERE status != 2
        AND type = $1
      ORDER BY sort_order ASC, id ASC
      `,
      [KIT_SHOWCASE_TYPE]
    );

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
    console.error('Get Kit Showcases Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch kit showcases.',
    });
  }
};

// 2. Get Public Active Kit Showcases
export const getPublicKitShowcases = async (req, res) => {
  try {
    const { rows } = await db.query(
      `
      SELECT 
        id,
        brand_key AS "kitKey",
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
        type
      FROM brand_showcases
      WHERE status = 1
        AND type = $1
      ORDER BY sort_order ASC, id ASC
      `,
      [KIT_SHOWCASE_TYPE]
    );

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
    console.error('Get Public Kit Showcases Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch active kit showcases.',
    });
  }
};

// 3. Create Kit Showcase
export const creatKitShowcase = async (req, res) => {
  try {
    const {
      name,
      kitKey,
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
      return res.status(400).json({
        success: false,
        message: 'Kit name is required.',
      });
    }

    const cleanName = name.trim();

    const finalKitKey =
      kitKey && kitKey.trim()
        ? slugify(kitKey)
        : `${slugify(cleanName)}-${Date.now().toString().slice(-4)}`;

    const statusInt =
      status === 1 ||
      status === '1' ||
      status === true ||
      String(status || 'Active').toLowerCase() === 'active'
        ? 1
        : 0;

    const orderInt = parseInt(sortOrder, 10) || 0;

    const productsJson = Array.isArray(products)
      ? JSON.stringify(products)
      : '[]';

    // Always force Kit Showcase type
    const typeInt = KIT_SHOWCASE_TYPE;

    const { rows } = await db.query(
      `
      INSERT INTO brand_showcases
      (
        brand_key,
        name,
        tagline,
        description,
        badge_text,
        accent_color,
        logo_url,
        bg_image_url,
        shop_link,
        products,
        sort_order,
        status,
        type,
        updated_at
      )
      VALUES
      (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10::jsonb,
        $11,
        $12,
        $13,
        NOW()
      )
      RETURNING
        id,
        brand_key AS "kitKey",
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
        type,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      `,
      [
        finalKitKey,
        cleanName,
        tagline || '',
        description || '',
        badgeText || '',
        accentColor || '#0071e3',
        logoUrl || null,
        bgImageUrl || null,
        shopLink ||
          `/user/products?kit=${encodeURIComponent(cleanName)}`,
        productsJson,
        orderInt,
        statusInt,
        typeInt,
      ]
    );

    const created = rows[0];

    created.status = created.status === 1 ? 'Active' : 'Inactive';

    created.products = Array.isArray(created.products)
      ? created.products
      : [];

    return res.status(201).json({
      success: true,
      message: 'Kit showcase created successfully.',
      showcase: created,
    });
  } catch (err) {
    console.error('Create Kit Showcase Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to create kit showcase.',
    });
  }
};

// 4. Update Kit Showcase
export const updateKitShowcase = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      name,
      kitKey,
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

    // Make sure the record is actually a Kit Showcase
    const checkRes = await db.query(
      `
      SELECT id, brand_key
      FROM brand_showcases
      WHERE id = $1
        AND status != 2
        AND type = $2
      `,
      [id, KIT_SHOWCASE_TYPE]
    );

    if (checkRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kit showcase not found.',
      });
    }

    const cleanName =
      name && name.trim() ? name.trim() : 'Kit Showcase';

    const finalKitKey =
      kitKey && kitKey.trim()
        ? slugify(kitKey)
        : checkRes.rows[0].brand_key;

    const statusInt =
      status === 1 ||
      status === '1' ||
      status === true ||
      String(status || 'Active').toLowerCase() === 'active'
        ? 1
        : 0;

    const orderInt = parseInt(sortOrder, 10) || 0;

    const productsJson = Array.isArray(products)
      ? JSON.stringify(products)
      : '[]';

    const { rows } = await db.query(
      `
      UPDATE brand_showcases
      SET
        brand_key = $1,
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
        type = $13,
        updated_at = NOW()
      WHERE id = $14
        AND type = $13
      RETURNING
        id,
        brand_key AS "kitKey",
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
        type,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      `,
      [
        finalKitKey,
        cleanName,
        tagline || '',
        description || '',
        badgeText || '',
        accentColor || '#0071e3',
        logoUrl || null,
        bgImageUrl || null,
        shopLink ||
          `/user/products?kit=${encodeURIComponent(cleanName)}`,
        productsJson,
        orderInt,
        statusInt,
        KIT_SHOWCASE_TYPE,
        id,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kit showcase not found.',
      });
    }

    const updated = rows[0];

    updated.status = updated.status === 1 ? 'Active' : 'Inactive';

    updated.products = Array.isArray(updated.products)
      ? updated.products
      : [];

    return res.json({
      success: true,
      message: 'Kit showcase updated successfully.',
      showcase: updated,
    });
  } catch (err) {
    console.error('Update Kit Showcase Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to update kit showcase.',
    });
  }
};

// 5. Delete Kit Showcase (Soft Delete)
export const deleteKitShowcase = async (req, res) => {
  try {
    const { id } = req.params;

    const { rowCount } = await db.query(
      `
      UPDATE brand_showcases
      SET
        status = 2,
        updated_at = NOW()
      WHERE id = $1
        AND status != 2
        AND type = $2
      `,
      [id, KIT_SHOWCASE_TYPE]
    );

    if (rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Kit showcase not found or already deleted.',
      });
    }

    return res.json({
      success: true,
      message: 'Kit showcase deleted successfully.',
      id: parseInt(id, 10),
    });
  } catch (err) {
    console.error('Delete Kit Showcase Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to delete kit showcase.',
    });
  }
};
