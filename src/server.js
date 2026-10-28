import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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

import db from './config/db.js';
// import { getKitShowcases } from './controllers/admin/kitsShowcaseController.js';

const app = express();
const PORT = process.env.PORT || 3005;

// Disable ETag generation to prevent 304 Not Modified responses on dynamic API routes
app.set('etag', false);

// Global Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

// Database Product Images Streamer: Streams images directly from PostgreSQL product_images table
app.get(['/api/product-images/:id', '/api/product-images/file/:filename'], async (req, res) => {
  try {
    const param = req.params.id || req.params.filename;
    const isNumeric = /^\d+$/.test(param);
    const query = isNumeric
      ? 'SELECT mime_type, image_data AS data FROM product_images WHERE id = $1'
      : 'SELECT mime_type, image_data AS data FROM product_images WHERE file_name = $1 LIMIT 1';
    const { rows } = await db.query(query, [param]);

    if (rows.length === 0) {
      return res.status(404).send('Product image not found in database');
    }

    const file = rows[0];
    res.setHeader('Content-Type', file.mime_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return res.end(file.data);
  } catch (err) {
    console.error('Serve Product Image Error:', err);
    return res.status(500).send('Error loading product image from database');
  }
});

// Database Media Streamer: Streams images & videos directly from PostgreSQL media_files table with Range streaming support
app.get('/api/media/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const isNumeric = /^\d+$/.test(id);
    const query = isNumeric
      ? 'SELECT mime_type, data FROM media_files WHERE id = $1'
      : 'SELECT mime_type, data FROM media_files WHERE filename = $1 LIMIT 1';
    const { rows } = await db.query(query, [id]);

    if (rows.length === 0) {
      return res.status(404).send('Media not found in database');
    }

    const file = rows[0];
    const data = file.data;
    const totalSize = data.length;
    const mimeType = file.mime_type || 'image/jpeg';

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');

    // Handle HTTP Range header for video streaming
    const rangeHeader = req.headers.range;
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
  } catch (err) {
    console.error('Serve Media Error:', err);
    return res.status(500).send('Error loading media from database');
  }
});

// Serve static uploads directly from backend uploads folder (including nested products/robu, brands, banners, etc.)
app.use('/uploads', express.static(UPLOADS_DIR));

// Database Upload Resolver: streams any /uploads/* from PostgreSQL product_images & media_files if not found on disk
app.get('/uploads/*', async (req, res, next) => {
  try {
    const rawPath = req.params[0] || '';
    const filename = path.basename(rawPath);
    if (!filename) return next();

    // 1. Check PostgreSQL product_images table first
    const prodImgRes = await db.query(
      'SELECT mime_type, image_data AS data FROM product_images WHERE file_name = $1 LIMIT 1',
      [filename]
    );

    if (prodImgRes.rows.length > 0) {
      res.setHeader('Content-Type', prodImgRes.rows[0].mime_type || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      return res.end(prodImgRes.rows[0].data);
    }

    // 2. Check PostgreSQL media_files table
    const { rows } = await db.query(
      'SELECT mime_type, data FROM media_files WHERE filename = $1 LIMIT 1',
      [filename]
    );

    if (rows.length > 0) {
      res.setHeader('Content-Type', rows[0].mime_type || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      return res.end(rows[0].data);
    }

    return res.status(404).send('Image not found in backend or database');
  } catch (err) {
    console.error('Database Upload Stream Error:', err);
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

// Admin Management API Routes
app.use('/api/admin/auth', authRoutes);
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
app.use('/api', shippingRoutes);



// Customer Storefront API Routes
app.use('/api/user/auth', userAuthRoutes);
app.use('/api/user', userProductRoutes);
app.use('/api/user', userOrderRoutes);
app.use('/api/user', userProfileRoutes);
app.use('/api/user', userCartRoutes);
app.use('/api/user', userWishlistRoutes);
app.use('/api/user', userEnquiryRoutes);
app.use('/api/user', userChatbotRoutes);
app.use('/api/user', userModuleRoutes);
app.use('/api/user', userPaymentRoutes);
app.use('/api/user',userCompetitionRoute);


// Centralized Error Handler
app.use(errorHandler);

// Start Express Server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Express Backend Server running on port ${PORT} (Listening on 0.0.0.0 for local network access)`);
  console.log(`🛒 Storefront API: http://localhost:${PORT}/api/user`);
  console.log(`⚙️ Admin API: http://localhost:${PORT}/api/admin`);
  ensureReviewsTable();
  ensureChatbotTable();
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
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 1000).unref();
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
process.once('SIGUSR2', gracefulShutdown);
