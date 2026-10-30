import db from '../../config/db.js';
import { generateSku } from '../../utils/skuGenerator.js';

const slugify = (text) => {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

// Resolve an existing brand ID or create/reuse a brand by name.
const resolveBrandId = async (
  queryable,
  { brandId, newBrandName, newBrandLogoUrl }
) => {
 if (brandId !== undefined && brandId !== null && brandId !== '') {
  const parsedBrandId = parseInt(brandId, 10);

  if (!Number.isInteger(parsedBrandId) || parsedBrandId <= 0) {
    throw new Error(`Invalid brand ID: ${brandId}`);
  }

  const { rows } = await queryable.query(
    `SELECT id
     FROM brand_logos
     WHERE id = $1
       AND status != 2`,
    [parsedBrandId]
  );

  if (rows.length === 0) {
    throw new Error(
      `Brand ID ${parsedBrandId} does not exist or has been deleted.`
    );
  }

  return parsedBrandId;
}

  const cleanBrandName = String(newBrandName || '').trim();

  // No brand selected or provided.
  if (!cleanBrandName) {
    return null;
  }

  // Reuse an existing brand with the same name.
  const existingBrand = await queryable.query(
    `SELECT id
     FROM public.brand_logos
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
     ORDER BY id
     LIMIT 1`,
    [cleanBrandName]
  );

  if (existingBrand.rows.length > 0) {
    return existingBrand.rows[0].id;
  }

  // Create a new brand when a new name is supplied.
  const logoUrl =
    String(newBrandLogoUrl || '').trim() ||
    '/PromoCards/def-icon.png';

  const createdBrand = await queryable.query(
    `INSERT INTO public.brand_logos (
      name,
      logo_url,
      sort_order,
      status
    )
    VALUES (
      $1,
      $2,
      COALESCE(
        (SELECT MAX(sort_order) + 1 FROM public.brand_logos),
        0
      ),
      1
    )
    RETURNING id`,
    [cleanBrandName, logoUrl]
  );

  return createdBrand.rows[0].id;
};

// 1. Get All Products
// export const getProducts = async (req, res) => {
//   try {
//     const { rows } = await db.query(`
//       SELECT
//         p.id,
//         c.module_id AS "moduleId",
//         m.name AS "moduleName",
//         p.category_id AS "categoryId",
//         c.name AS "categoryName",
//         p.sub_category_id AS "subCategoryId",
//         sc.name AS "subCategoryName",
//         p.name,
//         p.slug,
//         p.sku,
//         p.description,
//        p.brand_id AS "brandId",
// bl.name AS brand,
// bl.logo_url AS "brandLogoUrl",
//         p.price,
//         p.old_price AS "oldPrice",
//         p.weight,
//         p.has_variants AS "hasVariants",
//         p.is_featured AS "isFeatured",
//         p.is_kit AS "isKit",
//         p.specifications,
//         p.kit_discount_percentage AS "kitDiscountPercentage",

//         (
//           SELECT json_agg(
//             json_build_object(
//               'productId', ki.product_id,
//               'quantity', ki.quantity,
//               'name', cp.name,
//               'sku', cp.sku,
//               'price', cp.price::numeric
//             )
//             ORDER BY ki.sort_order ASC
//           )
//           FROM kit_items ki
//           JOIN products cp ON ki.product_id = cp.id
//           WHERE ki.kit_id = p.id
//         ) AS "kitItems",

//         (
//           SELECT COUNT(*)::int
//           FROM kit_items ki
//           WHERE ki.kit_id = p.id
//         ) AS "componentsCount",

//         p.sort_order AS "sortOrder",
//         p.meta_title AS "metaTitle",
//         p.meta_description AS "metaDescription",
//         p.image_url AS "image",
//         p.images AS "images",
//         p.status,
//         p.created_at AS "createdAt",
//         p.updated_at AS "updatedAt"

//       FROM products p
//       LEFT JOIN categories c
//         ON p.category_id = c.id
//         AND c.status != 2
//       LEFT JOIN modules m
//         ON c.module_id = m.id
//         AND m.status != 2
//       LEFT JOIN subcategories sc
//         ON p.sub_category_id = sc.id
//         AND sc.status != 2
//         LEFT JOIN brand_logos bl
//   ON p.brand_id = bl.id
//   AND bl.status != 2

//       WHERE p.status != 2
//       ORDER BY p.id DESC
//     `);

//     const products = rows.map((prod) => ({
//       ...prod,
//       price: parseFloat(prod.price || 0),
//       oldPrice: prod.oldPrice
//         ? parseFloat(prod.oldPrice)
//         : null,
//       weight: prod.weight
//         ? parseFloat(prod.weight)
//         : null,
//       status: prod.status === 1 ? 'Active' : 'Inactive',
//       specifications:
//         typeof prod.specifications === 'object' &&
//         prod.specifications !== null
//           ? prod.specifications
//           : {},
//       images: Array.isArray(prod.images)
//         ? prod.images
//         : typeof prod.images === 'string'
//           ? JSON.parse(prod.images)
//           : prod.image
//             ? [prod.image]
//             : [],
//       kitItems: prod.kitItems || [],
//     }));

//     return res.json({
//       success: true,
//       count: products.length,
//       products,
//     });
//   } catch (err) {
//     console.error('Get Products Error:', err);

//     return res.status(500).json({
//       success: false,
//       message: 'Failed to fetch products.',
//     });
//   }
// };

// 2. Create Product
export const createProduct = async (req, res) => {
  try {
    const {
      name,
        moduleId, // ADD THIS

      categoryId,
      subCategoryId,
      sku,
      price,
      oldPrice,
      weight,
      brandId,
      newBrandName,
      newBrandLogoUrl,
      newBrand,
      description,
      hasVariants,
      isFeatured,
      isKit,
      is_kit,
      specifications,
      kitDiscountPercentage,
      kit_items,
      kitItems,
      sortOrder,
      metaTitle,
      metaDescription,
      image,
      images,
      status,
    } = req.body;

    if (!name || !price || !categoryId) {
      return res.status(400).json({
        success: false,
        message: 'Product name, category, and price are required.',
      });
    }

    const catId = parseInt(categoryId, 10);
    const subCatId = subCategoryId
      ? parseInt(subCategoryId, 10)
      : null;

    const cleanName = String(name).trim();

    const baseSlug = slugify(cleanName);
    const existingSlugRes = await db.query(
      'SELECT id FROM products WHERE slug = $1 LIMIT 1',
      [baseSlug]
    );
    const generatedSlug =
      existingSlugRes.rows.length === 0
        ? baseSlug
        : `${baseSlug}-${Date.now().toString().slice(-4)}`;

    let cleanSku = sku ? String(sku).trim() : '';

    if (!cleanSku) {
      const catRes = await db.query(
        'SELECT code FROM categories WHERE id = $1',
        [catId]
      );

      const subCatRes = subCatId
        ? await db.query(
            'SELECT code FROM subcategories WHERE id = $1',
            [subCatId]
          )
        : { rows: [] };

      const catCode =
        catRes.rows[0]?.code || String(1000 + catId);

      const subCatCode =
        subCatRes.rows[0]?.code ||
        (subCatId ? String(2000 + subCatId) : '0000');

      cleanSku = generateSku(catCode, subCatCode, cleanName);
    }

    const numPrice = parseFloat(price) || 0.0;
    const numOldPrice = oldPrice
      ? parseFloat(oldPrice)
      : null;
    const numWeight = weight
      ? parseFloat(weight)
      : null;

    const boolHasVariants = Boolean(hasVariants);
    const boolIsFeatured = Boolean(isFeatured);

    const boolIsKit = Boolean(
      isKit !== undefined ? isKit : is_kit
    );

    const specsJson =
      typeof specifications === 'object' &&
      specifications !== null
        ? JSON.stringify(specifications)
        : typeof specifications === 'string'
          ? specifications
          : '{}';

    const numKitDiscount =
      parseFloat(kitDiscountPercentage || 0) || 0.0;

    const numSortOrder = parseInt(sortOrder || '0', 10);

    const statusInt =
      String(status || 'Active').toLowerCase() === 'active' ||
      status === 1
        ? 1
        : 0;

    let imageList = [];

    if (Array.isArray(images) && images.length > 0) {
      imageList = images.filter(
        (img) => typeof img === 'string' && img.trim()
      );
    } else if (
      image &&
      typeof image === 'string' &&
      image.trim()
    ) {
      imageList = [image.trim()];
    }

    const primaryImage =
      imageList[0] ||
      (typeof image === 'string' ? image.trim() : '');

    const imagesJson = JSON.stringify(imageList);

    // Brand is stored as brand_id, not as a brand name.
    const resolvedBrandId = await resolveBrandId(db, {
      brandId,
      newBrandName: newBrandName || newBrand?.name,
      newBrandLogoUrl:
        newBrandLogoUrl ||
        newBrand?.logoUrl ||
        newBrand?.logo_url,
    });

    const { rows } = await db.query(
      `INSERT INTO products (
        category_id,
        sub_category_id,
        name,
        slug,
        sku,
        description,
        brand_id,
        price,
        old_price,
        weight,
        has_variants,
        is_featured,
        is_kit,
        specifications,
        kit_discount_percentage,
        sort_order,
        meta_title,
        meta_description,
        image_url,
        images,
        status,
        module_id
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22
      )
      RETURNING
        id,
        module_id "moduleId",
        category_id AS "categoryId",
        sub_category_id AS "subCategoryId",
        name,
        slug,
        sku,
        description,
        brand_id AS "brandId",
        price,
        old_price AS "oldPrice",
        weight,
        has_variants AS "hasVariants",
        is_featured AS "isFeatured",
        is_kit AS "isKit",
        specifications,
        kit_discount_percentage AS "kitDiscountPercentage",
        sort_order AS "sortOrder",
        meta_title AS "metaTitle",
        meta_description AS "metaDescription",
        image_url AS "image",
        images,
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"`,
      [
        catId,
        subCatId,
        cleanName,
        generatedSlug,
        cleanSku,
        description || '',
        resolvedBrandId,
        numPrice,
        numOldPrice,
        numWeight,
        boolHasVariants,
        boolIsFeatured,
        boolIsKit,
        specsJson,
        numKitDiscount,
        numSortOrder,
        metaTitle || '',
        metaDescription || '',
        primaryImage,
        imagesJson,
        statusInt,
        moduleId
      ]
    );

    const created = rows[0];

    // If product is a kit, save its constituent items.
    const itemsToInsert = kit_items || kitItems || [];

    if (
      boolIsKit &&
      Array.isArray(itemsToInsert) &&
      itemsToInsert.length > 0
    ) {
      let itemSortOrder = 0;

      for (const item of itemsToInsert) {
        const compId = item.productId || item.id;
        const qty = parseInt(item.quantity || 1, 10);

        if (compId && qty > 0) {
          await db.query(
            `INSERT INTO kit_items (
              kit_id,
              product_id,
              quantity,
              sort_order
            )
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (kit_id, product_id)
            DO UPDATE SET quantity = EXCLUDED.quantity`,
            [
              created.id,
              compId,
              qty,
              itemSortOrder++,
            ]
          );
        }
      }
    }

    const catRes = await db.query(
      'SELECT name FROM categories WHERE id = $1',
      [catId]
    );

    const subCatRes = subCatId
      ? await db.query(
          'SELECT name FROM subcategories WHERE id = $1',
          [subCatId]
        )
      : { rows: [] };

    created.categoryName =
      catRes.rows[0]?.name || 'General';

    created.subCategoryName =
      subCatRes.rows[0]?.name || '';

    created.price = parseFloat(created.price || 0);

    created.oldPrice = created.oldPrice
      ? parseFloat(created.oldPrice)
      : null;

    created.weight = created.weight
      ? parseFloat(created.weight)
      : null;

    created.status =
      created.status === 1 ? 'Active' : 'Inactive';

    created.specifications =
      typeof created.specifications === 'object' &&
      created.specifications !== null
        ? created.specifications
        : {};

    return res.status(201).json({
      success: true,
      message: 'Product created successfully.',
      product: created,
    });
  } catch (err) {
    console.error('Create Product Error:', err);

    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to create product.',
    });
  }
};

