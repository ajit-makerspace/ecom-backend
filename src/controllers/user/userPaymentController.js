import crypto from 'crypto';
import db from '../../config/db.js';
import { generateOrderNumber } from '../../utils/orderNumberGenerator.js';
import emailService from '../../services/emailService.js';

// Ensure Razorpay tracking columns and payments table exist in DB
export async function ensureOrderRazorpayColumns() {
  try {
    await db.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_order_id VARCHAR(255);
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_payment_id VARCHAR(255);
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS razorpay_signature TEXT;

      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        provider VARCHAR(30) NOT NULL DEFAULT 'razorpay',
        provider_order_id VARCHAR(100) UNIQUE,
        provider_payment_id VARCHAR(100) UNIQUE,
        amount BIGINT NOT NULL CHECK (amount > 0),
        currency CHAR(3) NOT NULL DEFAULT 'INR',
        status VARCHAR(30) NOT NULL DEFAULT 'PENDING'
            CHECK (status IN (
                'PENDING',
                'AUTHORIZED',
                'SUCCESS',
                'FAILED',
                'REFUND_PENDING',
                'PARTIALLY_REFUNDED',
                'REFUNDED'
            )),
        payment_method VARCHAR(50),
        failure_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT payments_order_provider_unique
            UNIQUE (order_id, provider, provider_order_id)
      );

      CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);
      CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
      CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);
    `);
  } catch (err) {
    console.error('Error ensuring Razorpay columns & payments table on orders:', err.message);
  }
}
ensureOrderRazorpayColumns();

// Public Config (Returns Razorpay Key ID for client initialization)
export const getRazorpayConfig = async (req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!keyId) {
    return res.status(500).json({
      success: false,
      message: 'RAZORPAY_KEY_ID is missing from .env configuration.',
    });
  }

  return res.json({
    success: true,
    keyId,
    currency: 'INR',
  });
};

// Create a Razorpay Order
export const createRazorpayOrder = async (req, res) => {
  try {
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return res.status(500).json({
        success: false,
        message: 'Razorpay keys (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET) are missing from .env.',
      });
    }

    let finalAmount = parseFloat(req.body.amount || 0);
    const items = req.body.items;

    // Optional verification of amount from database if items provided
    if (items && Array.isArray(items) && items.length > 0) {
      let subtotal = 0;
      for (const item of items) {
        const productId = item.productId || item.product?.id || item.id;
        const qty = parseInt(item.quantity || 1, 10);
        if (!productId || qty <= 0) continue;

        const { rows } = await db.query(
          'SELECT price FROM products WHERE id = $1 AND status = 1',
          [productId]
        );
        if (rows.length > 0) {
          subtotal += parseFloat(rows[0].price || 0) * qty;
        }
      }
      if (subtotal > 0) {
        const shippingFee = subtotal > 150 ? 0 : 15;
        const tax = 0;
        finalAmount = subtotal + shippingFee + tax;
      }
    }

    if (finalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid order amount. Amount must be greater than zero.',
      });
    }

    // Razorpay requires amount in paise (1 INR = 100 paise)
    const amountInPaise = Math.round(finalAmount * 100);

    const authHeader = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const receiptId = `rcpt_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const rzpResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${authHeader}`,
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: 'INR',
        receipt: receiptId,
        notes: {
          customerName: req.body.customerName || 'Customer',
          customerEmail: req.body.customerEmail || '',
          customerPhone: req.body.customerPhone || '',
          userId: req.user?.id ? String(req.user.id) : 'guest',
        },
      }),
    });

    const rzpOrder = await rzpResponse.json();

    if (!rzpResponse.ok) {
      console.error('Razorpay Order Creation Failed:', rzpOrder);
      return res.status(rzpResponse.status).json({
        success: false,
        message: rzpOrder.error?.description || 'Failed to initialize payment gateway order.',
        error: rzpOrder.error,
      });
    }

    return res.json({
      success: true,
      orderId: rzpOrder.id,
      amount: rzpOrder.amount, // in paise
      amountInRupees: finalAmount,
      currency: rzpOrder.currency || 'INR',
      keyId,
    });
  } catch (err) {
    console.error('Create Razorpay Order Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Internal server error while creating payment order.',
    });
  }
};

// Verify Razorpay Payment Signature and Finalize Order
export const verifyRazorpayPayment = async (req, res) => {
  const client = await db.pool.connect();

  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      orderData,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        message: 'Missing Razorpay payment verification parameters.',
      });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return res.status(500).json({
        success: false,
        message: 'RAZORPAY_KEY_SECRET is not configured in .env',
      });
    }

    // Verify HMAC SHA256 Signature
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const isMatch = crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'utf-8'),
      Buffer.from(razorpay_signature, 'utf-8')
    );

    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed: Invalid transaction signature.',
      });
    }

    // Payment is authentic! Now persist the order into database inside a transaction
    await client.query('BEGIN');

    const shipping = orderData?.shipping_address || {};
    const finalFirstName = orderData?.firstName || shipping.first_name || shipping.firstName || req.user?.first_name || req.user?.firstName || 'Customer';
    const finalLastName = orderData?.lastName || shipping.last_name || shipping.lastName || req.user?.last_name || req.user?.lastName || '';
    const finalEmail = orderData?.email || shipping.email || req.user?.email || 'customer@example.com';
    const finalPhone = orderData?.phone || shipping.phone || req.user?.phone || '';
    const finalAddress = orderData?.address || shipping.address_line_1 || shipping.address || '';
    const finalCity = orderData?.city || shipping.city || '';
    const finalState = orderData?.state || shipping.state || '';
    const finalZip = orderData?.zip || shipping.postal_code || shipping.zip || '';
    const finalCountry = orderData?.country || shipping.country || 'India';
    const items = orderData?.items || [];
    const notes = orderData?.notes || null;

    if (!items || !Array.isArray(items) || items.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Order must contain at least one item.',
      });
    }

    // 1. Verify products & calculate verified totals
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

      // Update stock
      await client.query(
        'UPDATE products SET stock = GREATEST(0, stock - $1), updated_at = NOW() WHERE id = $2',
        [qty, prod.id]
      );
    }

    if (validatedItems.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'No valid products in cart.' });
    }

    const shippingFee = subtotal > 150 ? 0.0 : 15.0;
    const tax = 0.0;
    const totalAmount = subtotal + shippingFee + tax;

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
        console.error('Error looking up user by email in verifyRazorpayPayment:', e);
      }
    }

    if (userId && customerPhone) {
      try {
        await client.query(
          `UPDATE users SET phone = $1, updated_at = NOW() WHERE id = $2 AND (phone IS NULL OR phone = '')`,
          [customerPhone, userId]
        );
      } catch (e) {
        console.error('Error updating user phone in verifyRazorpayPayment:', e);
      }
    }

    // 2. Insert into orders table with Razorpay payment details
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
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
        'Processing', 'Paid', 'Razorpay', $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, NOW(), NOW()
      ) RETURNING id, order_number, total_amount, status, payment_status, requires_gst_invoice, customer_gstin, billing_business_name, invoice_number, invoice_date, created_at;
    `;

    const requiresGstInvoice = Boolean(orderData?.requires_gst_invoice || orderData?.requiresGstInvoice);
    const customerGstin = requiresGstInvoice && orderData?.customer_gstin ? String(orderData.customer_gstin).trim().toUpperCase() : null;
    const billingBusinessName = requiresGstInvoice && orderData?.billing_business_name ? String(orderData.billing_business_name).trim() : null;
    const tradeName = requiresGstInvoice && orderData?.trade_name ? String(orderData.trade_name).trim() : null;
    const billingAddress = requiresGstInvoice && orderData?.billing_address ? orderData.billing_address : null;
    const placeOfSupply = customerGstin && customerGstin.length >= 2 ? customerGstin.slice(0, 2) : (orderData?.place_of_supply_state_code || null);
    const invoiceNumber = requiresGstInvoice ? `INV-${Date.now().toString().slice(-6)}-${Math.floor(1000 + Math.random() * 9000)}` : null;
    const invoiceDate = requiresGstInvoice ? new Date() : null;

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
      notes ? String(notes).trim() : null,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      requiresGstInvoice,
      customerGstin,
      billingBusinessName,
      billingAddress ? JSON.stringify(billingAddress) : null,
      placeOfSupply,
      invoiceNumber,
      invoiceDate,
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

    // 4. Insert payment transaction log into payments table
    const amountInPaise = Math.round(totalAmount * 100);
    const paymentInsertSql = `
      INSERT INTO payments (
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
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()
      )
      ON CONFLICT (order_id, provider, provider_order_id)
      DO UPDATE SET
        provider_payment_id = EXCLUDED.provider_payment_id,
        status = EXCLUDED.status,
        payment_method = EXCLUDED.payment_method,
        updated_at = NOW()
      RETURNING id, order_id, provider, provider_order_id, provider_payment_id, amount, currency, status, payment_method, created_at, updated_at;
    `;

    const paymentResult = await client.query(paymentInsertSql, [
      createdOrder.id,
      'razorpay',
      razorpay_order_id,
      razorpay_payment_id,
      amountInPaise,
      'INR',
      'SUCCESS',
      orderData?.paymentMethod || 'Razorpay',
      null,
    ]);
    const createdPayment = paymentResult.rows[0];

    await client.query('COMMIT');

    // Trigger Order Confirmation Email
    if (finalEmail) {
      emailService
        .sendOrderConfirmationEmail({
          email: finalEmail,
          customerName: customerName || 'Valued Customer',
          orderNumber: createdOrder.order_number,
          items: validatedItems,
          totalAmount,
          subtotal,
          shippingFee,
          tax,
          paymentMethod: 'Razorpay',
          paymentStatus: 'Paid',
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
      message: 'Payment verified and order placed successfully!',
      order: {
        id: createdOrder.id,
        orderNumber: createdOrder.order_number,
        totalAmount: parseFloat(createdOrder.total_amount),
        status: createdOrder.status,
        paymentStatus: createdOrder.payment_status,
        paymentMethod: 'Razorpay',
        razorpayPaymentId: razorpay_payment_id,
        paymentId: createdPayment?.id,
        createdAt: createdOrder.created_at,
        itemCount: validatedItems.reduce((acc, it) => acc + it.quantity, 0),
        items: validatedItems,
      },
      payment: createdPayment,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Verify Payment Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Payment verification failed.',
    });
  } finally {
    client.release();
  }
};

