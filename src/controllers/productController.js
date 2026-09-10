import db from '../config/db.js';
import { generateSku } from '../utils/skuGenerator.js';

const slugify = (text) => {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

// 1. Get All Products (Raw SQL JOIN with categories and subcategories, excluding status = 2)
export const getProducts = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        p.id,
        c.module_id AS "moduleId",
        m.name AS "moduleName",
        p.category_id AS "categoryId",
        c.name AS "categoryName",
        p.sub_category_id AS "subCategoryId",
        sc.name AS "subCategoryName",
        p.name,
        p.slug,
        p.sku,
        p.description,
        p.brand,
        p.price,
        p.old_price AS "oldPrice",
        p.weight,
        p.has_variants AS "hasVariants",
        p.is_featured AS "isFeatured",
        p.sort_order AS "sortOrder",
        p.meta_title AS "metaTitle",
        p.meta_description AS "metaDescription",
        p.image_url AS "image",
        p.status,
        p.created_at AS "createdAt",
        p.updated_at AS "updatedAt"
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id AND c.status != 2
      LEFT JOIN modules m ON c.module_id = m.id AND m.status != 2
      LEFT JOIN subcategories sc ON p.sub_category_id = sc.id AND sc.status != 2
      WHERE p.status != 2
      ORDER BY p.id DESC
    `);

    const products = rows.map((prod) => ({
      ...prod,
      price: parseFloat(prod.price || 0),
      oldPrice: prod.oldPrice ? parseFloat(prod.oldPrice) : null,
      weight: prod.weight ? parseFloat(prod.weight) : null,
      status: prod.status === 1 ? 'Active' : 'Inactive',
    }));

    return res.json({
      success: true,
      count: products.length,
      products,
    });
  } catch (err) {
    console.error('Get Products Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch products.' });
  }
};

// 2. Create Product (Raw SQL Insert)
export const createProduct = async (req, res) => {
  try {
    const {
      name,
      categoryId,
      subCategoryId,
      sku,
      price,
      oldPrice,
      weight,
      brand,
      description,
      hasVariants,
      isFeatured,
      sortOrder,
      metaTitle,
      metaDescription,
      image,
      status,
    } = req.body;

    if (!name || !price || !categoryId) {
      return res.status(400).json({
        success: false,
        message: 'Product name, category, and price are required.',
      });
    }

    const catId = parseInt(categoryId, 10);
    const subCatId = subCategoryId ? parseInt(subCategoryId, 10) : null;
    const cleanName = String(name).trim();
    const generatedSlug = `${slugify(cleanName)}-${Date.now().toString().slice(-4)}`;

    let cleanSku = sku ? String(sku).trim() : '';
    if (!cleanSku) {
      const catRes = await db.query('SELECT code FROM categories WHERE id = $1', [catId]);
      const subCatRes = subCatId ? await db.query('SELECT code FROM subcategories WHERE id = $1', [subCatId]) : { rows: [] };
      const catCode = catRes.rows[0]?.code || String(1000 + catId);
      const subCatCode = subCatRes.rows[0]?.code || (subCatId ? String(2000 + subCatId) : '0000');
      cleanSku = generateSku(catCode, subCatCode, cleanName);
    }

    const numPrice = parseFloat(price) || 0.00;
    const numOldPrice = oldPrice ? parseFloat(oldPrice) : null;
    const numWeight = weight ? parseFloat(weight) : null;

    const boolHasVariants = Boolean(hasVariants);
    const boolIsFeatured = Boolean(isFeatured);
    const numSortOrder = parseInt(sortOrder || '0', 10);

    const statusInt = String(status || 'Active').toLowerCase() === 'active' || status === 1 ? 1 : 2;

    const { rows } = await db.query(
      `INSERT INTO products (
        category_id, sub_category_id, name, slug, sku, description, brand,
        price, old_price, weight, has_variants, is_featured, sort_order,
        meta_title, meta_description, image_url, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      RETURNING 
        id, category_id AS "categoryId", sub_category_id AS "subCategoryId",
        name, slug, sku, description, brand, price, old_price AS "oldPrice",
        weight, has_variants AS "hasVariants", is_featured AS "isFeatured",
        sort_order AS "sortOrder", meta_title AS "metaTitle", meta_description AS "metaDescription",
        image_url AS "image", status, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        catId,
        subCatId,
        cleanName,
        generatedSlug,
        cleanSku,
        description || '',
        brand || '',
        numPrice,
        numOldPrice,
        numWeight,
        boolHasVariants,
        boolIsFeatured,
        numSortOrder,
        metaTitle || '',
        metaDescription || '',
        image || '',
        statusInt,
      ]
    );

    const created = rows[0];

    const catRes = await db.query('SELECT name FROM categories WHERE id = $1', [catId]);
    const subCatRes = subCatId ? await db.query('SELECT name FROM subcategories WHERE id = $1', [subCatId]) : { rows: [] };

    created.categoryName = catRes.rows[0]?.name || 'General';
    created.subCategoryName = subCatRes.rows[0]?.name || '';
    created.price = parseFloat(created.price || 0);
    created.oldPrice = created.oldPrice ? parseFloat(created.oldPrice) : null;
    created.weight = created.weight ? parseFloat(created.weight) : null;
    created.status = created.status === 1 ? 'Active' : 'Inactive';

    return res.status(201).json({
      success: true,
      message: 'Product created successfully.',
      product: created,
    });
  } catch (err) {
    console.error('Create Product Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to create product.' });
  }
};

