const db = require('../config/db');

// Helper to generate URL-safe slugs
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// 1. Raw SQL Get Main Categories
async function getCategories(req, res) {
  try {
    const result = await db.query(`
      SELECT 
        c.id,
        c.name,
        c.slug,
        c.code,
        c.image_url AS image,
        c.status,
        c.created_at AS "createdAt",
        (SELECT COUNT(*)::int FROM products p WHERE p.category_id = c.id) AS "productCount"
      FROM categories c
      WHERE c.parent_id IS NULL
      ORDER BY c.id ASC
    `);

    // Map status integer to string badge
    const categories = result.rows.map((cat) => ({
      ...cat,
      status: cat.status === 1 ? 'Active' : 'Inactive',
    }));

    return res.json({
      success: true,
      count: categories.length,
      categories,
    });
  } catch (err) {
    console.error('Get Categories Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch categories.' });
  }
}

// 2. Raw SQL Create Main Category
async function createCategory(req, res) {
  try {
    const { name, code, image, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Category name is required.' });
    }

    const cleanName = name.trim();
    const baseSlug = slugify(cleanName);
    const slug = `${baseSlug}-${Date.now().toString().slice(-4)}`;
    
    // Ensure 4-digit numeric code
    const rawCode = String(code || '').replace(/\D/g, '');
    const finalCode = rawCode.length === 4
      ? rawCode
      : Math.floor(1000 + Math.random() * 9000).toString();

    const statusInt = String(status || 'Active').toLowerCase() === 'active' ? 1 : 0;
    const imageUrl = image && String(image).trim() ? String(image).trim() : null;

    const insertResult = await db.query(
      `INSERT INTO categories (name, slug, code, image_url, status, parent_id)
       VALUES ($1, $2, $3, $4, $5, NULL)
       RETURNING id, name, slug, code, image_url AS image, status, created_at AS "createdAt"`,
      [cleanName, slug, finalCode, imageUrl, statusInt]
    );

    const created = insertResult.rows[0];
    created.status = created.status === 1 ? 'Active' : 'Inactive';
    created.productCount = 0;

    return res.status(201).json({
      success: true,
      message: 'Category created successfully.',
      category: created,
    });
  } catch (err) {
    console.error('Create Category Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create category.' });
  }
}

// 3. Raw SQL Update Category
async function updateCategory(req, res) {
  try {
    const { id } = req.params;
    const { name, code, image, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Category name is required.' });
    }

    const cleanName = name.trim();
    const slug = slugify(cleanName);
    const rawCode = String(code || '').replace(/\D/g, '');
    const finalCode = rawCode.length === 4 ? rawCode : '1001';
    const statusInt = String(status || 'Active').toLowerCase() === 'active' ? 1 : 0;
    const imageUrl = image && String(image).trim() ? String(image).trim() : null;

    const updateResult = await db.query(
      `UPDATE categories
       SET name = $1, slug = $2, code = $3, image_url = $4, status = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING id, name, slug, code, image_url AS image, status, parent_id`,
      [cleanName, slug, finalCode, imageUrl, statusInt, id]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    const updated = updateResult.rows[0];
    updated.status = updated.status === 1 ? 'Active' : 'Inactive';

    return res.json({
      success: true,
      message: 'Category updated successfully.',
      category: updated,
    });
  } catch (err) {
    console.error('Update Category Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update category.' });
  }
}

// 4. Raw SQL Delete Category
async function deleteCategory(req, res) {
  try {
    const { id } = req.params;

    const deleteResult = await db.query('DELETE FROM categories WHERE id = $1 RETURNING id', [id]);

    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    return res.json({
      success: true,
      message: `Category ${id} deleted successfully.`,
    });
  } catch (err) {
    console.error('Delete Category Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete category.' });
  }
}

// 5. Raw SQL Get Sub-Categories
async function getSubCategories(req, res) {
  try {
    const result = await db.query(`
      SELECT 
        c.id,
        c.name,
        c.slug,
        c.code,
        c.parent_id AS "categoryId",
        p.name AS "categoryName",
        c.image_url AS image,
        c.status
      FROM categories c
      LEFT JOIN categories p ON c.parent_id = p.id
      WHERE c.parent_id IS NOT NULL
      ORDER BY c.id ASC
    `);

    const subCategories = result.rows.map((sub) => ({
      ...sub,
      status: sub.status === 1 ? 'Active' : 'Inactive',
    }));

    return res.json({
      success: true,
      count: subCategories.length,
      subCategories,
    });
  } catch (err) {
    console.error('Get SubCategories Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch sub-categories.' });
  }
}

// 6. Raw SQL Create Sub-Category
async function createSubCategory(req, res) {
  try {
    const { name, categoryId, categoryName, code, image, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Sub-category name is required.' });
    }

    const cleanName = name.trim();
    const slug = `${slugify(cleanName)}-${Date.now().toString().slice(-4)}`;

    const rawCode = String(code || '').replace(/\D/g, '');
    const finalCode = rawCode.length === 4
      ? rawCode
      : Math.floor(2000 + Math.random() * 8000).toString();

    const statusInt = String(status || 'Active').toLowerCase() === 'active' ? 1 : 0;
    const imageUrl = image && String(image).trim() ? String(image).trim() : null;

    // Resolve parent_id if categoryId or categoryName provided
    let parentId = categoryId ? parseInt(categoryId, 10) : null;
    if (!parentId && categoryName) {
      const parentRes = await db.query('SELECT id FROM categories WHERE LOWER(name) = LOWER($1)', [categoryName]);
      if (parentRes.rows.length > 0) {
        parentId = parentRes.rows[0].id;
      }
    }

    const insertResult = await db.query(
      `INSERT INTO categories (name, slug, code, image_url, status, parent_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, slug, code, image_url AS image, status, parent_id AS "categoryId"`,
      [cleanName, slug, finalCode, imageUrl, statusInt, parentId]
    );

    const created = insertResult.rows[0];
    created.status = created.status === 1 ? 'Active' : 'Inactive';
    created.categoryName = categoryName || 'General';

    return res.status(201).json({
      success: true,
      message: 'Sub-category created successfully.',
      subCategory: created,
    });
  } catch (err) {
    console.error('Create SubCategory Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create sub-category.' });
  }
}

// 7. Raw SQL Delete Sub-Category
async function deleteSubCategory(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM categories WHERE id = $1 AND parent_id IS NOT NULL RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Sub-category not found.' });
    }

    return res.json({
      success: true,
      message: `Sub-category ${id} deleted successfully.`,
    });
  } catch (err) {
    console.error('Delete SubCategory Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete sub-category.' });
  }
}

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getSubCategories,
  createSubCategory,
  deleteSubCategory,
};
