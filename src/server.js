import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import errorHandler from './middleware/errorHandler.js';

import authRoutes from './routes/admin/authRoutes.js';
import moduleRoutes from './routes/admin/moduleRoutes.js';
import categoryRoutes from './routes/admin/categoryRoutes.js';
import productRoutes from './routes/admin/productRoutes.js';
import orderRoutes from './routes/admin/orderRoutes.js';
import analyticsRoutes from './routes/admin/analyticsRoutes.js';
import customerRoutes from './routes/admin/customerRoutes.js';
import bannerRoutes from './routes/admin/bannerRoutes.js';
import showcaseRoutes from './routes/admin/showcaseRoutes.js';
import kitShowcaseRoutes from "./routes/admin/kitShowcaseRoutes.js"
import chatbotRoutes from './routes/admin/chatbotRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import brandLogoRoutes from './routes/admin/brandLogoRoutes.js';
import customerLogoRoutes from './routes/admin/customerLogoRoute.js';
import competitionRoutes from "./routes/admin/competitionBannerRoutes.js"
import shippingRoutes from './routes/admin/shippingRoutes.js';
import warehouseRoutes from './routes/admin/warehouseRoutes.js';

import userAuthRoutes from './routes/user/userAuthRoutes.js';
import userProductRoutes from './routes/user/userProductRoutes.js';
import userOrderRoutes from './routes/user/userOrderRoutes.js';
import userProfileRoutes from './routes/user/userProfileRoutes.js';
import userCartRoutes from './routes/user/userCartRoutes.js';
import userWishlistRoutes from './routes/user/userWishlistRoutes.js';
import userEnquiryRoutes from './routes/user/userEnquiryRoutes.js';
import userModuleRoutes from "./routes/user/userModuleRoutes.js";
import userChatbotRoutes from './routes/user/userChatbotRoutes.js';
import userPaymentRoutes from './routes/user/userPaymentRoutes.js';
import { ensureReviewsTable } from './controllers/user/userReviewController.js';
import { ensureChatbotTable } from './controllers/admin/adminChatbotController.js';
import userCompetitionRoute from "./routes/user/userCompetitionRoute.js"
import ftpService from './services/ftpStorageService.js';
import storageService from './services/storageService.js';
import { startFtpSyncCron, stopFtpSyncCron } from './services/ftpSyncCron.js';

import db from './config/db.js';

const app = express();
const PORT = process.env.PORT || 3005;

// Disable ETag generation to prevent 304 Not Modified responses on dynamic API routes
app.set('etag', false);

// Global Middlewares
app.use(cors());
// SEC-07: Constrain payload size to prevent resource exhaustion / OOM crashes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// SEC-07: Rate Limiters for brute-force protection
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many authentication attempts from this IP. Please try again after 15 minutes.',
  },
});

const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // 60 requests per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many order or checkout requests from this IP. Please try again shortly.',
  },
});

// Prevent browser/proxy caching for all dynamic API endpoints so fresh 200 OK data is always served
app.use('/api', (req, res, next) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store',
  });
  next();
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'ecom-backend', message: 'MakerSpace Masters API' }));
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

// Shared MIME types lookup for file streaming
const MIME_TYPES_MAP = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.pdf': 'application/pdf',
};

/**
 * Universal binary streamer handling HTTP 206 partial Range requests (for video)
 * and Cache-Control headers.
 */
const sendFileBuffer = (res, data, filename, rangeHeader, customMime = null) => {
  const ext = path.extname(filename || '').toLowerCase();
  const mimeType = customMime || MIME_TYPES_MAP[ext] || 'application/octet-stream';
  const totalSize = data.length;

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');

  // Handle Range request for video streaming
  if (rangeHeader && mimeType.startsWith('video/')) {
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

    if (start >= totalSize || end >= totalSize) {
      res.status(416).setHeader('Content-Range', `bytes */${totalSize}`);
      return res.end();
    }

    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
    res.setHeader('Content-Length', chunkSize);
    return res.end(data.subarray(start, end + 1));
  }

  res.setHeader('Content-Length', totalSize);
  return res.end(data);
};

