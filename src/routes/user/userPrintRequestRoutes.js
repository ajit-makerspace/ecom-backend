import express from 'express';
import { createPrintRequest ,getMyPrintRequests} from '../../controllers/user/userPrintRequestController.js';
import { uploadModel } from '../../controllers/uploadController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

router.post('/printing-service', authenticateToken, uploadModel, createPrintRequest);
router.get('/printing-service', authenticateToken, getMyPrintRequests);

export default router;