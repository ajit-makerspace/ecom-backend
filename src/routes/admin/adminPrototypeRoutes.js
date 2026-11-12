import express from 'express';
import { authenticateToken } from '../../middleware/auth.js';
import {
  getAdminPrototypeRequests,
  getAdminPrototypeRequestById,
  updateAdminPrototypeRequestStatus,
  updateAdminPrototypeRequestQuote,
  deleteAdminPrototypeRequest,
} from '../../controllers/prototypeController.js';

const router = express.Router();

// All admin prototype endpoints require authentication
router.use(authenticateToken);

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
