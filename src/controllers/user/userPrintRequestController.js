
// import crypto from 'node:crypto';
// import db from '../../config/db.js';
// import storageService from '../../services/storageService.js';
// import path from 'node:path';

// export const createPrintRequest = async (req, res) => {
//   try {
//     const userId = req.user?.id;

//     if (!userId) {
//       return res.status(401).json({
//         success: false,
//         message: 'Please sign in.',
//       });
//     }

//     // Get files from Multer fields()
//     const modelFile = req.files?.model?.[0];
//     const supportFiles = req.files?.supportFiles || [];

//     if (!modelFile) {
//       return res.status(400).json({
//         success: false,
//         message: 'No model file was uploaded.',
//       });
//     }

//     const addressId = parseInt(req.body.addressId, 10);

//     if (!Number.isInteger(addressId) || addressId <= 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'A delivery address is required.',
//       });
//     }

//     // Verify that the address belongs to the signed-in user
//     const addr = await db.query(
//       'SELECT id FROM user_addresses WHERE id = $1 AND user_id = $2',
//       [addressId, userId]
//     );

//     if (addr.rows.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid delivery address.',
//       });
//     }

//     // 1. Save the primary model file
//     const ext = path.extname(modelFile.originalname).toLowerCase();

//     const safeName = `print-models-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;

//     const mimeType =
//       modelFile.mimetype || 'application/octet-stream';

//     const saved = await storageService.saveFile({
//       buffer: modelFile.buffer,
//       filename: safeName,
//       folder: 'print-models',
//       mimeType,
//       asyncFtp: true,
//     });

//     // 2. Record the primary model in media_files
//     const media = await db.query(
//       `INSERT INTO media_files
//          (filename, original_name, mime_type, file_size, folder, storage_type, storage_path, data)
//        VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
//        RETURNING id`,
//       [
//         safeName,
//         modelFile.originalname,
//         mimeType,
//         modelFile.buffer.length,
//         'print-models',
//         saved.storageType,
//         saved.storagePath,
//       ]
//     );

//     // 3. Create print request
//     const { rows } = await db.query(
//       `INSERT INTO print_requests (user_id, media_id, user_address_id)
//        VALUES ($1, $2, $3)
//        RETURNING id, created_at AS "createdAt"`,
//       [userId, media.rows[0].id, addressId]
//     );

//     return res.status(201).json({
//       success: true,
//       data: {
//         ...rows[0],
//         mediaId: media.rows[0].id,
//         filename: modelFile.originalname,
//         supportFilesCount: supportFiles.length,
//       },
//     });

//   } catch (err) {
//     console.error('Create Print Request Error:', err);

//     return res.status(500).json({
//       success: false,
//       message: 'Failed to submit your print request.',
//     });
//   }
// };


// export const getMyPrintRequests = async (req, res) => {
//   try {
//     // Get logged-in user's ID from authentication middleware
//     const userId = req.user?.id;

//     if (!userId) {
//       return res.status(401).json({
//         success: false,
//         message: 'Please sign in.',
//       });
//     }

//     // Fetch only this user's print orders
//   const { rows } = await db.query(
//   `SELECT
//       pr.id,
//       pr.created_at AS "createdAt",
//       pr.media_id AS "mediaId",
//       pr.user_address_id AS "addressId",
//       mf.original_name AS "filename",
//       mf.mime_type AS "mimeType",
//       mf.file_size AS "fileSize"
//    FROM print_requests pr
//    LEFT JOIN media_files mf
//       ON pr.media_id = mf.id
//    WHERE pr.user_id = $1
//    ORDER BY pr.created_at DESC`,
//   [userId]
// );

//     return res.status(200).json({
//       success: true,
//       count: rows.length,
//       data: rows,
//     });

//   } catch (err) {
//     console.error('Get My Print Requests Error:', err);

//     return res.status(500).json({
//       success: false,
//       message: 'Failed to fetch print orders.',
//     });
//   }
// };





import crypto from 'node:crypto';
import db from '../../config/db.js';
import storageService from '../../services/storageService.js';
import path from 'node:path';

