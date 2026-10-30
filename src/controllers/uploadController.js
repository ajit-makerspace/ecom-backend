import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import multer from 'multer';
import { createJimp } from '@jimp/core';
import { defaultFormats, defaultPlugins } from 'jimp';
import webpFormat from '@jimp/wasm-webp';
import db from '../config/db.js';
import storageService from '../services/storageService.js';

// Polyfill Node.js fetch for local wasm files needed by @jsquash/webp in Jimp
if (typeof globalThis.fetch === 'function') {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, ...args) => {
    const urlStr = String(url);
    if (urlStr.startsWith('file:') && urlStr.endsWith('.wasm')) {
      const data = await readFile(fileURLToPath(urlStr));
      return new Response(data, {
        headers: { 'content-type': 'application/wasm' },
      });
    }
    return originalFetch(url, ...args);
  };
}

// Configured Jimp instance with WebP encoder/decoder support
const Jimp = createJimp({
  formats: [...defaultFormats, webpFormat],
  plugins: defaultPlugins,
});

// Allowed MIME types map
const ALLOWED_MIME_TYPES = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/gif': '.gif',
  'image/tiff': '.tiff',
  'image/bmp': '.bmp',
  'image/x-ms-bmp': '.bmp',
  'image/pjpeg': '.jpg',
  'image/x-png': '.png',
  'application/pdf': '.pdf',
  // Video (banners only, enforced in handleSingleUpload)
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogg',
};

// All raster image MIME types that must be converted to WebP format
const CONVERTIBLE_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/bmp',
  'image/x-ms-bmp',
  'image/pjpeg',
  'image/x-png',
]);

const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg']);
const VIDEO_ALLOWED_FOLDERS = new Set(['banners']);

const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB for images / PDFs
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50 MB for videos

/**
 * Converts a raster image buffer into optimized WebP format using Jimp.
 * Preserves vector graphics (SVG), documents (PDF), and videos without conversion.
 *
 * @param {Buffer} buffer - Original file buffer
 * @param {string} mimeType - Original MIME type
 * @returns {Promise<{ buffer: Buffer, mimeType: string, ext: string, isConverted: boolean }>}
 */
