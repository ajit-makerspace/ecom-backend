import db from '../../config/db.js';

/**
 * Ensure the chatbot_intents table exists and seed default FAQ intents if empty
 */
export async function ensureChatbotTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS chatbot_intents (
        id SERIAL PRIMARY KEY,
        category VARCHAR(100) NOT NULL DEFAULT 'General',
        title VARCHAR(255) NOT NULL,
        answer TEXT NOT NULL,
        keywords TEXT[] DEFAULT '{}',
        action_label VARCHAR(100),
        action_url VARCHAR(255),
        sort_order INTEGER NOT NULL DEFAULT 0,
        status SMALLINT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_chatbot_intents_cat ON chatbot_intents(category);
      CREATE INDEX IF NOT EXISTS idx_chatbot_intents_status ON chatbot_intents(status);
    `);

    // Check if table is empty, if so seed high-quality defaults
    const countRes = await db.query('SELECT COUNT(*)::int AS count FROM chatbot_intents');
    if (countRes.rows[0].count === 0) {
      const defaultIntents = [
        {
          category: 'Orders & Shipping',
          title: 'How do I track my order?',
          answer: 'You can track your order status in real time under "My Orders". Once dispatched, we also send courier tracking links to your registered email and phone number.',
          keywords: ['track', 'order', 'status', 'shipping', 'delivery', 'where is my order', 'courier', 'awb'],
          action_label: 'View My Orders',
          action_url: '/user/orders',
          sort_order: 1,
        },
        {
          category: 'Orders & Shipping',
          title: 'What are the delivery timelines and shipping charges?',
          answer: 'Standard shipping across India takes 3 to 5 business days. Express delivery takes 1 to 2 business days. Shipping is completely free on orders above ₹1,999.',
          keywords: ['delivery', 'time', 'shipping charges', 'free shipping', 'cost', 'fast shipping', 'duration'],
          action_label: 'Shop Products',
          action_url: '/user',
          sort_order: 2,
        },
        {
          category: 'Orders & Shipping',
          title: 'Is Cash on Delivery (COD) available?',
          answer: 'Yes, Cash on Delivery is available for eligible electronics and DIY components across most serviceable pin codes in India with zero hidden charges.',
          keywords: ['cod', 'cash on delivery', 'pay on delivery', 'cash'],
          action_label: 'Explore Catalog',
          action_url: '/user',
          sort_order: 3,
        },
        {
          category: 'Kits & Robotics',
          title: 'How do I place a bulk order for schools, colleges, or ATL labs?',
          answer: 'We provide custom educational discounts, official GST quotations, and custom kit assembly for Atal Tinkering Labs (ATL), robotics clubs, and college engineering departments.',
          keywords: ['bulk', 'school', 'college', 'atl', 'lab', 'institution', 'quote', 'bulk order', 'discount'],
          action_label: 'Submit Bulk Enquiry',
          action_url: '/user/bulk-enquiry',
          sort_order: 4,
        },
        {
          category: 'Kits & Robotics',
          title: 'Are assembly guides and code included with DIY drone & robotics kits?',
          answer: 'Yes! Every DIY kit comes with step-by-step assembly guides, circuit schematics, pinout references, and downloadable open-source code/libraries.',
          keywords: ['guide', 'manual', 'code', 'assembly', 'instructions', 'tutorial', 'documentation', 'schematic'],
          action_label: 'Explore Featured Kits',
          action_url: '/user',
          sort_order: 5,
        },
        {
          category: 'Payments & GST',
          title: 'Can I get a GST business tax invoice for my order?',
          answer: 'Yes! You can enter your company GSTIN and legal business name during checkout. An automated GST B2B tax invoice with input tax credit (ITC) will be issued and emailed to you.',
          keywords: ['gst', 'tax invoice', 'business invoice', 'b2b', 'gstin', 'itc', 'invoice'],
          action_label: 'Go to Cart',
          action_url: '/user/cart',
          sort_order: 6,
        },
        {
          category: 'Payments & GST',
          title: 'What payment methods are supported?',
          answer: 'We accept all major payment methods including UPI (Google Pay, PhonePe, Paytm), Credit & Debit Cards (Visa, MasterCard, RuPay), Net Banking, and digital wallets.',
          keywords: ['payment', 'upi', 'credit card', 'debit card', 'netbanking', 'wallet', 'pay'],
          action_label: 'Shop Now',
          action_url: '/user',
          sort_order: 7,
        },
        {
          category: 'Returns & Warranty',
          title: 'What is your return & replacement policy?',
          answer: 'We offer a 7-day hassle-free replacement guarantee if an electronic component arrives defective or damaged during transit. Contact support within 7 days with photos/video of the issue.',
          keywords: ['return', 'refund', 'replacement', 'damaged', 'defective', 'warranty', 'exchange'],
          action_label: 'Talk to Support',
          action_url: 'https://wa.me/919999999999',
          sort_order: 8,
        },
        {
          category: 'Support & Help',
          title: 'How can I contact MakerSpace customer support?',
          answer: 'Our technical support team is available Monday to Saturday, 9:00 AM - 7:00 PM IST. You can chat with us directly on WhatsApp or email support@makerspacemasters.com.',
          keywords: ['contact', 'support', 'help', 'phone', 'email', 'whatsapp', 'customer care', 'agent'],
          action_label: 'Chat on WhatsApp',
          action_url: 'https://wa.me/919999999999',
          sort_order: 9,
        },
      ];

      for (const item of defaultIntents) {
        await db.query(
          `INSERT INTO chatbot_intents (
            category, title, answer, keywords, action_label, action_url, sort_order, status, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, NOW(), NOW())`,
          [
            item.category,
            item.title,
            item.answer,
            item.keywords,
            item.action_label,
            item.action_url,
            item.sort_order,
          ]
        );
      }
      console.log('✅ Default chatbot intents successfully seeded.');
    }
  } catch (err) {
    console.error('Error ensuring chatbot_intents table:', err.message);
  }
}

/**
 * GET /api/admin/chatbot-intents
 * Fetch all chatbot intents with optional search, category, and status filters
 */
export async function getAdminChatbotIntents(req, res) {
  try {
    const { search, category, status } = req.query;

    let query = `
      SELECT 
        id,
        category,
        title,
        answer,
        keywords,
        action_label AS "actionLabel",
        action_url AS "actionUrl",
        sort_order AS "sortOrder",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM chatbot_intents
      WHERE 1=1
    `;
    const params = [];

    if (category && category !== 'ALL') {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    if (status !== undefined && status !== 'ALL' && status !== '') {
      params.push(parseInt(status, 10));
      query += ` AND status = $${params.length}`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (
        LOWER(title) LIKE $${params.length} OR 
        LOWER(answer) LIKE $${params.length} OR 
        LOWER(category) LIKE $${params.length} OR
        $${params.length} = ANY(SELECT LOWER(unnest(keywords)))
      )`;
    }

    query += ' ORDER BY sort_order ASC, id ASC';

    const { rows } = await db.query(query, params);

    // Get list of distinct categories for filters
    const catRes = await db.query('SELECT DISTINCT category FROM chatbot_intents ORDER BY category ASC');
    const categories = catRes.rows.map((r) => r.category);

    return res.json({
      success: true,
      count: rows.length,
      categories,
      intents: rows,
    });
  } catch (err) {
    console.error('Get Admin Chatbot Intents Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch chatbot intents.' });
  }
}

