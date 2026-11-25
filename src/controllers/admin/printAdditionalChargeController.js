
import db from "../../config/db.js";

const VALID_CHARGE_TYPES = ["fixed", "per_cm3", "percentage"];

const VALID_PERCENTAGE_BASES = [
  "material_cost",
  "printing_cost",
  "subtotal",
];

// CREATE ADDITIONAL CHARGE
export const createAdditionalCharge = async (req, res) => {
  try {
    const {
      charge_name,
      description,
      charge_type,
      charge_value,
      percentage_base,
      calculation_order = 0,
    } = req.body;

    if (
      typeof charge_name !== "string" ||
      !charge_name.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Charge name is required",
      });
    }

    if (!VALID_CHARGE_TYPES.includes(charge_type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid charge type",
      });
    }

    const value = Number(charge_value);

    if (
      charge_value === undefined ||
      charge_value === null ||
      charge_value === "" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid charge value is required",
      });
    }

    if (
      charge_type === "percentage" &&
      !VALID_PERCENTAGE_BASES.includes(percentage_base)
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid percentage base is required",
      });
    }

    if (
      charge_type !== "percentage" &&
      percentage_base !== undefined &&
      percentage_base !== null &&
      percentage_base !== ""
    ) {
      return res.status(400).json({
        success: false,
        message: "Percentage base is only allowed for percentage charges",
      });
    }

    const order = Number(calculation_order);

    if (
      !Number.isInteger(order) ||
      order < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Calculation order must be a non-negative integer",
      });
    }

    const result = await db.query(
      `INSERT INTO print_additional_charges
       (
         charge_name,
         description,
         charge_type,
         charge_value,
         percentage_base,
         calculation_order
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        charge_name.trim(),
        description?.trim() || null,
        charge_type,
        value,
        charge_type === "percentage" ? percentage_base : null,
        order,
      ]
    );

    return res.status(201).json({
      success: true,
      message: "Additional charge created successfully",
      data: result.rows[0],
    });

  } catch (error) {
    console.error("Create additional charge error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to create additional charge",
    });
  }
};


// GET ALL ADDITIONAL CHARGES
export const getAllAdditionalCharges = async (req, res) => {
  try {
    const { includeInactive } = req.query;

    const result = await db.query(
      `SELECT *
       FROM print_additional_charges
       WHERE ($1::boolean = TRUE OR is_active = TRUE)
       ORDER BY calculation_order ASC, created_at DESC`,
      [includeInactive === "true"]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });

  } catch (error) {
    console.error("Get additional charges error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch additional charges",
    });
  }
};


// GET ADDITIONAL CHARGE BY ID
export const getAdditionalChargeById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid additional charge ID",
      });
    }

    const result = await db.query(
      `SELECT *
       FROM print_additional_charges
       WHERE id = $1`,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Additional charge not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });

  } catch (error) {
    console.error("Get additional charge error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch additional charge",
    });
  }
};


// UPDATE ADDITIONAL CHARGE
export const updateAdditionalCharge = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      charge_name,
      description,
      charge_type,
      charge_value,
      percentage_base,
      calculation_order,
    } = req.body;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid additional charge ID",
      });
    }

    if (
      typeof charge_name !== "string" ||
      !charge_name.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: "Charge name is required",
      });
    }

    if (!VALID_CHARGE_TYPES.includes(charge_type)) {
      return res.status(400).json({
        success: false,
        message: "Invalid charge type",
      });
    }

    const value = Number(charge_value);

    if (
      charge_value === undefined ||
      charge_value === null ||
      charge_value === "" ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid charge value is required",
      });
    }

    if (
      charge_type === "percentage" &&
      !VALID_PERCENTAGE_BASES.includes(percentage_base)
    ) {
      return res.status(400).json({
        success: false,
        message: "Valid percentage base is required",
      });
    }

    if (
      charge_type !== "percentage" &&
      percentage_base !== undefined &&
      percentage_base !== null &&
      percentage_base !== ""
    ) {
      return res.status(400).json({
        success: false,
        message: "Percentage base is only allowed for percentage charges",
      });
    }

    const order = Number(calculation_order);

    if (
      !Number.isInteger(order) ||
      order < 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Calculation order must be a non-negative integer",
      });
    }

    const result = await db.query(
      `UPDATE print_additional_charges
       SET charge_name = $1,
           description = $2,
           charge_type = $3,
           charge_value = $4,
           percentage_base = $5,
           calculation_order = $6,
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        charge_name.trim(),
        description?.trim() || null,
        charge_type,
        value,
        charge_type === "percentage" ? percentage_base : null,
        order,
        id,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Additional charge not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Additional charge updated successfully",
      data: result.rows[0],
    });

  } catch (error) {
    console.error("Update additional charge error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update additional charge",
    });
  }
};


// ACTIVATE / DEACTIVATE ADDITIONAL CHARGE
export const updateAdditionalChargeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid additional charge ID",
      });
    }

    if (typeof is_active !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "is_active must be boolean",
      });
    }

    const result = await db.query(
      `UPDATE print_additional_charges
       SET is_active = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [is_active, id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        success: false,
        message: "Additional charge not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Additional charge status updated successfully",
      data: result.rows[0],
    });

  } catch (error) {
    console.error("Update additional charge status error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update additional charge status",
    });
  }
};
