import db from "../../config/db.js";

/* =========================================================
   CONSTANTS
========================================================= */

const ORDER_STATUSES = [
  "pending_payment",
  "confirmed",
  "in_production",
  "quality_check",
  "ready_to_ship",
  "shipped",
  "delivered",
  "cancelled",
];

// Status changes an admin may make.
// "confirmed" is intentionally missing as a target: it is set by the
// payment verification flow, not manually.
const ALLOWED_TRANSITIONS = {
  pending_payment: ["cancelled"],
  confirmed: ["in_production", "cancelled"],
  in_production: ["quality_check", "cancelled"],
  quality_check: ["in_production", "ready_to_ship", "cancelled"],
  ready_to_ship: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

const SORT_COLUMNS = {
  id: "pr.id",
  order_number: "pr.order_number",
  created_at: "pr.created_at",
  updated_at: "pr.updated_at",
  quantity: "pr.quantity",
  total_amount: "pr.total_amount",
  order_status: "pr.order_status",
};

const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 100;
const MAX_INT4 = 2147483647;

const fail = (res, code, message) =>
  res.status(code).json({ success: false, message });

// Parses a positive int4 ID. Returns null when invalid.
const parseId = (value) => {
  if (!/^[1-9]\d{0,9}$/.test(String(value))) return null;
  const n = Number(value);
  return n <= MAX_INT4 ? n : null;
};

// Escapes LIKE wildcards so user input is matched literally.
const escapeLike = (text) => text.replace(/[\\%_]/g, "\\$&");

// Trims a string; returns null for empty / non-string values.
const cleanText = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

/* =========================================================
   ADMIN: GET ALL PRINT ORDERS
   GET /print-requests
========================================================= */

export const getAdminPrintRequests = async (req, res) => {
  try {
    const {
      search = "",
      status = "all",
      material = "all",
      page = "1",
      limit = "20",
      sortBy = "created_at",
      sortOrder = "DESC",
    } = req.query;

    // ---- Pagination ----
    const pageNum = Number.parseInt(page, 10);
    const pageSize = Number.parseInt(limit, 10);

    if (!Number.isInteger(pageNum) || pageNum < 1) {
      return fail(res, 400, "Page must be a positive integer.");
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
      return fail(res, 400, `Limit must be between 1 and ${MAX_PAGE_SIZE}.`);
    }
    const offset = (pageNum - 1) * pageSize;

    // ---- Sorting ----
    const sortColumn = SORT_COLUMNS[String(sortBy)];
    if (!sortColumn) {
      return fail(
        res,
        400,
        `Invalid sort field. Use one of: ${Object.keys(SORT_COLUMNS).join(", ")}.`
      );
    }

    const sortDirection = String(sortOrder).toUpperCase();
    if (!["ASC", "DESC"].includes(sortDirection)) {
      return fail(res, 400, "Sort order must be ASC or DESC.");
    }

    // ---- Filters ----
    const conditions = [];
    const values = [];

    const searchTerm = String(search).trim();
    if (searchTerm.length > MAX_SEARCH_LENGTH) {
      return fail(res, 400, `Search must be at most ${MAX_SEARCH_LENGTH} characters.`);
    }

    if (searchTerm) {
      values.push(`%${escapeLike(searchTerm)}%`);
      const p = `$${values.length}`;
      conditions.push(`(
        pr.order_number ILIKE ${p}
        OR pr.id::text ILIKE ${p}
        OR pm.name ILIKE ${p}
        OR u.email ILIKE ${p}
        OR u.phone ILIKE ${p}
        OR CONCAT_WS(' ', u.first_name, u.last_name) ILIKE ${p}
      )`);
    }

    if (String(status) !== "all") {
      if (!ORDER_STATUSES.includes(String(status))) {
        return fail(res, 400, "Invalid order status.");
      }
      values.push(String(status));
      conditions.push(`pr.order_status = $${values.length}`);
    }

    if (String(material) !== "all") {
      const materialId = parseId(material);
      if (!materialId) return fail(res, 400, "Invalid material ID.");
      values.push(materialId);
      conditions.push(`pr.material_id = $${values.length}`);
    }

    const whereSQL = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const fromSQL = `
      FROM print_requests pr
      INNER JOIN print_materials pm ON pm.id = pr.material_id
      LEFT JOIN users u ON u.id = pr.user_id
    `;

    // ---- Queries ----
    const [countResult, metricsResult, result] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS total ${fromSQL} ${whereSQL}`, values),

      db.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE order_status = 'pending_payment')::int AS pending_payment,
          COUNT(*) FILTER (WHERE order_status = 'confirmed')::int AS confirmed,
          COUNT(*) FILTER (WHERE order_status = 'in_production')::int AS in_production,
          COUNT(*) FILTER (WHERE order_status = 'quality_check')::int AS quality_check,
          COUNT(*) FILTER (WHERE order_status = 'ready_to_ship')::int AS ready_to_ship,
          COUNT(*) FILTER (WHERE order_status = 'shipped')::int AS shipped,
          COUNT(*) FILTER (WHERE order_status = 'delivered')::int AS delivered,
          COUNT(*) FILTER (WHERE order_status = 'cancelled')::int AS cancelled
        FROM print_requests
      `),

      db.query(
        `
        SELECT
          pr.id,
          pr.order_number AS "orderNumber",

          pr.user_id AS "userId",
          json_build_object(
            'firstName', u.first_name,
            'lastName', u.last_name,
            'email', u.email,
            'phone', u.phone
          ) AS customer,
          pr.user_address_id AS "addressId",

          pr.material_id AS "materialId",
          pm.name AS "materialName",

          pr.color_mode AS "colorMode",
          pr.color_hex AS "colorHex",
          pr.quality,
          pr.quantity,
          pr.units,
          pr.scale,

          pr.x_dimension AS "xDimension",
          pr.y_dimension AS "yDimension",
          pr.z_dimension AS "zDimension",
          pr.original_volume_cm3 AS "originalVolumeCm3",
          pr.scaled_volume_cm3 AS "scaledVolumeCm3",
          pr.wall_thickness AS "wallThickness",
          pr.infill,
          pr.instructions,

          pr.material_cost AS "materialCost",
          pr.additional_charges AS "additionalCharges",
          pr.subtotal,
          pr.tax_amount AS "taxAmount",
          pr.shipping_cost AS "shippingCost",
          pr.total_amount AS "totalAmount",

          pr.order_status AS "orderStatus",
          pr.tracking_number AS "trackingNumber",
          pr.courier_name AS "courierName",
          pr.cancelled_at AS "cancelledAt",
          pr.created_at AS "createdAt",
          pr.updated_at AS "updatedAt",

          payment.status AS "paymentStatus",
          payment.payment_method AS "paymentMethod",

          COALESCE(
            (
              SELECT json_agg(
                json_build_object(
                  'id', mf.id,
                  'filename', mf.original_name,
                  'mimeType', mf.mime_type,
                  'fileSize', mf.file_size,
                  'role', prf.file_role,
                  'url', '/api/media/' || mf.id
                )
                ORDER BY
                  CASE WHEN prf.file_role = 'model' THEN 0 ELSE 1 END,
                  prf.id
              )
              FROM print_request_files prf
              INNER JOIN media_files mf ON mf.id = prf.media_id
              WHERE prf.print_request_id = pr.id
            ),
            '[]'::json
          ) AS files

        ${fromSQL}

        LEFT JOIN LATERAL (
          SELECT p.status, p.payment_method
          FROM print_request_payments p
          WHERE p.print_request_id = pr.id
          ORDER BY p.created_at DESC, p.id DESC
          LIMIT 1
        ) payment ON TRUE

        ${whereSQL}

        ORDER BY ${sortColumn} ${sortDirection}, pr.id DESC
        LIMIT $${values.length + 1}
        OFFSET $${values.length + 2}
        `,
        [...values, pageSize, offset]
      ),
    ]);

    const total = countResult.rows[0].total;

    return res.status(200).json({
      success: true,
      message: "Print orders fetched successfully.",
      data: result.rows,
      metrics: metricsResult.rows[0],
      pagination: {
        total,
        page: pageNum,
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("Get Admin Print Orders Error:", error);
    return fail(res, 500, "Failed to fetch print orders.");
  }
};

/* =========================================================
   ADMIN: GET SINGLE PRINT ORDER
   GET /print-requests/:id
========================================================= */

export const getAdminPrintRequestById = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return fail(res, 400, "Invalid print order ID.");

    const orderResult = await db.query(
      `
      SELECT
        pr.id,
        pr.order_number AS "orderNumber",

        pr.user_id AS "userId",
        json_build_object(
          'id', u.id,
          'firstName', u.first_name,
          'lastName', u.last_name,
          'email', u.email,
          'phone', u.phone
        ) AS customer,

        pr.user_address_id AS "addressId",
        to_jsonb(ua) AS address,

        pr.material_id AS "materialId",
        pm.name AS "materialName",
        pm.description AS "materialDescription",
        pm.price_per_cm3 AS "pricePerCm3",

        pr.color_mode AS "colorMode",
        pr.color_hex AS "colorHex",
        pr.quality,
        pr.quantity,
        pr.units,
        pr.scale,

        pr.x_dimension AS "xDimension",
        pr.y_dimension AS "yDimension",
        pr.z_dimension AS "zDimension",
        pr.original_volume_cm3 AS "originalVolumeCm3",
        pr.scaled_volume_cm3 AS "scaledVolumeCm3",
        pr.wall_thickness AS "wallThickness",
        pr.infill,
        pr.instructions,

        pr.material_cost AS "materialCost",
        pr.additional_charges AS "additionalCharges",
        pr.subtotal,
        pr.tax_amount AS "taxAmount",
        pr.shipping_cost AS "shippingCost",
        pr.total_amount AS "totalAmount",
        pr.pricing_snapshot AS "pricingSnapshot",

        pr.order_status AS "orderStatus",
        pr.tracking_number AS "trackingNumber",
        pr.courier_name AS "courierName",
        pr.cancelled_at AS "cancelledAt",
        pr.created_at AS "createdAt",
        pr.updated_at AS "updatedAt"

      FROM print_requests pr
      INNER JOIN print_materials pm ON pm.id = pr.material_id
      LEFT JOIN users u ON u.id = pr.user_id
      LEFT JOIN user_addresses ua ON ua.id = pr.user_address_id
      WHERE pr.id = $1
      LIMIT 1
      `,
      [id]
    );

    if (orderResult.rowCount === 0) {
      return fail(res, 404, "Print order not found.");
    }

    const [filesResult, paymentsResult] = await Promise.all([
      db.query(
        `
        SELECT
          mf.id,
          mf.original_name AS "filename",
          mf.filename AS "storedFilename",
          mf.mime_type AS "mimeType",
          mf.file_size AS "fileSize",
          mf.folder,
          mf.storage_type AS "storageType",
          mf.storage_path AS "storagePath",
          '/api/media/' || mf.id AS url,
          prf.file_role AS "fileRole",
          prf.created_at AS "createdAt"
        FROM print_request_files prf
        INNER JOIN media_files mf ON mf.id = prf.media_id
        WHERE prf.print_request_id = $1
        ORDER BY
          CASE WHEN prf.file_role = 'model' THEN 0 ELSE 1 END,
          prf.id ASC
        `,
        [id]
      ),

      db.query(
        `
        SELECT
          p.id,
          p.razorpay_order_id AS "razorpayOrderId",
          p.razorpay_payment_id AS "razorpayPaymentId",
          p.amount,
          p.currency,
          p.status,
          p.payment_method AS "paymentMethod",
          p.failure_reason AS "failureReason",
          p.created_at AS "createdAt"
        FROM print_request_payments p
        WHERE p.print_request_id = $1
        ORDER BY p.created_at DESC, p.id DESC
        `,
        [id]
      ),
    ]);

    const files = filesResult.rows;

    return res.status(200).json({
      success: true,
      message: "Print order details fetched successfully.",
      data: {
        ...orderResult.rows[0],
        model: files.find((f) => f.fileRole === "model") || null,
        supportFiles: files.filter((f) => f.fileRole === "support"),
        payments: paymentsResult.rows,
        allowedNextStatuses:
          ALLOWED_TRANSITIONS[orderResult.rows[0].orderStatus] || [],
      },
    });
  } catch (error) {
    console.error("Get Admin Print Order Details Error:", error);
    return fail(res, 500, "Failed to fetch print order details.");
  }
};