// Save file and create its media_files record
const savePrintMedia = async (file) => {
  const ext = path.extname(file.originalname).toLowerCase();

  const safeName = `print-models-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;

  const mimeType = file.mimetype || 'application/octet-stream';

  const saved = await storageService.saveFile({
    buffer: file.buffer,
    filename: safeName,
    folder: 'print-models',
    mimeType,
    asyncFtp: true,
  });

  const media = await db.query(
    `INSERT INTO media_files
      (
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
      safeName,
      file.originalname,
      mimeType,
      file.buffer.length,
      'print-models',
      saved.storageType,
      saved.storagePath,
    ]
  );

  return media.rows[0].id;
};


export const createPrintRequest = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Please sign in.',
      });
    }

    // Get files from Multer fields()
    const modelFile = req.files?.model?.[0];
    const supportFiles = req.files?.supportFiles || [];

    if (!modelFile) {
      return res.status(400).json({
        success: false,
        message: 'No model file was uploaded.',
      });
    }

    const addressId = parseInt(req.body.addressId, 10);

    if (!Number.isInteger(addressId) || addressId <= 0) {
      return res.status(400).json({
        success: false,
        message: 'A delivery address is required.',
      });
    }

    // Validate printing preferences
    const quantity = parseInt(req.body.quantity ?? '1', 10);
    const scale = Number(req.body.scale ?? 1);

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Quantity must be a positive integer.',
      });
    }

    if (!Number.isFinite(scale) || scale <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Scale must be a positive number.',
      });
    }

    const {
      material = null,
      colorMode = null,
      colorHex = null,
      quality = null,
      units = 'mm',
      instructions = null,
    } = req.body;

    // Verify that the address belongs to the signed-in user
    const addr = await db.query(
      'SELECT id FROM user_addresses WHERE id = $1 AND user_id = $2',
      [addressId, userId]
    );

    if (addr.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid delivery address.',
      });
    }

    // 1. Save the primary model file
    const mainMediaId = await savePrintMedia(modelFile);

    // 2. Create print request with printing preferences
    const { rows } = await db.query(
      `INSERT INTO print_requests (
        user_id,
        media_id,
        user_address_id,
        material,
        color_mode,
        color_hex,
        quality,
        quantity,
        scale,
        units,
        instructions,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending_review')
      RETURNING
        id,
        created_at AS "createdAt",
        status`,
      [
        userId,
        mainMediaId,
        addressId,
        material,
        colorMode,
        colorHex,
        quality,
        quantity,
        scale,
        units,
        instructions,
      ]
    );

    const request = rows[0];

    // 3. Save and link supporting files
    const savedSupportFiles = [];

    for (const supportFile of supportFiles) {
      const supportMediaId = await savePrintMedia(supportFile);

      await db.query(
        `INSERT INTO print_request_files (
          print_request_id,
          media_id,
          file_role
        )
        VALUES ($1, $2, 'support')`,
        [request.id, supportMediaId]
      );

      savedSupportFiles.push({
        mediaId: supportMediaId,
        filename: supportFile.originalname,
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Print request submitted successfully.',
      data: {
        ...request,
        mediaId: mainMediaId,
        filename: modelFile.originalname,
        supportFiles: savedSupportFiles,
        preferences: {
          material,
          colorMode,
          colorHex,
          quality,
          quantity,
          scale,
          units,
          instructions,
        },
      },
    });

  } catch (err) {
    console.error('Create Print Request Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to submit your print request.',
    });
  }
};


// export const getMyPrintRequests = async (req, res) => {
//   try {
//     // Get logged-in user's ID from authentication middleware
//     const userId = req.user?.id;

//     if (!userId) {
//       return res.status(401).json({
//         success: false,
//         message: 'Please sign in.',
//       });
//     }

//     // Fetch only this user's print requests and supporting files
//     const { rows } = await db.query(
//       `SELECT
//         pr.id,
//         pr.created_at AS "createdAt",
//         pr.updated_at AS "updatedAt",
//         pr.media_id AS "mediaId",
//         pr.user_address_id AS "addressId",

//         pr.material,
//         pr.color_mode AS "colorMode",
//         pr.color_hex AS "colorHex",
//         pr.quality,
//         pr.quantity,
//         pr.scale,
//         pr.units,
//         pr.instructions,
//         pr.status,

