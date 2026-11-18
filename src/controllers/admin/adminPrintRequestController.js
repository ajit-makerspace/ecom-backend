
import db from '../../config/db.js';

// Admin: Get all print requests
export const getAdminPrintRequests = async (req, res) => {
  try {
    const {
      search = '',
      status = 'all',
      material = 'all',
      page = 1,
      limit = 20,
      sortBy = 'created_at',
      sortOrder = 'DESC',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(limit, 10) || 20)
    );

    const offset = (pageNum - 1) * pageSize;

    const conditions = [];
    const values = [];
    let idx = 1;

    // Search
    if (search.trim()) {
      conditions.push(`(
        pr.id::text ILIKE $${idx}
        OR COALESCE(pr.material, '') ILIKE $${idx}
      )`);

      values.push(`%${search.trim()}%`);
      idx++;
    }

    // Status filter
    if (status !== 'all') {
      conditions.push(`pr.status = $${idx}`);
      values.push(status);
      idx++;
    }

    // Material filter
    if (material !== 'all') {
      conditions.push(`LOWER(pr.material) = LOWER($${idx})`);
      values.push(material);
      idx++;
    }

    const whereSQL = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    // Prevent SQL injection through sorting
    const allowedSortColumns = [
      'created_at',
      'updated_at',
      'id',
      'quantity',
      'status',
      'material',
    ];

    const safeSortBy = allowedSortColumns.includes(sortBy)
      ? sortBy
      : 'created_at';

    const safeSortOrder =
      sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Total matching requests
    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total
       FROM print_requests pr
       ${whereSQL}`,
      values
    );

    const total = countResult.rows[0].total;

    // Status metrics
    const metricsResult = await db.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (
          WHERE status = 'pending_review'
        )::int AS pending_review,
        COUNT(*) FILTER (
          WHERE status = 'under_review'
        )::int AS under_review,
        COUNT(*) FILTER (
          WHERE status = 'quoted'
        )::int AS quoted,
        COUNT(*) FILTER (
          WHERE status = 'accepted'
        )::int AS accepted,
        COUNT(*) FILTER (
          WHERE status = 'in_production'
        )::int AS in_production,
        COUNT(*) FILTER (
          WHERE status = 'completed'
        )::int AS completed,
        COUNT(*) FILTER (
          WHERE status = 'rejected'
        )::int AS rejected
      FROM print_requests
    `);

    // Fetch requests
    const { rows } = await db.query(
      `SELECT
        pr.id,
        pr.user_id AS "userId",
        pr.media_id AS "mediaId",
        pr.user_address_id AS "addressId",
        pr.material,
        pr.color_mode AS "colorMode",
        pr.color_hex AS "colorHex",
        pr.quality,
        pr.quantity,
        pr.scale,
        pr.units,
        pr.instructions,
        pr.status,
        pr.created_at AS "createdAt",
        pr.updated_at AS "updatedAt",

        json_build_object(
          'id', mf.id,
          'filename', mf.original_name,
          'mimeType', mf.mime_type,
          'fileSize', mf.file_size
        ) AS "model",

        COALESCE(
          (
            SELECT json_agg(
              json_build_object(
                'mediaId', sm.id,
                'filename', sm.original_name,
                'mimeType', sm.mime_type,
                'fileSize', sm.file_size
              )
            )
            FROM print_request_files prf
            JOIN media_files sm
              ON sm.id = prf.media_id
            WHERE prf.print_request_id = pr.id
              AND prf.file_role = 'support'
          ),
          '[]'::json
        ) AS "supportFiles"

      FROM print_requests pr
      LEFT JOIN media_files mf
        ON mf.id = pr.media_id

      ${whereSQL}

      ORDER BY pr.${safeSortBy} ${safeSortOrder}
      LIMIT $${idx}
      OFFSET $${idx + 1}`,
      [...values, pageSize, offset]
    );

    return res.status(200).json({
      success: true,
      message: 'Print requests fetched successfully.',
      data: rows,
      metrics: metricsResult.rows[0],
      pagination: {
        total,
        page: pageNum,
        limit: pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });

  } catch (err) {
    console.error('Get Admin Print Requests Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch print requests.',
    });
  }
};




