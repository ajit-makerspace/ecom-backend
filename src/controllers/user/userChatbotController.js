import db from '../../config/db.js';

/**
 * GET /api/user/chatbot-intents
 * Returns active chatbot FAQ intents for storefront users
 */
export async function getStoreChatbotIntents(req, res) {
  try {
    const { category, search } = req.query;

    let query = `
      SELECT 
        id,
        category,
        title,
        answer,
        keywords,
        action_label AS "actionLabel",
        action_url AS "actionUrl",
        sort_order AS "sortOrder"
      FROM chatbot_intents
      WHERE status = 1
    `;
    const params = [];

    if (category && category !== 'ALL') {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      query += ` AND (
        LOWER(title) LIKE $${params.length} OR 
        LOWER(answer) LIKE $${params.length} OR 
        $${params.length} = ANY(SELECT LOWER(unnest(keywords)))
      )`;
    }

    query += ' ORDER BY sort_order ASC, id ASC';

    const { rows } = await db.query(query, params);

    // Get active categories
    const catRes = await db.query(
      'SELECT DISTINCT category FROM chatbot_intents WHERE status = 1 ORDER BY category ASC'
    );
    const categories = catRes.rows.map((r) => r.category);

    return res.json({
      success: true,
      categories,
      intents: rows,
    });
  } catch (err) {
    console.error('Storefront Chatbot Intents Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load chatbot responses.' });
  }
}