//         mf.original_name AS "filename",
//         mf.mime_type AS "mimeType",
//         mf.file_size AS "fileSize",

//         COALESCE(
//           (
//             SELECT json_agg(
//               json_build_object(
//                 'mediaId', sm.id,
//                 'filename', sm.original_name,
//                 'mimeType', sm.mime_type,
//                 'fileSize', sm.file_size
//               )
//             )
//             FROM print_request_files prf
//             JOIN media_files sm
//               ON sm.id = prf.media_id
//             WHERE prf.print_request_id = pr.id
//           ),
//           '[]'::json
//         ) AS "supportFiles"

//       FROM print_requests pr

//       LEFT JOIN media_files mf
//         ON pr.media_id = mf.id

//       WHERE pr.user_id = $1

//       ORDER BY pr.created_at DESC`,
//       [userId]
//     );

//     return res.status(200).json({
//       success: true,
//       count: rows.length,
//       data: rows,
//     });

//   } catch (err) {
//     console.error('Get My Print Requests Error:', err);

//     return res.status(500).json({
//       success: false,
//       message: 'Failed to fetch print orders.',
//     });
//   }
// };




export const getMyPrintRequests = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Please sign in.",
      });
    }

    const { rows } = await db.query(
      `
      SELECT
        pr.id,
        pr.created_at AS "createdAt",
        pr.updated_at AS "updatedAt",
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

        mf.original_name AS "filename",
        mf.mime_type AS "mimeType",
        mf.file_size AS "fileSize",

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
            JOIN media_files sm ON sm.id = prf.media_id
            WHERE prf.print_request_id = pr.id
          ),
          '[]'::json
        ) AS "supportFiles",

        pq.id AS "quotationId",
        pq.version_number AS "quoteVersion",
        pq.amount AS "quoteAmount",
        pq.material_cost AS "materialCost",
        pq.printing_cost AS "printingCost",
        pq.shipping_cost AS "shippingCost",
        pq.estimated_days AS "estimatedDays",
        pq.admin_notes AS "adminNotes",

        CASE
          WHEN pq.id IS NOT NULL THEN
            json_build_object(
              'id', pq.id,
              'version', pq.version_number,
              'total', pq.amount,
              'currency', 'INR',
              'materialCost', pq.material_cost,
              'printingCost', pq.printing_cost,
              'shippingCost', pq.shipping_cost,
              'estimatedDays', pq.estimated_days,
              'adminNotes', pq.admin_notes
            )
          ELSE NULL
        END AS quote

      FROM print_requests pr

      LEFT JOIN media_files mf
        ON pr.media_id = mf.id

      LEFT JOIN LATERAL (
        SELECT
          q.id,
          q.version_number,
          q.amount,
          q.material_cost,
          q.printing_cost,
          q.shipping_cost,
          q.estimated_days,
          q.admin_notes
        FROM print_request_quotations q
        WHERE q.print_request_id = pr.id
          AND q.is_current = TRUE
        ORDER BY q.version_number DESC
        LIMIT 1
      ) pq ON TRUE

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
    console.error("Get My Print Requests Error:", err);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch print orders.",
    });
  }
};


// Common function to accept or reject a quotation
const respondToPrintQuotation = async (req, res, decision) => {
  const requestId = Number(req.params.id);
  const userId = req.user?.id;

  // Validate request ID
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return res.status(400).json({
      success: false,
      message: 'Invalid print request ID.',
    });
  }

  // Authentication check
  if (!userId) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
  }

  const client = await db.pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // 1. Fetch print request belonging to logged-in user
    // FOR UPDATE prevents simultaneous accept/reject operations
    const requestResult = await client.query(
      `SELECT id, user_id, status
       FROM print_requests
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [requestId, userId]
    );

    if (requestResult.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return res.status(404).json({
        success: false,
        message: 'Print request not found.',
      });
    }

    const printRequest = requestResult.rows[0];
