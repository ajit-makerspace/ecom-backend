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
      ORDER BY c.id ASC
    `);

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

    const rawCode = String(code || '').replace(/\D/g, '');
    const finalCode = rawCode.length === 4
      ? rawCode
      : Math.floor(1000 + Math.random() * 9000).toString();

    const statusInt = String(status || 'Active').toLowerCase() === 'active' ? 1 : 0;
    const imageUrl = image && String(image).trim() ? String(image).trim() : null;

    const insertResult = await db.query(
      `INSERT INTO categories (name, slug, code, image_url, status)
       VALUES ($1, $2, $3, $4, $5)
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
    const slug = `${slugify(cleanName)}-${Date.now().toString().slice(-4)}`;
    const rawCode = String(code || '').replace(/\D/g, '');
    const finalCode = rawCode.length === 4 ? rawCode : '1001';
    const statusInt = String(status || 'Active').toLowerCase() === 'active' ? 1 : 0;
    const imageUrl = image && String(image).trim() ? String(image).trim() : null;

    const updateResult = await db.query(
      `UPDATE categories
       SET name = $1, slug = $2, code = $3, image_url = $4, status = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING id, name, slug, code, image_url AS image, status`,
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
        s.id,
        s.name,
        s.slug,
        s.code,
        s.category_id AS "categoryId",
        c.name AS "categoryName",
        s.image_url AS image,
        s.status
      FROM subcategories s
      LEFT JOIN categories c ON s.category_id = c.id
      ORDER BY s.id ASC
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

    // Resolve parent category_id
    let parentId = categoryId ? parseInt(categoryId, 10) : null;
    let parentName = categoryName || 'General';

    if (!parentId && categoryName) {
      const parentRes = await db.query('SELECT id, name FROM categories WHERE LOWER(name) = LOWER($1)', [categoryName.trim()]);
      if (parentRes.rows.length > 0) {
        parentId = parentRes.rows[0].id;
        parentName = parentRes.rows[0].name;
      }
    }

    if (!parentId) {
      const firstCat = await db.query('SELECT id, name FROM categories ORDER BY id ASC LIMIT 1');
      if (firstCat.rows.length > 0) {
        parentId = firstCat.rows[0].id;
        parentName = firstCat.rows[0].name;
      } else {
        const newParent = await db.query(
          `INSERT INTO categories (name, slug, code, status) VALUES ('General', 'general', '1001', 1) RETURNING id, name`
        );
        parentId = newParent.rows[0].id;
        parentName = newParent.rows[0].name;
      }
    }

    const insertResult = await db.query(
      `INSERT INTO subcategories (name, slug, code, image_url, status, category_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, slug, code, image_url AS image, status, category_id AS "categoryId"`,
      [cleanName, slug, finalCode, imageUrl, statusInt, parentId]
    );

    const created = insertResult.rows[0];
    created.status = created.status === 1 ? 'Active' : 'Inactive';
    created.categoryName = parentName;

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

// 7. Raw SQL Update Sub-Category
async function updateSubCategory(req, res) {
  try {
    const { id } = req.params;
    const { name, categoryId, categoryName, code, image, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Sub-category name is required.' });
    }

    const cleanName = name.trim();
    const slug = `${slugify(cleanName)}-${Date.now().toString().slice(-4)}`;
    const rawCode = String(code || '').replace(/\D/g, '');
    const finalCode = rawCode.length === 4 ? rawCode : '2001';
    const statusInt = String(status || 'Active').toLowerCase() === 'active' ? 1 : 0;
    const imageUrl = image && String(image).trim() ? String(image).trim() : null;

    // Resolve parent category_id
    let parentId = categoryId ? parseInt(categoryId, 10) : null;
    let parentName = categoryName || 'General';

    if (!parentId && categoryName) {
      const parentRes = await db.query('SELECT id, name FROM categories WHERE LOWER(name) = LOWER($1)', [categoryName.trim()]);
      if (parentRes.rows.length > 0) {
        parentId = parentRes.rows[0].id;
        parentName = parentRes.rows[0].name;
      }
    }

    if (!parentId) {
      const firstCat = await db.query('SELECT id, name FROM categories ORDER BY id ASC LIMIT 1');
      if (firstCat.rows.length > 0) {
        parentId = firstCat.rows[0].id;
        parentName = firstCat.rows[0].name;
      }
    }

    const updateResult = await db.query(
      `UPDATE subcategories
       SET name = $1, slug = $2, code = $3, image_url = $4, status = $5, category_id = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING id, name, slug, code, image_url AS image, status, category_id AS "categoryId"`,
      [cleanName, slug, finalCode, imageUrl, statusInt, parentId, id]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Sub-category not found.' });
    }

    const updated = updateResult.rows[0];
    updated.status = updated.status === 1 ? 'Active' : 'Inactive';
    updated.categoryName = parentName;

    return res.json({
      success: true,
      message: 'Sub-category updated successfully.',
      subCategory: updated,
    });
  } catch (err) {
    console.error('Update SubCategory Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update sub-category.' });
  }
}

