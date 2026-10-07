import express from 'express';
import { createBulkEnquiry, getBulkEnquiriesAdmin } from '../../controllers/user/userEnquiryController.js';
import { optionalAuth, requireAdmin, authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

// Public / Customer endpoint to submit bulk enquiry (optional auth to link user account if logged in)
router.post('/bulk-enquiry', optionalAuth, createBulkEnquiry);

// Admin endpoint to view bulk inquiries
router.get('/admin/bulk-enquiries', authenticateToken, requireAdmin, getBulkEnquiriesAdmin);

export default router;
