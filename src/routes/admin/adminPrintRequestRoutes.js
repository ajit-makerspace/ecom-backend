
import express from "express";

import {
  authenticateToken,
  requireRole,
} from "../../middleware/auth.js";

import {
  getAdminPrintRequests,
  getAdminPrintRequestById,
  updatePrintRequestStatus,
} from "../../controllers/admin/adminPrintRequestController.js";

const router = express.Router();

router.use(authenticateToken);

// SUPER_ADMIN (1) and 3D admin (4)
router.use(requireRole([1, 4]));

// Get all print orders
router.get("/print-requests", getAdminPrintRequests);

// Get individual print order
router.get("/print-requests/:id", getAdminPrintRequestById);

// Update print order status
router.patch("/print-requests/:id/status", updatePrintRequestStatus);


export default router;
