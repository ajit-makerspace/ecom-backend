import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';

// Base uploads directory relative to backend project root
const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');

// Ensure folder exists helper
const ensureDirExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

// Ensure root uploads folder exists
ensureDirExists(UPLOADS_ROOT);

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
  const allowedFolders = ['products', 'categories', 'banners', 'showcases', 'profiles', 'general'];
  return allowedFolders.includes(clean) ? clean : 'general';
};

// Configure Multer Disk Storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = sanitizeFolder(req.body?.folder || req.query?.folder);
    const targetDir = path.join(UPLOADS_ROOT, folder);
    ensureDirExists(targetDir);
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    const folder = sanitizeFolder(req.body?.folder || req.query?.folder);
    const ext = ALLOWED_MIME_TYPES[file.mimetype] || path.extname(file.originalname).toLowerCase() || '.png';
    const uniqueId = crypto.randomBytes(6).toString('hex');
    const safeName = `${folder}-${Date.now()}-${uniqueId}${ext}`;
    cb(null, safeName);
  },
});

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
 * Handle single file upload from FormData
 */
export const handleSingleUpload = (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file was uploaded. Please provide a file field named "file" or "image".',
      });
    }

    const folder = sanitizeFolder(req.body?.folder || req.query?.folder);
    const relativeUrl = `/uploads/${folder}/${req.file.filename}`;

    return res.status(201).json({
      success: true,
      message: 'File uploaded successfully.',
      url: relativeUrl,
      path: relativeUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    });
  } catch (err) {
    console.error('Upload Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'File upload failed.',
    });
  }
};

/**
 * Handle base64 payload upload (fallback/alternative for programmatic image uploads)
 */
export const handleBase64Upload = (req, res) => {
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
    const targetDir = path.join(UPLOADS_ROOT, folder);
    ensureDirExists(targetDir);

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
    const destinationPath = path.join(targetDir, safeFilename);

    fs.writeFileSync(destinationPath, buffer);

    const relativeUrl = `/uploads/${folder}/${safeFilename}`;

    return res.status(201).json({
      success: true,
      message: 'Base64 image saved successfully.',
      url: relativeUrl,
      path: relativeUrl,
      filename: safeFilename,
      mimetype: mimeType,
      size: buffer.length,
    });
  } catch (err) {
    console.error('Base64 Upload Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to process base64 upload.',
    });
  }
};