// 3. Update Product
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
      brandId,
      newBrandName,
      newBrandLogoUrl,
      newBrand,
      description,
      hasVariants,
      isFeatured,
      isKit,
      is_kit,
      specifications,
      kitDiscountPercentage,
      kit_items,
      kitItems,
      sortOrder,
      metaTitle,
      metaDescription,
      image,
      images,
      status,
    } = req.body;

    const cleanName = String(name || '').trim();

    const catId = parseInt(categoryId, 10);

    const subCatId = subCategoryId
      ? parseInt(subCategoryId, 10)
      : null;

    const numPrice = parseFloat(price) || 0.0;

    const numOldPrice = oldPrice
      ? parseFloat(oldPrice)
      : null;

    const numWeight = weight
      ? parseFloat(weight)
      : null;

    const boolHasVariants = Boolean(hasVariants);
    const boolIsFeatured = Boolean(isFeatured);

    const boolIsKit =
      isKit !== undefined
        ? Boolean(isKit)
        : is_kit !== undefined
          ? Boolean(is_kit)
          : false;

    const specsJson =
      typeof specifications === 'object' &&
      specifications !== null
        ? JSON.stringify(specifications)
        : typeof specifications === 'string'
          ? specifications
          : '{}';

    const numKitDiscount =
      parseFloat(kitDiscountPercentage || 0) || 0.0;

    const numSortOrder = parseInt(sortOrder || '0', 10);

    const statusInt =
      String(status || 'Active').toLowerCase() === 'active' ||
      status === 1
        ? 1
        : 0;

    let imageList = [];

    if (Array.isArray(images) && images.length > 0) {
      imageList = images.filter(
        (img) => typeof img === 'string' && img.trim()
      );
    } else if (
      image &&
      typeof image === 'string' &&
      image.trim()
    ) {
      imageList = [image.trim()];
    }

    const primaryImage =
      imageList[0] ||
      (typeof image === 'string' ? image.trim() : '');

    const imagesJson = JSON.stringify(imageList);

    // Brand is updated using brand_id.
    const resolvedBrandId = await resolveBrandId(db, {
      brandId,
      newBrandName: newBrandName || newBrand?.name,
      newBrandLogoUrl:
        newBrandLogoUrl ||
        newBrand?.logoUrl ||
        newBrand?.logo_url,
    });

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
         brand_id = $8,
         description = $9,
         has_variants = $10,
         is_featured = $11,
         is_kit = $12,
         specifications = $13,
         kit_discount_percentage = $14,
         sort_order = $15,
         meta_title = $16,
         meta_description = $17,
         image_url = $18,
         images = $19,
         status = $20,
         updated_at = NOW()
       WHERE id = $21
       RETURNING
         id,
         category_id AS "categoryId",
         sub_category_id AS "subCategoryId",
         name,
         slug,
         sku,
         description,
         brand_id AS "brandId",
         price,
         old_price AS "oldPrice",
         weight,
         has_variants AS "hasVariants",
         is_featured AS "isFeatured",
         is_kit AS "isKit",
         specifications,
         kit_discount_percentage AS "kitDiscountPercentage",
         sort_order AS "sortOrder",
         meta_title AS "metaTitle",
         meta_description AS "metaDescription",
         image_url AS "image",
         images,
         status,
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [
        cleanName,
        catId,
        subCatId,
        sku || null,
        numPrice,
        numOldPrice,
        numWeight,
        resolvedBrandId,
        description || '',
        boolHasVariants,
        boolIsFeatured,
        boolIsKit,
        specsJson,
        numKitDiscount,
        numSortOrder,
        metaTitle || '',
        metaDescription || '',
        primaryImage,
        imagesJson,
        statusInt,
        id,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    // Update kit items if supplied.
    const itemsToUpdate = kit_items || kitItems;

    if (Array.isArray(itemsToUpdate)) {
      await db.query(
        'DELETE FROM kit_items WHERE kit_id = $1',
        [id]
      );

      let itemSortOrder = 0;

      for (const item of itemsToUpdate) {
        const compId = item.productId || item.id;
        const qty = parseInt(item.quantity || 1, 10);

        if (compId && qty > 0) {
          await db.query(
            `INSERT INTO kit_items (
              kit_id,
              product_id,
              quantity,
              sort_order
            )
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (kit_id, product_id)
            DO UPDATE SET quantity = EXCLUDED.quantity`,
            [
              id,
              compId,
              qty,
              itemSortOrder++,
            ]
          );
        }
      }
    }

    const updated = rows[0];

    const catRes = await db.query(
      'SELECT name FROM categories WHERE id = $1',
      [catId]
    );

    const subCatRes = subCatId
      ? await db.query(
          'SELECT name FROM subcategories WHERE id = $1',
          [subCatId]
        )
      : { rows: [] };

    updated.categoryName =
      catRes.rows[0]?.name || 'General';

    updated.subCategoryName =
      subCatRes.rows[0]?.name || '';

    updated.price = parseFloat(updated.price || 0);

    updated.oldPrice = updated.oldPrice
      ? parseFloat(updated.oldPrice)
      : null;

    updated.weight = updated.weight
      ? parseFloat(updated.weight)
      : null;

    updated.status =
      updated.status === 1 ? 'Active' : 'Inactive';

    return res.json({
      success: true,
      message: 'Product updated successfully.',
      product: updated,
    });
  } catch (err) {
    console.error('Update Product Error:', err);

    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to update product.',
    });
  }
};

