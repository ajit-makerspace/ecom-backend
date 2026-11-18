import db from '../../config/db.js';

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