export const convertToWebp = async (buffer, mimeType) => {
  const isRasterImage = CONVERTIBLE_IMAGE_MIME_TYPES.has(mimeType) || 
    (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml');

  if (!isRasterImage) {
    return {
      buffer,
      mimeType,
      ext: ALLOWED_MIME_TYPES[mimeType] || '.bin',
      isConverted: false,
    };
  }

  try {
    const image = await Jimp.read(buffer);
    const webpBuffer = await image.getBuffer('image/webp', { quality: 85 });

    return {
      buffer: webpBuffer,
      mimeType: 'image/webp',
      ext: '.webp',
      isConverted: true,
    };
  } catch (err) {
    console.warn(
      `[WebP Conversion Warning] Failed converting ${mimeType} to WebP using Jimp (${err.message}). Using original buffer:`
    );
    return {
      buffer,
      mimeType,
      ext: ALLOWED_MIME_TYPES[mimeType] || '.webp',
      isConverted: false,
    };
  }
};

// Safe folder sanitizer
export const sanitizeFolder = (folderName) => {
  if (!folderName || typeof folderName !== 'string') return 'general';
  const clean = folderName.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const allowedFolders = ['products', 'categories', 'subcategories', 'banners', 'showcases', 'profiles', 'general'];
  return allowedFolders.includes(clean) ? clean : 'general';
};

// Multer memory storage (keeps binary in memory Buffer during request, then saves via storageService)
const storage = multer.memoryStorage();

// File filter for security
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES[file.mimetype]) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Unsupported file format (${file.mimetype}). Allowed formats: JPEG, PNG, WEBP, SVG, GIF, PDF, MP4, WEBM, OGG`
      ),
      false
    );
  }
};

// Multer upload middleware instance
export const multerUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_VIDEO_SIZE,
    files: 5,
  },
});

/**
 * Handle single file upload:
 * 1. Converts images to .webp format for faster loading.
 * 2. Saves file via storageService (FTP or local /internal-files fallback).
 * 3. Records metadata in PostgreSQL media_files with data = NULL (NO DB BLOBS).
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
    const isVideo = VIDEO_MIME_TYPES.has(req.file.mimetype);

    // Videos are only accepted for banners
    if (isVideo && !VIDEO_ALLOWED_FOLDERS.has(folder)) {
      return res.status(400).json({
        success: false,
        message: 'Video uploads are only allowed for banners.',
      });
    }

    // Keep the 15MB limit for non-videos
    if (!isVideo && req.file.size > MAX_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        message: 'File size exceeds maximum allowed limit of 15MB.',
      });
    }

    // 1. Automatically convert eligible raster images to WebP
    const converted = await convertToWebp(req.file.buffer, req.file.mimetype);
    const ext = converted.ext;
    const uniqueId = crypto.randomBytes(6).toString('hex');
    const safeName = `${folder}-${Date.now()}-${uniqueId}${ext}`;

    // 2. Save via storageService (local disk + async background FTP push)
    const saveResult = await storageService.saveFile({
      buffer: converted.buffer,
      filename: safeName,
      folder,
      mimeType: converted.mimeType,
      asyncFtp: true,
    });

    // 3. Insert metadata only into PostgreSQL media_files table (data = NULL explicitly)
    const { rows } = await db.query(
      `INSERT INTO media_files (filename, original_name, mime_type, file_size, folder, storage_type, storage_path, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
       RETURNING id, filename, mime_type, file_size, storage_type, storage_path`,
      [
        safeName,
        req.file.originalname,
        converted.mimeType,
        converted.buffer.length,
        folder,
        saveResult.storageType,
        saveResult.storagePath,
      ]
    );

    const mediaId = rows[0].id;
    const relativeUrl = `/api/media/${mediaId}`;

    return res.status(201).json({
      success: true,
      message: converted.isConverted
        ? `Image converted to WebP and saved to ${saveResult.storageType} successfully.`
        : `File saved to ${saveResult.storageType} successfully.`,
      url: relativeUrl,
      path: relativeUrl,
      mediaId,
      filename: safeName,
      originalName: req.file.originalname,
      mimetype: converted.mimeType,
      size: converted.buffer.length,
      storageType: saveResult.storageType,
      storagePath: saveResult.storagePath,
      isFallback: saveResult.isFallback || false,
    });
  } catch (err) {
    console.error('File Upload Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'File upload failed.',
    });
  }
};

/**
 * Handle base64 payload upload:
 * 1. Converts images to .webp format for faster loading.
 * 2. Saves file via storageService (FTP or local /internal-files fallback).
 * 3. Records metadata in PostgreSQL media_files with data = NULL (NO DB BLOBS).
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

    // Videos must go through the multipart upload (base64 would bloat the payload)
    if (VIDEO_MIME_TYPES.has(mimeType)) {
      return res.status(400).json({
        success: false,
        message: 'Videos must be uploaded as a file, not base64.',
      });
    }

    const rawBuffer = Buffer.from(base64BufferData, 'base64');

    if (rawBuffer.length > MAX_FILE_SIZE) {
      return res.status(400).json({
        success: false,
        message: 'File size exceeds maximum allowed limit of 15MB.',
      });
    }

    // 1. Automatically convert eligible raster images to WebP
    const converted = await convertToWebp(rawBuffer, mimeType);
    const ext = converted.ext;
    const uniqueId = crypto.randomBytes(6).toString('hex');
    const safeFilename = `${folder}-${Date.now()}-${uniqueId}${ext}`;

    // 2. Save via storageService (local disk + async background FTP push)
    const saveResult = await storageService.saveFile({
      buffer: converted.buffer,
      filename: safeFilename,
      folder,
      mimeType: converted.mimeType,
      asyncFtp: true,
    });

    // 3. Insert metadata into media_files with data = NULL (NO DB BLOBS)
    const { rows } = await db.query(
      `INSERT INTO media_files (filename, original_name, mime_type, file_size, folder, storage_type, storage_path, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
       RETURNING id, filename, mime_type, file_size, storage_type, storage_path`,
      [
        safeFilename,
        filename || safeFilename,
        converted.mimeType,
        converted.buffer.length,
        folder,
        saveResult.storageType,
        saveResult.storagePath,
      ]
    );

    const mediaId = rows[0].id;
    const relativeUrl = `/api/media/${mediaId}`;

    return res.status(201).json({
      success: true,
      message: converted.isConverted
        ? `Base64 image converted to WebP and saved to ${saveResult.storageType} successfully.`
        : `Base64 file saved to ${saveResult.storageType} successfully.`,
      url: relativeUrl,
      path: relativeUrl,
      mediaId,
      filename: safeFilename,
      mimetype: converted.mimeType,
      size: converted.buffer.length,
      storageType: saveResult.storageType,
      storagePath: saveResult.storagePath,
      isFallback: saveResult.isFallback || false,
    });
  } catch (err) {
    console.error('Base64 Upload Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to process base64 upload.',
    });
  }
};

export default {
  convertToWebp,
  sanitizeFolder,
  multerUpload,
  handleSingleUpload,
  handleBase64Upload,
};
