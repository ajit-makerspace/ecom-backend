import express from 'express';
import { getDashboardAnalytics } from '../../controllers/admin/analyticsController.js';

const router = express.Router();

router.get('/analytics/dashboard', getDashboardAnalytics);

export default router;
