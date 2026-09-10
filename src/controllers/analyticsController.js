import db from '../config/db.js';

// Raw SQL Dashboard Analytics Controller
export const getDashboardAnalytics = async (req, res) => {
  try {
    const prodRes = await db.query('SELECT COUNT(*)::int AS count FROM products WHERE status = 1');
    const catRes = await db.query('SELECT COUNT(*)::int AS count FROM categories WHERE status = 1');
    const orderRes = await db.query('SELECT COUNT(*)::int AS count, COALESCE(SUM(total_amount), 0)::numeric AS revenue FROM orders');

    const totalProducts = prodRes.rows[0]?.count || 0;
    const totalCategories = catRes.rows[0]?.count || 0;
    const totalOrders = orderRes.rows[0]?.count || 0;
    const totalRevenue = parseFloat(orderRes.rows[0]?.revenue || '0.00');

    return res.json({
      success: true,
      stats: {
        totalRevenue,
        totalOrders,
        totalCustomers: 0,
        totalProducts,
        totalCategories,
        revenueGrowth: '+14.2%',
        ordersGrowth: '+8.5%',
        customersGrowth: '+22.1%',
        productsGrowth: '+5.4%',
      },
    });
  } catch (err) {
    console.error('Get Dashboard Analytics Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch analytics.' });
  }
};
