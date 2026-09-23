import db from '../../config/db.js';

// Get Public Store Products for Customer Browsing
export const getStoreProducts = async (req, res) => {
  try {
    const { category, search, sort = 'featured', is_kit, limit = 100, offset = 0 } = req.query;

    let queryText = `
      SELECT 
        p.id,
        p.name,
        p.slug,
        p.sku,
        p.category_id AS "categoryId",
        c.name AS "categoryName",
        c.slug AS "categorySlug",
        p.sub_category_id AS "subCategoryId",
        sc.name AS "subCategoryName",
        p.brand,
        p.price,
        p.old_price AS "oldPrice",
        p.stock,
        p.rating,
        p.reviews_count AS "reviewsCount",
        p.is_featured AS "isFeatured",
        p.is_kit AS "isKit",
        p.specifications,
        p.kit_discount_percentage AS "kitDiscountPercentage",
        (SELECT COUNT(*)::int FROM kit_items ki WHERE ki.kit_id = p.id) AS "componentsCount",
        p.image_url AS "image",
        p.description,
        p.created_at AS "createdAt"
      FROM products p
      JOIN categories c ON p.category_id = c.id AND c.status = 1
      LEFT JOIN subcategories sc ON p.sub_category_id = sc.id AND sc.status = 1
      WHERE p.status = 1
    `;

    const params = [];

    // Filter by Category Slug or ID
    if (category && category !== 'all') {
      params.push(category);
      queryText += ` AND (c.slug = $${params.length} OR c.id::text = $${params.length})`;
    }

    // Filter by Kit / Single Product
    if (is_kit === 'true') {
      queryText += ' AND p.is_kit = true';
    } else if (is_kit === 'false') {
      queryText += ' AND p.is_kit = false';
    }

    // Filter by Search Term
    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      queryText += ` AND (
        LOWER(p.name) LIKE $${params.length} OR 
        LOWER(p.description) LIKE $${params.length} OR 
        LOWER(p.brand) LIKE $${params.length} OR
        LOWER(c.name) LIKE $${params.length}
      )`;
    }

    // Sorting
    if (sort === 'price-low') {
      queryText += ' ORDER BY p.price ASC';
    } else if (sort === 'price-high') {
      queryText += ' ORDER BY p.price DESC';
    } else if (sort === 'rating') {
      queryText += ' ORDER BY p.rating DESC, p.reviews_count DESC';
    } else if (sort === 'newest') {
      queryText += ' ORDER BY p.id DESC';
    } else {
      // Default: featured first, then newest
      queryText += ' ORDER BY p.is_featured DESC, p.sort_order ASC, p.id DESC';
    }

    params.push(parseInt(limit, 10) || 100);
    queryText += ` LIMIT $${params.length}`;

    params.push(parseInt(offset, 10) || 0);
    queryText += ` OFFSET $${params.length}`;

    const { rows } = await db.query(queryText, params);

    const products = rows.map((p) => ({
      ...p,
      price: parseFloat(p.price || 0),
      oldPrice: p.oldPrice ? parseFloat(p.oldPrice) : null,
      rating: parseFloat(p.rating || 5.0),
      reviewsCount: parseInt(p.reviewsCount || 0, 10),
      image: p.image || '/products/product-electronics.png',
      specifications: typeof p.specifications === 'object' && p.specifications !== null ? p.specifications : {},
    }));

    return res.json({
      success: true,
      count: products.length,
      products,
    });
  } catch (err) {
    console.error('Store Products Controller Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch catalog products.' });
  }
};