// Database & Local / FTP Product Images Streamer
app.get(['/api/product-images/:id', '/api/product-images/file/:filename'], async (req, res) => {
  try {
    const param = req.params.id || req.params.filename;
    const isNumeric = /^\d+$/.test(param);

    // 1. Check media_files first
    const mediaQuery = isNumeric
      ? 'SELECT mime_type, storage_type, storage_path, filename, folder FROM media_files WHERE id = $1'
      : 'SELECT mime_type, storage_type, storage_path, filename, folder FROM media_files WHERE filename = $1 LIMIT 1';
    const mediaRes = await db.query(mediaQuery, [param]);

    if (mediaRes.rows.length > 0) {
      const file = mediaRes.rows[0];
      const data = await storageService.readFile({
        storageType: file.storage_type,
        storagePath: file.storage_path,
        filename: file.filename,
        folder: file.folder,
      });
      if (data) {
        return sendFileBuffer(res, data, file.filename, req.headers.range, file.mime_type);
      }
    }

    // 2. Legacy check: product_images table if present
    try {
      const query = isNumeric
        ? 'SELECT mime_type, image_data AS data, file_name FROM product_images WHERE id = $1'
        : 'SELECT mime_type, image_data AS data, file_name FROM product_images WHERE file_name = $1 LIMIT 1';
      const { rows } = await db.query(query, [param]);
      if (rows.length > 0 && rows[0].data) {
        return sendFileBuffer(res, rows[0].data, rows[0].file_name, req.headers.range, rows[0].mime_type);
      }
    } catch {}

    const placeholderSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="100%" height="100%" fill="#f8fafc" rx="8" stroke="#e2e8f0" stroke-width="1"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="600" fill="#94a3b8">Product Image</text></svg>`
    );
    return sendFileBuffer(res, placeholderSvg, 'product-placeholder.svg', req.headers.range, 'image/svg+xml');
  } catch (err) {
    console.error('Serve Product Image Error:', err);
    return res.status(500).send('Error loading product image');
  }
});

// Storage Service Media Streamer: Streams images & videos from FTP server or local /internal-files
app.get('/api/media/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const isNumeric = /^\d+$/.test(id);
    const query = isNumeric
      ? 'SELECT mime_type, data, storage_type, storage_path, filename, folder, file_size FROM media_files WHERE id = $1'
      : 'SELECT mime_type, data, storage_type, storage_path, filename, folder, file_size FROM media_files WHERE filename = $1 LIMIT 1';
    const { rows } = await db.query(query, [id]);

    if (rows.length === 0) {
      // Direct local file fallback in internal-files
      const internalFilesDir = storageService.getInternalFilesDir();
      const directLocalPath = path.join(internalFilesDir, id);
      if (fs.existsSync(directLocalPath)) {
        const data = await fs.promises.readFile(directLocalPath);
        return sendFileBuffer(res, data, id, req.headers.range);
      }
      const placeholderSvg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="60" viewBox="0 0 180 60"><rect width="100%" height="100%" fill="#f8fafc" rx="6" stroke="#e2e8f0" stroke-width="1"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="600" fill="#94a3b8">Not Found</text></svg>`
      );
      return sendFileBuffer(res, placeholderSvg, 'not-found.svg', req.headers.range, 'image/svg+xml');
    }

    const file = rows[0];

    // Read file via storageService (from local /internal-files or FTP or local disk cache)
    let data = await storageService.readFile({
      storageType: file.storage_type,
      storagePath: file.storage_path,
      filename: file.filename,
      folder: file.folder,
    });

    // Fallback only if legacy data bytea is present
    if (!data && file.data) {
      data = file.data;
    }

    if (!data) {
      // Graceful SVG placeholder fallback to prevent Next.js image optimizer "received null" crash
      const label = file.filename
        ? file.filename.replace(/^brand-/, '').replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
        : 'Image';
      const cleanLabel = (label.charAt(0).toUpperCase() + label.slice(1)).slice(0, 24);
      const placeholderSvg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="60" viewBox="0 0 180 60"><rect width="100%" height="100%" fill="#f8fafc" rx="6" stroke="#e2e8f0" stroke-width="1"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="12" font-weight="600" fill="#64748b">${cleanLabel}</text></svg>`
      );
      return sendFileBuffer(res, placeholderSvg, `${file.filename || id}.svg`, req.headers.range, 'image/svg+xml');
    }

    return sendFileBuffer(res, data, file.filename, req.headers.range, file.mime_type);
  } catch (err) {
    console.error('Serve Media Error:', err);
    return res.status(500).send('Error loading media');
  }
});

// Serve static uploads directly from backend uploads folder if files exist on disk
app.use('/uploads', express.static(UPLOADS_DIR));

// Storage Service & FTP Upload Resolver: streams any /uploads/* from /internal-files, FTP server, or media_files
app.get('/uploads/*', async (req, res, next) => {
  try {
    const rawPath = req.params[0] || '';
    const filename = path.basename(rawPath);
    if (!filename) return next();

    // 1. Check local /internal-files directory first
    const internalFilesDir = storageService.getInternalFilesDir();
    const localInternalPath = path.join(internalFilesDir, rawPath);
    const altInternalPath = path.join(internalFilesDir, filename);

    if (fs.existsSync(localInternalPath)) {
      const data = await fs.promises.readFile(localInternalPath);
      return sendFileBuffer(res, data, filename, req.headers.range);
    }
    if (fs.existsSync(altInternalPath)) {
      const data = await fs.promises.readFile(altInternalPath);
      return sendFileBuffer(res, data, filename, req.headers.range);
    }

    // 2. Check PostgreSQL media_files table metadata (resolves from /internal-files or FTP)
    const { rows } = await db.query(
      'SELECT mime_type, data, storage_type, storage_path, folder, filename FROM media_files WHERE filename = $1 LIMIT 1',
      [filename]
    );

    if (rows.length > 0) {
      const file = rows[0];
      let data = await storageService.readFile({
        storageType: file.storage_type,
        storagePath: file.storage_path,
        filename: file.filename,
        folder: file.folder,
      });
      if (!data && file.data) {
        data = file.data;
      }
      if (data) {
        return sendFileBuffer(res, data, filename, req.headers.range, file.mime_type);
      }
    }

    // 3. Fallback: Check directly on FTP Server at /ecom/${rawPath}
    if (ftpService.isFtpConfigured()) {
      try {
        const baseDir = ftpService.getFtpBaseDir();
        const remotePath = path.posix.join(baseDir, rawPath);
        let data = await ftpService.downloadBuffer(remotePath).catch(() => null);
        if (!data) {
          const altPath = path.posix.join(baseDir, 'uploads', rawPath);
          data = await ftpService.downloadBuffer(altPath).catch(() => null);
        }

        if (data && data.length > 0) {
          return sendFileBuffer(res, data, filename, req.headers.range);
        }
      } catch (ftpFallbackErr) {
        // Continue to 404
      }
    }

    return res.status(404).send('Image not found in internal-files, uploads, or FTP server');
  } catch (err) {
    console.error('Storage Upload Stream Error:', err);
    next(err);
  }
});

// File Upload Routes
app.use('/api', uploadRoutes);

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ecom-backend',
    timestamp: new Date().toISOString(),
  });
});

// Admin Management API Routes (with rate-limiting on auth endpoints)
app.use('/api/admin/auth', authLimiter, authRoutes);
app.use('/api/admin', moduleRoutes);
app.use('/api/admin', categoryRoutes);
app.use('/api/admin', productRoutes);
app.use('/api/admin', orderRoutes);
app.use('/api/admin', analyticsRoutes);
app.use('/api/admin', customerRoutes);
app.use('/api/admin', bannerRoutes);
app.use('/api/admin', showcaseRoutes);
app.use('/api/admin', kitShowcaseRoutes);
app.use('/api/admin', chatbotRoutes);
app.use('/api/admin', brandLogoRoutes);
app.use('/api/admin', customerLogoRoutes);
app.use('/api/admin', competitionRoutes);
app.use('/api/admin', warehouseRoutes);
app.use('/api', shippingRoutes);

// Customer Storefront API Routes (with auth & checkout rate-limiters)
app.use('/api/user/auth', authLimiter, userAuthRoutes);
app.use('/api/user', userProductRoutes);
app.use('/api/user', orderLimiter, userOrderRoutes);
app.use('/api/user', userProfileRoutes);
app.use('/api/user', userCartRoutes);
app.use('/api/user', userWishlistRoutes);
app.use('/api/user', userEnquiryRoutes);
app.use('/api/user', userChatbotRoutes);
app.use('/api/user', userModuleRoutes);
app.use('/api/user', orderLimiter, userPaymentRoutes);
app.use('/api/user', userCompetitionRoute);

// Centralized Error Handler
app.use(errorHandler);

// Start Express Server
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Express Backend Server running on port ${PORT} (Listening on 0.0.0.0 for local network access)`);
  console.log(`🛒 Storefront API: http://localhost:${PORT}/api/user`);
  console.log(`⚙️ Admin API: http://localhost:${PORT}/api/admin`);

  // Ensure storage tables and schema migrations
  await storageService.ensureMediaFilesSchema();
  ensureReviewsTable();
  ensureChatbotTable();

  // Non-blocking background purge of any legacy DB blobs
  storageService.purgeDbBlobs({ batchSize: 20, maxBatches: 2 }).catch((err) => {
    console.warn('[Storage Cleanup] Startup purge warning:', err.message);
  });

  // Start background FTP sync cron
  startFtpSyncCron();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} in use, retrying in 1s...`);
    setTimeout(() => {
      server.close();
      server.listen(PORT, '0.0.0.0');
    }, 1000);
  } else {
    console.error('Server error:', err);
  }
});

const gracefulShutdown = () => {
  stopFtpSyncCron();
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.once('SIGUSR2', gracefulShutdown);