// 3. Update Product (Raw SQL Update)
export const updateProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      categoryId,
      subCategoryId,
      sku,
      price,
      oldPrice,
      weight,
      brand,
      description,
      hasVariants,
      isFeatured,
      sortOrder,
      metaTitle,
      metaDescription,
      image,
      status,
    } = req.body;

    const cleanName = String(name || '').trim();
    const catId = parseInt(categoryId, 10);
    const subCatId = subCategoryId ? parseInt(subCategoryId, 10) : null;

    const numPrice = parseFloat(price) || 0.00;
    const numOldPrice = oldPrice ? parseFloat(oldPrice) : null;
    const numWeight = weight ? parseFloat(weight) : null;

    const boolHasVariants = Boolean(hasVariants);
    const boolIsFeatured = Boolean(isFeatured);
    const numSortOrder = parseInt(sortOrder || '0', 10);

    const statusInt = String(status || 'Active').toLowerCase() === 'active' || status === 1 ? 1 : 2;

    const { rows } = await db.query(
      `UPDATE products
       SET 
         name = $1,
         category_id = $2,
         sub_category_id = $3,
         sku = $4,
         price = $5,
         old_price = $6,
         weight = $7,
         brand = $8,
         description = $9,
         has_variants = $10,
         is_featured = $11,
         sort_order = $12,
         meta_title = $13,
         meta_description = $14,
         image_url = $15,
         status = $16,
         updated_at = NOW()
       WHERE id = $17
       RETURNING 
         id, category_id AS "categoryId", sub_category_id AS "subCategoryId",
         name, slug, sku, description, brand, price, old_price AS "oldPrice",
         weight, has_variants AS "hasVariants", is_featured AS "isFeatured",
         sort_order AS "sortOrder", meta_title AS "metaTitle", meta_description AS "metaDescription",
         image_url AS "image", status, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        cleanName,
        catId,
        subCatId,
        sku || null,
        numPrice,
        numOldPrice,
        numWeight,
        brand || '',
        description || '',
        boolHasVariants,
        boolIsFeatured,
        numSortOrder,
        metaTitle || '',
        metaDescription || '',
        image || '',
        statusInt,
        id,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const updated = rows[0];

    const catRes = await db.query('SELECT name FROM categories WHERE id = $1', [catId]);
    const subCatRes = subCatId ? await db.query('SELECT name FROM subcategories WHERE id = $1', [subCatId]) : { rows: [] };

    updated.categoryName = catRes.rows[0]?.name || 'General';
    updated.subCategoryName = subCatRes.rows[0]?.name || '';
    updated.price = parseFloat(updated.price || 0);
    updated.oldPrice = updated.oldPrice ? parseFloat(updated.oldPrice) : null;
    updated.weight = updated.weight ? parseFloat(updated.weight) : null;
    updated.status = updated.status === 1 ? 'Active' : 'Inactive';

    return res.json({
      success: true,
      message: 'Product updated successfully.',
      product: updated,
    });
  } catch (err) {
    console.error('Update Product Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update product.' });
  }
};

// 4. Delete Product (Soft Delete: status = 2)
export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(
      'UPDATE products SET status = 2, updated_at = NOW() WHERE id = $1 RETURNING id',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    return res.json({
      success: true,
      message: `Product ${id} deleted successfully.`,
    });
  } catch (err) {
    console.error('Delete Product Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete product.' });
  }
};

// 5. Bulk Import Products (Transactional SQL)
export const bulkImportProducts = async (req, res) => {
  const client = await db.pool.connect();
  try {
    const { products } = req.body;
    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid products provided for import.' });
    }

    await client.query('BEGIN');

    const createdProducts = [];
    for (let i = 0; i < products.length; i++) {
      const item = products[i];
      const name = String(item.name || item['Product Name'] || '').trim();
      const catId = item.categoryId ? parseInt(item.categoryId, 10) : 1;
      const subCatId = item.subCategoryId ? parseInt(item.subCategoryId, 10) : null;
      const price = parseFloat(item.price || item['Price']) || 0.00;
      const oldPrice = item.oldPrice ? parseFloat(item.oldPrice) : null;
      const weight = item.weight ? parseFloat(item.weight) : null;
      const brand = String(item.brand || item['Brand'] || '').trim();
      const sku = item.sku ? String(item.sku).trim() : `SKU-IMP-${Date.now().toString().slice(-4)}-${i}`;
      const description = String(item.description || '').trim();
      const image = String(item.image || item.image_url || '').trim();
      const statusInt = String(item.status || 'Active').toLowerCase() === 'active' ? 1 : 2;

      if (!name) continue;

      const slug = `${slugify(name)}-${Date.now().toString().slice(-4)}-${i}`;

      const resInsert = await client.query(
        `INSERT INTO products (
          category_id, sub_category_id, name, slug, sku, description, brand,
          price, old_price, weight, image_url, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, name, slug, sku, category_id AS "categoryId", price, brand, image_url AS "image", status`,
        [catId, subCatId, name, slug, sku, description, brand, price, oldPrice, weight, image, statusInt]
      );

      const prod = resInsert.rows[0];
      prod.price = parseFloat(prod.price || 0);
      prod.status = prod.status === 1 ? 'Active' : 'Inactive';
      createdProducts.push(prod);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: `Successfully imported ${createdProducts.length} products.`,
      products: createdProducts,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Bulk Import Products Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to bulk import products.' });
  } finally {
    client.release();
  }
};
