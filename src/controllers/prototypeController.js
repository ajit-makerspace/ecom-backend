import path from 'node:path';
import fs from 'node:fs';
import db from '../config/db.js';
import { ensureLocalFolder, saveFile } from '../services/storageService.js';
import multer from 'multer';

// Ensure prototype_requests schema exists in PostgreSQL
let tableEnsured = false;
export async function ensurePrototypeRequestsTable() {
  if (tableEnsured) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS prototype_requests (
        id SERIAL PRIMARY KEY,
        request_number VARCHAR(60) UNIQUE NOT NULL,
        user_id INTEGER,
        customer_name VARCHAR(255),
        customer_email VARCHAR(255),
        customer_phone VARCHAR(50),
        model_name VARCHAR(255) NOT NULL,
        model_file_url TEXT NOT NULL,
        model_file_size BIGINT DEFAULT 0,
        support_files JSONB DEFAULT '[]'::jsonb,
        material VARCHAR(100) DEFAULT 'PLA',
        color VARCHAR(100) DEFAULT 'Original',
        color_mode VARCHAR(50) DEFAULT 'original',
        color_hex VARCHAR(50),
        quality VARCHAR(50) DEFAULT 'Standard',
        quantity INTEGER DEFAULT 1,
        scale VARCHAR(50) DEFAULT '100',
        units VARCHAR(50) DEFAULT 'mm',
        instructions TEXT,
        status VARCHAR(50) DEFAULT 'submitted',
        quote_amount NUMERIC(12, 2) DEFAULT NULL,
        quote_breakdown JSONB DEFAULT NULL,
        admin_notes TEXT,
        estimated_days INTEGER DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_proto_requests_user ON prototype_requests(user_id);
      CREATE INDEX IF NOT EXISTS idx_proto_requests_status ON prototype_requests(status);
      CREATE INDEX IF NOT EXISTS idx_proto_requests_created ON prototype_requests(created_at DESC);
    `);
    tableEnsured = true;
  } catch (err) {
    console.warn('[Prototype Services] Table init notice:', err.message);
  }
}

// Multer storage setup for 3D model files (up to 100MB)
const storage = multer.memoryStorage();
export const prototypeMulterUpload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB max per file
    files: 20,
  },
});

/**
 * Customer: Submit new 3D Print / Prototype Request (POST /api/print-requests)
 */
export const submitPrintRequest = async (req, res) => {
  try {
    await ensurePrototypeRequestsTable();

    const files = req.files || {};
    const modelFile = files.model?.[0] || (req.file?.fieldname === 'model' ? req.file : null);

    if (!modelFile) {
      return res.status(400).json({
        success: false,
        message: 'A 3D model file (.stl, .obj, .3mf, .zip) is required.',
      });
    }

    // Save main model file via storageService (stores to local /internal-files and syncs to FTP if configured)
    const safeModelName = modelFile.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const modelFilename = `model-${Date.now()}-${safeModelName}`;
    await saveFile({
      buffer: modelFile.buffer,
      filename: modelFilename,
      folder: 'prototype-models',
      mimeType: modelFile.mimetype || 'application/octet-stream',
      asyncFtp: true,
    });
    const modelFileUrl = `/uploads/prototype-models/${modelFilename}`;

    // Process any companion support files (.mtl, textures, etc.)
    const supportFilesData = [];
    const rawSupportFiles = files.supportFiles || [];
    if (Array.isArray(rawSupportFiles) && rawSupportFiles.length > 0) {
      for (const sFile of rawSupportFiles) {
        const safeSupportName = sFile.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const sFilename = `support-${Date.now()}-${safeSupportName}`;
        await saveFile({
          buffer: sFile.buffer,
          filename: sFilename,
          folder: 'prototype-models/support',
          mimeType: sFile.mimetype || 'application/octet-stream',
          asyncFtp: true,
        });
        supportFilesData.push({
          name: sFile.originalname,
          size: sFile.size,
          mimeType: sFile.mimetype,
          url: `/uploads/prototype-models/support/${sFilename}`,
        });
      }
    }

    // Generate unique reference ID
    const requestNumber = `PR-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;

    // Resolve customer details from authenticated session if available
    let userId = req.user?.id || null;
    let customerName = req.user?.name || `${req.user?.first_name || ''} ${req.user?.last_name || ''}`.trim() || req.body.customerName || 'Maker Customer';
    let customerEmail = req.user?.email || req.body.customerEmail || '';
    let customerPhone = req.user?.phone || req.body.customerPhone || '';

    // If customer is not authenticated in req.user, try to read from body
    if (!customerEmail && req.body.email) customerEmail = req.body.email;
    if (!customerName && req.body.name) customerName = req.body.name;
    if (!customerPhone && req.body.phone) customerPhone = req.body.phone;

    const {
      material = 'PLA',
      color = 'Original',
      colorMode = 'original',
      colorHex = null,
      quality = 'Standard',
      quantity = 1,
      scale = '100',
      units = 'mm',
      instructions = '',
    } = req.body;

    const { rows } = await db.query(
      `INSERT INTO prototype_requests (
        request_number,
        user_id,
        customer_name,
        customer_email,
        customer_phone,
        model_name,
        model_file_url,
        model_file_size,
        support_files,
        material,
        color,
        color_mode,
        color_hex,
        quality,
        quantity,
        scale,
        units,
        instructions,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'submitted')
      RETURNING *`,
      [
        requestNumber,
        userId,
        customerName,
        customerEmail,
        customerPhone,
        modelFile.originalname,
        modelFileUrl,
        modelFile.size,
        JSON.stringify(supportFilesData),
        material,
        color,
        colorMode,
        colorHex,
        quality,
        parseInt(quantity || 1, 10),
        String(scale || '100'),
        units,
        instructions ? String(instructions).trim() : null,
      ]
    );

    const record = rows[0];

    return res.status(201).json({
      success: true,
      message: '3D Print & Prototype request submitted successfully.',
      data: {
        id: record.id,
        requestNumber: record.request_number,
        status: record.status,
        modelName: record.model_name,
        modelFileUrl: record.model_file_url,
        createdAt: record.created_at,
      },
    });
  } catch (err) {
    console.error('[Prototype Services] Submit Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Server error submitting print request.',
    });
  }
};

