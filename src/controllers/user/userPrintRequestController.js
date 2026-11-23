import crypto from 'node:crypto';
import path from 'node:path';
import db from '../../config/db.js';
import storageService from '../../services/storageService.js';
// Adjust this path to wherever calculatePrintPrice lives in your project.
import { calculatePrintPrice } from '../../services/printPricingService.js';

/* -------------------------------------------------------------------------- */
/* Config & helpers                                                           */
/* -------------------------------------------------------------------------- */

// const UNIT_TO_MM = {
//   mm: 1,
//   cm: 10,
//   in: 25.4,
// };

// Units are display-only now: this list is only used to validate the
// `units` value sent by the client. It never changes size or price.
const UNIT_TO_MM = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
};

const MAX_QUANTITY = 1000;
// const MAX_SUPPORT_FILES = 50;
const CHECKOUT_EXPIRY_MINUTES = 30;
const PRINT_FOLDER = 'print-models';

// Keep in sync with PRINT_LIMITS and the Scale (%) input on the frontend.
const PRINT_LIMITS = {
  minAxisMm: 1.2,
  minLargestMm: 5,
  maxScalePercent: 1000,
};

// Tax and shipping now come from the print_pricing table
// (via calculatePrintPrice), not from .env.

const round2 = (n) =>
  Math.round((n + Number.EPSILON) * 100) / 100;

const fail = (res, code, message) =>
  res.status(code).json({
    success: false,
    message,
  });

const generateOrderNumber = () => {
  const date = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');

  return `PR-${date}-${crypto.randomBytes(4)
    .toString('hex')
    .toUpperCase()}`;
};

const parsePositiveInteger = (value) => {
  if (!/^\d+$/.test(String(value ?? ''))) return null;

  const number = Number(value);

  return Number.isSafeInteger(number) && number > 0
    ? number
    : null;
};

const parseOptionalNumber = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : NaN;
};