const alreadyProcessed =
  (decision === 'accepted' &&
    printRequest.status === 'awaiting_payment') ||
  (decision === 'rejected' &&
    printRequest.status === 'rejected');
    // 2. Handle repeated requests (idempotency)
    if (alreadyProcessed) {
      const existingQuotation = await client.query(
        `SELECT id, version_number, amount
         FROM print_request_quotations
         WHERE print_request_id = $1
           AND is_current = TRUE
         LIMIT 1`,
        [requestId]
      );

      await client.query('COMMIT');
      transactionStarted = false;

      return res.status(200).json({
        success: true,
        message: `Quotation already ${decision}.`,
        status: decision,
        quotation: existingQuotation.rows[0] || null,
      });
    }

    // 3. Only requests with a pending quotation can be accepted/rejected
    if (printRequest.status !== 'quoted') {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        message: 'This quotation cannot be accepted or rejected.',
        currentStatus: printRequest.status,
      });
    }

    // 4. Fetch current quotation
const quotationResult = await client.query(
  `SELECT id, print_request_id, version_number, amount
   FROM print_request_quotations
   WHERE print_request_id = $1
     AND is_current = TRUE
   FOR UPDATE`,
  [requestId]
);

if (quotationResult.rowCount === 0) {
  await client.query('ROLLBACK');

  return res.status(404).json({
    success: false,
    message: 'No active quotation found.',
  });
}

    const quotation = quotationResult.rows[0];

    // 5. Update print request status
    // await client.query(
    //   `UPDATE print_requests
    //    SET status = $1,
    //        updated_at = NOW()
    //    WHERE id = $2
    //      AND user_id = $3`,
    //   [decision, requestId, userId]
    // );
//     await client.query(
//   `UPDATE print_requests
//    SET status = $1,
//        accepted_quotation_id = $2,
//        updated_at = NOW()
//    WHERE id = $3
//      AND user_id = $4`,
//   [decision, decision === 'accepted' ? quotation.id : null, requestId, userId]
// );
// await client.query(
//   `UPDATE print_requests
//    SET status = $1,
//        accepted_quotation_id = $2,
//        updated_at = NOW()
//    WHERE id = $3
//      AND user_id = $4`,
//   [
//     decision,
//     decision === 'accepted' ? quotation.id : null,
//     requestId,
//     userId,
//   ]
// );
const nextStatus =
  decision === 'accepted'
    ? 'awaiting_payment'
    : 'rejected';

await client.query(
  `UPDATE print_requests
   SET status = $1,
       accepted_quotation_id = $2,
       updated_at = NOW()
   WHERE id = $3
     AND user_id = $4`,
  [
    nextStatus,
    decision === 'accepted' ? quotation.id : null,
    requestId,
    userId,
  ]
);

    // 6. Commit transaction
    await client.query('COMMIT');
    
    transactionStarted = false;

    // return res.status(200).json({
    //   success: true,
    //   message:
    //     decision === 'accepted'
    //       ? 'Quotation accepted successfully. Please proceed with payment.'
    //       : 'Quotation rejected successfully. Your print request has been closed.',

    //   printRequestId: requestId,

    //   quotation: {
    //     id: quotation.id,
    //     version: quotation.version_number,
    //     amount: Number(quotation.amount),
    //   },

    //   status: decision,
    //   paymentRequired: decision === 'accepted',
    // });
    return res.status(200).json({
  success: true,
  message:
    decision === 'accepted'
      ? 'Quotation accepted. Please proceed with payment.'
      : 'Quotation rejected successfully.',
  printRequestId: requestId,
  quotation: {
    id: quotation.id,
    version: quotation.version_number,
    amount: Number(quotation.amount),
  },
  status: nextStatus,
  paymentRequired: decision === 'accepted',
});

  } catch (error) {
  if (transactionStarted) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error(
        'Payment transaction rollback failed:',
        rollbackError
      );
    }
  }

  console.error('Verify Print Payment Error:', error);

  return res.status(500).json({
    success: false,
    message: error.message || 'Payment verification failed.',
  });
} finally {
  client.release();
}
};

// Accept quotation
export const acceptPrintQuotation = async (req, res) => {
  return respondToPrintQuotation(req, res, 'accepted');
};

// Reject quotation
export const rejectPrintQuotation = async (req, res) => {
  return respondToPrintQuotation(req, res, 'rejected');
};