/**
 * Customer: Get My Print Requests (GET /api/print-requests/my)
 */
export const getMyPrintRequests = async (req, res) => {
  try {
    await ensurePrototypeRequestsTable();

    const userId = req.user?.id;
    const userEmail = req.user?.email;

    if (!userId && !userEmail) {
      return res.status(401).json({
        success: false,
        message: 'Please sign in to view your prototype orders.',
      });
    }

    const { rows } = await db.query(
      `SELECT 
        id,
        request_number AS "requestNumber",
        model_name AS "modelName",
        model_file_url AS "modelFileUrl",
        model_file_size AS "modelFileSize",
        support_files AS "supportFiles",
        material,
        color,
        color_mode AS "colorMode",
        color_hex AS "colorHex",
        quality,
        quantity,
        scale,
        units,
        instructions,
        status,
        quote_amount AS "quoteAmount",
        quote_breakdown AS "quote",
        admin_notes AS "adminNotes",
        estimated_days AS "estimatedDays",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM prototype_requests
      WHERE user_id = $1 OR (customer_email IS NOT NULL AND LOWER(customer_email) = LOWER($2))
      ORDER BY created_at DESC`,
      [userId || -1, userEmail || '']
    );

    return res.json({
      success: true,
      data: rows,
    });
  } catch (err) {
    console.error('[Prototype Services] Fetch My Requests Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to fetch your print requests.',
    });
  }
};

/**
 * Admin: Get All Prototype Requests with Metrics & Filters (GET /api/admin/prototype-requests)
 */
