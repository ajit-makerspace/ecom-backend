const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

router.get('/orders', orderController.getOrders);
router.put('/orders/:id/status', orderController.updateOrderStatus);

module.exports = router;
