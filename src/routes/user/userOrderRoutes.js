import express from 'express';
import {
  placeOrder,
  getUserOrders,
  getUserOrderById,
} from '../../controllers/user/userOrderController.js';
import { authenticateToken, optionalAuth, requireCustomer } from '../../middleware/auth.js';

const router = express.Router();

// Public / Authenticated Order Placement (Checkout)
router.post('/orders', optionalAuth, placeOrder);

// Authenticated Customer Order History & Tracking
router.get('/orders', authenticateToken, requireCustomer, getUserOrders);
router.get('/orders/:id', authenticateToken, requireCustomer, getUserOrderById);

export default router;