/**
 * POST /api/admin/chatbot-intents
 * Create a new chatbot intent / FAQ
 */
export async function createChatbotIntent(req, res) {
  try {
    const {
      category = 'General',
      title,
      answer,
      keywords = [],
      action_label,
      action_url,
      sort_order = 0,
      status = 1,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Question/Title is required.' });
    }
    if (!answer || !answer.trim()) {
      return res.status(400).json({ success: false, message: 'Answer response text is required.' });
    }

    const parsedKeywords = Array.isArray(keywords)
      ? keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean)
      : typeof keywords === 'string'
      ? keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean)
      : [];

    const { rows } = await db.query(
      `INSERT INTO chatbot_intents (
        category,
        title,
        answer,
        keywords,
        action_label,
        action_url,
        sort_order,
        status,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING 
        id,
        category,
        title,
        answer,
        keywords,
        action_label AS "actionLabel",
        action_url AS "actionUrl",
        sort_order AS "sortOrder",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"`,
      [
        category.trim() || 'General',
        title.trim(),
        answer.trim(),
        parsedKeywords,
        action_label?.trim() || null,
        action_url?.trim() || null,
        parseInt(sort_order, 10) || 0,
        parseInt(status, 10) === 0 ? 0 : 1,
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Chatbot intent created successfully.',
      intent: rows[0],
    });
  } catch (err) {
    console.error('Create Chatbot Intent Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to create chatbot intent.' });
  }
}

