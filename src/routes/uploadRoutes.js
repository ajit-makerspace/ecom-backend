import express from 'express';
import { multerUpload, handleSingleUpload, handleBase64Upload } from '../controllers/uploadController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// Middleware to handle either 'file' or 'image' field in form-data
const uploadFileMiddleware = (req, res, next) => {
  const upload = multerUpload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'image', maxCount: 1 },
  ]);

  upload(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        success: false,
        message: err.message || 'File upload validation error.',
      });
    }
    // Set req.file to whichever was uploaded
    if (req.files?.file?.[0]) {
      req.file = req.files.file[0];
    } else if (req.files?.image?.[0]) {
      req.file = req.files.image[0];
    }
    next();
  });
};

// General upload endpoint (handles multipart/form-data)
router.post('/upload', uploadFileMiddleware, handleSingleUpload);

// Programmatic / fallback Base64 upload endpoint
router.post('/upload/base64', handleBase64Upload);

// Admin-specific upload endpoint
router.post('/admin/upload', uploadFileMiddleware, handleSingleUpload);

export default router;
