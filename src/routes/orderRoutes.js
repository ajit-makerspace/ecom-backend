import express from 'express';
import { getOrders, updateOrderStatus } from '../controllers/orderController.js';

const router = express.Router();

router.get('/orders', getOrders);
router.put('/orders/:id/status', updateOrderStatus);

export default router;
