import express from 'express';
import {
  getRazorpayConfig,
  createRazorpayOrder,
  verifyRazorpayPayment,
  getOrderPayments,
  recordPaymentFailure,
} from '../../controllers/user/userPaymentController.js';
import { optionalAuth } from '../../middleware/auth.js';

const router = express.Router();

// Get public Razorpay configuration (Key ID)
router.get('/payment/razorpay/config', getRazorpayConfig);

// Initialize Razorpay Order
router.post('/payment/razorpay/create-order', optionalAuth, createRazorpayOrder);

// Verify Razorpay Payment Signature and finalize order
router.post('/payment/razorpay/verify', optionalAuth, verifyRazorpayPayment);

// Get payments by order ID
router.get('/payment/order/:orderId', optionalAuth, getOrderPayments);

// Record payment failure event
router.post('/payment/record-failure', optionalAuth, recordPaymentFailure);

export default router;
