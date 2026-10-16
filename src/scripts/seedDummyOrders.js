import db from '../config/db.js';

export async function seedDummyOrders() {
  console.log('📦 Starting Dummy Orders Seeding...');

  try {
    // 1. Get all users
    const userRes = await db.query('SELECT id, email, first_name, last_name FROM users');
    const users = userRes.rows;
    console.log(`Found ${users.length} users in database.`);

    // 2. Get real products
    const prodRes = await db.query(`
      SELECT id, name, sku, price, image_url 
      FROM products 
      WHERE status = 1 
      ORDER BY id ASC 
      LIMIT 12
    `);
    const prods = prodRes.rows;
    if (prods.length === 0) {
      console.log('No products found to seed orders with.');
      return;
    }

    // 3. Clear older dummy orders to prevent duplicates
    await db.query(`DELETE FROM orders WHERE order_number IN ('A35545vs43', 'MS-829104', 'MS-740219', 'MS-619842', 'MS-512093', 'MS-948120', 'MSM26271001', 'MSM26271002', 'MSM26271003', 'MSM26271004', 'MSM26271005')`);

    // Target user IDs: assign orders to each registered user (and null for guest)
    const targetUserIds = users.length > 0 ? users.map((u) => u.id) : [null];

    const orderTemplates = [
      {
        orderNumber: 'MSM26271005',
        customerName: 'Khushi Oberoi',
        createdAt: '2026-11-15T10:30:00Z',
        status: 'Delivered',
        paymentStatus: 'Paid',
        totalAmount: 158814.00,
        items: [
          { prod: prods[0] || prods[0], qty: 1, price: 39703.50 },
          { prod: prods[1] || prods[0], qty: 1, price: 39703.50 },
          { prod: prods[2] || prods[0], qty: 1, price: 39703.50 },
          { prod: prods[3] || prods[0], qty: 1, price: 39703.50 },
        ],
      },
      {
        orderNumber: 'MSM26271004',
        customerName: 'Khushi Oberoi',
        createdAt: '2026-11-12T14:20:00Z',
        status: 'In Transit',
        paymentStatus: 'Paid',
        totalAmount: 49200.00,
        items: [
          { prod: prods[4] || prods[0], qty: 2, price: 12500.00 },
          { prod: prods[5] || prods[0], qty: 1, price: 24200.00 },
        ],
      },
      {
        orderNumber: 'MSM26271003',
        customerName: 'Khushi Oberoi',
        createdAt: '2026-10-28T16:45:00Z',
        status: 'Delivered',
        paymentStatus: 'Paid',
        totalAmount: 84500.00,
        items: [
          { prod: prods[6] || prods[0], qty: 1, price: 28500.00 },
          { prod: prods[7] || prods[0], qty: 1, price: 32000.00 },
          { prod: prods[8] || prods[0], qty: 1, price: 24000.00 },
        ],
      },
      {
        orderNumber: 'MSM26271002',
        customerName: 'Khushi Oberoi',
        createdAt: '2026-09-14T11:10:00Z',
        status: 'Delivered',
        paymentStatus: 'Paid',
        totalAmount: 125000.00,
        items: [
          { prod: prods[9] || prods[0], qty: 1, price: 65000.00 },
          { prod: prods[10] || prods[0], qty: 1, price: 60000.00 },
        ],
      },
      {
        orderNumber: 'MSM26271001',
        customerName: 'Khushi Oberoi',
        createdAt: '2026-08-05T09:00:00Z',
        status: 'Delivered',
        paymentStatus: 'Paid',
        totalAmount: 62300.00,
        items: [
          { prod: prods[11] || prods[0], qty: 2, price: 15500.00 },
          { prod: prods[1] || prods[0], qty: 1, price: 31300.00 },
        ],
      },
    ];

    // Seed orders for each user so whenever anyone logs in, they see these dummy orders
    for (const userId of targetUserIds) {
      for (const tpl of orderTemplates) {
        // Generate unique order number per user if multiple users
        const orderNum = targetUserIds.length > 1 && userId !== targetUserIds[0] 
          ? `${tpl.orderNumber}-${userId.slice(0, 4)}` 
          : tpl.orderNumber;

        const orderIns = await db.query(
          `INSERT INTO orders (
            order_number,
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
            user_id,
            created_at,
            updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $18)
          RETURNING id;`,
          [
            orderNum,
            tpl.customerName,
            'customer@makerspace.com',
            '+91 98765 43210',
            'Flat 402, Green Glen Layout, Bellandur',
            'Bengaluru',
            'Karnataka',
            '560103',
            'India',
            tpl.totalAmount,
            0.00,
            0.00,
            tpl.totalAmount,
            tpl.status,
            tpl.paymentStatus,
            'Online (Razorpay / UPI)',
            userId,
            tpl.createdAt,
          ]
        );

        const orderId = orderIns.rows[0].id;

        // Insert items
        for (const item of tpl.items) {
          await db.query(
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
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`,
            [
              orderId,
              item.prod.id,
              item.prod.name,
              item.prod.sku,
              item.prod.image_url,
              item.price,
              item.qty,
              item.price * item.qty,
              tpl.createdAt,
            ]
          );
        }
      }
    }

    console.log('✅ Successfully seeded dummy orders with line items across all user accounts!');
  } catch (err) {
    console.error('❌ Error seeding dummy orders:', err);
  }
}

// Auto-run if executed directly
if (process.argv[1]?.endsWith('seedDummyOrders.js')) {
  seedDummyOrders().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
