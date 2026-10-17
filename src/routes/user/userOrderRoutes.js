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

// Customer Order History & Tracking (Strict Authenticated RBAC)
router.get('/orders', authenticateToken, getUserOrders);
router.get('/orders/:id', authenticateToken, getUserOrderById);

export default router;
