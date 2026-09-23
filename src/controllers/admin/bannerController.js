import db from '../../config/db.js';

// 1. Get All Banners (Admin)
export const getBanners = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        id,
        title,
        subtitle,
        cta_text AS "ctaText",
        cta_link AS "ctaLink",
        secondary_text AS "secondaryText",
        secondary_link AS "secondaryLink",
        image_url AS "imageUrl",
        sort_order AS "sortOrder",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM banners
      WHERE status != 2
      ORDER BY sort_order ASC, id ASC
    `);

    const banners = rows.map((b) => ({
      ...b,
      status: b.status === 1 ? 'Active' : 'Inactive',
    }));

    return res.json({
      success: true,
      count: banners.length,
      banners,
    });
  } catch (err) {
    console.error('Get Banners Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch banners.' });
  }
};

// 2. Get Public Active Banners (Storefront)
export const getPublicBanners = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        id,
        title,
        subtitle,
        cta_text AS "ctaText",
        cta_link AS "ctaLink",
        secondary_text AS "secondaryText",
        secondary_link AS "secondaryLink",
        image_url AS "imageUrl",
        sort_order AS "sortOrder"
      FROM banners
      WHERE status = 1
      ORDER BY sort_order ASC, id ASC
    `);

    return res.json({
      success: true,
      count: rows.length,
      banners: rows,
    });
  } catch (err) {
    console.error('Get Public Banners Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch active banners.' });
  }
};

// 3. Create Banner (Admin)
export const createBanner = async (req, res) => {
  try {
    const {
      title,
      subtitle,
      ctaText,
      ctaLink,
      secondaryText,
      secondaryLink,
      imageUrl,
      sortOrder,
      status,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Banner title is required.' });
    }

    if (!imageUrl || !imageUrl.trim()) {
      return res.status(400).json({ success: false, message: 'Banner image URL is required.' });
    }

    const statusInt = (status === 1 || status === '1' || status === true || String(status || 'Active').toLowerCase() === 'active') ? 1 : 0;
    const orderInt = parseInt(sortOrder, 10) || 0;

    const { rows } = await db.query(
      `INSERT INTO banners 
       (title, subtitle, cta_text, cta_link, secondary_text, secondary_link, image_url, sort_order, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING id, title, subtitle, cta_text AS "ctaText", cta_link AS "ctaLink", 
                 secondary_text AS "secondaryText", secondary_link AS "secondaryLink", 
                 image_url AS "imageUrl", sort_order AS "sortOrder", status, created_at AS "createdAt"`,
      [
        title.trim(),
        subtitle || '',
        ctaText || 'Explore Hardware',
        ctaLink || '/user/products',
        secondaryText || '',
        secondaryLink || '',
        imageUrl.trim(),
        orderInt,
        statusInt,
      ]
    );

    const created = rows[0];
    created.status = created.status === 1 ? 'Active' : 'Inactive';

    return res.status(201).json({
      success: true,
      message: 'Banner created successfully.',
      banner: created,
    });
  } catch (err) {
    console.error('Create Banner Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create banner.' });
  }
};

// 4. Update Banner (Admin)
export const updateBanner = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      subtitle,
      ctaText,
      ctaLink,
      secondaryText,
      secondaryLink,
      imageUrl,
      sortOrder,
      status,
    } = req.body;

    const checkRes = await db.query('SELECT id FROM banners WHERE id = $1 AND status != 2', [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Banner not found.' });
    }

    const statusInt = (status === 1 || status === '1' || status === true || String(status || 'Active').toLowerCase() === 'active') ? 1 : 0;
    const orderInt = parseInt(sortOrder, 10) || 0;

    const { rows } = await db.query(
      `UPDATE banners
       SET title = $1,
           subtitle = $2,
           cta_text = $3,
           cta_link = $4,
           secondary_text = $5,
           secondary_link = $6,
           image_url = $7,
           sort_order = $8,
           status = $9,
           updated_at = NOW()
       WHERE id = $10
       RETURNING id, title, subtitle, cta_text AS "ctaText", cta_link AS "ctaLink", 
                 secondary_text AS "secondaryText", secondary_link AS "secondaryLink", 
                 image_url AS "imageUrl", sort_order AS "sortOrder", status, updated_at AS "updatedAt"`,
      [
        title ? title.trim() : 'Banner',
        subtitle || '',
        ctaText || 'Explore Hardware',
        ctaLink || '/user/products',
        secondaryText || '',
        secondaryLink || '',
        imageUrl ? imageUrl.trim() : '/hero-banner-1.png',
        orderInt,
        statusInt,
        id,
      ]
    );

    const updated = rows[0];
    updated.status = updated.status === 1 ? 'Active' : 'Inactive';

    return res.json({
      success: true,
      message: 'Banner updated successfully.',
      banner: updated,
    });
  } catch (err) {
    console.error('Update Banner Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update banner.' });
  }
};

// 5. Delete Banner (Soft Delete, status = 2)
export const deleteBanner = async (req, res) => {
  try {
    const { id } = req.params;

    const { rowCount } = await db.query(
      `UPDATE banners SET status = 2, updated_at = NOW() WHERE id = $1 AND status != 2`,
      [id]
    );

    if (rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Banner not found or already deleted.' });
    }

    return res.json({
      success: true,
      message: 'Banner deleted successfully.',
      id: parseInt(id, 10),
    });
  } catch (err) {
    console.error('Delete Banner Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete banner.' });
  }
};
