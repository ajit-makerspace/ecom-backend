import db from '../../config/db.js';


export const getProductsAsPerModule = async (req, res) => {
  try {
    const { moduleId } = req.params;
       if (!Number.isInteger(Number(moduleId))) {
     return res.status(400).json({ success: false, message: "Invalid module id" });
   }
    const limit = Math.min(Number(req.query.limit) || 8, 50);

    const moduleRes = await db.query(
      `SELECT id, name, image_url AS "imageUrl"
         FROM modules
        WHERE id = $1`,
      [moduleId]
    );

    if (moduleRes.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Module not found" });
    }

    const productsRes = await db.query(
      `SELECT p.*
         FROM products p
         JOIN categories c ON c.id = p.category_id
        WHERE c.module_id = $1 
        ORDER BY p.is_featured DESC, p.id DESC
        LIMIT $2`,
      [moduleId, limit]
    );

    return res.json({
      success: true,
      module: moduleRes.rows[0],
      products: productsRes.rows,
    });
  } catch (err) {
    console.error("getProductsAsPerModule error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Server error" });
  }
};


export const getUserModules = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, name, image_url AS "imageUrl"
         FROM modules
        ORDER BY id ASC`
    );

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