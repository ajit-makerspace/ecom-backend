import express from 'express';
import { getOrders, updateOrderStatus } from '../../controllers/admin/orderController.js';
import { authenticateToken, requireAdmin } from '../../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireAdmin);

router.get('/orders', getOrders);
router.put('/orders/:id/status', updateOrderStatus);

export default router;