export const updateAdminPrintRequestQuotation = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      amount,
      breakdown = {},
      estimatedDays,
      adminNotes,
      status,
    } = req.body ?? {};

    // 1. Validate request ID
    if (!id || !/^[1-9]\d*$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid print request ID.',
      });
    }

    // 2. Validate quotation amount
    if (
      amount === undefined ||
      amount === null ||
      typeof amount === 'boolean' ||
      (typeof amount === 'string' && amount.trim() === '')
    ) {
      return res.status(400).json({
        success: false,
        message: 'Quotation amount is required.',
      });
    }

    const quotationAmount = Number(amount);

    const isValidMoney = (value) =>
      Number.isFinite(value) &&
      value >= 0 &&
      Math.round(value * 100) === value * 100;

    if (!isValidMoney(quotationAmount) || quotationAmount <= 0) {
      return res.status(400).json({
        success: false,
        message:
          'Quotation amount must be positive and have no more than two decimal places.',
      });
    }

    // 3. Validate breakdown
    if (
      !breakdown ||
      typeof breakdown !== 'object' ||
      Array.isArray(breakdown)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Quotation breakdown must be a valid object.',
      });
    }

    const parseCost = (value, fieldName) => {
      if (
        typeof value === 'boolean' ||
        value === null ||
        (typeof value === 'string' && value.trim() === '')
      ) {
        throw new Error(
          `${fieldName} must be a valid non-negative amount.`
        );
      }

      const parsed = Number(value);

      if (!isValidMoney(parsed)) {
        throw new Error(
          `${fieldName} must be non-negative and have no more than two decimal places.`
        );
      }

      return parsed;
    };

    let materialCost;
    let printingCost;
    let shippingCost;

    try {
      materialCost = parseCost(
        breakdown.materialCost ?? 0,
        'Material cost'
      );

      printingCost = parseCost(
        breakdown.printingCost ?? 0,
        'Printing cost'
      );

      shippingCost = parseCost(
        breakdown.shippingCost ?? 0,
        'Shipping cost'
      );
    } catch (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError.message,
      });
    }

    // 4. Validate estimated days
    const requestedDays =
      estimatedDays ?? breakdown.estimatedDays ?? 3;

    if (
      typeof requestedDays === 'boolean' ||
      (typeof requestedDays === 'string' &&
        requestedDays.trim() === '')
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Estimated delivery days must be an integer between 1 and 60.',
      });
    }

    const days = Number(requestedDays);

    if (!Number.isInteger(days) || days < 1 || days > 60) {
      return res.status(400).json({
        success: false,
        message:
          'Estimated delivery days must be between 1 and 60.',
      });
    }

    // 5. Validate admin notes
    const notes = adminNotes ?? breakdown.adminNotes ?? '';

    if (typeof notes !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Admin notes must be a string.',
      });
    }

    if (notes.length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'Admin notes cannot exceed 2000 characters.',
      });
    }

    // 6. Validate quotation status
    if (status !== 'quoted') {
      return res.status(400).json({
        success: false,
        message:
          'Status must be "quoted" when submitting a quotation.',
      });
    }

    // // 7. Save quotation and update request using db.query()
    // const result = await db.query(
    //   `
    //   WITH locked_request AS (
    //     SELECT id
    //     FROM print_requests
    //     WHERE id = $1
    //     FOR UPDATE
    //   ),
    //   next_version AS (
    //     SELECT COALESCE(MAX(q.version_number), 0) + 1 AS version_number
    //     FROM print_request_quotations q
    //     INNER JOIN locked_request lr
    //       ON lr.id = q.print_request_id
    //   ),
    //   deactivate_previous AS (
    //     UPDATE print_request_quotations
    //     SET is_current = FALSE
    //     WHERE print_request_id = $1
    //       AND is_current = TRUE
    //       AND EXISTS (SELECT 1 FROM locked_request)
    //     RETURNING id
    //   ),
    //   insert_quotation AS (
    //     INSERT INTO print_request_quotations (
    //       print_request_id,
    //       version_number,
    //       amount,
    //       material_cost,
    //       printing_cost,
    //       shipping_cost,
    //       estimated_days,
    //       admin_notes,
    //       created_by_admin_id,
    //       is_current
    //     )
    //     SELECT
    //       lr.id,
    //       nv.version_number,
    //       $2,
    //       $3,
    //       $4,
    //       $5,
    //       $6,
    //       $7,
    //       $8,
    //       TRUE
    //     FROM locked_request lr
    //     CROSS JOIN next_version nv
    //     RETURNING
    //       id,
    //       print_request_id AS "printRequestId",
    //       version_number AS "versionNumber",
    //       amount,
    //       material_cost AS "materialCost",
    //       printing_cost AS "printingCost",
    //       shipping_cost AS "shippingCost",
    //       estimated_days AS "estimatedDays",
    //       admin_notes AS "adminNotes",
    //       created_at AS "createdAt",
    //       is_current AS "isCurrent"
    //   ),
    //   update_request AS (
    //     UPDATE print_requests
    //     SET
    //       status = 'quoted',
    //       updated_at = NOW()
    //     WHERE id = $1
    //       AND EXISTS (SELECT 1 FROM insert_quotation)
    //     RETURNING id
    //   )
    //   SELECT
    //     iq.*,
    //     'quoted' AS status
    //   FROM insert_quotation iq
    //   INNER JOIN update_request ur
    //     ON ur.id = iq."printRequestId"
    //   `,
    //   [
    //     id,
    //     quotationAmount,
    //     materialCost,
    //     printingCost,
    //     shippingCost,
    //     days,
    //     notes.trim(),
    //     req.user?.adminId ?? null,
    //   ]
    // );

    // // 8. Check whether request exists
    // if (result.rowCount === 0) {
    //   return res.status(404).json({
    //     success: false,
    //     message: `Print request ${id} was not found.`,
    //   });
    // }

    // // 9. Success response
    // return res.status(200).json({
    //   success: true,
    //   message: 'Quotation saved successfully.',
    //   data: result.rows[0],
    // });
    // 7. Save quotation using a transaction