export const getAdminPrototypeRequests = async (req, res) => {
  try {
    await ensurePrototypeRequestsTable();

    const {
      search = '',
      status = 'all',
      material = 'all',
      page = 1,
      limit = 50,
      sortBy = 'created_at',
      sortOrder = 'DESC',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10)));
    const offset = (pageNum - 1) * pageSize;

    const whereClauses = [];
    const values = [];
    let idx = 1;

    if (search && search.trim()) {
      const q = `%${search.trim().toLowerCase()}%`;
      whereClauses.push(`(
        LOWER(request_number) LIKE $${idx} OR
        LOWER(COALESCE(customer_name, '')) LIKE $${idx} OR
        LOWER(COALESCE(customer_email, '')) LIKE $${idx} OR
        LOWER(model_name) LIKE $${idx} OR
        LOWER(material) LIKE $${idx}
      )`);
      values.push(q);
      idx++;
    }

    if (status && status !== 'all') {
      whereClauses.push(`status = $${idx}`);
      values.push(status);
      idx++;
    }

    if (material && material !== 'all') {
      whereClauses.push(`LOWER(material) = LOWER($${idx})`);
      values.push(material);
      idx++;
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 1. Fetch Metrics Summary
    const { rows: metricsRows } = await db.query(`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE status = 'submitted')::int AS "submitted",
        COUNT(*) FILTER (WHERE status = 'under_review')::int AS "underReview",
        COUNT(*) FILTER (WHERE status = 'quoted')::int AS "quoted",
        COUNT(*) FILTER (WHERE status = 'approved')::int AS "approved",
        COUNT(*) FILTER (WHERE status = 'in_production')::int AS "inProduction",
        COUNT(*) FILTER (WHERE status = 'completed')::int AS "completed",
        COUNT(*) FILTER (WHERE status = 'rejected')::int AS "rejected"
      FROM prototype_requests
    `);

    // 2. Fetch Total Count matching search
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*)::int AS "filteredTotal" FROM prototype_requests ${whereSql}`,
      values
    );

    const filteredTotal = countRows[0]?.filteredTotal || 0;

    // 3. Fetch Paginated Records
    const validSortCols = ['created_at', 'updated_at', 'request_number', 'status', 'quantity', 'quote_amount'];
    const safeSortBy = validSortCols.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const dataQuery = `
      SELECT 
        id,
        request_number AS "requestNumber",
        user_id AS "userId",
        customer_name AS "customerName",
        customer_email AS "customerEmail",
        customer_phone AS "customerPhone",
        model_name AS "modelName",
        model_file_url AS "modelFileUrl",
        model_file_size AS "modelFileSize",
        support_files AS "supportFiles",
        material,
        color,
        color_mode AS "colorMode",
        color_hex AS "colorHex",
        quality,
        quantity,
        scale,
        units,
        instructions,
        status,
        quote_amount AS "quoteAmount",
        quote_breakdown AS "quoteBreakdown",
        admin_notes AS "adminNotes",
        estimated_days AS "estimatedDays",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM prototype_requests
      ${whereSql}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      LIMIT $${idx} OFFSET $${idx + 1}
    `;

    const { rows: requests } = await db.query(dataQuery, [...values, pageSize, offset]);

    return res.json({
      success: true,
      data: requests,
      metrics: metricsRows[0] || {
        total: 0,
        submitted: 0,
        underReview: 0,
        quoted: 0,
        approved: 0,
        inProduction: 0,
        completed: 0,
        rejected: 0,
      },
      pagination: {
        total: filteredTotal,
        page: pageNum,
        limit: pageSize,
        pages: Math.ceil(filteredTotal / pageSize),
      },
    });
  } catch (err) {
    console.error('[Prototype Services] Admin List Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to fetch prototype requests.',
    });
  }
};

/**
 * Admin: Get Single Prototype Request Details (GET /api/admin/prototype-requests/:id)
 */
export const getAdminPrototypeRequestById = async (req, res) => {
  try {
    await ensurePrototypeRequestsTable();
    const { id } = req.params;

    const { rows } = await db.query(
      `SELECT 
        id,
        request_number AS "requestNumber",
        user_id AS "userId",
        customer_name AS "customerName",
        customer_email AS "customerEmail",
        customer_phone AS "customerPhone",
        model_name AS "modelName",
        model_file_url AS "modelFileUrl",
        model_file_size AS "modelFileSize",
        support_files AS "supportFiles",
        material,
        color,
        color_mode AS "colorMode",
        color_hex AS "colorHex",
        quality,
        quantity,
        scale,
        units,
        instructions,
        status,
        quote_amount AS "quoteAmount",
        quote_breakdown AS "quoteBreakdown",
        admin_notes AS "adminNotes",
        estimated_days AS "estimatedDays",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM prototype_requests
      WHERE id::text = $1 OR request_number = $1`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Prototype request not found.' });
    }

    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[Prototype Services] Admin Get Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to retrieve prototype request.',
    });
  }
};

/**
 * Admin: Update Status (PATCH /api/admin/prototype-requests/:id/status)
 */
export const updateAdminPrototypeRequestStatus = async (req, res) => {
  try {
    await ensurePrototypeRequestsTable();
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const validStatuses = ['submitted', 'under_review', 'quoted', 'approved', 'in_production', 'completed', 'rejected'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Allowed values: ${validStatuses.join(', ')}`,
      });
    }

    const { rows } = await db.query(
      `UPDATE prototype_requests
       SET status = $1,
           admin_notes = COALESCE($2, admin_notes),
           updated_at = NOW()
       WHERE id::text = $3 OR request_number = $3
       RETURNING id, request_number AS "requestNumber", status, admin_notes AS "adminNotes", updated_at AS "updatedAt"`,
      [status, adminNotes || null, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Prototype request not found.' });
    }

    return res.json({
      success: true,
      message: `Request status updated to "${status}".`,
      data: rows[0],
    });
  } catch (err) {
    console.error('[Prototype Services] Status Update Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to update prototype request status.',
    });
  }
};

