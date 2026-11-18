
import express from 'express';

import {
  createPrintRequestPaymentOrder,
  verifyPrintRequestPayment,
  recordPrintRequestPaymentFailure,
  getPrintRequestPayment,
} from '../../controllers/user/printRequestPaymentController.js';

import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

// All 3D printing payment routes require authentication.
router.use(authenticateToken);

// Create Razorpay order
router.post(
  '/print-requests/:id/payment/create-order',
  createPrintRequestPaymentOrder
);

// Verify Razorpay payment
router.post(
  '/print-requests/:id/payment/verify',
  verifyPrintRequestPayment
);

// Record failed payment
router.post(
  '/print-requests/:id/payment/failure',
  recordPrintRequestPaymentFailure
);

// Get payment history
router.get(
  '/print-requests/:id/payment',
  getPrintRequestPayment
);

export default router;
