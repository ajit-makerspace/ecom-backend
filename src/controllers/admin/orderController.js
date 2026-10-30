import db from '../../config/db.js';
import { getFiscalYearCode } from '../../utils/orderNumberGenerator.js';
import emailService from '../../services/emailService.js';

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
        o.shiprocket_order_id AS "shiprocketOrderId",
        o.shiprocket_shipment_id AS "shiprocketShipmentId",
        o.shiprocket_awb_code AS "shiprocketAwbCode",
        o.shiprocket_courier_name AS "shiprocketCourierName",
        o.shipping_label_url AS "shippingLabelUrl",
        o.tracking_status AS "trackingStatus",
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
        orderNumber: o.orderNumber || (o.id ? `MSM${getFiscalYearCode(o.createdAt)}${1000 + parseInt(o.id, 10)}` : ''),
        totalAmount,
        total: totalAmount,
        subtotal: parseFloat(o.subtotal || totalAmount),
        shippingFee: parseFloat(o.shippingFee || 0),
        tax: parseFloat(o.tax || 0),
        deliveryDate: o.deliveryDate,
        date: new Date(o.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        customerAvatar: null,
        items: Array.isArray(o.items) ? o.items.map((it) => ({
          ...it,
          price: parseFloat(it.price || 0),
          quantity: parseInt(it.quantity || 1, 10),
          image: it.image || '/placeholder.jpg',
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

    if (!status) {
      return res.status(400).json({ success: false, message: 'Order status is required.' });
    }

    // 1. Fetch current order details, customer info, and items before update
    const { rows: existingRows } = await db.query(
      `SELECT 
        o.id,
        o.order_number AS "orderNumber",
        COALESCE(o.customer_name, CONCAT(u.first_name, ' ', u.last_name), 'Valued Customer') AS "customerName",
        COALESCE(o.customer_email, u.email) AS "customerEmail",
        o.customer_phone AS "customerPhone",
        o.shipping_address AS "shippingAddress",
        o.shipping_city AS "shippingCity",
        o.shipping_state AS "shippingState",
        o.shipping_postal_code AS "shippingPostalCode",
        o.shipping_country AS "shippingCountry",
        o.subtotal,
        o.shipping_fee AS "shippingFee",
        o.tax,
        o.total_amount AS "totalAmount",
        o.status,
        o.payment_status AS "paymentStatus",
        o.payment_method AS "paymentMethod",
        o.delivery_date AS "deliveryDate",
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
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.id::text = $1::text OR o.order_number::text = $1::text
      GROUP BY o.id, u.id, u.email`,
      [id]
    );

    if (existingRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const currentOrder = existingRows[0];
    const previousStatus = currentOrder.status;

    let paymentStatus = currentOrder.paymentStatus || 'Paid';
    if (status === 'Cancelled') paymentStatus = 'Refunded';

    const isDelivered = String(status || '').trim().toLowerCase() === 'delivered';
    const providedDeliveryDate = deliveryDate || delivery_date || null;

    const { rows: updatedRows } = await db.query(
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
      [status, paymentStatus, providedDeliveryDate, isDelivered, currentOrder.id]
    );

    const updatedOrder = updatedRows[0];

    // Check if status changed
    const statusChanged = String(previousStatus || '').trim().toLowerCase() !== String(status || '').trim().toLowerCase();

    if (statusChanged && currentOrder.customerEmail) {
      emailService
        .sendOrderStatusUpdateEmail({
          email: currentOrder.customerEmail,
          customerName: currentOrder.customerName,
          orderNumber: updatedOrder.orderNumber || currentOrder.orderNumber || `MSM${currentOrder.id}`,
          newStatus: status,
          oldStatus: previousStatus,
          paymentStatus: updatedOrder.paymentStatus,
          deliveryDate: updatedOrder.deliveryDate,
          items: currentOrder.items || [],
          totalAmount: parseFloat(currentOrder.totalAmount || 0),
          subtotal: parseFloat(currentOrder.subtotal || 0),
          shippingFee: parseFloat(currentOrder.shippingFee || 0),
          tax: parseFloat(currentOrder.tax || 0),
          shippingAddress: currentOrder.shippingAddress,
          shippingCity: currentOrder.shippingCity,
          shippingState: currentOrder.shippingState,
          shippingPostalCode: currentOrder.shippingPostalCode,
          shippingCountry: currentOrder.shippingCountry,
        })
        .catch((emailErr) => {
          console.error(
            `Failed to send order status email for order #${updatedOrder.orderNumber}:`,
            emailErr.message
          );
        });
    }

    return res.json({
      success: true,
      message: 'Order status updated successfully.',
      order: {
        ...updatedOrder,
        id: String(updatedOrder.id),
      },
    });
  } catch (err) {
    console.error('Update Order Status Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update order status.' });
  }
};