// 4. Delete Product (Soft Delete)
export const deleteProduct = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await db.query(
      `UPDATE products
       SET status = 2, updated_at = NOW()
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.',
      });
    }

    return res.json({
      success: true,
      message: `Product ${id} deleted successfully.`,
    });
  } catch (err) {
    console.error('Delete Product Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to delete product.',
    });
  }
};

// 5. Bulk Import Products

// export const bulkImportProducts = async (req, res) => {
//   const client = await db.pool.connect();

//   try {
//     const { products } = req.body;

//     if (!Array.isArray(products) || products.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'No valid products provided for import.',
//       });
//     }

//     await client.query('BEGIN');

//     const createdProducts = [];

//     for (let i = 0; i < products.length; i++) {
//       const item = products[i];

//       const name = String(
//         item.name || item['Product Name'] || ''
//       ).trim();

//       if (!name) continue;

//       const catId = item.categoryId
//         ? parseInt(item.categoryId, 10)
//         : 1;

//       const subCatId = item.subCategoryId
//         ? parseInt(item.subCategoryId, 10)
//         : null;

//       const price =
//         parseFloat(item.price ?? item['Price']) || 0;

//       const oldPrice =
//         item.oldPrice || item['Old Price']
//           ? parseFloat(item.oldPrice ?? item['Old Price'])
//           : null;

//       const weight = item.weight
//         ? parseFloat(item.weight)
//         : null;

//       // Resolve the brand to brand_logos.id.
//       // A CSV brand name is reused or created by resolveBrandId.
//       const resolvedBrandId = await resolveBrandId(client, {
//         brandId: item.brandId ?? item.brand_id,
//         newBrandName:
//           item.newBrandName ||
//           item.newBrand?.name ||
//           item.brand ||
//           item.Brand,
//         newBrandLogoUrl:
//           item.newBrandLogoUrl ||
//           item.newBrand?.logoUrl ||
//           item.newBrand?.logo_url,
//       });

//       const sku = item.sku
//         ? String(item.sku).trim()
//         : `SKU-IMP-${Date.now().toString().slice(-4)}-${i}`;

//       const description = String(
//         item.description || item.Description || ''
//       ).trim();

//       const image = String(
//         item.image ||
//         item.image_url ||
//         item['Image URL'] ||
//         ''
//       ).trim();

//       const statusInt =
//         String(item.status || item.Status || 'Active')
//           .toLowerCase() === 'active'
//           ? 1
//           : 2;

//       const slug =
//         `${slugify(name)}-${Date.now().toString().slice(-4)}-${i}`;

//       const resInsert = await client.query(
//         `INSERT INTO products (
//           category_id,
//           sub_category_id,
//           name,
//           slug,
//           sku,
//           description,
//           brand_id,
//           price,
//           old_price,
//           weight,
//           image_url,
//           status
//         )
//         VALUES (
//           $1, $2, $3, $4, $5, $6,
//           $7, $8, $9, $10, $11, $12
//         )
//         RETURNING
//           id,
//           name,
//           slug,
//           sku,
//           category_id AS "categoryId",
//           sub_category_id AS "subCategoryId",
//           price,
//           old_price AS "oldPrice",
//           weight,
//           brand_id AS "brandId",
//           image_url AS "image",
//           status`,
//         [
//           catId,
//           subCatId,
//           name,
//           slug,
//           sku,
//           description,
//           resolvedBrandId,
//           price,
//           oldPrice,
//           weight,
//           image,
//           statusInt,
//         ]
//       );

//       const prod = resInsert.rows[0];

//       prod.price = parseFloat(prod.price || 0);
//       prod.oldPrice = prod.oldPrice
//         ? parseFloat(prod.oldPrice)
//         : null;
//       prod.weight = prod.weight
//         ? parseFloat(prod.weight)
//         : null;

//       prod.status =
//         prod.status === 1 ? 'Active' : 'Inactive';

//       createdProducts.push(prod);
//     }

//     await client.query('COMMIT');

//     return res.status(201).json({
//       success: true,
//       message: `Successfully imported ${createdProducts.length} products.`,
//       products: createdProducts,
//     });
//   } catch (err) {
//     await client.query('ROLLBACK');

//     console.error('Bulk Import Products Error:', err);

//     return res.status(500).json({
//       success: false,
//       message:
//         err.message || 'Failed to bulk import products.',
//     });
//   } finally {
//     client.release();
//   }
// };







export const bulkImportProducts = async (req, res) => {
  let client;
  let transactionStarted = false;

  const rowErrors = [];
  const createdProducts = [];

  const normalizeName = (value) =>
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '');

  const getValue = (item, ...keys) => {
    for (const key of keys) {
      if (item[key] !== undefined && item[key] !== null) {
        return item[key];
      }
    }
    return '';
  };

  const isBlank = (value) =>
    value === undefined ||
    value === null ||
    String(value).trim() === '';

  const findByName = (items, value, label) => {
    const normalized = normalizeName(value);

    const matches = items.filter(
      (entry) => normalizeName(entry.name) === normalized
    );

    if (matches.length > 1) {
      throw new Error(
        `${label} "${String(value).trim()}" matches multiple database records. Please resolve the duplicate names before importing.`
      );
    }

    return matches[0] || null;
  };

  const parseImages = (value) => {
    if (Array.isArray(value)) {
      return value
        .filter((image) => typeof image === 'string')
        .map((image) => image.trim())
        .filter(Boolean);
    }

    if (isBlank(value)) return [];

    const text = String(value).trim();

    // Also accept a JSON array if one is supplied.
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text);

        if (Array.isArray(parsed)) {
          return parsed
            .filter((image) => typeof image === 'string')
            .map((image) => image.trim())
            .filter(Boolean);
        }
      } catch {
        // Fall back to pipe-separated URLs.
      }
    }

    return text
      .split('|')
      .map((image) => image.trim())
      .filter(Boolean);
  };

  try {
    const { products } = req.body;

    if (!Array.isArray(products) || products.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid products provided for import.',
        rowErrors: [],
      });
    }

    client = await db.pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;

    // Load reference records once, rather than querying for every row.
    const [
      modulesResult,
      categoriesResult,
      subcategoriesResult,
      brandsResult,
    ] = await Promise.all([
      client.query(`
        SELECT id, name
        FROM modules
        WHERE status != 2
      `),
      client.query(`
        SELECT id, name
        FROM categories
        WHERE status != 2
      `),
      client.query(`
        SELECT id, name, category_id
        FROM subcategories
        WHERE status != 2
      `),
      client.query(`
        SELECT id, name
        FROM brand_logos
        WHERE status != 2
      `),
    ]);

    const modules = modulesResult.rows;
    const categories = categoriesResult.rows;
    const subcategories = subcategoriesResult.rows;
    const brands = brandsResult.rows;

    for (let i = 0; i < products.length; i++) {
      const item = products[i] || {};

      const name = String(
        getValue(item, 'name', 'Product Name')
      ).trim();

      const rowNumber = Number(
        item.__csvRowNumber || i + 2
      );

      if (!name) {
        rowErrors.push({
          rowNumber,
          productName: '',
          message: 'Product Name is required.',
        });
        continue;
      }

      await client.query('SAVEPOINT import_product_row');

      try {
        // 1. Resolve optional module name.
        const rawModuleName = getValue(
          item,
          'moduleName',
          'module_name',
          'Module Name'
        );

        let moduleId = null;

        if (!isBlank(rawModuleName)) {
          const module = findByName(
            modules,
            rawModuleName,
            'Module'
          );

          if (!module) {
            throw new Error(
              `Module "${String(rawModuleName).trim()}" does not exist.`
            );
          }

          moduleId = module.id;
        }

        // 2. Resolve required category name.
        const rawCategoryName = getValue(
          item,
          'categoryName',
          'category_name',
          'Category Name'
        );

        if (isBlank(rawCategoryName)) {
          throw new Error('Category Name is required.');
        }

        const category = findByName(
          categories,
          rawCategoryName,
          'Category'
        );

        if (!category) {
          throw new Error(
            `Category "${String(rawCategoryName).trim()}" does not exist.`
          );
        }

        const categoryId = category.id;

        // 3. Resolve optional sub-category and verify its parent.
        const rawSubcategoryName = getValue(
          item,
          'subCategoryName',
          'subcategoryName',
          'sub_category_name',
          'Subcategory Name',
          'Sub Category Name'
        );

        let subCategoryId = null;

        if (!isBlank(rawSubcategoryName)) {
          const subcategory = findByName(
            subcategories,
            rawSubcategoryName,
            'Sub-category'
          );

          if (!subcategory) {
            throw new Error(
              `Sub-category "${String(rawSubcategoryName).trim()}" does not exist.`
            );
          }

          if (
            String(subcategory.category_id) !==
            String(categoryId)
          ) {
            throw new Error(
              `Sub-category "${subcategory.name}" does not belong to category "${category.name}".`
            );
          }

          subCategoryId = subcategory.id;
        }

        // 4. Validate price and optional numeric values.
        const rawPrice = getValue(item, 'price', 'Price');

        if (isBlank(rawPrice)) {
          throw new Error('Price is required.');
        }

        const price = Number(rawPrice);

        if (!Number.isFinite(price) || price < 0) {
          throw new Error(
            `Price "${rawPrice}" must be a non-negative number.`
          );
        }

        const rawOldPrice = getValue(
          item,
          'oldPrice',
          'old_price',
          'Old Price'
        );

        let oldPrice = null;

        if (!isBlank(rawOldPrice)) {
          oldPrice = Number(rawOldPrice);

          if (!Number.isFinite(oldPrice) || oldPrice < 0) {
            throw new Error(
              `Old Price "${rawOldPrice}" must be a non-negative number.`
            );
          }
        }

        const rawWeight = getValue(item, 'weight', 'Weight');
        let weight = null;

        if (!isBlank(rawWeight)) {
          weight = Number(rawWeight);

          if (!Number.isFinite(weight) || weight < 0) {
            throw new Error(
              `Weight "${rawWeight}" must be a non-negative number.`
            );
          }
        }

        // 5. Resolve brand by normalized name.
        // Existing behavior is preserved: create a missing brand.
        const rawBrandName = getValue(
          item,
          'brandName',
          'brand_name',
          'brand',
          'Brand Name',
          'Brand'
        );

        let brandId = null;

        if (!isBlank(rawBrandName)) {
          let brand = findByName(
            brands,
            rawBrandName,
            'Brand'
          );

          if (brand) {
            brandId = brand.id;
          } else {
            brandId = await resolveBrandId(client, {
              newBrandName: String(rawBrandName).trim(),
              newBrandLogoUrl:
                item.newBrandLogoUrl ||
                item.brandLogoUrl ||
                item['Brand Logo URL'] ||
                '',
            });

            if (brandId) {
              const createdBrandResult = await client.query(
                `SELECT id, name
                 FROM brand_logos
                 WHERE id = $1`,
                [brandId]
              );

              if (createdBrandResult.rows[0]) {
                brands.push(createdBrandResult.rows[0]);
              }
            }
          }
        }

        // 6. Handle cover image separately from additional images.
        const coverImage = String(
          getValue(
            item,
            'coverImage',
            'cover_image',
            'image',
            'image_url',
            'Cover Image'
          )
        ).trim();

        const additionalImages = parseImages(
          getValue(
            item,
            'additionalImages',
            'additional_images',
            'Additional Images',
            'additional_image',
            'Additional Image'
          )
        );

        // Remove duplicates and exclude the cover from additional images.
        const seenImages = new Set(
          coverImage ? [coverImage] : []
        );

        const uniqueAdditionalImages = additionalImages.filter(
          (url) => {
            if (seenImages.has(url)) return false;
            seenImages.add(url);
            return true;
          }
        );

        // 7. Validate status.
        const rawStatus = String(
          getValue(item, 'status', 'Status') || 'Active'
        ).trim().toLowerCase();

        let statusInt;

        if (['active', '1'].includes(rawStatus)) {
          statusInt = 1;
        } else if (['inactive', '0'].includes(rawStatus)) {
          statusInt = 0;
        } else {
          throw new Error(
            `Status "${rawStatus}" is invalid. Use Active or Inactive.`
          );
        }

        // 8. Prepare remaining product fields.
        const rawSku = getValue(item, 'sku', 'SKU');

        const sku = !isBlank(rawSku)
          ? String(rawSku).trim()
          : `SKU-IMP-${Date.now()}-${i}`;

        const description = String(
          getValue(item, 'description', 'Description')
        ).trim();

        const slug = `${slugify(name)}-${Date.now()}-${i}`;

        // 9. Insert exact resolved foreign-key IDs.
        const insertResult = await client.query(
          `INSERT INTO products (
            module_id,
            category_id,
            sub_category_id,
            name,
            slug,
            sku,
            description,
            brand_id,
            price,
            old_price,
            weight,
            image_url,
            images,
            status
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7,
            $8, $9, $10, $11, $12, $13, $14
          )
          RETURNING
            id,
            module_id AS "moduleId",
            category_id AS "categoryId",
            sub_category_id AS "subCategoryId",
            name,
            slug,
            sku,
            description,
            brand_id AS "brandId",
            price,
            old_price AS "oldPrice",
            weight,
            image_url AS "image",
            images,
            status`,
          [
            moduleId,
            categoryId,
            subCategoryId,
            name,
            slug,
            sku,
            description,
            brandId,
            price,
            oldPrice,
            weight,
            coverImage,
            JSON.stringify(uniqueAdditionalImages),
            statusInt,
          ]
        );

        const prod = insertResult.rows[0];

        prod.images = Array.isArray(prod.images)
          ? prod.images
          : typeof prod.images === 'string'
            ? JSON.parse(prod.images)
            : [];

        prod.price = Number(prod.price || 0);
        prod.oldPrice =
          prod.oldPrice !== null
            ? Number(prod.oldPrice)
            : null;
        prod.weight =
          prod.weight !== null
            ? Number(prod.weight)
            : null;
        prod.status = prod.status === 1
          ? 'Active'
          : 'Inactive';

        createdProducts.push({
          ...prod,
          csvRowNumber: rowNumber,
        });

        await client.query(
          'RELEASE SAVEPOINT import_product_row'
        );
      } catch (rowError) {
        await client.query(
          'ROLLBACK TO SAVEPOINT import_product_row'
        );
        await client.query(
          'RELEASE SAVEPOINT import_product_row'
        );

        rowErrors.push({
          rowNumber,
          productName: name,
          message: rowError.message ||
            'This product could not be imported.',
        });
      }
    }

    await client.query('COMMIT');
    transactionStarted = false;

    return res.status(200).json({
      success: createdProducts.length > 0,
      message: createdProducts.length > 0
        ? `Imported ${createdProducts.length} product(s). ${rowErrors.length} row(s) skipped.`
        : 'No products were imported. Please review the row errors.',
      count: createdProducts.length,
      products: createdProducts,
      rowErrors,
    });
  } catch (err) {
    if (client && transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Bulk import rollback error:', rollbackError);
      }
    }

    console.error('Bulk Import Products Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to process the product CSV import.',
      rowErrors,
    });
  } finally {
    if (client) client.release();
  }
};