// 8. Raw SQL Delete Sub-Category
async function deleteSubCategory(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM subcategories WHERE id = $1 RETURNING id', [id]);

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

// 8. Bulk Import Main Categories (Transactional)
async function bulkImportCategories(req, res) {
  const client = await db.pool.connect();
  try {
    const { categories } = req.body;
    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid categories provided for bulk import.' });
    }

    await client.query('BEGIN');

    const importedCategories = [];
    let skippedCount = 0;

    for (let i = 0; i < categories.length; i++) {
      const item = categories[i];
      if (!item || !item.name || !item.name.trim()) {
        skippedCount++;
        continue;
      }

      const cleanName = item.name.trim();
      const baseSlug = slugify(cleanName);
      const slug = `${baseSlug}-${Date.now().toString().slice(-4)}-${i}`;

      const rawCode = String(item.code || '').replace(/\D/g, '');
      const finalCode = rawCode.length === 4
        ? rawCode
        : Math.floor(1000 + Math.random() * 9000).toString();

      const statusInt = String(item.status || 'Active').toLowerCase() === 'active' ? 1 : 0;
      const imageUrl = item.image && String(item.image).trim() ? String(item.image).trim() : null;

      const insertRes = await client.query(
        `INSERT INTO categories (name, slug, code, image_url, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, name, slug, code, image_url AS image, status, created_at AS "createdAt"`,
        [cleanName, slug, finalCode, imageUrl, statusInt]
      );

      const created = insertRes.rows[0];
      created.status = created.status === 1 ? 'Active' : 'Inactive';
      created.productCount = 0;
      importedCategories.push(created);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: `Successfully imported ${importedCategories.length} categories.`,
      count: importedCategories.length,
      skipped: skippedCount,
      categories: importedCategories,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk Import Categories Error:', err);
    return res.status(500).json({ success: false, message: 'Bulk category import failed.' });
  } finally {
    client.release();
  }
}

// 9. Bulk Import Sub-Categories (Transactional)
async function bulkImportSubCategories(req, res) {
  const client = await db.pool.connect();
  try {
    const { subCategories } = req.body;
    if (!Array.isArray(subCategories) || subCategories.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid sub-categories provided for bulk import.' });
    }

    await client.query('BEGIN');

    const importedSubCategories = [];
    let skippedCount = 0;

    for (let i = 0; i < subCategories.length; i++) {
      const item = subCategories[i];
      if (!item || !item.name || !item.name.trim()) {
        skippedCount++;
        continue;
      }

      const cleanName = item.name.trim();
      const slug = `${slugify(cleanName)}-${Date.now().toString().slice(-4)}-${i}`;

      const rawCode = String(item.code || '').replace(/\D/g, '');
      const finalCode = rawCode.length === 4
        ? rawCode
        : Math.floor(2000 + Math.random() * 8000).toString();

      const statusInt = String(item.status || 'Active').toLowerCase() === 'active' ? 1 : 0;
      const imageUrl = item.image && String(item.image).trim() ? String(item.image).trim() : null;

      let parentId = item.categoryId ? parseInt(item.categoryId, 10) : null;
      let parentName = item.categoryName || 'General';

      if (!parentId && parentName) {
        const parentRes = await client.query('SELECT id, name FROM categories WHERE LOWER(name) = LOWER($1)', [parentName.trim()]);
        if (parentRes.rows.length > 0) {
          parentId = parentRes.rows[0].id;
          parentName = parentRes.rows[0].name;
        }
      }

      if (!parentId) {
        const firstCat = await client.query('SELECT id, name FROM categories ORDER BY id ASC LIMIT 1');
        if (firstCat.rows.length > 0) {
          parentId = firstCat.rows[0].id;
          parentName = firstCat.rows[0].name;
        } else {
          const newParent = await client.query(
            `INSERT INTO categories (name, slug, code, status) VALUES ('General', 'general', '1001', 1) RETURNING id, name`
          );
          parentId = newParent.rows[0].id;
          parentName = newParent.rows[0].name;
        }
      }

      const insertRes = await client.query(
        `INSERT INTO subcategories (name, slug, code, image_url, status, category_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, slug, code, image_url AS image, status, category_id AS "categoryId"`,
        [cleanName, slug, finalCode, imageUrl, statusInt, parentId]
      );

      const created = insertRes.rows[0];
      created.status = created.status === 1 ? 'Active' : 'Inactive';
      created.categoryName = parentName;
      importedSubCategories.push(created);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: `Successfully imported ${importedSubCategories.length} sub-categories.`,
      count: importedSubCategories.length,
      skipped: skippedCount,
      subCategories: importedSubCategories,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk Import SubCategories Error:', err);
    return res.status(500).json({ success: false, message: 'Bulk sub-category import failed.' });
  } finally {
    client.release();
  }
}

module.exports = {
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getSubCategories,
  createSubCategory,
  updateSubCategory,
  deleteSubCategory,
  bulkImportCategories,
  bulkImportSubCategories,
};