// Get Single Product Details with Specifications, Kit Breakdown & Related Products
export const getStoreProductById = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await db.query(
      `SELECT 
        p.id,
        p.name,
        p.slug,
        p.sku,
        p.category_id AS "categoryId",
        c.name AS "categoryName",
        c.slug AS "categorySlug",
        p.sub_category_id AS "subCategoryId",
        sc.name AS "subCategoryName",
        p.brand,
        p.price,
        p.old_price AS "oldPrice",
        p.stock,
        p.rating,
        p.reviews_count AS "reviewsCount",
        p.is_featured AS "isFeatured",
        p.is_kit AS "isKit",
        p.specifications,
        p.kit_discount_percentage AS "kitDiscountPercentage",
        p.image_url AS "image",
        p.description,
        p.weight,
        p.created_at AS "createdAt"
      FROM products p
      JOIN categories c ON p.category_id = c.id
      LEFT JOIN subcategories sc ON p.sub_category_id = sc.id
      WHERE (p.id::text = $1 OR p.slug = $1) AND p.status = 1
      LIMIT 1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Product not found.' });
    }

    const prod = rows[0];
    const product = {
      ...prod,
      price: parseFloat(prod.price || 0),
      oldPrice: prod.oldPrice ? parseFloat(prod.oldPrice) : null,
      rating: parseFloat(prod.rating || 5.0),
      reviewsCount: parseInt(prod.reviewsCount || 0, 10),
      image: prod.image || '/products/product-electronics.png',
      specifications: typeof prod.specifications === 'object' && prod.specifications !== null ? prod.specifications : {},
      components: [],
      totalComponentPrice: 0,
      savings: 0,
      savingsPercentage: 0,
      kitsIncludingThisProduct: [],
    };

    // If Product is a Kit: Load all constituent items with quantities & specifications
    if (prod.isKit) {
      const compRes = await db.query(
        `SELECT 
          ki.quantity,
          ki.sort_order AS "sortOrder",
          p.id,
          p.name,
          p.slug,
          p.sku,
          p.brand,
          p.price,
          p.old_price AS "oldPrice",
          p.image_url AS "image",
          p.description,
          p.specifications,
          p.stock
        FROM kit_items ki
        JOIN products p ON ki.product_id = p.id
        WHERE ki.kit_id = $1 AND p.status = 1
        ORDER BY ki.sort_order ASC, ki.id ASC`,
        [prod.id]
      );

      const components = compRes.rows.map((c) => ({
        ...c,
        price: parseFloat(c.price || 0),
        oldPrice: c.oldPrice ? parseFloat(c.oldPrice) : null,
        specifications: typeof c.specifications === 'object' && c.specifications !== null ? c.specifications : {},
      }));

      const totalComponentPrice = components.reduce((sum, c) => sum + (c.price * c.quantity), 0);
      const savings = Math.max(0, totalComponentPrice - product.price);
      const savingsPercentage = totalComponentPrice > 0 ? Math.round((savings / totalComponentPrice) * 100) : 0;

      product.components = components;
      product.totalComponentPrice = parseFloat(totalComponentPrice.toFixed(2));
      product.savings = parseFloat(savings.toFixed(2));
      product.savingsPercentage = savingsPercentage;
    } else {
      // If Single Product: Query which kits include this item for cross-selling
      const kitRes = await db.query(
        `SELECT 
          p.id, p.name, p.slug, p.sku, p.price, p.old_price AS "oldPrice",
          p.image_url AS "image", p.rating, p.reviews_count AS "reviewsCount",
          ki.quantity AS "includedQuantity"
        FROM kit_items ki
        JOIN products p ON ki.kit_id = p.id
        WHERE ki.product_id = $1 AND p.status = 1 AND p.is_kit = true
        ORDER BY p.is_featured DESC, p.id DESC`,
        [prod.id]
      );

      product.kitsIncludingThisProduct = kitRes.rows.map((k) => ({
        ...k,
        price: parseFloat(k.price || 0),
        oldPrice: k.oldPrice ? parseFloat(k.oldPrice) : null,
      }));
    }

    // Fetch related products in the same category
    const relRes = await db.query(
      `SELECT 
        p.id, p.name, p.slug, p.sku, p.price, p.old_price AS "oldPrice",
        p.rating, p.reviews_count AS "reviewsCount", p.image_url AS "image",
        p.is_kit AS "isKit",
        c.name AS "categoryName", c.slug AS "categorySlug"
       FROM products p
       JOIN categories c ON p.category_id = c.id
       WHERE p.category_id = $1 AND p.id != $2 AND p.status = 1
       LIMIT 4`,
      [product.categoryId, product.id]
    );

    const relatedProducts = relRes.rows.map((r) => ({
      ...r,
      price: parseFloat(r.price || 0),
      oldPrice: r.oldPrice ? parseFloat(r.oldPrice) : null,
      rating: parseFloat(r.rating || 5.0),
      reviewsCount: parseInt(r.reviewsCount || 0, 10),
      image: r.image || '/products/product-electronics.png',
    }));

    return res.json({
      success: true,
      product,
      relatedProducts,
    });
  } catch (err) {
    console.error('Store Product Detail Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch product details.' });
  }
};

// Get All Maker Kits with Component Breakdown & Savings
export const getStoreKits = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        p.id,
        p.name,
        p.slug,
        p.sku,
        p.category_id AS "categoryId",
        c.name AS "categoryName",
        c.slug AS "categorySlug",
        p.brand,
        p.price,
        p.old_price AS "oldPrice",
        p.stock,
        p.rating,
        p.reviews_count AS "reviewsCount",
        p.is_featured AS "isFeatured",
        p.is_kit AS "isKit",
        p.image_url AS "image",
        p.description,
        p.specifications,
        p.created_at AS "createdAt",
        (
          SELECT json_agg(
            json_build_object(
              'id', cp.id,
              'name', cp.name,
              'sku', cp.sku,
              'price', cp.price::numeric,
              'quantity', ki.quantity,
              'image', cp.image_url,
              'specifications', cp.specifications
            ) ORDER BY ki.sort_order ASC
          )
          FROM kit_items ki
          JOIN products cp ON ki.product_id = cp.id
          WHERE ki.kit_id = p.id
        ) AS components
      FROM products p
      JOIN categories c ON p.category_id = c.id
      WHERE p.is_kit = true AND p.status = 1
      ORDER BY p.is_featured DESC, p.sort_order ASC, p.id DESC
    `);

    const kits = rows.map((k) => {
      const components = (k.components || []).map((comp) => ({
        ...comp,
        price: parseFloat(comp.price || 0),
      }));
      const totalComponentPrice = components.reduce((sum, c) => sum + (c.price * (c.quantity || 1)), 0);
      const kitPrice = parseFloat(k.price || 0);
      const savings = Math.max(0, totalComponentPrice - kitPrice);
      const savingsPercentage = totalComponentPrice > 0 ? Math.round((savings / totalComponentPrice) * 100) : 0;

      return {
        ...k,
        price: kitPrice,
        oldPrice: k.oldPrice ? parseFloat(k.oldPrice) : null,
        rating: parseFloat(k.rating || 5.0),
        reviewsCount: parseInt(k.reviewsCount || 0, 10),
        image: k.image || '/products/product-electronics.png',
        specifications: typeof k.specifications === 'object' && k.specifications !== null ? k.specifications : {},
        components,
        componentsCount: components.length,
        totalComponentPrice: parseFloat(totalComponentPrice.toFixed(2)),
        savings: parseFloat(savings.toFixed(2)),
        savingsPercentage,
      };
    });

    return res.json({
      success: true,
      count: kits.length,
      kits,
    });
  } catch (err) {
    console.error('Store Kits Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch kits.' });
  }
};

// Get Store Categories Hierarchy
export const getStoreCategories = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        c.id,
        c.name,
        c.slug,
        c.code,
        c.description,
        c.image_url AS image,
        (SELECT COUNT(*)::int FROM products p WHERE p.category_id = c.id AND p.status = 1) AS "productCount"
      FROM categories c
      WHERE c.status = 1
      ORDER BY c.name ASC
    `);

    return res.json({
      success: true,
      count: rows.length,
      categories: rows,
    });
  } catch (err) {
    console.error('Store Categories Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch store categories.' });
  }
};