// Store file externally before starting the DB transaction.
const storePrintFile = async (file) => {
  const ext = path.extname(file.originalname).toLowerCase();

  const safeName = `print-models-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;

  const mimeType = file.mimetype || 'application/octet-stream';

  const saved = await storageService.saveFile({
    buffer: file.buffer,
    filename: safeName,
    folder: PRINT_FOLDER,
    mimeType,
    asyncFtp: true,
  });

  return {
    safeName,
    mimeType,
    originalName: file.originalname,
    size: file.buffer.length,
    storageType: saved.storageType,
    storagePath: saved.storagePath,
  };
};

// Insert media_files row inside the DB transaction.
const insertMediaRecord = async (client, file) => {
  const { rows } = await client.query(
    `INSERT INTO media_files (
       filename,
       original_name,
       mime_type,
       file_size,
       folder,
       storage_type,
       storage_path,
       data
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
     RETURNING id`,
    [
      file.safeName,
      file.originalName,
      file.mimeType,
      file.size,
      PRINT_FOLDER,
      file.storageType,
      file.storagePath,
    ]
  );

  return rows[0].id;
};

// Delete externally stored files if DB creation fails.
const cleanupStoredFiles = async (storedFiles) => {
  await Promise.allSettled(
    storedFiles.map((file) =>
      storageService.deleteFile({
        storageType: file.storageType,
        storagePath: file.storagePath,
        filename: file.safeName,
        folder: PRINT_FOLDER,
      })
    )
  );
};

/* -------------------------------------------------------------------------- */
/* POST /printing-service                                                     */
/* Create print request + pending payment                                    */
/* -------------------------------------------------------------------------- */

export const createPrintRequest = async (req, res) => {
  const storedFiles = [];
  let committed = false;

  try {
    /* ------------------------------ Auth --------------------------------- */

    const userId = req.user?.id;

    if (!userId) {
      return fail(res, 401, 'Please sign in.');
    }

    /* ------------------------------ Files -------------------------------- */

    // const modelFile = req.files?.model?.[0];
    // const supportFiles = req.files?.supportFiles || [];

    // if (!modelFile) {
    //   return fail(res, 400, 'No model file was uploaded.');
    // }

    // if (supportFiles.length > MAX_SUPPORT_FILES) {
    //   return fail(
    //     res,
    //     400,
    //     `Maximum ${MAX_SUPPORT_FILES} support files are allowed.`
    //   );
    // }
    const modelFile = req.file;
    if (!modelFile) {
  return fail(res, 400, 'No model file was uploaded.');
}

const allowedExtensions = ['.zip', '.obj', '.stl', '.3mf'];

const extension = path.extname(modelFile.originalname).toLowerCase();

if (!allowedExtensions.includes(extension)) {
  return fail(
    res,
    400,
    'Please upload a ZIP, OBJ, STL or 3MF model file.'
  );
}

// if (!modelFile) {
//   return fail(res, 400, 'No model file was uploaded.');
// }

    const body = req.body;

    /* ----------------------------- Address ------------------------------- */

    const addressId = parsePositiveInteger(body.addressId);

    if (!addressId) {
      return fail(res, 400, 'A valid delivery address is required.');
    }

    /* ------------------------ Print preferences ------------------------- */

    const quantity = parsePositiveInteger(body.quantity ?? '1');

    if (!quantity || quantity > MAX_QUANTITY) {
      return fail(
        res,
        400,
        `Quantity must be between 1 and ${MAX_QUANTITY}.`
      );
    }

    const scalePercent = Number(body.scale ?? 100);

    if (
      !Number.isFinite(scalePercent) ||
      scalePercent <= 0 ||
      scalePercent > PRINT_LIMITS.maxScalePercent
    ) {
      return fail(
        res,
        400,
        `Scale must be between 1 and ${PRINT_LIMITS.maxScalePercent}%.`
      );
    }

    const units = body.units || 'mm';

    if (!Object.hasOwn(UNIT_TO_MM, units)) {
      // return fail(res, 400, 'Units must be mm, cm or in.');
        return fail(res, 400, 'Units must be mm, cm, m or in.');

    }

    const infill = parseOptionalNumber(body.infill);

    if (
      infill !== null &&
      (!Number.isFinite(infill) || infill < 0 || infill > 100)
    ) {
      return fail(
        res,
        400,
        'Infill must be between 0 and 100.'
      );
    }

    const wallThickness = parseOptionalNumber(body.wallThickness);

    if (
      wallThickness !== null &&
      (!Number.isFinite(wallThickness) || wallThickness <= 0)
    ) {
      return fail(
        res,
        400,
        'Wall thickness must be a positive number.'
      );
    }

    /* -------------------------- Color settings --------------------------- */

    const colorMode = body.colorMode || 'original';

    if (!['original', 'custom'].includes(colorMode)) {
      return fail(res, 400, 'Invalid color mode.');
    }

    let colorHex = null;

    if (colorMode === 'custom') {
      if (!/^#[0-9a-f]{6}$/i.test(body.colorHex || '')) {
        return fail(res, 400, 'Invalid colour.');
      }

      colorHex = body.colorHex.toUpperCase();
    }

    const quality = body.quality
      ? String(body.quality).trim().slice(0, 50)
      : null;

    const instructions = body.instructions
      ? String(body.instructions).trim().slice(0, 2000)
      : null;

    /* -------------------------- Model analysis --------------------------- */

    let analysis;

    try {
      analysis =
        typeof body.modelAnalysis === 'string'
          ? JSON.parse(body.modelAnalysis)
          : body.modelAnalysis;
    } catch {
      return fail(res, 400, 'Invalid model analysis data.');
    }

    const dims = analysis?.originalDimensions;
    const originalVolume = Number(analysis?.originalVolume);

    if (
      !dims ||
      ![dims.x, dims.y, dims.z].every(
        (value) =>
          Number.isFinite(Number(value)) &&
          Number(value) > 0
      ) ||
      !Number.isFinite(originalVolume) ||
      originalVolume <= 0
    ) {
      return fail(
        res,
        400,
        'Model analysis is missing or invalid. Please re-upload the model.'
      );
    }

    /* --------------------------- Minimum size ---------------------------- */

    // Real physical size in mm: raw size × scale. The selected unit never
    // affects it. Same rule as getPrintSizeError on the frontend.
    const scaledDimsMm = [dims.x, dims.y, dims.z].map(
      (value) => Number(value) * (scalePercent / 100)
    );

    if (
      Math.min(...scaledDimsMm) < PRINT_LIMITS.minAxisMm ||
      Math.max(...scaledDimsMm) < PRINT_LIMITS.minLargestMm
    ) {
      return fail(
        res,
        400,
        `This model is too small to print. Minimum is ${PRINT_LIMITS.minAxisMm} mm on every side and ${PRINT_LIMITS.minLargestMm} mm on the longest side.`
      );
    }

    /* ----------------------------- Material ------------------------------ */

    const materialId = parsePositiveInteger(body.materialId);

    const materialRes = materialId
      ? await db.query(
          `SELECT id, name, price_per_cm3
           FROM print_materials
           WHERE id = $1
             AND is_active = true`,
          [materialId]
        )
      : await db.query(
          `SELECT id, name, price_per_cm3
           FROM print_materials
           WHERE LOWER(name) = LOWER($1)
             AND is_active = true`,
          [body.material || '']
        );

    if (materialRes.rows.length === 0) {
      return fail(
        res,
        400,
        'Selected material is not available.'
      );
    }

    const material = materialRes.rows[0];
    const pricePerCm3 = Number(material.price_per_cm3);

    if (
      !Number.isFinite(pricePerCm3) ||
      pricePerCm3 < 0
    ) {
      throw new Error('Invalid material pricing configuration.');
    }

    /* ------------------------- Address ownership ------------------------- */

    const addressRes = await db.query(
      `SELECT id
       FROM user_addresses
       WHERE id = $1
         AND user_id = $2`,
      [addressId, userId]
    );

    if (addressRes.rows.length === 0) {
      return fail(res, 400, 'Invalid delivery address.');
    }

    /* ------------------------------ Pricing ------------------------------ */

    // Units are display-only: model coordinates are treated as mm and only
    // the scale changes the physical size. Raw mm³ → cm³.

    const scaleFactor = scalePercent / 100;

    const normalizedOriginalVolumeCm3 = originalVolume / 1000;

    // Volume changes cubically with scale.
    const scaledVolumeCm3 =
      normalizedOriginalVolumeCm3 * Math.pow(scaleFactor, 3);

    if (
      !Number.isFinite(normalizedOriginalVolumeCm3) ||
      normalizedOriginalVolumeCm3 <= 0 ||
      !Number.isFinite(scaledVolumeCm3) ||
      scaledVolumeCm3 <= 0
    ) {
      return fail(res, 400, 'Invalid calculated model volume.');
    }

    // Material cost, admin-managed additional charges, GST and shipping
    // are all calculated by the pricing service.
    const price = await calculatePrintPrice({
      materialId: material.id,
      scaledVolumeCm3,
      quantity,
    });

    const {
      materialCost,
      additionalCharges,
      subtotal,
      taxAmount,
      shippingCost,
      totalAmount,
    } = price;

    if (
      !Number.isFinite(totalAmount) ||
      totalAmount <= 0 ||
      !Number.isSafeInteger(Math.round(totalAmount * 100))
    ) {
      return fail(res, 400, 'Invalid order amount.');
    }

    // print_requests stores rupees.
    // print_request_payments stores paise.
    const paymentAmount = Math.round(totalAmount * 100);

    const calculatedAt = new Date().toISOString();

    const pricingSnapshot = {
      ...price.pricingSnapshot,

      originalVolumeCm3: Number(
        normalizedOriginalVolumeCm3.toFixed(6)
      ),

      scalePercent,
      units,
      materialCost,
      subtotal,
      taxAmount,
      totalAmount,
      currency: price.currency,
      calculatedAt,
    };

    /* -------------------------- Checkout expiry -------------------------- */

    const checkoutExpiresAt = new Date(
      Date.now() + CHECKOUT_EXPIRY_MINUTES * 60 * 1000
    );

    /* ---------------------------- Store files ---------------------------- */
const storedModel = await storePrintFile(modelFile);

storedFiles.push(storedModel);

    /* -------------------------- Database transaction -------------------- */

    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');

      // Save main model media record.
      const modelMediaId = await insertMediaRecord(
        client,
        storedModel
      );

      // Create print request.
      const { rows } = await client.query(
        `INSERT INTO print_requests (
           order_number,
           user_id,
           user_address_id,
           material_id,
           color_mode,
           color_hex,
           quality,
           quantity,
           units,
           scale,
           x_dimension,
           y_dimension,
           z_dimension,
           original_volume_cm3,
           scaled_volume_cm3,
           wall_thickness,
           infill,
           instructions,
           material_cost,
           additional_charges,
           subtotal,
           tax_amount,
           shipping_cost,
           total_amount,
           order_status,
           checkout_expires_at,
           pricing_snapshot
         )
         VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, $8, $9, $10,
           $11, $12, $13,
           $14, $15,
           $16, $17, $18,
           $19, $20::jsonb, $21, $22,
           $23, $24, 'pending_payment',
           $25, $26::jsonb
         )
         RETURNING
           id,
           order_number AS "orderNumber",
           order_status AS "orderStatus",
           checkout_expires_at AS "checkoutExpiresAt",
           created_at AS "createdAt"`,
        [
          generateOrderNumber(),
          userId,
          addressId,
          material.id,
          colorMode,
          colorHex,
          quality,
          quantity,
          units,
          scalePercent,
          Number(dims.x),
          Number(dims.y),
          Number(dims.z),
          Number(normalizedOriginalVolumeCm3.toFixed(6)),
          Number(scaledVolumeCm3.toFixed(6)),
          wallThickness,
          infill,
          instructions,
          materialCost,
          JSON.stringify(additionalCharges),
          subtotal,
          taxAmount,
          shippingCost,
          totalAmount,
          checkoutExpiresAt,
          JSON.stringify(pricingSnapshot),
        ]
      );

      const request = rows[0];

      // Attach main model.
      await client.query(
        `INSERT INTO print_request_files (
           print_request_id,
           media_id,
           file_role
         )
         VALUES ($1, $2, 'model')`,
        [request.id, modelMediaId]
      );

      // Attach supporting files.
      // const savedSupport = [];

      // for (const file of storedSupport) {
      //   const mediaId = await insertMediaRecord(
      //     client,
      //     file
      //   );

      //   await client.query(
      //     `INSERT INTO print_request_files (
      //        print_request_id,
      //        media_id,
      //        file_role
      //      )
      //      VALUES ($1, $2, 'support')`,
      //     [request.id, mediaId]
      //   );

      //   savedSupport.push({
      //     mediaId,
      //     filename: file.originalName,
      //   });
      // }

      // Create pending payment record.
      // Amount is stored in paise, not rupees.
      const paymentResult = await client.query(
        `INSERT INTO print_request_payments (
           print_request_id,
           amount,
           currency,
           status
         )
         VALUES ($1, $2, 'INR', 'pending')
         RETURNING
           id,
           amount,
           currency,
           status`,
        [
          request.id,
          paymentAmount,
        ]
      );

      const payment = paymentResult.rows[0];

      // Commit everything together.
      await client.query('COMMIT');

      committed = true;

      /* ---------------------------- API response ------------------------- */

      return res.status(201).json({
        success: true,
        message: 'Print request submitted successfully.',

        data: {
          ...request,

          modelFile: {
            mediaId: modelMediaId,
            filename: storedModel.originalName,
          },

          supportFiles: [],

          pricing: {
            materialCost,
            additionalCharges,
            subtotal,
            taxAmount,
            shippingCost,
            totalAmount,
            currency: 'INR',
          },

          payment: {
            id: payment.id,
            amount: Number(payment.amount),
            currency: payment.currency,
            status: payment.status,
          },
        },
      });
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Create Print Request Error:', err);

    // Clean up external files only if the DB transaction
    // did not commit.
    if (!committed && storedFiles.length > 0) {
      await cleanupStoredFiles(storedFiles);
    }

    return fail(
      res,
      500,
      'Failed to submit your print request.'
    );
  }
};

