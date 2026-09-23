import db from '../../config/db.js';

// Get All Customers with Lifetime Spend, Address & Orders Count
export const getCustomers = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT 
        u.id,
        CONCAT(u.first_name, ' ', COALESCE(u.last_name, '')) AS name,
        u.email,
        u.phone,
        u.profile_image_url AS avatar,
        u.status,
        u.created_at AS "joinedDate",
        u.last_login_at AS "lastLoginAt",
        COUNT(DISTINCT o.id)::int AS "ordersCount",
        COALESCE(SUM(o.total_amount), 0)::numeric AS "totalSpent",
        COALESCE(
          (
            SELECT CONCAT(ua.address_line_1, ', ', ua.city, ', ', ua.state, ' ', ua.postal_code)
            FROM user_addresses ua
            WHERE ua.user_id = u.id
            ORDER BY ua.is_default DESC, ua.created_at DESC
            LIMIT 1
          ),
          'No address on file'
        ) AS address
      FROM users u
      LEFT JOIN orders o ON u.id = o.user_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);

    const customers = rows.map((c) => {
      const totalSpent = parseFloat(c.totalSpent || 0);
      let tier = c.status === 1 ? 'Active' : 'Inactive';
      if (c.status === 1 && totalSpent >= 5000) {
        tier = 'VIP';
      }

      return {
        id: c.id,
        name: c.name.trim() || c.email.split('@')[0],
        email: c.email,
        phone: c.phone || 'N/A',
        avatar: c.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&q=80',
        status: tier,
        joinedDate: new Date(c.joinedDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
        ordersCount: c.ordersCount,
        totalOrders: c.ordersCount,
        totalSpent,
        address: c.address,
      };
    });

    return res.json({
      success: true,
      count: customers.length,
      customers,
    });
  } catch (err) {
    console.error('Get Admin Customers Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch customers roster.' });
  }
};

// Update Customer Status (Active / Inactive)
export const updateCustomerStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const statusInt = String(status).toLowerCase() === 'active' || status === 1 ? 1 : 0;

    const { rows } = await db.query(
      `UPDATE users
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, email, first_name, last_name, status`,
      [statusInt, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }

    const c = rows[0];
    return res.json({
      success: true,
      message: 'Customer status updated.',
      customer: {
        id: c.id,
        status: c.status === 1 ? 'Active' : 'Inactive',
      },
    });
  } catch (err) {
    console.error('Update Customer Status Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update customer status.' });
  }
};
