const db = require('../config/db');

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// 1. Raw SQL Get Products
async function getProducts(req, res) {
  try {
    const result = await db.query(`
      SELECT 
        p.id,
        p.category_id AS "categoryId",
        c.name AS "categoryName",
        p.name,
        p.slug,
        p.price,
        p.stock,
        p.description,
        p.brand_name AS brand,
        p.image_url AS image,
        p.status,
        p.created_at AS "createdAt"
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ORDER BY p.id DESC
    `);

    const products = result.rows.map((prod) => ({
      ...prod,
      price: parseFloat(prod.price),
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
}

// 2. Raw SQL Create Product
async function createProduct(req, res) {
  try {
    const { name, categoryId, price, stock, brand, description, image, status } = req.body;

    if (!name || !price) {
      return res.status(400).json({ success: false, message: 'Name and price are required.' });
    }

    const cleanName = name.trim();
    const slug = `${slugify(cleanName)}-${Date.now().toString().slice(-4)}`;
    const catId = categoryId ? parseInt(categoryId, 10) : 1;
    const numPrice = parseFloat(price) || 0.00;
    const numStock = parseInt(stock || '0', 10);
    const statusInt = String(status || 'Active').toLowerCase() === 'active' ? 1 : 0;

    const result = await db.query(
      `INSERT INTO products (name, slug, category_id, price, stock, brand_name, description, image_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, slug, category_id AS "categoryId", price, stock, brand_name AS brand, image_url AS image, status, created_at AS "createdAt"`,
      [cleanName, slug, catId, numPrice, numStock, brand || 'Aura', description || '', image || '', statusInt]
    );

    const created = result.rows[0];
    created.price = parseFloat(created.price);
    created.status = created.status === 1 ? 'Active' : 'Inactive';

    return res.status(201).json({
      success: true,
      message: 'Product created successfully.',
      product: created,
    });
  } catch (err) {
    console.error('Create Product Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create product.' });
  }
}

// 3. Raw SQL Update Product
async function updateProduct(req, res) {
  try {
    const { id } = req.params;
    const { name, price, stock, brand, description, image, status } = req.body;

    const numPrice = parseFloat(price) || 0.00;
    const numStock = parseInt(stock || '0', 10);
    const statusInt = String(status || 'Active').toLowerCase() === 'active' ? 1 : 0;

    const result = await db.query(
      `UPDATE products
       SET name = $1, price = $2, stock = $3, brand_name = $4, description = $5, image_url = $6, status = $7, updated_at = NOW()
       WHERE id = $8
       RETURNING id, name, price, stock, brand_name AS brand, description, image_url AS image, status`,
      [name, numPrice, numStock, brand, description, image, statusInt, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const updated = result.rows[0];
    updated.price = parseFloat(updated.price);
    updated.status = updated.status === 1 ? 'Active' : 'Inactive';

    return res.json({
      success: true,
      message: 'Product updated successfully.',
      product: updated,
    });
  } catch (err) {
    console.error('Update Product Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update product.' });
  }
}

// 4. Raw SQL Delete Product
async function deleteProduct(req, res) {
  try {
    const { id } = req.params;
    const result = await db.query('DELETE FROM products WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
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
}

module.exports = {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
};