// export const bulkImportProducts = async (req, res) => {
//   let client;
//   let transactionStarted = false;
//   let currentRow = null;

//   try {
//     const { products } = req.body;

//     if (!Array.isArray(products) || products.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'No valid products provided for import.',
//       });
//     }

//     client = await db.pool.connect();

//     await client.query('BEGIN');
//     transactionStarted = true;

//     const createdProducts = [];

//     for (let i = 0; i < products.length; i++) {
//       const item = products[i] || {};

//       const name = String(
//         item.name || item['Product Name'] || ''
//       ).trim();

//       // Preserve the existing behavior of skipping empty product names.
//       if (!name) continue;

//       // CSV row 1 is assumed to contain the column headings.
//       currentRow = {
//         number: i + 2,
//         name,
//       };

//       try {
//         // ---------------------------------------------------------
//         // 1. Validate category ID
//         // ---------------------------------------------------------
//         const rawCategoryId =
//           item.categoryId ??
//           item.category_id ??
//           item['Category ID'];

//         if (
//           rawCategoryId === undefined ||
//           rawCategoryId === null ||
//           String(rawCategoryId).trim() === ''
//         ) {
//           throw new Error('Category ID is required.');
//         }

//         const catId = Number(rawCategoryId);

//         if (!Number.isSafeInteger(catId) || catId <= 0) {
//           throw new Error(
//             `Category ID "${rawCategoryId}" is invalid. Please provide a valid numeric category ID.`
//           );
//         }

