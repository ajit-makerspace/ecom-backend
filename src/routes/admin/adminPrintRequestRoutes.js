
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
  updateAdminPrintRequestQuotation,
} from '../../controllers/admin/adminPrintRequestController.js';

const router = express.Router();

// Authentication required
router.use(authenticateToken);

// Only SUPER_ADMIN (1) and 3D (4) can access these routes
router.use(requireRole([1, 4]));

// Get all print requests for admin
router.get('/print-requests', getAdminPrintRequests);
router.patch(
  '/print-requests/:id/quotation',
  authenticateToken,
  requireRole([1, 4]),
  updateAdminPrintRequestQuotation
);

export default router;