/* -------------------------------------------------------------------------- */
/* GET /printing-service/materials                                            */
/* -------------------------------------------------------------------------- */

export const getPrintMaterials = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         id,
         name,
         description,
         price_per_cm3 AS "pricePerCm3"
       FROM print_materials
       WHERE is_active = true
       ORDER BY name`
    );

    return res.status(200).json({
      success: true,
      data: rows,
    });
  } catch (err) {
    console.error('Get Print Materials Error:', err);

    return fail(
      res,
      500,
      'Failed to fetch materials.'
    );
  }
};

/* -------------------------------------------------------------------------- */
/* GET /printing-service                                                      */
/* Get logged-in user's print requests                                        */
/* -------------------------------------------------------------------------- */

export const getMyPrintRequests = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return fail(res, 401, 'Please sign in.');
    }

    const { rows } = await db.query(
      `
      SELECT
        pr.id,
        pr.order_number AS "orderNumber",
        pr.created_at AS "createdAt",
        pr.updated_at AS "updatedAt",

        -- Checkout expiry
        pr.checkout_expires_at AS "checkoutExpiresAt",

        -- Address
        pr.user_address_id AS "addressId",

        -- Material
        pr.material_id AS "materialId",
        pm.name AS "materialName",

        -- Printing configuration
        pr.color_mode AS "colorMode",
        pr.color_hex AS "colorHex",
        pr.quality,
        pr.quantity,
        pr.scale,
        pr.units,
        pr.x_dimension AS "xDimension",
        pr.y_dimension AS "yDimension",
        pr.z_dimension AS "zDimension",
        pr.original_volume_cm3 AS "originalVolumeCm3",
        pr.scaled_volume_cm3 AS "scaledVolumeCm3",
        pr.wall_thickness AS "wallThickness",
        pr.infill,
        pr.instructions,

        -- Pricing
        pr.material_cost AS "materialCost",
        pr.additional_charges AS "additionalCharges",
        pr.subtotal,
        pr.tax_amount AS "taxAmount",
        pr.shipping_cost AS "shippingCost",
        pr.total_amount AS "totalAmount",
        pr.pricing_snapshot AS "pricingSnapshot",

        -- Order status
        pr.order_status AS "orderStatus",
        pr.tracking_number AS "trackingNumber",
        pr.courier_name AS "courierName",
        pr.cancelled_at AS "cancelledAt",

        -- Main model
        (
          SELECT json_build_object(
            'mediaId', mf.id,
            'filename', mf.original_name,
            'mimeType', mf.mime_type,
            'fileSize', mf.file_size
          )
          FROM print_request_files prf
          JOIN media_files mf
            ON mf.id = prf.media_id
          WHERE prf.print_request_id = pr.id
            AND prf.file_role = 'model'
          ORDER BY prf.id
          LIMIT 1
        ) AS "modelFile",

        -- Supporting files
        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'mediaId', mf.id,
                'filename', mf.original_name,
                'mimeType', mf.mime_type,
                'fileSize', mf.file_size
              )
              ORDER BY prf.id
            )
            FROM print_request_files prf
            JOIN media_files mf
              ON mf.id = prf.media_id
            WHERE prf.print_request_id = pr.id
              AND prf.file_role = 'support'
          ),
          '[]'::json
        ) AS "supportFiles",

        -- Latest payment attempt
        payment.id AS "paymentId",
        payment.razorpay_order_id AS "razorpayOrderId",
        payment.razorpay_payment_id AS "razorpayPaymentId",
        payment.amount AS "paymentAmount",
        payment.currency,
        payment.status AS "paymentStatus",
        payment.payment_method AS "paymentMethod",
        payment.failure_reason AS "paymentFailureReason",
        payment.created_at AS "paymentCreatedAt"

      FROM print_requests pr

      LEFT JOIN print_materials pm
        ON pm.id = pr.material_id

      LEFT JOIN LATERAL (
        SELECT
          p.id,
          p.razorpay_order_id,
          p.razorpay_payment_id,
          p.amount,
          p.currency,
          p.status,
          p.payment_method,
          p.failure_reason,
          p.created_at
        FROM print_request_payments p
        WHERE p.print_request_id = pr.id
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT 1
      ) payment ON TRUE

      WHERE pr.user_id = $1

      ORDER BY pr.created_at DESC
      `,
      [userId]
    );

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (err) {
    console.error('Get My Print Requests Error:', err);

    return fail(
      res,
      500,
      'Failed to fetch print orders.'
    );
  }
};