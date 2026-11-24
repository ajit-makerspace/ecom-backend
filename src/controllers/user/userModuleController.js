import db from '../../config/db.js';


// export const getProductsAsPerModule = async (req, res) => {
//   try {
//     const { moduleId } = req.params;
//        if (!Number.isInteger(Number(moduleId))) {
//      return res.status(400).json({ success: false, message: "Invalid module id" });
//    }
//     const limit = Math.min(Number(req.query.limit) || 8, 50);

//     const moduleRes = await db.query(
//       `SELECT id, name, image_url AS "imageUrl"
//          FROM modules
//         WHERE id = $1`,
//       [moduleId]
//     );

//     if (moduleRes.rows.length === 0) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Module not found" });
//     }

//     const productsRes = await db.query(
//       `SELECT p.*
//          FROM products p
//          JOIN categories c ON c.id = p.category_id
//         WHERE c.module_id = $1 
//         ORDER BY p.is_featured DESC, p.id DESC
//         LIMIT $2`,
//       [moduleId, limit]
//     );

//     return res.json({
//       success: true,
//       module: moduleRes.rows[0],
//       products: productsRes.rows,
//     });
//   } catch (err) {
//     console.error("getProductsAsPerModule error:", err);
//     return res
//       .status(500)
//       .json({ success: false, message: "Server error" });
//   }
// };



// export const getProductsAsPerModule = async (req, res) => {
//   try {
//     const { moduleId } = req.params;
//     const { is_kit } = req.query;

//     if (!Number.isInteger(Number(moduleId))) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid module id",
//       });
//     }

//     const limit = Math.min(Number(req.query.limit) || 8, 50);

//     const moduleRes = await db.query(
//       `SELECT id, name, image_url AS "imageUrl"
//        FROM modules
//        WHERE id = $1`,
//       [moduleId]
//     );

//     if (moduleRes.rows.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: "Module not found",
//       });
//     }

//     let productsQuery = `
//       SELECT p.*
//       FROM products p
//       JOIN categories c ON c.id = p.category_id
//       WHERE c.module_id = $1
//     `;

//     const params = [moduleId];

//     // Optional filter by kit or single product
//     if (is_kit === "true") {
//       productsQuery += " AND p.is_kit = true";
//     } else if (is_kit === "false") {
//       productsQuery += " AND p.is_kit = false";
//     }

//     productsQuery += `
//       ORDER BY p.is_featured DESC, p.id DESC
//       LIMIT $2
//     `;

//     params.push(limit);

//     const productsRes = await db.query(productsQuery, params);

//     return res.json({
//       success: true,
//       module: moduleRes.rows[0],
//       products: productsRes.rows,
//     });
//   } catch (err) {
//     console.error("getProductsAsPerModule error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Server error",
//     });
//   }
// };


export const getUserModules = async (req, res) => {
  try {
    const minKits = parseInt(req.query.min_kits, 10) || (req.query.has_kits === 'true' ? 1 : 0);
    const limit = parseInt(req.query.limit, 10) || null;

    let query = `
      SELECT m.id, m.name, m.slug, m.image_url AS "imageUrl"
      FROM modules m
      WHERE m.status = 1
    `;
    const params = [];

    if (minKits > 0) {
      params.push(minKits);
      query += ` AND (
        SELECT COUNT(*) FROM products p 
        WHERE p.module_id = m.id AND p.is_kit = true AND p.status = 1
      ) >= $${params.length}`;
    }

    query += ` ORDER BY m.id ASC`;

    if (limit && limit > 0) {
      params.push(limit);
      query += ` LIMIT $${params.length}`;
    }

    const result = await db.query(query, params);
    return res.json({
      success: true,
      modules: result.rows,
    });
  } catch (err) {
    console.error("getModules error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error" });
  }
};

// updated code

// export const getProductsAsPerModule = async (req, res) => {
//   try {
//     const { categoryId } = req.params;
//     const { is_kit } = req.query;

//     if (!Number.isInteger(Number(categoryId))) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid category id",
//       });
//     }

//     const limit = Math.min(Number(req.query.limit) || 8, 50);

//     const categoryRes = await db.query(
//       `SELECT id, name
//        FROM categories
//        WHERE id = $1`,
//       [categoryId]
//     );

//     if (categoryRes.rows.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: "Category not found",
//       });
//     }

//     let productsQuery = `
//       SELECT p.*
//       FROM products p
//       WHERE p.category_id = $1
//     `;

//     const params = [categoryId];


//     if (is_kit === "true") {
//       productsQuery += " AND p.is_kit = true";
//     } else if (is_kit === "false") {
//       productsQuery += " AND p.is_kit = false";
//     }

//     productsQuery += `
//       ORDER BY p.is_featured DESC, p.id DESC
//       LIMIT $2
//     `;

//     params.push(limit);

//     const productsRes = await db.query(productsQuery, params);

//     return res.json({
//       success: true,
//       module: categoryRes.rows[0],
//       products: productsRes.rows,
//     });
//   } catch (err) {
//     console.error("getProductsAsPerModule error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Server error",
//     });
//   }
// };
export const getProductsAsPerModule = async (req, res) => {
  try {
    const { moduleId } = req.params;
    const { is_kit } = req.query;

    if (!Number.isInteger(Number(moduleId)) || Number(moduleId) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid module id",
      });
    }

    const limit = Math.min(Number(req.query.limit) || 8, 50);

    let productsQuery = `
      SELECT p.*
      FROM products p
      WHERE p.module_id = $1
    `;

    const params = [Number(moduleId)];

    // Optional filter by kit or single product
    if (is_kit === "true") {
      productsQuery += " AND p.is_kit = true";
    } else if (is_kit === "false") {
      productsQuery += " AND p.is_kit = false";
    }

    productsQuery += `
      ORDER BY p.is_featured DESC, p.id DESC
      LIMIT $2
    `;

    params.push(limit);

    const productsRes = await db.query(productsQuery, params);

    return res.json({
      success: true,
      moduleId: Number(moduleId),
      products: productsRes.rows,
    });
  } catch (err) {
    console.error("getProductsAsPerModule error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};


