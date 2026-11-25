import crypto from 'node:crypto';
import path from 'node:path';
import db from '../../config/db.js';
import * as storageService from '../../services/storageService.js';

/**
 * Public / Storefront: Create a bulk & wholesale enquiry
 * Supports both JSON payload and multipart/form-data with attached BOM file.
 */
export const createBulkEnquiry = async (req, res) => {
  try {
    const {
      fullName,
      companyName,
      email,
      phone,
      category,
      estimatedQuantity,
      targetDate,
      budget,
      gstin,
      city,
      pincode,
      requirements,
    } = req.body;

    // Parse items if passed as string in multipart FormData
    let items = req.body.items;
    if (typeof items === 'string') {
      try {
        items = JSON.parse(items);
      } catch {
        items = [];
      }
    }
    if (!Array.isArray(items)) {
      items = [];
    }

    // Basic required fields
    if (!fullName || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and phone number are required for submitting a bulk enquiry.',
      });
    }

    // Phone validation (at least 10 digits)
    const cleanPhone = String(phone).replace(/[\s\-\(\)\+]/g, '');
    if (cleanPhone.length < 10) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid phone or WhatsApp number with at least 10 digits.',
      });
    }

    // GSTIN validation (optional, but if provided must be 15 alphanumeric characters)
    if (gstin && gstin.trim()) {
      const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      if (!gstinRegex.test(gstin.trim().toUpperCase())) {
        return res.status(400).json({
          success: false,
          message: 'The provided GSTIN is invalid. It must be a standard 15-character format.',
        });
      }
    }

    // Handle attached BOM file if uploaded via Multer
    let fileUrl = req.body.fileUrl || null;
    let fileName = req.body.fileName || null;
    let mediaId = null;

    if (req.file) {
      try {
        const originalExt = path.extname(req.file.originalname).toLowerCase() || '.bin';
        const randomHex = crypto.randomBytes(6).toString('hex');
        const safeFilename = `bom-${Date.now()}-${randomHex}${originalExt}`;
        const folder = 'bulk-enquiries';

        // Save file through storageService (Local / FTP)
        const saveResult = await storageService.saveFile({
          buffer: req.file.buffer,
          filename: safeFilename,
          folder,
          mimeType: req.file.mimetype,
          asyncFtp: true,
        });

        // Insert metadata into media_files
        const { rows: mediaRows } = await db.query(
          `INSERT INTO media_files (filename, original_name, mime_type, file_size, folder, storage_type, storage_path, data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
           RETURNING id`,
          [
            safeFilename,
            req.file.originalname,
            req.file.mimetype,
            req.file.size,
            folder,
            saveResult.storageType,
            saveResult.storagePath,
          ]
        );

        if (mediaRows && mediaRows.length > 0) {
          mediaId = mediaRows[0].id;
          fileUrl = `/api/media/${mediaId}`;
          fileName = req.file.originalname;
        }
      } catch (fileErr) {
        console.error('[Bulk Enquiry] File save error:', fileErr);
        // Continue even if file save fails, but log it
      }
    }

    // Enforce that either at least 1 valid product item or an attached BOM file is provided
    const validItems = items.filter((item) => item && item.name && String(item.name).trim() !== '');
    if (validItems.length === 0 && !fileUrl && !fileName) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one product line item or attach a BOM spreadsheet.',
      });
    }

    const userId = req.user?.id || null;
    const year = new Date().getFullYear();
    const randomCode = Math.floor(100000 + Math.random() * 900000);
    const referenceNo = `ENQ-${year}-${randomCode}`;

    const insertQuery = `
      INSERT INTO bulk_enquiries (
        reference_no,
        user_id,
        full_name,
        company_name,
        email,
        phone,
        category,
        estimated_quantity,
        target_date,
        budget,
        gstin,
        city,
        pincode,
        requirements,
        items,
        file_url,
        file_name,
        media_id,
        status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'PENDING')
      RETURNING id, reference_no, status, created_at;
    `;

    const values = [
      referenceNo,
      userId,
      fullName.trim(),
      companyName ? companyName.trim() : null,
      email.toLowerCase().trim(),
      phone.trim(),
      category || 'General Bulk Inquiry',
      estimatedQuantity || '50+ units',
      targetDate || null,
      budget || null,
      gstin ? gstin.trim().toUpperCase() : null,
      city ? city.trim() : null,
      pincode ? pincode.trim() : null,
      requirements ? requirements.trim() : '',
      JSON.stringify(validItems),
      fileUrl,
      fileName,
      mediaId,
    ];

    const result = await db.query(insertQuery, values);
    const saved = result.rows[0];

    console.log(`[Bulk Enquiry] Received #${referenceNo} from ${fullName} (${email}, ${phone}) with ${validItems.length} items & file: ${fileName || 'none'}`);

    return res.status(201).json({
      success: true,
      message: 'Your bulk enquiry has been received successfully! Our enterprise team will connect with you shortly.',
      referenceNo: saved.reference_no,
      enquiryId: saved.id,
      fileUrl,
      fileName,
      createdAt: saved.created_at,
    });
  } catch (err) {
    console.error('Error submitting bulk enquiry:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to submit bulk enquiry. Please try again or reach out to sales directly.',
    });
  }
};

