import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import db from '../config/db.js';

// Allowed MIME types map
const ALLOWED_MIME_TYPES = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

// Safe folder sanitizer
export const sanitizeFolder = (folderName) => {
  if (!folderName || typeof folderName !== 'string') return 'general';
  const clean = folderName.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const allowedFolders = ['products', 'categories', 'subcategories', 'banners', 'showcases', 'profiles', 'general'];
  return allowedFolders.includes(clean) ? clean : 'general';
};

// Multer memory storage (keeps binary in memory Buffer, saves to PostgreSQL)
const storage = multer.memoryStorage();

// File filter for security
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new Error(`Unsupported file format (${file.mimetype}). Allowed formats: JPEG, PNG, WEBP, SVG, GIF, PDF`), false);
  }
};

// Multer upload middleware instance (15MB limit)
export const multerUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15 MB
    files: 5,
  },
});

/**
 * Handle single file upload - saves directly to PostgreSQL media_files table
 */
export const handleSingleUpload = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file was uploaded. Please provide a file field named "file" or "image".',
      });
    }

    const folder = sanitizeFolder(req.query?.folder || req.body?.folder);
    const ext = ALLOWED_MIME_TYPES[req.file.mimetype] || path.extname(req.file.originalname).toLowerCase() || '.png';
    const uniqueId = crypto.randomBytes(6).toString('hex');
    const safeName = `${folder}-${Date.now()}-${uniqueId}${ext}`;

    const { rows } = await db.query(
      `INSERT INTO media_files (filename, original_name, mime_type, file_size, folder, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, filename, mime_type, file_size`,
      [safeName, req.file.originalname, req.file.mimetype, req.file.size, folder, req.file.buffer]
    );

    const mediaId = rows[0].id;
    const relativeUrl = `/api/media/${mediaId}`;

    return res.status(201).json({
      success: true,
      message: 'File saved to database successfully.',
      url: relativeUrl,
      path: relativeUrl,
      mediaId,
      filename: safeName,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });
  } catch (err) {
    console.error('Database Upload Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'File upload to database failed.',
    });
  }
};

/**
 * Handle base64 payload upload - saves directly to PostgreSQL media_files table
 */
export const handleBase64Upload = async (req, res) => {
  try {
    const { data, image, fileData, filename, folder: rawFolder } = req.body;
    const base64String = data || image || fileData;

    if (!base64String || typeof base64String !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Valid base64 data string is required (data or image field).',
      });
    }

    const folder = sanitizeFolder(rawFolder || req.query?.folder);

    // Extract MIME type and raw base64 data
    const matches = base64String.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let mimeType = 'image/png';
    let base64BufferData = base64String;

    if (matches && matches.length === 3) {
      mimeType = matches[1];
      base64BufferData = matches[2];
    }

    const ext = ALLOWED_MIME_TYPES[mimeType] || '.png';
    const buffer = Buffer.from(base64BufferData, 'base64');

    if (buffer.length > 15 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        message: 'File size exceeds maximum allowed limit of 15MB.',
      });
    }

    const uniqueId = crypto.randomBytes(6).toString('hex');
    const safeFilename = `${folder}-${Date.now()}-${uniqueId}${ext}`;

    const { rows } = await db.query(
      `INSERT INTO media_files (filename, original_name, mime_type, file_size, folder, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, filename, mime_type, file_size`,
      [safeFilename, filename || safeFilename, mimeType, buffer.length, folder, buffer]
    );

    const mediaId = rows[0].id;
    const relativeUrl = `/api/media/${mediaId}`;

    return res.status(201).json({
      success: true,
      message: 'Base64 image saved to database successfully.',
      url: relativeUrl,
      path: relativeUrl,
      mediaId,
      filename: safeFilename,
      mimetype: mimeType,
      size: buffer.length,
    });
  } catch (err) {
    console.error('Database Base64 Upload Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to process base64 upload to database.',
    });
  }
};
