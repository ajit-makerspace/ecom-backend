const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');

router.get('/analytics/dashboard', analyticsController.getDashboardAnalytics);

module.exports = router;
