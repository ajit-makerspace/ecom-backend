import db from '../../config/db.js';
import { generateOrderNumber, getFiscalYearCode } from '../../utils/orderNumberGenerator.js';
import emailService from '../../services/emailService.js';

// Auto-migrate Razorpay & Delivery Date columns on orders table, and legacy order numbers
async function ensureOrderColumns() {
  try {
    await db.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(255);
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(255);
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_signature TEXT;
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date TIMESTAMPTZ;
      UPDATE orders SET delivery_date = updated_at WHERE LOWER(status) = 'delivered' AND delivery_date IS NULL;
      UPDATE orders o
      SET user_id = u.id
      FROM users u
      WHERE o.user_id IS NULL
        AND LOWER(o.customer_email) = LOWER(u.email);
    `);

    // Auto-migrate existing orders to MSM format e.g. MSM26271001
    const { rows: legacyOrders } = await db.query(`
      SELECT id, order_number, created_at 
      FROM orders 
      ORDER BY id ASC
    `);
    let orderSeq = 1001;
    for (const ord of legacyOrders) {
      if (!ord.order_number || !ord.order_number.startsWith('MSM')) {
        const fy = getFiscalYearCode(ord.created_at || new Date());
        const newNum = `MSM${fy}${orderSeq}`;
        await db.query('UPDATE orders SET order_number = $1 WHERE id = $2', [newNum, ord.id]);
        orderSeq++;
      } else {
        const match = ord.order_number.match(/^MSM\d{4}(\d+)$/);
        if (match) {
          const num = parseInt(match[1], 10);
          if (num >= orderSeq) orderSeq = num + 1;
        }
      }
    }
  } catch (err) {
    console.error('Error ensuring columns on orders table:', err.message);
  }
}
ensureOrderColumns();

// Customer Place Order Controller (Transactional SQL)
export const placeOrder = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const shipping = req.body.shipping_address || {};
    const finalFirstName = req.body.firstName || shipping.first_name || shipping.firstName || req.user?.first_name || req.user?.firstName || 'Customer';
    const finalLastName = req.body.lastName || shipping.last_name || shipping.lastName || req.user?.last_name || req.user?.lastName || '';
    const finalEmail = req.body.email || shipping.email || req.user?.email;
    const finalPhone = req.body.phone || shipping.phone || req.user?.phone || '';
    const finalAddress = req.body.address || shipping.address_line_1 || shipping.address || '';
    const finalCity = req.body.city || shipping.city || '';
    const finalState = req.body.state || shipping.state || '';
    const finalZip = req.body.zip || shipping.postal_code || shipping.zip || '';
    const finalCountry = req.body.country || shipping.country || 'India';
    const finalPaymentMethod = req.body.paymentMethod || req.body.payment_method || 'Credit Card';
    const items = req.body.items;
    const notes = req.body.notes;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Order must contain at least one item.' });
    }

    if (!finalEmail || !finalFirstName || !finalAddress || !finalCity || !finalZip) {
      return res.status(400).json({
        success: false,
        message: 'First name, email, shipping address, city, and zip code are required.',
      });
    }

    await client.query('BEGIN');

    // 1. Verify products & calculate verified totals from database
    let subtotal = 0;
    const validatedItems = [];

    for (const item of items) {
      const productId = item.productId || item.product?.id || item.id || item.product_id;
      const qty = parseInt(item.quantity || 1, 10);

      if (!productId || qty <= 0) continue;

      const { rows } = await client.query(
        'SELECT id, name, sku, price, image_url, stock FROM products WHERE id = $1 AND status = 1 FOR UPDATE',
        [productId]
      );

      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: `Product #${productId} is currently unavailable or out of stock.`,
        });
      }

      const prod = rows[0];
      const itemPrice = parseFloat(prod.price || 0);
      const lineTotal = itemPrice * qty;
      subtotal += lineTotal;

      validatedItems.push({
        productId: prod.id,
        name: prod.name,
        sku: prod.sku,
        image: prod.image_url,
        price: itemPrice,
        quantity: qty,
        lineTotal,
      });

      // Update product stock
      await client.query(
        'UPDATE products SET stock = GREATEST(0, stock - $1), updated_at = NOW() WHERE id = $2',
        [qty, prod.id]
      );
    }

    if (validatedItems.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'No valid products in cart.' });
    }

    const shippingFee = subtotal > 150 ? 0.00 : 15.00;
    const tax = 0.00;
    const totalAmount = subtotal + shippingFee + tax;

    // Generate unique order number e.g. MSM26271001
    const orderNumber = await generateOrderNumber(client);

    const customerName = `${finalFirstName.trim()} ${(finalLastName || '').trim()}`.trim();
    const customerEmail = String(finalEmail).trim().toLowerCase();
    const customerPhone = finalPhone ? String(finalPhone).trim() : null;
    let userId = req.user?.id || null;
    if (!userId && customerEmail) {
      try {
        const userLookup = await client.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [customerEmail]);
        if (userLookup.rows.length > 0) {
          userId = userLookup.rows[0].id;
        }
      } catch (e) {
        console.error('Error looking up user by email in placeOrder:', e);
      }
    }
    if (userId && customerPhone) {
      try {
        await client.query(
          `UPDATE users SET phone = $1, updated_at = NOW() WHERE id = $2 AND (phone IS NULL OR phone = '')`,
          [customerPhone, userId]
        );
      } catch (e) {
        console.error('Error updating user phone in placeOrder:', e);
      }
    }

    // 2. Insert into orders table
    const orderInsertSql = `
      INSERT INTO orders (
        order_number,
        user_id,
        customer_name,
        customer_email,
        customer_phone,
        shipping_address,
        shipping_city,
        shipping_state,
        shipping_postal_code,
        shipping_country,
        subtotal,
        shipping_fee,
        tax,
        total_amount,
        status,
        payment_status,
        payment_method,
        notes,
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        requires_gst_invoice,
        customer_gstin,
        billing_business_name,
        billing_address,
        place_of_supply_state_code,
        invoice_number,
        invoice_date,
        delivery_date,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
        $27, $28, $29, NOW(), NOW()
      ) RETURNING id, order_number, total_amount, status, payment_status, requires_gst_invoice, customer_gstin, billing_business_name, invoice_number, invoice_date, delivery_date, created_at;
    `;

    const finalStatus = req.body.status || 'Pending';
    const finalPaymentStatus = req.body.paymentStatus || req.body.payment_status || (finalPaymentMethod === 'Razorpay' ? 'Paid' : 'Pending');
    const rzpOrderId = req.body.razorpay_order_id || req.body.razorpayOrderId || null;
    const rzpPaymentId = req.body.razorpay_payment_id || req.body.razorpayPaymentId || null;
    const rzpSignature = req.body.razorpay_signature || req.body.razorpaySignature || null;

    const requiresGstInvoice = Boolean(req.body.requires_gst_invoice || req.body.requiresGstInvoice);
    const customerGstin = requiresGstInvoice && req.body.customer_gstin ? String(req.body.customer_gstin).trim().toUpperCase() : null;
    const billingBusinessName = requiresGstInvoice && req.body.billing_business_name ? String(req.body.billing_business_name).trim() : null;
    const tradeName = requiresGstInvoice && req.body.trade_name ? String(req.body.trade_name).trim() : null;
    const billingAddress = requiresGstInvoice && req.body.billing_address ? req.body.billing_address : null;
    const placeOfSupply = customerGstin && customerGstin.length >= 2 ? customerGstin.slice(0, 2) : (req.body.place_of_supply_state_code || null);
    const invoiceNumber = requiresGstInvoice ? `INV-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}` : null;
    const invoiceDate = requiresGstInvoice ? new Date() : null;
    const deliveryDate = String(finalStatus).trim().toLowerCase() === 'delivered' ? new Date() : (req.body.delivery_date ? new Date(req.body.delivery_date) : null);

    const orderValues = [
      orderNumber,
      userId,
      customerName,
      customerEmail,
      customerPhone,
      String(finalAddress).trim(),
      String(finalCity).trim(),
      finalState ? String(finalState).trim() : '',
      String(finalZip).trim(),
      finalCountry ? String(finalCountry).trim() : 'India',
      subtotal,
      shippingFee,
      tax,
      totalAmount,
      finalStatus,
      finalPaymentStatus,
      String(finalPaymentMethod).trim(),
      notes ? String(notes).trim() : null,
      rzpOrderId,
      rzpPaymentId,
      rzpSignature,
      requiresGstInvoice,
      customerGstin,
      billingBusinessName,
      billingAddress ? JSON.stringify(billingAddress) : null,
      placeOfSupply,
      invoiceNumber,
      invoiceDate,
      deliveryDate,
    ];

    const orderResult = await client.query(orderInsertSql, orderValues);
    const createdOrder = orderResult.rows[0];

    // If customer provided GST profile and is logged in, upsert into user_gst_numbers
    if (userId && customerGstin && billingBusinessName) {
      try {
        const countRes = await client.query(
          `SELECT COUNT(*) FROM user_gst_numbers WHERE user_id = $1 AND status = 1`,
          [userId]
        );
        const shouldBeDefault = parseInt(countRes.rows[0].count, 10) === 0;

        await client.query(
          `INSERT INTO user_gst_numbers (
            user_id,
            gstin,
            legal_business_name,
            trade_name,
            billing_address_id,
            is_default,
            status,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 1, NOW(), NOW())
          ON CONFLICT (user_id, gstin)
          DO UPDATE SET
            legal_business_name = EXCLUDED.legal_business_name,
            trade_name = COALESCE(EXCLUDED.trade_name, user_gst_numbers.trade_name),
            billing_address_id = COALESCE(EXCLUDED.billing_address_id, user_gst_numbers.billing_address_id),
            status = 1,
            updated_at = NOW()`,
          [
            userId,
            customerGstin,
            billingBusinessName,
            tradeName,
            req.body.billing_address_id || null,
            shouldBeDefault,
          ]
        );
      } catch (gstErr) {
        console.warn('Could not upsert user_gst_numbers:', gstErr.message);
      }
    }

    // 3. Insert order items
    for (const item of validatedItems) {
      await client.query(
        `INSERT INTO order_items (
          order_id,
          product_id,
          product_name,
          product_sku,
          product_image,
          price,
          quantity,
          total_price,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          createdOrder.id,
          item.productId,
          item.name,
          item.sku,
          item.image,
          item.price,
          item.quantity,
          item.lineTotal,
        ]
      );
    }

    // Insert payment record into payments table if online payment or provider IDs exist
    if (rzpOrderId || rzpPaymentId || finalPaymentMethod === 'Razorpay') {
      try {
        const paymentStatus = finalPaymentStatus === 'Paid' ? 'SUCCESS' : 'PENDING';
        const amountInPaise = Math.round(totalAmount * 100);
        await client.query(
          `INSERT INTO payments (
            order_id,
            provider,
            provider_order_id,
            provider_payment_id,
            amount,
            currency,
            status,
            payment_method,
            failure_reason,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
          ON CONFLICT (order_id, provider, provider_order_id)
          DO UPDATE SET
            provider_payment_id = COALESCE(EXCLUDED.provider_payment_id, payments.provider_payment_id),
            status = EXCLUDED.status,
            updated_at = NOW()`,
          [
            createdOrder.id,
            'razorpay',
            rzpOrderId || `rzp_order_${createdOrder.id}_${Date.now()}`,
            rzpPaymentId,
            amountInPaise,
            'INR',
            paymentStatus,
            finalPaymentMethod,
            null,
          ]
        );
      } catch (payErr) {
        console.error('Error logging payment to payments table:', payErr.message);
      }
    }

    await client.query('COMMIT');

    // Trigger Order Confirmation Email
    if (customerEmail) {
      emailService
        .sendOrderConfirmationEmail({
          email: customerEmail,
          customerName: customerName || 'Valued Customer',
          orderNumber: createdOrder.order_number,
          items: validatedItems,
          totalAmount,
          subtotal,
          shippingFee,
          tax,
          paymentMethod: finalPaymentMethod,
          paymentStatus: finalPaymentStatus,
          shippingAddress: finalAddress,
          shippingCity: finalCity,
          shippingState: finalState,
          shippingPostalCode: finalZip,
          shippingCountry: finalCountry,
          createdAt: createdOrder.created_at,
        })
        .catch((emailErr) => {
          console.error(
            `Failed to send order confirmation email for order #${createdOrder.order_number}:`,
            emailErr.message
          );
        });
    }

    return res.status(201).json({
      success: true,
      message: 'Order placed successfully! Thank you for your purchase.',
      order: {
        id: createdOrder.id,
        orderNumber: createdOrder.order_number,
        totalAmount: parseFloat(createdOrder.total_amount),
        status: createdOrder.status,
        createdAt: createdOrder.created_at,
        itemCount: validatedItems.reduce((acc, it) => acc + it.quantity, 0),
        items: validatedItems,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Place Order Transaction Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to place order.' });
  } finally {
    client.release();
  }
};

export const getUserOrders = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userEmail = req.user?.email ? String(req.user.email).trim().toLowerCase() : null;

    if (!userId && !userEmail) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required to view your orders.',
        orders: [],
      });
    }

    let queryText = `
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
        o.shipping_country AS "shippingCountry",
        o.subtotal,
        o.shipping_fee AS "shippingFee",
        o.tax,
        o.total_amount AS "totalAmount",
        o.status,
        o.payment_status AS "paymentStatus",
        o.payment_method AS "paymentMethod",
        o.razorpay_order_id AS "razorpayOrderId",
        o.razorpay_payment_id AS "razorpayPaymentId",
        o.requires_gst_invoice AS "requiresGstInvoice",
        o.customer_gstin AS "customerGstin",
        o.billing_business_name AS "billingBusinessName",
        o.billing_address AS "billingAddress",
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
    `;

    const params = [];
    if (userId && userEmail) {
      params.push(userId, userEmail);
      queryText += ` WHERE (o.user_id = $1 OR (o.user_id IS NULL AND LOWER(o.customer_email) = $2))`;
    } else if (userId) {
      params.push(userId);
      queryText += ` WHERE o.user_id = $1`;
    } else {
      params.push(userEmail);
      queryText += ` WHERE (o.user_id IS NULL AND LOWER(o.customer_email) = $1)`;
    }

    queryText += ` GROUP BY o.id, p.id, p.provider_payment_id, p.status ORDER BY o.id DESC LIMIT 50`;

    const { rows } = await db.query(queryText, params);

    const orders = rows.map((ord) => ({
      ...ord,
      totalAmount: parseFloat(ord.totalAmount || 0),
      subtotal: parseFloat(ord.subtotal || 0),
      shippingFee: parseFloat(ord.shippingFee || 0),
    }));

    return res.json({
      success: true,
      count: orders.length,
      orders,
    });
  } catch (err) {
    console.error('Get User Orders Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch customer orders.' });
  }
};

