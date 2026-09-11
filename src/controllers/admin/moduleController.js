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

// 1. Raw SQL Get All Modules
export const getModules = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        m.id,
        m.name,
        m.slug,
        m.code,
        m.description,
        m.image_url AS image,
        m.status,
        m.created_at AS "createdAt",
        (SELECT COUNT(*)::int FROM categories c WHERE c.module_id = m.id AND c.status != 2) AS "categoryCount"
      FROM modules m
      WHERE m.status != 2
      ORDER BY m.id ASC
    `);

    const modules = rows.map((mod) => ({
      ...mod,
      status: mod.status === 1 ? 'Active' : 'Inactive',
    }));

    return res.json({
      success: true,
      count: modules.length,
      modules,
    });
  } catch (err) {
    console.error('Get Modules Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch modules.' });
  }
};

// Helper to generate next unique 4-digit Module code (1000, 1001, 1002...)
const getNextModuleCode = async (clientOrDb = db) => {
  try {
    const { rows } = await clientOrDb.query(
      `SELECT code FROM modules WHERE code ~ '^\\d{4}$' ORDER BY CAST(code AS INTEGER) DESC LIMIT 1`
    );
    if (rows.length > 0 && rows[0].code) {
      const nextNum = parseInt(rows[0].code, 10) + 1;
      return String(nextNum).padStart(4, '0');
    }
    return '1000';
  } catch (err) {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }
};

// 2. Raw SQL Create Module
export const createModule = async (req, res) => {
  try {
    const { name, code, description, image, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Module name is required.' });
    }

    const cleanName = name.trim();
    const baseSlug = slugify(cleanName);
    const slug = `${baseSlug}-${Date.now().toString().slice(-4)}`;

    const rawCode = String(code || '').replace(/\D/g, '');
    const finalCode = rawCode.length === 4
      ? rawCode
      : await getNextModuleCode();

    const statusInt = String(status || 'Active').toLowerCase() === 'active' ? 1 : 0;
    const imageUrl = image && String(image).trim() ? String(image).trim() : null;

    const { rows } = await db.query(
      `INSERT INTO modules (name, slug, code, description, image_url, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, slug, code, description, image_url AS image, status, created_at AS "createdAt"`,
      [cleanName, slug, finalCode, description || '', imageUrl, statusInt]
    );

    const created = rows[0];
    created.status = created.status === 1 ? 'Active' : 'Inactive';
    created.categoryCount = 0;

    return res.status(201).json({
      success: true,
      message: 'Module created successfully.',
      module: created,
    });
  } catch (err) {
    console.error('Create Module Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create module.' });
  }
};

// 3. Raw SQL Update Module
export const updateModule = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description, image, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Module name is required.' });
    }

    const cleanName = name.trim();
    const slug = `${slugify(cleanName)}-${Date.now().toString().slice(-4)}`;
    const rawCode = String(code || '').replace(/\D/g, '');
    const finalCode = rawCode.length === 4 ? rawCode : '1000';
    const statusInt = String(status || 'Active').toLowerCase() === 'active' ? 1 : 0;
    const imageUrl = image && String(image).trim() ? String(image).trim() : null;

    const { rows } = await db.query(
      `UPDATE modules
       SET name = $1, slug = $2, code = $3, description = $4, image_url = $5, status = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING id, name, slug, code, description, image_url AS image, status`,
      [cleanName, slug, finalCode, description || '', imageUrl, statusInt, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Module not found.' });
    }

    // Cascade inactive status to child categories, subcategories, and products
    if (statusInt === 0) {
      await db.query(
        `UPDATE categories SET status = 0, updated_at = NOW() WHERE module_id = $1 AND status != 2`,
        [id]
      );
      await db.query(
        `UPDATE subcategories SET status = 0, updated_at = NOW()
         WHERE category_id IN (SELECT id FROM categories WHERE module_id = $1) AND status != 2`,
        [id]
      );
      await db.query(
        `UPDATE products SET status = 0, updated_at = NOW()
         WHERE category_id IN (SELECT id FROM categories WHERE module_id = $1) AND status != 2`,
        [id]
      );
    }

    const updated = rows[0];
    updated.status = updated.status === 1 ? 'Active' : 'Inactive';

    return res.json({
      success: true,
      message: 'Module updated successfully.',
      module: updated,
    });
  } catch (err) {
    console.error('Update Module Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update module.' });
  }
};

// 4. Raw SQL Delete Module (Soft Delete: status = 2)
export const deleteModule = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      'UPDATE modules SET status = 2, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Module not found.' });
    }

    return res.json({
      success: true,
      message: `Module ${id} deleted successfully.`,
    });
  } catch (err) {
    console.error('Delete Module Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete module.' });
  }
};

// 5. Bulk Import Modules (Transactional)
export const bulkImportModules = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { modules } = req.body;
    if (!Array.isArray(modules) || modules.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid modules provided for bulk import.' });
    }

    await client.query('BEGIN');

    const importedModules = [];
    let skippedCount = 0;

    for (let i = 0; i < modules.length; i++) {
      const item = modules[i];
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
        : await getNextModuleCode(client);

      const statusInt = String(item.status || 'Active').toLowerCase() === 'active' ? 1 : 0;
      const imageUrl = item.image && String(item.image).trim() ? String(item.image).trim() : null;

      const insertRes = await client.query(
        `INSERT INTO modules (name, slug, code, description, image_url, status)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, slug, code, description, image_url AS image, status, created_at AS "createdAt"`,
        [cleanName, slug, finalCode, item.description || '', imageUrl, statusInt]
      );

      const created = insertRes.rows[0];
      created.status = created.status === 1 ? 'Active' : 'Inactive';
      created.categoryCount = 0;
      importedModules.push(created);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: `Successfully imported ${importedModules.length} modules.`,
      count: importedModules.length,
      skipped: skippedCount,
      modules: importedModules,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk Import Modules Error:', err);
    return res.status(500).json({ success: false, message: 'Bulk module import failed.' });
  } finally {
    client.release();
  }
};