//         const categoryResult = await client.query(
//           `SELECT id, name
//            FROM categories
//            WHERE id = $1
//              AND status != 2`,
//           [catId]
//         );

//         if (categoryResult.rows.length === 0) {
//           throw new Error(
//             `Category ID ${catId} does not exist or has been deleted. Please check the category ID in your CSV.`
//           );
//         }

//         // ---------------------------------------------------------
//         // 2. Validate subcategory ID and category relationship
//         // ---------------------------------------------------------
//         const rawSubCategoryId =
//           item.subCategoryId ??
//           item.sub_category_id ??
//           item['Subcategory ID'];

//         let subCatId = null;

//         if (
//           rawSubCategoryId !== undefined &&
//           rawSubCategoryId !== null &&
//           String(rawSubCategoryId).trim() !== ''
//         ) {
//           subCatId = Number(rawSubCategoryId);

//           if (
//             !Number.isSafeInteger(subCatId) ||
//             subCatId <= 0
//           ) {
//             throw new Error(
//               `Subcategory ID "${rawSubCategoryId}" is invalid. Please provide a valid numeric subcategory ID.`
//             );
//           }

//           const subcategoryResult = await client.query(
//             `SELECT id, name, category_id
//              FROM subcategories
//              WHERE id = $1
//                AND status != 2`,
//             [subCatId]
//           );