// Customer Get Single Order Details (RBAC - User's Own Order Only)
export const getUserOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id || null;
    const userEmail = req.user?.email ? String(req.user.email).trim().toLowerCase() : null;

    if (!userId && !userEmail) {
      return res.status(401).json({ success: false, message: 'Authentication required to view order details.' });
    }

    let filterClause = '';
    const params = [String(id)];

    if (userId && userEmail) {
      params.push(userId, userEmail);
      filterClause = `AND (o.user_id = $2 OR (o.user_id IS NULL AND LOWER(o.customer_email) = $3))`;
    } else if (userId) {
      params.push(userId);
      filterClause = `AND o.user_id = $2`;
    } else {
      params.push(userEmail);
      filterClause = `AND (o.user_id IS NULL AND LOWER(o.customer_email) = $2)`;
    }

    const { rows } = await db.query(
      `SELECT 
        o.id,
        o.order_number AS "orderNumber",
        o.customer_name AS "customerName",
        o.customer_email AS "customerEmail",
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
        o.razorpay_order_id AS "razorpayOrderId",
        o.razorpay_payment_id AS "razorpayPaymentId",
        o.requires_gst_invoice AS "requiresGstInvoice",
        o.customer_gstin AS "customerGstin",
        o.billing_business_name AS "billingBusinessName",
        o.billing_address AS "billingAddress",
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
      WHERE (o.id::text = $1::text OR o.order_number::text = $1::text) ${filterClause}
      GROUP BY o.id, p.id, p.provider_payment_id, p.status`,
      params
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const order = {
      ...rows[0],
      totalAmount: parseFloat(rows[0].totalAmount || 0),
      subtotal: parseFloat(rows[0].subtotal || 0),
    };

    return res.json({
      success: true,
      order,
    });
  } catch (err) {
    console.error('Get Order Detail Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch order details.' });
  }
};
