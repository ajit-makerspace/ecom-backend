
import db from '../config/db.js';

const round2 = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const toNumber = (value, fieldName) => {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Invalid pricing value: ${fieldName}`);
  }

  return number;
};

export const calculatePrintPrice = async ({
  materialId,
  scaledVolumeCm3,
  quantity,
}) => {
  if (!Number.isInteger(Number(quantity)) || Number(quantity) <= 0) {
    throw new Error('Invalid quantity.');
  }

  if (!Number.isFinite(Number(scaledVolumeCm3)) || Number(scaledVolumeCm3) <= 0) {
    throw new Error('Invalid scaled model volume.');
  }

  // 1. Fetch active material
  const materialResult = await db.query(
    `SELECT id, name, price_per_cm3
     FROM print_materials
     WHERE id = $1 AND is_active = true`,
    [materialId]
  );

  if (!materialResult.rows.length) {
    throw new Error('Selected material is not available.');
  }

  const material = materialResult.rows[0];

  // 2. Fetch global pricing configuration
  const configResult = await db.query(
    `SELECT pricing_config
     FROM print_pricing
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`
  );

  const pricingConfig = configResult.rows[0]?.pricing_config || {};

  const gstPercentage = toNumber(
    pricingConfig.gst_percentage ?? 0,
    'gst_percentage'
  );

  const shippingCost = toNumber(
    pricingConfig.shipping_cost ?? 0,
    'shipping_cost'
  );

  // 3. Fetch active additional charges
  const chargesResult = await db.query(
    `SELECT
       id,
       charge_name,
       charge_type,
       charge_value,
       percentage_base,
       calculation_order
     FROM print_additional_charges
     WHERE is_active = true
     ORDER BY calculation_order ASC, id ASC`
  );

  // 4. Calculate combined volume
  const totalVolumeCm3 =
    Number(scaledVolumeCm3) * Number(quantity);

  // 5. Material cost
  const pricePerCm3 = toNumber(
    material.price_per_cm3,
    'material price'
  );

  const materialCost = round2(
    totalVolumeCm3 * pricePerCm3
  );

  let fixedCharges = 0;
  let perCm3Charges = 0;

  const additionalCharges = [];

  // 6. Calculate fixed and per-cm3 charges first
  for (const charge of chargesResult.rows) {
    const value = toNumber(
      charge.charge_value,
      charge.charge_name
    );

    let amount = 0;

    if (charge.charge_type === 'fixed') {
      // Fixed charge applies once per order.
      amount = round2(value);
      fixedCharges += amount;
    } else if (charge.charge_type === 'per_cm3') {
      // Per-cm3 charge applies to combined volume.
      amount = round2(totalVolumeCm3 * value);
      perCm3Charges += amount;
    } else {
      continue;
    }

    additionalCharges.push({
      id: charge.id,
      label: charge.charge_name,
      type: charge.charge_type,
      rate: value,
      amount,
    });
  }

  // 7. Calculate percentage charges.
  // All percentage charges use the same pre-percentage bases.
  // This avoids circular and compound calculations.
  const baseSubtotal = round2(
    materialCost + fixedCharges + perCm3Charges
  );

  const percentageBases = {
    material_cost: materialCost,
    printing_cost: perCm3Charges,
    subtotal: baseSubtotal,
  };

  let percentageCharges = 0;

  for (const charge of chargesResult.rows) {
    if (charge.charge_type !== 'percentage') continue;

    const percentage = toNumber(
      charge.charge_value,
      charge.charge_name
    );

    const base = percentageBases[charge.percentage_base];

    if (base === undefined) {
      throw new Error(
        `Invalid percentage base for ${charge.charge_name}.`
      );
    }

    const amount = round2(base * percentage / 100);

    percentageCharges += amount;

    additionalCharges.push({
      id: charge.id,
      label: charge.charge_name,
      type: charge.charge_type,
      percentageBase: charge.percentage_base,
      rate: percentage,
      amount,
    });
  }

  // 8. Final subtotal, GST and shipping
  const additionalTotal = round2(
    fixedCharges + perCm3Charges + percentageCharges
  );

  const subtotal = round2(
    materialCost + additionalTotal
  );

  // GST applies only to subtotal, not shipping.
  const taxAmount = round2(
    subtotal * gstPercentage / 100
  );

  const totalAmount = round2(
    subtotal + taxAmount + shippingCost
  );

  return {
    material: {
      id: material.id,
      name: material.name,
      pricePerCm3,
    },

    volume: {
      scaledVolumeCm3: Number(Number(scaledVolumeCm3).toFixed(6)),
      quantity: Number(quantity),
      totalVolumeCm3: Number(totalVolumeCm3.toFixed(6)),
    },

    materialCost,
    additionalCharges,
    additionalTotal,
    subtotal,

    gstPercentage,
    taxAmount,

    shippingCost,
    totalAmount,

    currency: pricingConfig.currency || 'INR',

    pricingSnapshot: {
      materialId: material.id,
      materialName: material.name,
      pricePerCm3,
      scaledVolumeCm3: Number(Number(scaledVolumeCm3).toFixed(6)),
      totalVolumeCm3: Number(totalVolumeCm3.toFixed(6)),
      quantity: Number(quantity),
      additionalCharges,
      gstPercentage,
      shippingCost,
      calculatedAt: new Date().toISOString(),
    },
  };
};
