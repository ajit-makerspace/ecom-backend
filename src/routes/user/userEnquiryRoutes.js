import express from 'express';
import multer from 'multer';
import path from 'node:path';
import {
  createBulkEnquiry,
  getBulkEnquiriesAdmin,
  updateBulkEnquiryStatusAdmin,
  deleteBulkEnquiryAdmin,
} from '../../controllers/user/userEnquiryController.js';
import { optionalAuth, requireAdmin, authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

// Supported BOM file extensions & MIME types
const ALLOWED_BOM_EXTENSIONS = new Set(['.csv', '.xlsx', '.xls', '.pdf']);
const MAX_BOM_FILE_SIZE = 15 * 1024 * 1024; // 15MB

const bomStorage = multer.memoryStorage();
const bomMulter = multer({
  storage: bomStorage,
  limits: {
    fileSize: MAX_BOM_FILE_SIZE,
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_BOM_EXTENSIONS.has(ext)) {
      return cb(null, true);
    }
    return cb(
      new Error(`Unsupported file type: ${ext}. Please upload a CSV, XLSX, XLS, or PDF file.`),
      false
    );
  },
});

// Middleware to gracefully handle either 'file' or 'bomFile' or JSON without file
const bomUploadMiddleware = (req, res, next) => {
  const upload = bomMulter.fields([
    { name: 'file', maxCount: 1 },
    { name: 'bomFile', maxCount: 1 },
  ]);

  upload(req, res, (err) => {
    if (err) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'BOM file size exceeds the maximum allowed limit of 15MB.'
          : err.message || 'File upload error.';
      return res.status(400).json({
        success: false,
        message: msg,
      });
    }

    if (req.files?.file?.[0]) {
      req.file = req.files.file[0];
    } else if (req.files?.bomFile?.[0]) {
      req.file = req.files.bomFile[0];
    }

    next();
  });
};

// ----------------------------------------------------
// PUBLIC / STOREFRONT ROUTES
// ----------------------------------------------------
router.post('/bulk-enquiry', optionalAuth, bomUploadMiddleware, createBulkEnquiry);
router.post('/user/bulk-enquiry', optionalAuth, bomUploadMiddleware, createBulkEnquiry);

// ----------------------------------------------------
// ADMIN ROUTES
// ----------------------------------------------------
router.get('/admin/bulk-enquiries', authenticateToken, requireAdmin, getBulkEnquiriesAdmin);
router.get('/bulk-enquiries', authenticateToken, requireAdmin, getBulkEnquiriesAdmin);

router.patch('/admin/bulk-enquiries/:id/status', authenticateToken, requireAdmin, updateBulkEnquiryStatusAdmin);
router.patch('/bulk-enquiries/:id/status', authenticateToken, requireAdmin, updateBulkEnquiryStatusAdmin);

router.delete('/admin/bulk-enquiries/:id', authenticateToken, requireAdmin, deleteBulkEnquiryAdmin);
router.delete('/bulk-enquiries/:id', authenticateToken, requireAdmin, deleteBulkEnquiryAdmin);

export default router;
