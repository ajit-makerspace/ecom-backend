import db from '../../config/db.js';

// Raw SQL Get Admin Orders (with items, customer details, and shipping)
export const getOrders = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        o.id,
        o.order_number AS "orderNumber",
        o.customer_name AS "customerName",
        o.customer_email AS "customerEmail",
        o.customer_phone AS "customerPhone",
        o.shipping_address AS "shippingAddress",
        o.shipping_city AS "shippingCity",
        o.shipping_state AS "shippingState",
        o.shipping_postal_code AS "shippingPostalCode",
        o.subtotal,
        o.shipping_fee AS "shippingFee",
        o.tax,
        o.total_amount AS "totalAmount",
        o.status,
        o.payment_status AS "paymentStatus",
        o.payment_method AS "paymentMethod",
        o.razorpay_order_id AS "razorpayOrderId",
        o.razorpay_payment_id AS "razorpayPaymentId",
        o.invoice_number AS "invoiceNumber",
        o.invoice_date AS "invoiceDate",
        o.delivery_date AS "deliveryDate",
        p.id AS "paymentId",
        p.provider_payment_id AS "paymentProviderPaymentId",
        p.status AS "paymentRecordStatus",
        o.created_at AS "createdAt",
        o.updated_at AS "updatedAt",
        COALESCE(
          json_agg(
            json_build_object(
              'id', oi.id,
              'productId', oi.product_id,
              'name', oi.product_name,
              'sku', oi.product_sku,
              'image', oi.product_image,
              'price', oi.price,
              'quantity', oi.quantity,
              'totalPrice', oi.total_price
            )
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) AS items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN LATERAL (
        SELECT id, provider_payment_id, status FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1
      ) p ON true
      GROUP BY o.id, p.id, p.provider_payment_id, p.status
      ORDER BY o.id DESC
    `);

    const orders = rows.map((o) => {
      const totalAmount = parseFloat(o.totalAmount || 0);
      return {
        ...o,
        id: String(o.id), // String ID for safe frontend search
        orderNumber: o.orderNumber,
        totalAmount,
        total: totalAmount,
        subtotal: parseFloat(o.subtotal || totalAmount),
        shippingFee: parseFloat(o.shippingFee || 0),
        tax: parseFloat(o.tax || 0),
        deliveryDate: o.deliveryDate,
        date: new Date(o.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        customerAvatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&q=80',
        items: Array.isArray(o.items) ? o.items.map((it) => ({
          ...it,
          price: parseFloat(it.price || 0),
          quantity: parseInt(it.quantity || 1, 10),
          image: it.image || '/products/product-electronics.png',
        })) : [],
      };
    });

    return res.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (err) {
    console.error('Get Admin Orders Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch orders.' });
  }
};

// Raw SQL Update Order Status
export const updateOrderStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, deliveryDate, delivery_date } = req.body;

    let paymentStatus = 'Paid';
    if (status === 'Cancelled') paymentStatus = 'Refunded';

    const isDelivered = String(status || '').trim().toLowerCase() === 'delivered';
    const providedDeliveryDate = deliveryDate || delivery_date || null;

    const { rows } = await db.query(
      `UPDATE orders
       SET status = $1::varchar,
           payment_status = $2::varchar,
           delivery_date = CASE 
             WHEN $3::timestamptz IS NOT NULL THEN $3::timestamptz
             WHEN $4::boolean = true AND (delivery_date IS NULL OR delivery_date > NOW()) THEN NOW()
             ELSE delivery_date 
           END,
           updated_at = NOW()
       WHERE id = $5
       RETURNING id, order_number AS "orderNumber", status, payment_status AS "paymentStatus", delivery_date AS "deliveryDate", updated_at AS "updatedAt"`,
      [status, paymentStatus, providedDeliveryDate, isDelivered, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    return res.json({
      success: true,
      message: 'Order status updated successfully.',
      order: {
        ...rows[0],
        id: String(rows[0].id),
      },
    });
  } catch (err) {
    console.error('Update Order Status Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update order status.' });
  }
};
