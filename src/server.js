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
import uploadRoutes from './routes/uploadRoutes.js';

import userAuthRoutes from './routes/user/userAuthRoutes.js';
import userProductRoutes from './routes/user/userProductRoutes.js';
import userOrderRoutes from './routes/user/userOrderRoutes.js';
import userProfileRoutes from './routes/user/userProfileRoutes.js';

import db from './config/db.js';
// import { getKitShowcases } from './controllers/admin/kitsShowcaseController.js';

const app = express();
const PORT = process.env.PORT || 3005;

// Global Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

// Database Media Streamer: Streams images directly from PostgreSQL media_files table
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
    res.setHeader('Content-Type', file.mime_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return res.end(file.data);
  } catch (err) {
    console.error('Serve Media Error:', err);
    return res.status(500).send('Error loading media from database');
  }
});

// Database Upload Resolver: streams any /uploads/:folder/:filename directly from PostgreSQL product_images & media_files
app.get(['/uploads/:folder/:filename', '/uploads/:filename'], async (req, res, next) => {
  try {
    const filename = req.params.filename || req.params.folder;
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

    // 3. Fallback to physical disk if any legacy file exists
    const candidate = path.join(UPLOADS_DIR, req.params.folder || '', filename);
    if (fs.existsSync(candidate)) {
      return res.sendFile(candidate);
    }

    return res.status(404).send('Image not found in database');
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


// Customer Storefront API Routes
app.use('/api/user/auth', userAuthRoutes);
app.use('/api/user', userProductRoutes);
app.use('/api/user', userOrderRoutes);
app.use('/api/user', userProfileRoutes);

// Centralized Error Handler
app.use(errorHandler);

// Start Express Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Express Backend Server running on port ${PORT} (Listening on 0.0.0.0 for local network access)`);
  console.log(`🛒 Storefront API: http://localhost:${PORT}/api/user`);
  console.log(`⚙️ Admin API: http://localhost:${PORT}/api/admin`);
});