/**
 * Admin: List all bulk enquiries with filtering, search, pagination, and status statistics
 */
export const getBulkEnquiriesAdmin = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    const whereClauses = [];
    const values = [];

    // Filter by status (case insensitive)
    if (status && status.toLowerCase() !== 'all') {
      values.push(status.toUpperCase());
      whereClauses.push(`UPPER(status) = $${values.length}`);
    }

    // Search by reference_no, full_name, email, phone, company_name
    if (search && search.trim()) {
      const searchTerm = `%${search.trim().toLowerCase()}%`;
      values.push(searchTerm);
      const idx = values.length;
      whereClauses.push(
        `(LOWER(reference_no) LIKE $${idx} OR LOWER(full_name) LIKE $${idx} OR LOWER(email) LIKE $${idx} OR phone LIKE $${idx} OR LOWER(COALESCE(company_name, '')) LIKE $${idx})`
      );
    }

    const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Main records query
    const dataQuery = `
      SELECT
        id,
        reference_no,
        user_id,
        full_name,
        company_name,
        email,
        phone,
        category,
        estimated_quantity,
        target_date,
        budget,
        gstin,
        city,
        pincode,
        requirements,
        items,
        file_url,
        file_name,
        media_id,
        status,
        created_at
      FROM bulk_enquiries
      ${whereSQL}
      ORDER BY created_at DESC
      LIMIT ${limitNum} OFFSET ${offset}
    `;

    // Total count query
    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM bulk_enquiries
      ${whereSQL}
    `;

    // Statistics counts query
    const statsQuery = `
      SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN UPPER(status) = 'PENDING' THEN 1 END)::int AS pending,
        COUNT(CASE WHEN UPPER(status) = 'CONTACTED' THEN 1 END)::int AS contacted,
        COUNT(CASE WHEN UPPER(status) = 'QUOTED' THEN 1 END)::int AS quoted,
        COUNT(CASE WHEN UPPER(status) = 'COMPLETED' THEN 1 END)::int AS completed,
        COUNT(CASE WHEN UPPER(status) = 'REJECTED' THEN 1 END)::int AS rejected
      FROM bulk_enquiries
    `;

    const [dataResult, countResult, statsResult] = await Promise.all([
      db.query(dataQuery, values),
      db.query(countQuery, values),
      db.query(statsQuery),
    ]);

    const total = countResult.rows[0]?.total || 0;
    const stats = statsResult.rows[0] || {
      total: 0,
      pending: 0,
      contacted: 0,
      quoted: 0,
      completed: 0,
      rejected: 0,
    };

    return res.json({
      success: true,
      enquiries: dataResult.rows,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
      stats,
    });
  } catch (err) {
    console.error('Error fetching bulk enquiries:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch bulk enquiries.',
    });
  }
};

/**
 * Admin: Update status of a bulk enquiry (e.g. PENDING, CONTACTED, QUOTED, COMPLETED, REJECTED)
 */
export const updateBulkEnquiryStatusAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required.',
      });
    }

    const validStatuses = ['PENDING', 'CONTACTED', 'QUOTED', 'COMPLETED', 'REJECTED'];
    const cleanStatus = status.toUpperCase().trim();
    if (!validStatuses.includes(cleanStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    // Check if enquiry exists
    const existing = await db.query('SELECT id, requirements FROM bulk_enquiries WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bulk enquiry not found.',
      });
    }

    let updatedRequirements = existing.rows[0].requirements || '';
    if (notes && String(notes).trim().length > 0) {
      const cleanNote = String(notes).trim();
      updatedRequirements = updatedRequirements
        ? `${updatedRequirements}\n[Admin Note]: ${cleanNote}`
        : `[Admin Note]: ${cleanNote}`;
    }

    const updateQuery = `
      UPDATE bulk_enquiries
      SET status = $1,
          requirements = $2,
          updated_at = NOW()
      WHERE id = $3
      RETURNING *;
    `;

    const { rows } = await db.query(updateQuery, [cleanStatus, updatedRequirements, id]);

    return res.json({
      success: true,
      message: `Enquiry status updated to ${cleanStatus}`,
      enquiry: rows[0],
    });
  } catch (err) {
    console.error('Error updating bulk enquiry status:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to update enquiry status.',
    });
  }
};

/**
 * Admin: Delete a bulk enquiry
 */
export const deleteBulkEnquiryAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await db.query(`DELETE FROM bulk_enquiries WHERE id = $1 RETURNING id, reference_no`, [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Bulk enquiry not found.',
      });
    }

    return res.json({
      success: true,
      message: `Bulk enquiry #${rows[0].reference_no} deleted successfully.`,
    });
  } catch (err) {
    console.error('Error deleting bulk enquiry:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete bulk enquiry.',
    });
  }
};
