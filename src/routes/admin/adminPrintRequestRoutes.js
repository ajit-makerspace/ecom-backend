
// import express from 'express';
// import {
//   authenticateToken,
//   requireRole,
// } from '../../middleware/auth.js';

// import {
//   getAdminPrintRequests,
// } from '../../controllers/admin/adminPrintRequestController.js';

// const router = express.Router();

// router.use(authenticateToken);

// // Replace role IDs with your actual authorized admin roles.
// router.use(requireRole(1, 4));

// router.get('/print-requests', getAdminPrintRequests);

// export default router;

import express from 'express';
import {
  authenticateToken,
  requireRole,
} from '../../middleware/auth.js';

import {
  getAdminPrintRequests,
  getAdminPrintRequestById,
  updateAdminPrintRequestQuotation,
  updateAdminPrintRequestStatus,
  deleteAdminPrintRequest,
} from '../../controllers/admin/adminPrintRequestController.js';

const router = express.Router();

// Authentication required
router.use(authenticateToken);

// Only SUPER_ADMIN (1) and 3D (4) can access these routes
router.use(requireRole([1, 4]));

// Print request management
router.get('/print-requests', getAdminPrintRequests);
router.get('/print-requests/:id', getAdminPrintRequestById);
router.patch('/print-requests/:id/quotation', updateAdminPrintRequestQuotation);
router.patch('/print-requests/:id/status', updateAdminPrintRequestStatus);
router.delete('/print-requests/:id', deleteAdminPrintRequest);

export default router;