//           if (subcategoryResult.rows.length === 0) {
//             throw new Error(
//               `Subcategory ID ${subCatId} does not exist or has been deleted. Please check the subcategory ID in your CSV.`
//             );
//           }

//           const subcategory = subcategoryResult.rows[0];

//           if (Number(subcategory.category_id) !== catId) {
//             throw new Error(
//               `Subcategory "${subcategory.name}" (ID ${subCatId}) does not belong to category "${categoryResult.rows[0].name}" (ID ${catId}). Please select a subcategory belonging to the selected category.`
//             );
//           }
//         }

//         // ---------------------------------------------------------
//         // 3. Validate price and optional numeric fields
//         // ---------------------------------------------------------
//         const rawPrice = item.price ?? item['Price'];

//         if (
//           rawPrice === undefined ||
//           rawPrice === null ||
//           String(rawPrice).trim() === ''
//         ) {
//           throw new Error('Product price is required.');
//         }

//         const price = Number(rawPrice);

//         if (!Number.isFinite(price) || price < 0) {
//           throw new Error(
//             `Price "${rawPrice}" is invalid. Please provide a valid non-negative number.`
//           );
//         }

//         const rawOldPrice =
//           item.oldPrice ?? item['Old Price'];

//         let oldPrice = null;

//         if (
//           rawOldPrice !== undefined &&
//           rawOldPrice !== null &&
//           String(rawOldPrice).trim() !== ''
//         ) {
//           oldPrice = Number(rawOldPrice);

//           if (!Number.isFinite(oldPrice) || oldPrice < 0) {
//             throw new Error(
//               `Old Price "${rawOldPrice}" is invalid. Please provide a valid non-negative number.`
//             );
//           }
//         }

//         let weight = null;

//         if (
//           item.weight !== undefined &&
//           item.weight !== null &&
//           String(item.weight).trim() !== ''
//         ) {
//           weight = Number(item.weight);

//           if (!Number.isFinite(weight) || weight < 0) {
//             throw new Error(
//               `Weight "${item.weight}" is invalid. Please provide a valid non-negative number.`
//             );
//           }
//         }

