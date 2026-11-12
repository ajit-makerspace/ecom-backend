import express from 'express';
import { optionalAuth, authenticateToken } from '../../middleware/auth.js';
import {
  prototypeMulterUpload,
  submitPrintRequest,
  getMyPrintRequests,
} from '../../controllers/prototypeController.js';

const router = express.Router();

// Upload fields: 'model' (primary 3D file) + 'supportFiles' (textures, materials)
const uploadFields = prototypeMulterUpload.fields([
  { name: 'model', maxCount: 1 },
  { name: 'supportFiles', maxCount: 15 },
  { name: 'file', maxCount: 1 }, // alias
]);

// Customer submit print request (supports logged-in users and guests)
router.post('/print-requests', optionalAuth, uploadFields, submitPrintRequest);

// Customer fetch their own submitted requests
router.get('/print-requests/my', authenticateToken, getMyPrintRequests);

export default router;
