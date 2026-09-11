import db from '../config/db.js';

// Helper to generate URL-safe slugs
const slugify = (text) => {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

// 1. Raw SQL Get Main Categories (joined with Modules, excluding status = 2)
export const getCategories = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        c.id,
        c.name,
        c.slug,
        c.code,
        c.module_id AS "moduleId",
        m.name AS "moduleName",
        c.image_url AS image,
        c.status,
        c.created_at AS "createdAt",
        (SELECT COUNT(*)::int FROM products p WHERE p.category_id = c.id AND p.status != 2) AS "productCount"
      FROM categories c
      LEFT JOIN modules m ON c.module_id = m.id AND m.status != 2
      WHERE c.status != 2
      ORDER BY c.id ASC
    `);

    const categories = rows.map((cat) => ({
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
};

// Helper to generate next unique 4-digit Category code (1001, 1002, 1003...)
const getNextCategoryCode = async (clientOrDb = db) => {
  try {
    const { rows } = await clientOrDb.query(
      `SELECT code FROM categories WHERE code ~ '^\\d{4}$' ORDER BY CAST(code AS INTEGER) DESC LIMIT 1`
    );
    if (rows.length > 0 && rows[0].code) {
      const nextNum = parseInt(rows[0].code, 10) + 1;
      return String(nextNum).padStart(4, '0');
    }
    return '1001';
  } catch (err) {
    return Math.floor(1001 + Math.random() * 8999).toString();
  }
};

// Helper to generate next unique 4-digit SubCategory code (2001, 2002, 2003...)
const getNextSubCategoryCode = async (clientOrDb = db) => {
  try {
    const { rows } = await clientOrDb.query(
      `SELECT code FROM subcategories WHERE code ~ '^\\d{4}$' ORDER BY CAST(code AS INTEGER) DESC LIMIT 1`
    );
    if (rows.length > 0 && rows[0].code) {
      const nextNum = parseInt(rows[0].code, 10) + 1;
      return String(nextNum).padStart(4, '0');
    }
    return '2001';
  } catch (err) {
    return Math.floor(2001 + Math.random() * 7999).toString();
  }
};

// 2. Raw SQL Create Main Category
export const createCategory = async (req, res) => {
  try {
    const { name, code, image, status, moduleId, moduleName } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Category name is required.' });
    }

    const cleanName = name.trim();
    const baseSlug = slugify(cleanName);
    const slug = `${baseSlug}-${Date.now().toString().slice(-4)}`;

    const rawCode = String(code || '').replace(/\D/g, '');
    const finalCode = rawCode.length === 4
      ? rawCode
      : await getNextCategoryCode();

    const statusInt = String(status || 'Active').toLowerCase() === 'active' ? 1 : 0;
    const imageUrl = image && String(image).trim() ? String(image).trim() : null;

    // Resolve parent module_id
    let parentModuleId = moduleId ? parseInt(moduleId, 10) : null;
    let parentModuleName = moduleName || '';

    if (!parentModuleId && moduleName) {
      const modRes = await db.query('SELECT id, name FROM modules WHERE LOWER(name) = LOWER($1)', [moduleName.trim()]);
      if (modRes.rows.length > 0) {
        parentModuleId = modRes.rows[0].id;
        parentModuleName = modRes.rows[0].name;
      }
    }

    if (!parentModuleId) {
      const firstMod = await db.query('SELECT id, name FROM modules ORDER BY id ASC LIMIT 1');
      if (firstMod.rows.length > 0) {
        parentModuleId = firstMod.rows[0].id;
        parentModuleName = firstMod.rows[0].name;
      }
    }

    const { rows } = await db.query(
      `INSERT INTO categories (name, slug, code, image_url, status, module_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, slug, code, module_id AS "moduleId", image_url AS image, status, created_at AS "createdAt"`,
      [cleanName, slug, finalCode, imageUrl, statusInt, parentModuleId]
    );

    const created = rows[0];
    created.status = created.status === 1 ? 'Active' : 'Inactive';
    created.moduleName = parentModuleName;
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
};

// 3. Raw SQL Update Category
export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, image, status, moduleId, moduleName } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Category name is required.' });
    }

    const cleanName = name.trim();
    const slug = `${slugify(cleanName)}-${Date.now().toString().slice(-4)}`;
    const rawCode = String(code || '').replace(/\D/g, '');
    const finalCode = rawCode.length === 4 ? rawCode : '1001';
    const statusInt = String(status || 'Active').toLowerCase() === 'active' ? 1 : 0;
    const imageUrl = image && String(image).trim() ? String(image).trim() : null;

    let parentModuleId = moduleId ? parseInt(moduleId, 10) : null;
    let parentModuleName = moduleName || '';

    if (!parentModuleId && moduleName) {
      const modRes = await db.query('SELECT id, name FROM modules WHERE LOWER(name) = LOWER($1)', [moduleName.trim()]);
      if (modRes.rows.length > 0) {
        parentModuleId = modRes.rows[0].id;
        parentModuleName = modRes.rows[0].name;
      }
    }

    const { rows } = await db.query(
      `UPDATE categories
       SET name = $1, slug = $2, code = $3, image_url = $4, status = $5, module_id = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING id, name, slug, code, module_id AS "moduleId", image_url AS image, status`,
      [cleanName, slug, finalCode, imageUrl, statusInt, parentModuleId, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Category not found.' });
    }

    // Cascade inactive status to child subcategories and products
    if (statusInt === 0) {
      await db.query(
        `UPDATE subcategories SET status = 0, updated_at = NOW() WHERE category_id = $1 AND status != 2`,
        [id]
      );
      await db.query(
        `UPDATE products SET status = 0, updated_at = NOW() WHERE category_id = $1 AND status != 2`,
        [id]
      );
    }

    const updated = rows[0];
    updated.status = updated.status === 1 ? 'Active' : 'Inactive';
    updated.moduleName = parentModuleName;

    return res.json({
      success: true,
      message: 'Category updated successfully.',
      category: updated,
    });
  } catch (err) {
    console.error('Update Category Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update category.' });
  }
};

// 4. Raw SQL Delete Category (Soft Delete: status = 2)
export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      'UPDATE categories SET status = 2, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );

    if (rows.length === 0) {
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
};

// 5. Raw SQL Get Sub-Categories (excluding status = 2)
export const getSubCategories = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        s.id,
        s.name,
        s.slug,
        s.code,
        s.category_id AS "categoryId",
        c.name AS "categoryName",
        c.module_id AS "moduleId",
        m.name AS "moduleName",
        s.image_url AS image,
        s.status
      FROM subcategories s
      LEFT JOIN categories c ON s.category_id = c.id AND c.status != 2
      LEFT JOIN modules m ON c.module_id = m.id AND m.status != 2
      WHERE s.status != 2
      ORDER BY s.id ASC
    `);

    const subCategories = rows.map((sub) => ({
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
};

// 6. Raw SQL Create Sub-Category
export const createSubCategory = async (req, res) => {
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
      : await getNextSubCategoryCode();

    const statusInt = String(status || 'Active').toLowerCase() === 'active' ? 1 : 0;
    const imageUrl = image && String(image).trim() ? String(image).trim() : null;

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

    const { rows } = await db.query(
      `INSERT INTO subcategories (name, slug, code, image_url, status, category_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, slug, code, image_url AS image, status, category_id AS "categoryId"`,
      [cleanName, slug, finalCode, imageUrl, statusInt, parentId]
    );

    const created = rows[0];
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
};

// 7. Raw SQL Update Sub-Category
export const updateSubCategory = async (req, res) => {
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

    const { rows } = await db.query(
      `UPDATE subcategories
       SET name = $1, slug = $2, code = $3, image_url = $4, status = $5, category_id = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING id, name, slug, code, image_url AS image, status, category_id AS "categoryId"`,
      [cleanName, slug, finalCode, imageUrl, statusInt, parentId, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Sub-category not found.' });
    }

    // Cascade inactive status to child products
    if (statusInt === 0) {
      await db.query(
        `UPDATE products SET status = 0, updated_at = NOW() WHERE sub_category_id = $1 AND status != 2`,
        [id]
      );
    }

    const updated = rows[0];
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
};

// 8. Raw SQL Delete Sub-Category (Soft Delete: status = 2)
export const deleteSubCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      'UPDATE subcategories SET status = 2, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );

    if (rows.length === 0) {
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
};

// 9. Bulk Import Main Categories (Transactional)
export const bulkImportCategories = async (req, res) => {
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
        : await getNextCategoryCode(client);

      const statusInt = String(item.status || 'Active').toLowerCase() === 'active' ? 1 : 0;
      const imageUrl = item.image && String(item.image).trim() ? String(item.image).trim() : null;

      let parentModId = item.moduleId ? parseInt(item.moduleId, 10) : null;
      let parentModName = item.moduleName || '';

      if (!parentModId && parentModName) {
        const modRes = await client.query('SELECT id, name FROM modules WHERE LOWER(name) = LOWER($1)', [parentModName.trim()]);
        if (modRes.rows.length > 0) {
          parentModId = modRes.rows[0].id;
          parentModName = modRes.rows[0].name;
        }
      }

      if (!parentModId) {
        const firstMod = await client.query('SELECT id, name FROM modules ORDER BY id ASC LIMIT 1');
        if (firstMod.rows.length > 0) {
          parentModId = firstMod.rows[0].id;
          parentModName = firstMod.rows[0].name;
        }
      }

      const insertRes = await client.query(
        `INSERT INTO categories (name, slug, code, image_url, status, module_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, slug, code, module_id AS "moduleId", image_url AS image, status, created_at AS "createdAt"`,
        [cleanName, slug, finalCode, imageUrl, statusInt, parentModId]
      );

      const created = insertRes.rows[0];
      created.status = created.status === 1 ? 'Active' : 'Inactive';
      created.moduleName = parentModName;
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
};

// 10. Bulk Import Sub-Categories (Transactional)
export const bulkImportSubCategories = async (req, res) => {
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
        : await getNextSubCategoryCode(client);

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
};
