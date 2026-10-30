import express from 'express';
import {
  getShippingConfig,
  checkServiceability,
  getShippingTat,
  createShipment,
  generateAWB,
  generateLabel,
  trackShipment,
  cancelShipment,
  renderShippingLabel,
} from '../../controllers/admin/shippingController.js';
import { authenticateToken, requireAdmin } from '../../middleware/auth.js';

const router = express.Router();

// Public Customer Shipping TAT / Serviceability
router.get('/shipping/tat', getShippingTat);

// Protected Admin Shipping Label Viewer
router.get('/admin/shipping/view-label/:orderId', authenticateToken, requireAdmin, renderShippingLabel);
router.get('/admin/shipping/view-label', authenticateToken, requireAdmin, renderShippingLabel);

// Protected Admin Routes
router.get('/admin/shipping/config', authenticateToken, requireAdmin, getShippingConfig);
router.post('/admin/shipping/check-serviceability', authenticateToken, requireAdmin, checkServiceability);
router.post('/admin/shipping/create-shipment/:orderId', authenticateToken, requireAdmin, createShipment);
router.post('/admin/shipping/generate-awb/:orderId', authenticateToken, requireAdmin, generateAWB);
router.post('/admin/shipping/generate-label/:orderId', authenticateToken, requireAdmin, generateLabel);
router.get('/admin/shipping/track/:orderId', authenticateToken, requireAdmin, trackShipment);
router.post('/admin/shipping/cancel/:orderId', authenticateToken, requireAdmin, cancelShipment);

// Customer Shipment Tracking (requires authentication & ownership verification)
router.get('/user/orders/:orderId/track', authenticateToken, trackShipment);

export default router;
