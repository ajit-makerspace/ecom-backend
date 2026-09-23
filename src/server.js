import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
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
import uploadRoutes from './routes/uploadRoutes.js';

import userAuthRoutes from './routes/user/userAuthRoutes.js';
import userProductRoutes from './routes/user/userProductRoutes.js';
import userOrderRoutes from './routes/user/userOrderRoutes.js';
import userProfileRoutes from './routes/user/userProfileRoutes.js';

const app = express();
const PORT = process.env.PORT || 3005;

// Global Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Statically serve public uploads folder (with cache headers)
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
app.use('/uploads', express.static(UPLOADS_DIR, {
  maxAge: '7d',
  etag: true,
}));

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

// Customer Storefront API Routes
app.use('/api/user/auth', userAuthRoutes);
app.use('/api/user', userProductRoutes);
app.use('/api/user', userOrderRoutes);
app.use('/api/user', userProfileRoutes);

// Centralized Error Handler
app.use(errorHandler);

// Start Express Server
app.listen(PORT, () => {
  console.log(`🚀 Express Backend Server running on port ${PORT}`);
  console.log(`🛒 Storefront API: http://localhost:${PORT}/api/user`);
  console.log(`⚙️ Admin API: http://localhost:${PORT}/api/admin`);
});