/* =========================================================
   ADMIN: UPDATE ORDER STATUS
   PATCH /print-requests/:id/status
   body: { status, trackingNumber?, courierName? }
========================================================= */

export const updatePrintRequestStatus = async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return fail(res, 400, "Invalid print order ID.");

  const { status, trackingNumber, courierName } = req.body ?? {};

  if (typeof status !== "string" || !ORDER_STATUSES.includes(status)) {
    return fail(res, 400, "Invalid order status.");
  }

  const tracking = cleanText(trackingNumber);
  const courier = cleanText(courierName);

  if (tracking && tracking.length > 150) {
    return fail(res, 400, "Tracking number must be at most 150 characters.");
  }
  if (courier && courier.length > 150) {
    return fail(res, 400, "Courier name must be at most 150 characters.");
  }

  const client = await db.pool.connect();

  try {
    await client.query("BEGIN");

    // Lock the row so two admins can't change the same order at once.
    const current = await client.query(
      `SELECT id, order_status, tracking_number, courier_name
       FROM print_requests
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );

    if (current.rowCount === 0) {
      await client.query("ROLLBACK");
      return fail(res, 404, "Print order not found.");
    }

    const order = current.rows[0];
    const from = order.order_status;

    // Allow re-saving a shipped order only to correct courier / tracking.
    const isShippingCorrection = from === "shipped" && status === "shipped";

    if (!isShippingCorrection) {
      if (from === status) {
        await client.query("ROLLBACK");
        return fail(res, 400, `Order is already ${status.replace(/_/g, " ")}.`);
      }

      const allowed = ALLOWED_TRANSITIONS[from] || [];
      if (!allowed.includes(status)) {
        await client.query("ROLLBACK");
        return fail(
          res,
          400,
          allowed.length
            ? `Cannot change status from "${from}" to "${status}". Allowed: ${allowed.join(", ")}.`
            : `Order is ${from.replace(/_/g, " ")} and can no longer be changed.`
        );
      }
    }

    // Shipping details are mandatory for "shipped".
    if (status === "shipped") {
      const finalTracking = tracking ?? order.tracking_number;
      const finalCourier = courier ?? order.courier_name;

      if (!finalTracking || !finalCourier) {
        await client.query("ROLLBACK");
        return fail(
          res,
          400,
          "Courier name and tracking number are required to mark an order as shipped."
        );
      }
    }

    const { rows } = await client.query(
      `
      UPDATE print_requests
      SET order_status = $2,
          tracking_number = COALESCE($3, tracking_number),
          courier_name = COALESCE($4, courier_name),
          cancelled_at = CASE WHEN $5::boolean THEN NOW() ELSE cancelled_at END,
          updated_at = NOW()
      WHERE id = $1
      RETURNING
        id,
        order_number AS "orderNumber",
        order_status AS "orderStatus",
        tracking_number AS "trackingNumber",
        courier_name AS "courierName",
        cancelled_at AS "cancelledAt",
        updated_at AS "updatedAt"
      `,
      [id, status, tracking, courier, status === "cancelled"]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Order status updated to ${status.replace(/_/g, " ")}.`,
      data: {
        ...rows[0],
        allowedNextStatuses: ALLOWED_TRANSITIONS[status] || [],
      },
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Update Print Order Status Error:", error);
    return fail(res, 500, "Failed to update order status.");
  } finally {
    client.release();
  }
};