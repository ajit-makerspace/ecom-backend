import express from 'express';
import { getCustomers, updateCustomerStatus } from '../../controllers/admin/customerController.js';
import { authenticateToken, requireAdmin } from '../../middleware/auth.js';

const router = express.Router();

router.use(authenticateToken);
router.use(requireAdmin);

router.get('/customers', getCustomers);
router.put('/customers/:id/status', updateCustomerStatus);

export default router;
