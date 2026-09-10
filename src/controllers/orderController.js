import db from '../config/db.js';

// Raw SQL Get Orders
export const getOrders = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        id,
        order_number AS "orderNumber",
        customer_name AS "customerName",
        customer_email AS "customerEmail",
        total_amount AS "totalAmount",
        status,
        payment_status AS "paymentStatus",
        created_at AS "createdAt"
      FROM orders
      ORDER BY id DESC
    `);

    const orders = rows.map((o) => ({
      ...o,
      totalAmount: parseFloat(o.totalAmount),
    }));

    return res.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (err) {
    console.error('Get Orders Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch orders.' });
  }
};

// Raw SQL Update Order Status
export const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    let paymentStatus = 'Paid';
    if (status === 'Cancelled') paymentStatus = 'Refunded';

    const { rows } = await db.query(
      `UPDATE orders
       SET status = $1, payment_status = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, order_number AS "orderNumber", status, payment_status AS "paymentStatus"`,
      [status, paymentStatus, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    return res.json({
      success: true,
      message: 'Order status updated successfully.',
      order: rows[0],
    });
  } catch (err) {
    console.error('Update Order Status Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update order status.' });
  }
};
