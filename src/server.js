import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import errorHandler from './middleware/errorHandler.js';

import authRoutes from './routes/admin/authRoutes.js';
import moduleRoutes from './routes/admin/moduleRoutes.js';
import categoryRoutes from './routes/admin/categoryRoutes.js';
import productRoutes from './routes/admin/productRoutes.js';
import orderRoutes from './routes/admin/orderRoutes.js';
import analyticsRoutes from './routes/admin/analyticsRoutes.js';
import userAuthRoutes from './routes/user/userAuthRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3005;

// Global Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'ecom-backend',
    timestamp: new Date().toISOString(),
  });
});

// Admin API Routes
app.use('/api/admin/auth', authRoutes);
app.use('/api/admin', moduleRoutes);
app.use('/api/admin', categoryRoutes);
app.use('/api/admin', productRoutes);
app.use('/api/admin', orderRoutes);
app.use('/api/admin', analyticsRoutes);

// Customer API Routes
app.use('/api/user/auth', userAuthRoutes);

// Centralized Error Handler
app.use(errorHandler);

// Start Express Server
app.listen(PORT, () => {
  console.log(`Express Backend Server running on port ${PORT}`);
  console.log(`API Base URL: http://localhost:${PORT}/api/admin`);
});