/**
 * Admin: Set / Update Price Quote (POST /api/admin/prototype-requests/:id/quote)
 */
export const updateAdminPrototypeRequestQuote = async (req, res) => {
  try {
    await ensurePrototypeRequestsTable();
    const { id } = req.params;
    const {
      amount,
      breakdown = {},
      estimatedDays,
      adminNotes,
      status = 'quoted',
    } = req.body;

    const numericAmount = parseFloat(amount || 0);

    const quoteData = {
      total: numericAmount,
      materialCost: parseFloat(breakdown.materialCost || 0),
      printingCost: parseFloat(breakdown.printingCost || 0),
      shippingCost: parseFloat(breakdown.shippingCost || 0),
      estimatedDays: parseInt(estimatedDays || breakdown.estimatedDays || 3, 10),
      adminNotes: adminNotes || breakdown.adminNotes || '',
      updatedAt: new Date().toISOString(),
    };

    const { rows } = await db.query(
      `UPDATE prototype_requests
       SET quote_amount = $1,
           quote_breakdown = $2,
           estimated_days = $3,
           admin_notes = COALESCE($4, admin_notes),
           status = $5,
           updated_at = NOW()
       WHERE id::text = $6 OR request_number = $6
       RETURNING *`,
      [
        numericAmount,
        JSON.stringify(quoteData),
        quoteData.estimatedDays,
        adminNotes || null,
        status || 'quoted',
        id,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Prototype request not found.' });
    }

    return res.json({
      success: true,
      message: 'Quote has been successfully issued to customer.',
      data: rows[0],
    });
  } catch (err) {
    console.error('[Prototype Services] Quote Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to submit quote.',
    });
  }
};

/**
 * Admin: Delete Request (DELETE /api/admin/prototype-requests/:id)
 */
export const deleteAdminPrototypeRequest = async (req, res) => {
  try {
    await ensurePrototypeRequestsTable();
    const { id } = req.params;

    const { rows } = await db.query(
      `DELETE FROM prototype_requests WHERE id::text = $1 OR request_number = $1 RETURNING id, request_number AS "requestNumber"`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Prototype request not found.' });
    }

    return res.json({
      success: true,
      message: `Prototype request #${rows[0].requestNumber} deleted successfully.`,
    });
  } catch (err) {
    console.error('[Prototype Services] Delete Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to delete request.',
    });
  }
};

export default {
  ensurePrototypeRequestsTable,
  prototypeMulterUpload,
  submitPrintRequest,
  getMyPrintRequests,
  getAdminPrototypeRequests,
  getAdminPrototypeRequestById,
  updateAdminPrototypeRequestStatus,
  updateAdminPrototypeRequestQuote,
  deleteAdminPrototypeRequest,
};