// Get all payments associated with an order
export const getOrderPayments = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { rows } = await db.query(
      `SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC`,
      [orderId]
    );

    return res.json({
      success: true,
      count: rows.length,
      payments: rows,
    });
  } catch (err) {
    console.error('Get Order Payments Error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch payment details.',
    });
  }
};

// Record a failed or rejected payment attempt in payments table
export const recordPaymentFailure = async (req, res) => {
  try {
    const {
      orderId,
      order_id,
      provider_order_id,
      provider_payment_id,
      amount,
      error_code,
      error_description,
      error_reason,
      payment_method,
    } = req.body;

    const finalOrderId = orderId || order_id;
    if (!finalOrderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required to link payment failure record.',
      });
    }

    const failureReason = error_description || error_reason || error_code || 'Payment declined or failed';
    const amountInPaise = amount ? Math.max(1, Math.round(Number(amount) * (Number(amount) < 1000 ? 100 : 1))) : 1;

    const { rows } = await db.query(
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
      ) VALUES ($1, 'razorpay', $2, $3, $4, 'INR', 'FAILED', $5, $6, NOW(), NOW())
      ON CONFLICT (order_id, provider, provider_order_id)
      DO UPDATE SET
        provider_payment_id = COALESCE(EXCLUDED.provider_payment_id, payments.provider_payment_id),
        status = 'FAILED',
        failure_reason = EXCLUDED.failure_reason,
        updated_at = NOW()
      RETURNING *`,
      [
        finalOrderId,
        provider_order_id || `failed_${Date.now()}`,
        provider_payment_id || null,
        amountInPaise,
        payment_method || 'razorpay',
        failureReason,
      ]
    );

    return res.json({
      success: true,
      message: 'Payment failure logged successfully.',
      payment: rows[0],
    });
  } catch (err) {
    console.error('Record Payment Failure Error:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to record payment failure.',
    });
  }
};
