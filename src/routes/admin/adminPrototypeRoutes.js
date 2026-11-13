import express from 'express';
import { authenticateToken, requireRole } from '../../middleware/auth.js';
import {
  getAdminPrototypeRequests,
  getAdminPrototypeRequestById,
  updateAdminPrototypeRequestStatus,
  updateAdminPrototypeRequestQuote,
  deleteAdminPrototypeRequest,
} from '../../controllers/prototypeController.js';

const router = express.Router();

// All admin prototype endpoints require authentication and SUPER_ADMIN (1) or 3D staff (4)
router.use(authenticateToken);
router.use(requireRole([1, 4]));

// List with search, status filters, metrics, pagination
router.get('/prototype-requests', getAdminPrototypeRequests);

// Single request details
router.get('/prototype-requests/:id', getAdminPrototypeRequestById);

// Update status
router.patch('/prototype-requests/:id/status', updateAdminPrototypeRequestStatus);

// Set / Update Price Quote
router.post('/prototype-requests/:id/quote', updateAdminPrototypeRequestQuote);

// Delete request
router.delete('/prototype-requests/:id', deleteAdminPrototypeRequest);

export default router;
