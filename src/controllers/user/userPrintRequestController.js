
import crypto from 'node:crypto';
import db from '../../config/db.js';
import storageService from '../../services/storageService.js';
import path from 'node:path';

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
    const ext = path.extname(modelFile.originalname).toLowerCase();

    const safeName = `print-models-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;

    const mimeType =
      modelFile.mimetype || 'application/octet-stream';

    const saved = await storageService.saveFile({
      buffer: modelFile.buffer,
      filename: safeName,
      folder: 'print-models',
      mimeType,
      asyncFtp: true,
    });

    // 2. Record the primary model in media_files
    const media = await db.query(
      `INSERT INTO media_files
         (filename, original_name, mime_type, file_size, folder, storage_type, storage_path, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
       RETURNING id`,
      [
        safeName,
        modelFile.originalname,
        mimeType,
        modelFile.buffer.length,
        'print-models',
        saved.storageType,
        saved.storagePath,
      ]
    );

    // 3. Create print request
    const { rows } = await db.query(
      `INSERT INTO print_requests (user_id, media_id, user_address_id)
       VALUES ($1, $2, $3)
       RETURNING id, created_at AS "createdAt"`,
      [userId, media.rows[0].id, addressId]
    );

    return res.status(201).json({
      success: true,
      data: {
        ...rows[0],
        mediaId: media.rows[0].id,
        filename: modelFile.originalname,
        supportFilesCount: supportFiles.length,
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


export const getMyPrintRequests = async (req, res) => {
  try {
    // Get logged-in user's ID from authentication middleware
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Please sign in.',
      });
    }

    // Fetch only this user's print orders
  const { rows } = await db.query(
  `SELECT
      pr.id,
      pr.created_at AS "createdAt",
      pr.media_id AS "mediaId",
      pr.user_address_id AS "addressId",
      mf.original_name AS "filename",
      mf.mime_type AS "mimeType",
      mf.file_size AS "fileSize"
   FROM print_requests pr
   LEFT JOIN media_files mf
      ON pr.media_id = mf.id
   WHERE pr.user_id = $1
   ORDER BY pr.created_at DESC`,
  [userId]
);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows,
    });

  } catch (err) {
    console.error('Get My Print Requests Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch print orders.',
    });
  }
};