const client = await db.pool.connect();

try {
  await client.query('BEGIN');

  // Lock the print request
  const requestResult = await client.query(
    `SELECT id, status
     FROM print_requests
     WHERE id = $1
     FOR UPDATE`,
    [id]
  );

  if (requestResult.rowCount === 0) {
    await client.query('ROLLBACK');

    return res.status(404).json({
      success: false,
      message: `Print request ${id} was not found.`,
    });
  }

  const currentStatus = requestResult.rows[0].status;
  // Do not allow quotation changes after acceptance or rejection  
  const allowedStatuses = [
    'pending_review',
    'under_review',
    'quoted',
  ];

  if (!allowedStatuses.includes(currentStatus)) {
    await client.query('ROLLBACK');

    return res.status(409).json({
      success: false,
      message: `A quotation cannot be updated when the request status is "${currentStatus}".`,
    });
  }

  // Generate the next quotation version
  const versionResult = await client.query(
    `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
     FROM print_request_quotations
     WHERE print_request_id = $1`,
    [id]
  );

  const nextVersion = versionResult.rows[0].next_version;

  // Mark previous quotation as no longer current
  await client.query(
    `UPDATE print_request_quotations
     SET is_current = FALSE
     WHERE print_request_id = $1
       AND is_current = TRUE`,
    [id]
  );

  // Insert the new quotation
  const quotationResult = await client.query(
    `INSERT INTO print_request_quotations (
       print_request_id,
       version_number,
       amount,
       material_cost,
       printing_cost,
       shipping_cost,
       estimated_days,
       admin_notes,
       created_by_admin_id,
       is_current
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE)
     RETURNING
       id,
       print_request_id AS "printRequestId",
       version_number AS "versionNumber",
       amount,
       material_cost AS "materialCost",
       printing_cost AS "printingCost",
       shipping_cost AS "shippingCost",
       estimated_days AS "estimatedDays",
       admin_notes AS "adminNotes",
       created_at AS "createdAt",
       is_current AS "isCurrent"`,
    [
      id,
      nextVersion,
      quotationAmount,
      materialCost,
      printingCost,
      shippingCost,
      days,
      notes.trim(),
      req.user?.adminId ?? null,
    ]
  );

  // Update request status
  await client.query(
    `UPDATE print_requests
     SET status = 'quoted',
         updated_at = NOW()
     WHERE id = $1`,
    [id]
  );

  await client.query('COMMIT');

  return res.status(200).json({
    success: true,
    message: 'Quotation saved successfully.',
    data: {
      ...quotationResult.rows[0],
      status: 'quoted',
    },
  });

} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}

  } catch (error) {
    console.error(
      'Update Print Request Quotation Error:',
      error
    );

    return res.status(500).json({
      success: false,
      message: 'Failed to save quotation. Please try again.',
    });
  }
};


