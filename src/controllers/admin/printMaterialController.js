
import db from "../../config/db.js";

// CREATE MATERIAL
export const createMaterial = async (req, res) => {
  try {
    const { name, description, price_per_cm3 } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({
        success: false,
        message: "Material name is required",
      });
    }

    const price = Number(price_per_cm3);

    if (
      price_per_cm3 === undefined ||
      price_per_cm3 === null ||
      price_per_cm3 === "" ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid material price is required",
      });
    }

    const result = await db.query(
      `INSERT INTO print_materials
       (name, description, price_per_cm3)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name.trim(), description?.trim() || null, price]
    );

    return res.status(201).json({
      success: true,
      message: "Material created successfully",
      data: result.rows[0],
    });

  } catch (error) {
    console.error("Create material error:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Material already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to create material",
    });
  }
};


// GET ALL MATERIALS
export const getAllMaterials = async (req, res) => {
  try {
    const { includeInactive } = req.query;

    const result = await db.query(
      `SELECT *
       FROM print_materials
       WHERE ($1::boolean = TRUE OR is_active = TRUE)
       ORDER BY created_at DESC`,
      [includeInactive === "true"]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });

  } catch (error) {
    console.error("Get materials error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch materials",
    });
  }
};


// GET MATERIAL BY ID
export const getMaterialById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid material ID",
      });
    }

    const result = await db.query(
      `SELECT * FROM print_materials WHERE id = $1`,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Material not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });

  } catch (error) {
    console.error("Get material error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch material",
    });
  }
};


// UPDATE MATERIAL
export const updateMaterial = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price_per_cm3 } = req.body;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid material ID",
      });
    }

if (typeof name !== "string" || !name.trim()) {      return res.status(400).json({
        success: false,
        message: "Material name is required",
      });
    }

    const price = Number(price_per_cm3);

    if (
      price_per_cm3 === undefined ||
      price_per_cm3 === null ||
      price_per_cm3 === "" ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid material price is required",
      });
    }

    const result = await db.query(
      `UPDATE print_materials
       SET name = $1,
           description = $2,
           price_per_cm3 = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [name.trim(), description?.trim() || null, price, id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Material not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Material updated successfully",
      data: result.rows[0],
    });

  } catch (error) {
    console.error("Update material error:", error);

    if (error.code === "23505") {
      return res.status(409).json({
        success: false,
        message: "Material name already exists",
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to update material",
    });
  }
};


// ACTIVATE / DEACTIVATE MATERIAL
export const updateMaterialStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid material ID",
      });
    }

    if (typeof is_active !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "is_active must be boolean",
      });
    }

    const result = await db.query(
      `UPDATE print_materials
       SET is_active = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [is_active, id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Material not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Material status updated successfully",
      data: result.rows[0],
    });

  } catch (error) {
    console.error("Update material status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update material status",
    });
  }
};