//         // ---------------------------------------------------------
//         // 4. Resolve brand using the existing helper
//         // ---------------------------------------------------------
//         const resolvedBrandId = await resolveBrandId(client, {
//           brandId: item.brandId ?? item.brand_id,
//           newBrandName:
//             item.newBrandName ||
//             item.newBrand?.name ||
//             item.brand ||
//             item.Brand,
//           newBrandLogoUrl:
//             item.newBrandLogoUrl ||
//             item.brandLogoUrl ||
//             item['Brand Logo URL'] ||
//             item.newBrand?.logoUrl ||
//             item.newBrand?.logo_url,
//         });

//         // ---------------------------------------------------------
//         // 5. Prepare product fields
//         // ---------------------------------------------------------
//         const sku = item.sku
//           ? String(item.sku).trim()
//           : `SKU-IMP-${Date.now()}-${i}`;

//         const description = String(
//           item.description || item.Description || ''
//         ).trim();

//         // const image = String(
//         //   item.image ||
//         //   item.image_url ||
//         //   item['Image URL'] ||
//         //   ''
//         // ).trim();
//         // Support multiple image URLs while retaining single-image CSV support.
// const imageList = [];
// const seenImages = new Set();

// const addImage = (value) => {
//   if (typeof value !== 'string' || !value.trim()) return;

//   const url = value.trim();

//   if (!seenImages.has(url)) {
//     seenImages.add(url);
//     imageList.push(url);
//   }
// };

// // Existing single-image fields remain supported.
// addImage(item.image);
// addImage(item.image_url);
// addImage(item['Image URL']);

// // Support the images array sent by the frontend.
// if (Array.isArray(item.images)) {
//   item.images.forEach(addImage);
// }

// // Support CSV columns such as Image URL 2, Image URL 3, etc.
// for (const [key, value] of Object.entries(item)) {
//   if (/^image(?:\s*url)?\s*\d+$/i.test(key.trim())) {
//     addImage(value);
//   }
// }

// // The first image remains the primary image for existing components.
// const image = imageList[0] || '';
// const imagesJson = JSON.stringify(imageList);

//         const rawStatus = String(
//           item.status ?? item.Status ?? 'Active'
//         ).trim().toLowerCase();

//         let statusInt;

//         if (
//           ['active', '1'].includes(rawStatus)
//         ) {
//           statusInt = 1;
//         } else if (
//           ['inactive', '0'].includes(rawStatus)
//         ) {
//           statusInt = 0;
//         } else {
//           throw new Error(
//             `Status "${rawStatus}" is invalid. Use Active or Inactive.`
//           );
//         }

//         const slug =
//           `${slugify(name)}-${Date.now()}-${i}`;

//         // ---------------------------------------------------------
//         // 6. Insert product with validated category/subcategory IDs
//         // ---------------------------------------------------------
//         // const insertResult = await client.query(
//         //   `INSERT INTO products (
//         //     category_id,
//         //     sub_category_id,
//         //     name,
//         //     slug,
//         //     sku,
//         //     description,
//         //     brand_id,
//         //     price,
//         //     old_price,
//         //     weight,
//         //     image_url,
//         //     status
//         //   )
//         //   VALUES (
//         //     $1, $2, $3, $4, $5, $6,
//         //     $7, $8, $9, $10, $11, $12
//         //   )
//         //   RETURNING
//         //     id,
//         //     name,
//         //     slug,
//         //     sku,
//         //     category_id AS "categoryId",
//         //     sub_category_id AS "subCategoryId",
//         //     price,
//         //     old_price AS "oldPrice",
//         //     weight,
//         //     brand_id AS "brandId",
//         //     image_url AS "image",
//         //     status`,
//         //   [
//         //     catId,
//         //     subCatId,
//         //     name,
//         //     slug,
//         //     sku,
//         //     description,
//         //     resolvedBrandId,
//         //     price,
//         //     oldPrice,
//         //     weight,
//         //     image,
//         //     statusInt,
//         //   ]
//         // );

//         const insertResult = await client.query(
//   `INSERT INTO products (
//     category_id,
//     sub_category_id,
//     name,
//     slug,
//     sku,
//     description,
//     brand_id,
//     price,
//     old_price,
//     weight,
//     image_url,
//     images,
//     status
//   )
//   VALUES (
//     $1, $2, $3, $4, $5, $6,
//     $7, $8, $9, $10, $11, $12, $13
//   )
//   RETURNING
//     id,
//     name,
//     slug,
//     sku,
//     category_id AS "categoryId",
//     sub_category_id AS "subCategoryId",
//     price,
//     old_price AS "oldPrice",
//     weight,
//     brand_id AS "brandId",
//     image_url AS "image",
//     images,
//     status`,
//   [
//     catId,
//     subCatId,
//     name,
//     slug,
//     sku,
//     description,
//     resolvedBrandId,
//     price,
//     oldPrice,
//     weight,
//     image,
//     imagesJson,
//     statusInt,
//   ]
// );

//         const prod = insertResult.rows[0];
//         prod.images = Array.isArray(prod.images)
//   ? prod.images
//   : typeof prod.images === 'string'
//     ? JSON.parse(prod.images)
//     : prod.image
//       ? [prod.image]
//       : [];

//         prod.price = Number(prod.price || 0);

//         prod.oldPrice =
//           prod.oldPrice !== null
//             ? Number(prod.oldPrice)
//             : null;

//         prod.weight =
//           prod.weight !== null
//             ? Number(prod.weight)
//             : null;

//         prod.status =
//           prod.status === 1 ? 'Active' : 'Inactive';

//         createdProducts.push(prod);
//       } catch (rowError) {
//         const isDatabaseError = Boolean(rowError.code);

//         const wrappedError = new Error(
//           `CSV row ${currentRow.number} (Product: "${currentRow.name}"): ${
//             isDatabaseError
//               ? 'The product could not be saved because one or more values conflict with database rules. Please check the SKU and required fields.'
//               : rowError.message
//           }`
//         );

//         if (rowError.code) {
//           wrappedError.code = rowError.code;
//         }

//         throw wrappedError;
//       }
//     }

//     if (createdProducts.length === 0) {
//       throw new Error(
//         'No products were imported. Please check that your CSV contains valid product names.'
//       );
//     }

//     await client.query('COMMIT');
//     transactionStarted = false;

//     return res.status(201).json({
//       success: true,
//       message: `Successfully imported ${createdProducts.length} products.`,
//       count: createdProducts.length,
//       products: createdProducts,
//     });
//   } catch (err) {
//     if (client && transactionStarted) {
//       try {
//         await client.query('ROLLBACK');
//       } catch (rollbackError) {
//         console.error(
//           'Bulk Import Rollback Error:',
//           rollbackError
//         );
//       }
//     }

