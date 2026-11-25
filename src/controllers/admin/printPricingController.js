
import db from "../../config/db.js";

const validatePricingConfig = ({
  gst_percentage,
  shipping_cost,
  currency,
}) => {
  const errors = [];

  const gst = Number(gst_percentage);
  const shipping = Number(shipping_cost);

  if (
    gst_percentage === undefined ||
    gst_percentage === null ||
    gst_percentage === "" ||
    !Number.isFinite(gst) ||
    gst < 0 ||
    gst > 100
  ) {
    errors.push("GST must be between 0 and 100");
  }

  if (
    shipping_cost === undefined ||
    shipping_cost === null ||
    shipping_cost === "" ||
    !Number.isFinite(shipping) ||
    shipping < 0
  ) {
    errors.push("Shipping cost must be zero or greater");
  }

  if (currency !== "INR") {
    errors.push("Only INR currency is supported");
  }

  return errors;
};

// GET CURRENT PRICING
export const getPrintPricing = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, pricing_config, updated_by, updated_at
       FROM print_pricing
       WHERE id = 1
       LIMIT 1`
    );

    if (!result.rows.length) {
      return res.status(200).json({
        success: true,
        configured: false,
        message: "Pricing configuration has not been created",
        data: null,
      });
    }

    return res.status(200).json({
      success: true,
      configured: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Get print pricing error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch pricing configuration",
    });
  }
};

// UPDATE CURRENT PRICING
export const updatePrintPricing = async (req, res) => {
  try {
    const {
      gst_percentage,
      shipping_cost,
      currency,
    } = req.body;

    const errors = validatePricingConfig({
      gst_percentage,
      shipping_cost,
      currency,
    });

    if (errors.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid pricing configuration",
        errors,
      });
    }

    const pricingConfig = {
      currency,
      gst_percentage: Number(gst_percentage),
      shipping_cost: Number(shipping_cost),
    };

    const updatedBy = req.user?.id || null;

    const result = await db.query(
      `INSERT INTO print_pricing (
         id,
         pricing_config,
         updated_by,
         updated_at
       )
       VALUES (1, $1::jsonb, $2, NOW())

       ON CONFLICT (id)
       DO UPDATE SET
         pricing_config = EXCLUDED.pricing_config,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()

       RETURNING *`,
      [
        JSON.stringify(pricingConfig),
        updatedBy,
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Pricing configuration updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Update print pricing error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to update pricing configuration",
    });
  }
};
