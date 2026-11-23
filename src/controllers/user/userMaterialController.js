
import db from "../../config/db.js";

// GET ALL ACTIVE MATERIALS
export const getActiveMaterials = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT
        id,
        name,
        description,
        price_per_cm3
       FROM print_materials
       WHERE is_active = TRUE
       ORDER BY id ASC`
    );

    return res.status(200).json({
      success: true,
      message: "Materials fetched successfully",
      data: result.rows,
    });
  } catch (error) {
    console.error("Get active materials error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch materials",
    });
  }
};

// GET ACTIVE MATERIAL BY ID
export const getActiveMaterialById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1) {
      return res.status(400).json({
        success: false,
        message: "Invalid material ID",
      });
    }

    const result = await db.query(
      `SELECT
        id,
        name,
        description,
        price_per_cm3
       FROM print_materials
       WHERE id = $1
       AND is_active = TRUE`,
      [Number(id)]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Material not found or unavailable",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Material fetched successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Get active material by ID error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch material",
    });
  }
};
