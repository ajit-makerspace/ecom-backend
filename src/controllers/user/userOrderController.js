import db from '../../config/db.js';

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

    // Generate unique order number e.g. MS-849201
    const orderNumber = `MS-${Math.floor(100000 + Math.random() * 900000)}`;

    const customerName = `${finalFirstName.trim()} ${(finalLastName || '').trim()}`.trim();
    const customerEmail = String(finalEmail).trim().toLowerCase();
    const customerPhone = finalPhone ? String(finalPhone).trim() : null;
    const userId = req.user?.id || null;

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
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'Pending', 'Paid', $15, $16, NOW(), NOW()
      ) RETURNING id, order_number, total_amount, status, created_at;
    `;

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
      String(finalPaymentMethod).trim(),
      notes ? String(notes).trim() : null,
    ];

    const orderResult = await client.query(orderInsertSql, orderValues);
    const createdOrder = orderResult.rows[0];

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

    await client.query('COMMIT');

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

// Customer Get Own Orders Controller
export const getUserOrders = async (req, res) => {
  try {
    const userId = req.user.id;

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
        o.created_at AS "createdAt",
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
      WHERE o.user_id = $1
      GROUP BY o.id
      ORDER BY o.id DESC`,
      [userId]
    );

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

// Customer Get Single Order Details
export const getUserOrderById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

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
        o.created_at AS "createdAt",
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
      WHERE (o.id::text = $1 OR o.order_number = $1) AND o.user_id = $2
      GROUP BY o.id`,
      [id, userId]
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
