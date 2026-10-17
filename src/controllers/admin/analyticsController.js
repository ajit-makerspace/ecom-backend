import db from '../../config/db.js';

// Raw SQL Dashboard Analytics Controller
export const getDashboardAnalytics = async (req, res) => {
  try {
    const prodRes = await db.query('SELECT COUNT(*)::int AS count FROM products WHERE status = 1');
    const catRes = await db.query('SELECT COUNT(*)::int AS count FROM categories WHERE status = 1');
    const orderRes = await db.query(`
      SELECT 
        COUNT(*)::int AS count, 
        COALESCE(SUM(CASE WHEN status != 'Cancelled' THEN total_amount ELSE 0 END), 0)::numeric AS revenue,
        COUNT(CASE WHEN status IN ('Pending', 'Processing') THEN 1 END)::int AS pending_orders
      FROM orders
    `);
    const custRes = await db.query('SELECT COUNT(*)::int AS count FROM users WHERE status = 1');

    // Category distribution based on real product sales
    const categoryDistributionRes = await db.query(`
      SELECT 
        c.id,
        c.name,
        COALESCE(SUM(oi.price * oi.quantity), 0)::numeric AS revenue,
        COUNT(DISTINCT oi.order_id)::int AS order_count,
        COUNT(DISTINCT p.id)::int AS product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      LEFT JOIN order_items oi ON oi.product_id = p.id
      LEFT JOIN orders o ON oi.order_id = o.id AND o.status != 'Cancelled'
      WHERE c.status = 1
      GROUP BY c.id, c.name
      ORDER BY revenue DESC, product_count DESC
    `);

    // Dynamic 7-day revenue & profit
    const sevenDaysRes = await db.query(`
      WITH date_series AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '6 days',
          CURRENT_DATE,
          INTERVAL '1 day'
        )::date AS day
      )
      SELECT 
        TO_CHAR(ds.day, 'DD Mon') AS label,
        ds.day::text AS date,
        COALESCE(SUM(o.total_amount), 0)::numeric AS revenue,
        ROUND(COALESCE(SUM(o.total_amount) * 0.35, 0), 2)::numeric AS profit,
        COUNT(o.id)::int AS orders
      FROM date_series ds
      LEFT JOIN orders o ON DATE(o.created_at) = ds.day AND o.status != 'Cancelled'
      GROUP BY ds.day
      ORDER BY ds.day ASC
    `);

    // Dynamic 30-day revenue & profit
    const thirtyDaysRes = await db.query(`
      WITH date_series AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '29 days',
          CURRENT_DATE,
          INTERVAL '1 day'
        )::date AS day
      )
      SELECT 
        TO_CHAR(ds.day, 'DD Mon') AS label,
        ds.day::text AS date,
        COALESCE(SUM(o.total_amount), 0)::numeric AS revenue,
        ROUND(COALESCE(SUM(o.total_amount) * 0.35, 0), 2)::numeric AS profit,
        COUNT(o.id)::int AS orders
      FROM date_series ds
      LEFT JOIN orders o ON DATE(o.created_at) = ds.day AND o.status != 'Cancelled'
      GROUP BY ds.day
      ORDER BY ds.day ASC
    `);

    // Dynamic 12-month revenue & profit
    const twelveMonthsRes = await db.query(`
      WITH month_series AS (
        SELECT generate_series(
          DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '11 months',
          DATE_TRUNC('month', CURRENT_DATE),
          INTERVAL '1 month'
        )::date AS month_start
      )
      SELECT 
        TO_CHAR(ms.month_start, 'Mon') AS label,
        TO_CHAR(ms.month_start, 'Mon YYYY') AS full_label,
        COALESCE(SUM(o.total_amount), 0)::numeric AS revenue,
        ROUND(COALESCE(SUM(o.total_amount) * 0.35, 0), 2)::numeric AS profit,
        COUNT(o.id)::int AS orders
      FROM month_series ms
      LEFT JOIN orders o 
        ON DATE_TRUNC('month', o.created_at) = ms.month_start 
        AND o.status != 'Cancelled'
      GROUP BY ms.month_start
      ORDER BY ms.month_start ASC
    `);

    // Low stock items count (products with stock <= 45)
    const lowStockRes = await db.query('SELECT COUNT(*)::int AS count FROM products WHERE stock <= 45 AND status = 1');

    // Real dynamic growth calculation (this month vs last month)
    const growthRes = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE) AND status != 'Cancelled' THEN total_amount ELSE 0 END), 0)::numeric AS rev_this_month,
        COALESCE(SUM(CASE WHEN DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND status != 'Cancelled' THEN total_amount ELSE 0 END), 0)::numeric AS rev_last_month,
        COUNT(CASE WHEN DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE) AND status != 'Cancelled' THEN 1 END)::int AS orders_this_month,
        COUNT(CASE WHEN DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') AND status != 'Cancelled' THEN 1 END)::int AS orders_last_month
      FROM orders
    `);

    const custGrowthRes = await db.query(`
      SELECT
        COUNT(CASE WHEN DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE) THEN 1 END)::int AS cust_this_month,
        COUNT(CASE WHEN DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month') THEN 1 END)::int AS cust_last_month
      FROM users WHERE status = 1
    `);

    const g = growthRes.rows[0];
    const cg = custGrowthRes.rows[0];

    const calcGrowth = (current, previous) => {
      if (!previous || previous === 0) return current > 0 ? '+100%' : '0%';
      const pct = ((current - previous) / previous) * 100;
      return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
    };

    const revenueGrowth = calcGrowth(parseFloat(g.rev_this_month), parseFloat(g.rev_last_month));
    const ordersGrowth = calcGrowth(g.orders_this_month, g.orders_last_month);
    const customersGrowth = calcGrowth(cg.cust_this_month, cg.cust_last_month);
    const productsGrowth = '+0.0%';

    const totalProducts = prodRes.rows[0]?.count || 0;
    const totalCategories = catRes.rows[0]?.count || 0;
    const totalOrders = orderRes.rows[0]?.count || 0;
    const totalRevenue = parseFloat(orderRes.rows[0]?.revenue || '0.00');
    const pendingOrders = orderRes.rows[0]?.pending_orders || 0;
    const totalCustomers = custRes.rows[0]?.count || 0;
    const lowStockCount = lowStockRes.rows[0]?.count || 0;

    return res.json({
      success: true,
      stats: {
        totalRevenue,
        totalOrders,
        totalCustomers,
        totalProducts,
        totalCategories,
        pendingOrders,
        lowStockCount,
        revenueGrowth,
        ordersGrowth,
        customersGrowth,
        productsGrowth,
      },
      charts: {
        revenue: {
          sevenDays: sevenDaysRes.rows.map(r => ({
            label: r.label,
            date: r.date,
            revenue: parseFloat(r.revenue),
            profit: parseFloat(r.profit),
            orders: r.orders,
          })),
          thirtyDays: thirtyDaysRes.rows.map(r => ({
            label: r.label,
            date: r.date,
            revenue: parseFloat(r.revenue),
            profit: parseFloat(r.profit),
            orders: r.orders,
          })),
          twelveMonths: twelveMonthsRes.rows.map(r => ({
            month: r.label,
            fullLabel: r.full_label,
            revenue: parseFloat(r.revenue),
            profit: parseFloat(r.profit),
            orders: r.orders,
          })),
        },
        categoryDistribution: categoryDistributionRes.rows.map(r => ({
          id: r.id,
          name: r.name,
          revenue: parseFloat(r.revenue),
          orderCount: r.order_count,
          productCount: r.product_count,
        })),
      },
    });
  } catch (err) {
    console.error('Get Dashboard Analytics Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch analytics.' });
  }
};
