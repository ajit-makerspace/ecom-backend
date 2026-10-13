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

// Customer Order History & Tracking (Authenticated or Guest Fallback)
router.get('/orders', optionalAuth, getUserOrders);
router.get('/orders/:id', optionalAuth, getUserOrderById);

export default router;