//     console.error('Bulk Import Products Error:', err);

//     const message =
//       err.message || 'Failed to bulk import products.';

//     // Validation errors and database constraint errors are handled
//     // without returning raw database details to the frontend.
//     const isValidationError =
//       /CSV row \d+|No valid products|No products were imported/i.test(
//         message
//       );

//     const isDatabaseConstraintError = [
//       '23502', // not_null_violation
//       '23503', // foreign_key_violation
//       '23505', // unique_violation
//       '23514', // check_violation
//       '22P02', // invalid_text_representation
//     ].includes(err.code);

//     const userMessage = isDatabaseConstraintError
//       ? currentRow
//         ? `CSV row ${currentRow.number} (Product: "${currentRow.name}"): The product contains a value that conflicts with the database rules. Please check the category, subcategory, SKU, price, and other required fields.`
//         : 'The import contains a value that conflicts with the database rules. Please check your CSV and try again.'
//       : message;

//     return res.status(
//       isValidationError || isDatabaseConstraintError
//         ? 400
//         : 500
//     ).json({
//       success: false,
//       message: userMessage,
//     });
//   } finally {
//     if (client) {
//       client.release();
//     }
//   }
// };


// updated code

export const getProducts = async (req, res) => {
  try {
//     const { rows } = await db.query(`
//       SELECT
//         p.id,
//         p.module_id AS "moduleId",
// m.name AS "moduleName",
//         p.category_id AS "categoryId",
//         c.name AS "categoryName",
//         p.sub_category_id AS "subCategoryId",
//         sc.name AS "subCategoryName",
//         p.name,
//         p.slug,
//         p.sku,
//         p.description,
//         p.brand_id AS "brandId",
//         bl.name AS brand,
//         bl.logo_url AS "brandLogoUrl",
//         p.price,
//         p.old_price AS "oldPrice",
//         p.weight,
//         p.has_variants AS "hasVariants",
//         p.is_featured AS "isFeatured",
//         p.is_kit AS "isKit",
//         p.specifications,
//         p.kit_discount_percentage AS "kitDiscountPercentage",

//         (
//           SELECT json_agg(
//             json_build_object(
//               'productId', ki.product_id,
//               'quantity', ki.quantity,
//               'name', cp.name,
//               'sku', cp.sku,
//               'price', cp.price::numeric
//             )
//             ORDER BY ki.sort_order ASC
//           )
//           FROM kit_items ki
//           JOIN products cp ON ki.product_id = cp.id
//           WHERE ki.kit_id = p.id
//         ) AS "kitItems",

//         (
//           SELECT COUNT(*)::int
//           FROM kit_items ki
//           WHERE ki.kit_id = p.id
//         ) AS "componentsCount",

//         p.sort_order AS "sortOrder",
//         p.meta_title AS "metaTitle",
//         p.meta_description AS "metaDescription",
//         p.image_url AS "image",
//         p.images AS "images",
//         p.status,
//         p.created_at AS "createdAt",
//         p.updated_at AS "updatedAt"

//       FROM products p
//       LEFT JOIN categories c
//         ON p.category_id = c.id
//         AND c.status != 2
//       LEFT JOIN subcategories sc
//         ON p.sub_category_id = sc.id
//         AND sc.status != 2
//       LEFT JOIN brand_logos bl
//         ON p.brand_id = bl.id
//         AND bl.status != 2
//         LEFT JOIN modules m
//   ON p.module_id = m.id

//       WHERE p.status != 2
//       ORDER BY p.id DESC
//     `);


const { rows } = await db.query(`
  SELECT
    p.id,

    -- Module
    p.module_id AS "moduleId",
    m.name AS "moduleName",

    -- Category
    p.category_id AS "categoryId",
    c.name AS "categoryName",

    -- Subcategory
    p.sub_category_id AS "subCategoryId",
    sc.name AS "subCategoryName",

    p.name,
    p.slug,
    p.sku,
    p.description,
    p.brand_id AS "brandId",
    bl.name AS brand,
    bl.logo_url AS "brandLogoUrl",
    p.price,
    p.old_price AS "oldPrice",
    p.weight,
    p.has_variants AS "hasVariants",
    p.is_featured AS "isFeatured",
    p.is_kit AS "isKit",
    p.specifications,
    p.kit_discount_percentage AS "kitDiscountPercentage",

    -- Keep your existing kitItems and componentsCount subqueries here

    p.sort_order AS "sortOrder",
    p.meta_title AS "metaTitle",
    p.meta_description AS "metaDescription",
    p.image_url AS "image",
    p.images AS "images",
    p.status,
    p.created_at AS "createdAt",
    p.updated_at AS "updatedAt"

  FROM products p

  LEFT JOIN modules m
    ON p.module_id = m.id

  LEFT JOIN categories c
    ON p.category_id = c.id
    AND c.status != 2

  LEFT JOIN subcategories sc
    ON p.sub_category_id = sc.id
    AND sc.status != 2

  LEFT JOIN brand_logos bl
    ON p.brand_id = bl.id
    AND bl.status != 2

  WHERE p.status != 2
  ORDER BY p.id DESC
`);
    const products = rows.map((prod) => ({
      ...prod,
      price: parseFloat(prod.price || 0),
      oldPrice: prod.oldPrice
        ? parseFloat(prod.oldPrice)
        : null,
      weight: prod.weight
        ? parseFloat(prod.weight)
        : null,
      status: prod.status === 1 ? 'Active' : 'Inactive',
      specifications:
        typeof prod.specifications === 'object' &&
        prod.specifications !== null
          ? prod.specifications
          : {},
      images: (() => {
        if (Array.isArray(prod.images)) return prod.images;
        if (typeof prod.images === 'string') {
          try {
            const parsed = JSON.parse(prod.images);
            if (Array.isArray(parsed)) return parsed;
            if (parsed) return [parsed];
          } catch {
            return prod.images.split(',').map((s) => s.trim()).filter(Boolean);
          }
        }
        return prod.image ? [prod.image] : [];
      })(),
      kitItems: prod.kitItems || [],
    }));

    return res.json({
      success: true,
      count: products.length,
      products,
    });
  } catch (err) {
    console.error('Get Products Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch products.',
    });
  }
};