/**
 * PUT /api/admin/chatbot-intents/:id
 * Update an existing chatbot intent / FAQ
 */
export async function updateChatbotIntent(req, res) {
  try {
    const { id } = req.params;
    const {
      category,
      title,
      answer,
      keywords,
      action_label,
      action_url,
      sort_order,
      status,
    } = req.body;

    const existRes = await db.query('SELECT * FROM chatbot_intents WHERE id = $1', [id]);
    if (existRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Chatbot intent not found.' });
    }

    const current = existRes.rows[0];

    const parsedKeywords = keywords !== undefined
      ? (Array.isArray(keywords)
          ? keywords.map((k) => String(k).trim().toLowerCase()).filter(Boolean)
          : typeof keywords === 'string'
          ? keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean)
          : [])
      : current.keywords;

    const { rows } = await db.query(
      `UPDATE chatbot_intents
       SET 
        category = $1,
        title = $2,
        answer = $3,
        keywords = $4,
        action_label = $5,
        action_url = $6,
        sort_order = $7,
        status = $8,
        updated_at = NOW()
       WHERE id = $9
       RETURNING 
        id,
        category,
        title,
        answer,
        keywords,
        action_label AS "actionLabel",
        action_url AS "actionUrl",
        sort_order AS "sortOrder",
        status,
        created_at AS "createdAt",
        updated_at AS "updatedAt"`,
      [
        category !== undefined ? category.trim() : current.category,
        title !== undefined ? title.trim() : current.title,
        answer !== undefined ? answer.trim() : current.answer,
        parsedKeywords,
        action_label !== undefined ? (action_label?.trim() || null) : current.action_label,
        action_url !== undefined ? (action_url?.trim() || null) : current.action_url,
        sort_order !== undefined ? parseInt(sort_order, 10) : current.sort_order,
        status !== undefined ? (parseInt(status, 10) === 0 ? 0 : 1) : current.status,
        id,
      ]
    );

    return res.json({
      success: true,
      message: 'Chatbot intent updated successfully.',
      intent: rows[0],
    });
  } catch (err) {
    console.error('Update Chatbot Intent Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update chatbot intent.' });
  }
}

/**
 * DELETE /api/admin/chatbot-intents/:id
 * Delete a chatbot intent
 */
export async function deleteChatbotIntent(req, res) {
  try {
    const { id } = req.params;

    const delRes = await db.query('DELETE FROM chatbot_intents WHERE id = $1 RETURNING id, title', [id]);
    if (delRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Chatbot intent not found.' });
    }

    return res.json({
      success: true,
      message: `Chatbot intent "${delRes.rows[0].title}" deleted successfully.`,
      deletedId: delRes.rows[0].id,
    });
  } catch (err) {
    console.error('Delete Chatbot Intent Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete chatbot intent.' });
  }
}

/**
 * PATCH /api/admin/chatbot-intents/:id/status
 * Toggle status of an intent
 */
export async function toggleChatbotIntentStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const { rows } = await db.query(
      `UPDATE chatbot_intents
       SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, title, status`,
      [parseInt(status, 10) === 1 ? 1 : 0, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Chatbot intent not found.' });
    }

    return res.json({
      success: true,
      message: `Status updated to ${rows[0].status === 1 ? 'Active' : 'Inactive'}.`,
      intent: rows[0],
    });
  } catch (err) {
    console.error('Toggle Chatbot Intent Status Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to toggle intent status.' });
  }
}
