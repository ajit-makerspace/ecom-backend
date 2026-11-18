import express from 'express';
import { acceptPrintQuotation, createPrintRequest ,getMyPrintRequests, rejectPrintQuotation} from '../../controllers/user/userPrintRequestController.js';
import { uploadModel } from '../../controllers/uploadController.js';
import { authenticateToken } from '../../middleware/auth.js';

const router = express.Router();

router.post('/printing-service', authenticateToken, uploadModel, createPrintRequest);
router.get('/printing-service', authenticateToken, getMyPrintRequests);
router.post(
  '/print-requests/:id/quotation/accept',
  authenticateToken,
  acceptPrintQuotation
);

router.post(
  '/print-requests/:id/quotation/reject',
  authenticateToken,
  rejectPrintQuotation
);
export default router;