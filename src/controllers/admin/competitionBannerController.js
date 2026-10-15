
import db from '../../config/db.js';

const VIDEO_EXT = /\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i;

const BANNER_COLUMNS = `
  id,
  title,
  subtitle AS "description",
  cta_text AS "ctaText",
  cta_link AS "ctaLink",
  media_type AS "mediaType",
  image_url AS "imageUrl",
  video_url AS "videoUrl",
  sort_order AS "sortOrder",
  status,
  banner_type AS "bannerType",
  starts_at AS "startsAt",
  ends_at AS "endsAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

const toStatusInt = (status) => {
  if (
    status === 1 ||
    status === '1' ||
    status === true ||
    String(status).toLowerCase() === 'active'
  ) {
    return 1;
  }

  return 0;
};

const resolveMedia = ({ mediaType, imageUrl, videoUrl }) => {
  const img = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  let vid = typeof videoUrl === 'string' ? videoUrl.trim() : '';

  let type;

  if (mediaType) {
    if (!['image', 'video'].includes(String(mediaType).toLowerCase())) {
      return { error: 'Media type must be image or video.' };
    }

    type = String(mediaType).toLowerCase();
  } else {
    type = vid || VIDEO_EXT.test(img) ? 'video' : 'image';
  }

  if (type === 'video') {
    let poster = img;

    if (!vid && VIDEO_EXT.test(img)) {
      vid = img;
      poster = '';
    }

    if (!vid) {
      return { error: 'Banner video URL is required.' };
    }

    return {
      mediaType: 'video',
      imageUrl: poster || null,
      videoUrl: vid,
    };
  }

  if (!img) {
    return { error: 'Banner image URL is required.' };
  }

  return {
    mediaType: 'image',
    imageUrl: img,
    videoUrl: null,
  };
};

const formatBanner = (banner) => ({
  ...banner,
  isActive: banner.status === 1,
  status: banner.status === 1 ? 'Active' : 'Inactive',
});

/* -------------------------------------------------------
   GET /api/admin/competition-banners
------------------------------------------------------- */
export const getCompetitionBanners = async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT ${BANNER_COLUMNS}
      FROM banners
      WHERE banner_type = 1
        AND status != 2
      ORDER BY sort_order ASC, id DESC
    `);

    return res.json({
      success: true,
      count: rows.length,
      banners: rows.map(formatBanner),
    });
  } catch (err) {
    console.error('Get Competition Banners Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch competition banners.',
    });
  }
};

/* -------------------------------------------------------
   POST /api/admin/competition-banners
------------------------------------------------------- */
export const createCompetitionBanner = async (req, res) => {
  let client;

  try {
    const {
      title,
      description,
      subtitle,
      ctaText,
      ctaLabel,
      ctaLink,
      ctaUrl,
      mediaType,
      imageUrl,
      videoUrl,
      sortOrder,
      status,
      isActive,
    } = req.body;

    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Banner title is required.',
      });
    }

    const media = resolveMedia({ mediaType, imageUrl, videoUrl });

    if (media.error) {
      return res.status(400).json({
        success: false,
        message: media.error,
      });
    }

    const statusInt =
      isActive !== undefined
        ? toStatusInt(isActive)
        : status !== undefined
          ? toStatusInt(status)
          : 0;

    const parsedOrder = Number.parseInt(sortOrder, 10);
    const orderInt = Number.isNaN(parsedOrder) ? 0 : parsedOrder;

    client = await db.pool.connect();

    await client.query('BEGIN');

    // Serialize active-banner changes.
    await client.query('SELECT pg_advisory_xact_lock($1)', [721041]);

    // Deactivate any other active competition banner.
    if (statusInt === 1) {
      await client.query(
        `UPDATE banners
         SET status = 0,
             updated_at = NOW()
         WHERE banner_type = 1
           AND status = 1`
      );
    }

    const { rows } = await client.query(
      `INSERT INTO banners (
        title,
        subtitle,
        cta_text,
        cta_link,
        media_type,
        image_url,
        video_url,
        sort_order,
        status,
        banner_type,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, NOW())
      RETURNING ${BANNER_COLUMNS}`,
      [
        title.trim(),
        description ?? subtitle ?? '',
        ctaText ?? ctaLabel ?? 'Register Now',
        ctaLink ?? ctaUrl ?? '',
        media.mediaType,
        media.imageUrl,
        media.videoUrl,
        orderInt,
        statusInt,
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Competition banner created successfully.',
      banner: formatBanner(rows[0]),
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Create Competition Banner Rollback Error:', rollbackError);
      }
    }

    console.error('Create Competition Banner Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to create competition banner.',
    });
  } finally {
    client?.release();
  }
};

/* -------------------------------------------------------
   PUT /api/admin/competition-banners/:id
------------------------------------------------------- */
export const updateCompetitionBanner = async (req, res) => {
  let client;

  try {
    const { id } = req.params;

    const {
      title,
      description,
      subtitle,
      ctaText,
      ctaLabel,
      ctaLink,
      ctaUrl,
      mediaType,
      imageUrl,
      videoUrl,
      sortOrder,
      status,
      isActive,
    } = req.body;

    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Banner title is required.',
      });
    }

    const media = resolveMedia({ mediaType, imageUrl, videoUrl });

    if (media.error) {
      return res.status(400).json({
        success: false,
        message: media.error,
      });
    }

    const parsedOrder = Number.parseInt(sortOrder, 10);
    const orderInt = Number.isNaN(parsedOrder) ? 0 : parsedOrder;

    client = await db.pool.connect();

    await client.query('BEGIN');

    await client.query('SELECT pg_advisory_xact_lock($1)', [721041]);

    const existing = await client.query(
      `SELECT id, status
       FROM banners
       WHERE id = $1
         AND banner_type = 1
         AND status != 2
       FOR UPDATE`,
      [id]
    );

    if (existing.rowCount === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        success: false,
        message: 'Competition banner not found.',
      });
    }

    // Preserve the existing status if the request doesn't include one.
    const statusInt =
      isActive !== undefined
        ? toStatusInt(isActive)
        : status !== undefined
          ? toStatusInt(status)
          : existing.rows[0].status;

    // Only one competition banner may be active at a time.
    if (statusInt === 1) {
      await client.query(
        `UPDATE banners
         SET status = 0,
             updated_at = NOW()
         WHERE banner_type = 1
           AND status = 1
           AND id != $1`,
        [id]
      );
    }

    const { rows } = await client.query(
      `UPDATE banners
       SET title = $1,
           subtitle = $2,
           cta_text = $3,
           cta_link = $4,
           media_type = $5,
           image_url = $6,
           video_url = $7,
           sort_order = $8,
           status = $9,
           updated_at = NOW()
       WHERE id = $10
         AND banner_type = 1
         AND status != 2
       RETURNING ${BANNER_COLUMNS}`,
      [
        title.trim(),
        description ?? subtitle ?? '',
        ctaText ?? ctaLabel ?? 'Register Now',
        ctaLink ?? ctaUrl ?? '',
        media.mediaType,
        media.imageUrl,
        media.videoUrl,
        orderInt,
        statusInt,
        id,
      ]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: 'Competition banner updated successfully.',
      banner: formatBanner(rows[0]),
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Update Competition Banner Rollback Error:', rollbackError);
      }
    }

    console.error('Update Competition Banner Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to update competition banner.',
    });
  } finally {
    client?.release();
  }
};

/* -------------------------------------------------------
   PATCH /api/admin/competition-banners/:id/status
------------------------------------------------------- */
export const updateCompetitionBannerStatus = async (req, res) => {
  let client;

  try {
    const { id } = req.params;
    const { status, isActive } = req.body;

    if (status === undefined && isActive === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Provide status or isActive.',
      });
    }

    const statusInt =
      isActive !== undefined
        ? toStatusInt(isActive)
        : toStatusInt(status);

    client = await db.pool.connect();

    await client.query('BEGIN');

    await client.query('SELECT pg_advisory_xact_lock($1)', [721041]);

    const existing = await client.query(
      `SELECT id
       FROM banners
       WHERE id = $1
         AND banner_type = 1
         AND status != 2
       FOR UPDATE`,
      [id]
    );

    if (existing.rowCount === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        success: false,
        message: 'Competition banner not found.',
      });
    }

    // Deactivate other banners before activating this one.
    if (statusInt === 1) {
      await client.query(
        `UPDATE banners
         SET status = 0,
             updated_at = NOW()
         WHERE banner_type = 1
           AND status = 1
           AND id != $1`,
        [id]
      );
    }

    const { rows } = await client.query(
      `UPDATE banners
       SET status = $1,
           updated_at = NOW()
       WHERE id = $2
         AND banner_type = 1
         AND status != 2
       RETURNING ${BANNER_COLUMNS}`,
      [statusInt, id]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: 'Competition banner status updated successfully.',
      banner: formatBanner(rows[0]),
    });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Update Competition Banner Status Rollback Error:', rollbackError);
      }
    }

    console.error('Update Competition Banner Status Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to update competition banner status.',
    });
  } finally {
    client?.release();
  }
};

/* -------------------------------------------------------
   DELETE /api/admin/competition-banners/:id
   Soft delete: status = 2
------------------------------------------------------- */
export const deleteCompetitionBanner = async (req, res) => {
  try {
    const { id } = req.params;

    const { rowCount } = await db.query(
      `UPDATE banners
       SET status = 2,
           updated_at = NOW()
       WHERE id = $1
         AND banner_type = 1
         AND status != 2`,
      [id]
    );

    if (rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Competition banner not found or already deleted.',
      });
    }

    return res.json({
      success: true,
      message: 'Competition banner deleted successfully.',
      id: Number(id),
    });
  } catch (err) {
    console.error('Delete Competition Banner Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to delete competition banner.',
    });
  }
};

/* -------------------------------------------------------
   GET /api/competition-banners/active
   Public storefront API
------------------------------------------------------- */
export const getActiveCompetitionBanner = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT ${BANNER_COLUMNS}
       FROM banners
       WHERE banner_type = 1
         AND status = 1
         AND (starts_at IS NULL OR starts_at <= NOW())
         AND (ends_at IS NULL OR ends_at >= NOW())
       ORDER BY updated_at DESC, id DESC
       LIMIT 1`
    );

    return res.json({
      success: true,
      banner: rows[0] ? formatBanner(rows[0]) : null,
    });
  } catch (err) {
    console.error('Get Active Competition Banner Error:', err);

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch active competition banner.',
    });
  }
};



// competition details ---



// Convert PostgreSQL column names to the camelCase fields
// already used by your React Competitions admin page.
const formatCompetition = (row) => ({
  id: String(row.id),
  title: row.title,
  status: row.status,
  category: row.category,
  description: row.description,
  longDescription: row.long_description,
  eligibility: row.eligibility,
  gradeLevel: row.grade_level,
  image: row.image_url,
  imageAlt: row.image_alt,
  duration: row.duration,
  teamSize: row.team_size,
  registrationDeadline: row.registration_deadline,
  eventDate: row.event_date,
  prize: row.prize,
  location: row.location,
  rules: row.rules || [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const competitionColumns = `
  id,
  title,
  status,
  category,
  description,
  long_description,
  eligibility,
  grade_level,
  image_url,
  image_alt,
  duration,
  team_size,
  registration_deadline,
  event_date,
  prize,
  location,
  rules,
  created_at,
  updated_at
`;

const allowedStatuses = [
  "Registrations Open",
  "Upcoming",
  "Closed",
];

const allowedCategories = [
  "Robotics",
  "Coding",
  "Engineering",
  "Design",
];

const allowedGrades = [
  "Grades 6–8",
  "Grades 9–12",
  "University",
];

const validateCompetition = (body) => {
  const errors = [];

  if (!body.title?.trim()) {
    errors.push("Title is required.");
  }

  if (!body.description?.trim()) {
    errors.push("Short description is required.");
  }

  if (!allowedStatuses.includes(body.status)) {
    errors.push("Invalid competition status.");
  }

  if (!allowedCategories.includes(body.category)) {
    errors.push("Invalid competition category.");
  }

  if (!allowedGrades.includes(body.gradeLevel)) {
    errors.push("Invalid grade level.");
  }

  if (
    body.rules !== undefined &&
    (!Array.isArray(body.rules) ||
      !body.rules.every((rule) => typeof rule === "string"))
  ) {
    errors.push("Rules must be an array of strings.");
  }

  return errors;
};

// GET /api/admin/competitions
export const getCompetitions = async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT ${competitionColumns}
      FROM competitions
      ORDER BY created_at DESC, id DESC
    `);

    return res.status(200).json({
      success: true,
      data: result.rows.map(formatCompetition),
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/admin/competitions/:id
export const getCompetitionById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid competition ID.",
      });
    }

    const result = await db.query(
      `SELECT ${competitionColumns}
       FROM competitions
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Competition not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: formatCompetition(result.rows[0]),
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/admin/competitions
export const createCompetition = async (req, res, next) => {
  try {
    const errors = validateCompetition(req.body);

    if (errors.length) {
      return res.status(400).json({
        success: false,
        message: errors.join(" "),
      });
    }

    const body = req.body;

    const rules = (body.rules || [])
      .filter((rule) => rule.trim() !== "");

    const values = [
      body.title.trim(),
      body.status,
      body.category,
      body.description.trim(),
      body.longDescription || "",
      body.eligibility || "",
      body.gradeLevel,
      body.image || "",
      body.imageAlt || "",
      body.duration || "",
      body.teamSize || "",
      body.registrationDeadline || "",
      body.eventDate || "",
      body.prize || "",
      body.location || "",
      JSON.stringify(rules),
    ];

    const result = await db.query(
      `INSERT INTO competitions (
        title,
        status,
        category,
        description,
        long_description,
        eligibility,
        grade_level,
        image_url,
        image_alt,
        duration,
        team_size,
        registration_deadline,
        event_date,
        prize,
        location,
        rules
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15,
        $16::jsonb
      )
      RETURNING ${competitionColumns}`,
      values
    );

    return res.status(201).json({
      success: true,
      message: "Competition created successfully.",
      data: formatCompetition(result.rows[0]),
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/admin/competitions/:id
export const updateCompetition = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid competition ID.",
      });
    }

    const errors = validateCompetition(req.body);

    if (errors.length) {
      return res.status(400).json({
        success: false,
        message: errors.join(" "),
      });
    }

    const body = req.body;

    const rules = (body.rules || [])
      .filter((rule) => rule.trim() !== "");

    const values = [
      id,
      body.title.trim(),
      body.status,
      body.category,
      body.description.trim(),
      body.longDescription || "",
      body.eligibility || "",
      body.gradeLevel,
      body.image || "",
      body.imageAlt || "",
      body.duration || "",
      body.teamSize || "",
      body.registrationDeadline || "",
      body.eventDate || "",
      body.prize || "",
      body.location || "",
      JSON.stringify(rules),
    ];

    const result = await db.query(
      `UPDATE competitions
       SET
         title = $2,
         status = $3,
         category = $4,
         description = $5,
         long_description = $6,
         eligibility = $7,
         grade_level = $8,
         image_url = $9,
         image_alt = $10,
         duration = $11,
         team_size = $12,
         registration_deadline = $13,
         event_date = $14,
         prize = $15,
         location = $16,
         rules = $17::jsonb,
         updated_at = NOW()
       WHERE id = $1
       RETURNING ${competitionColumns}`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Competition not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Competition updated successfully.",
      data: formatCompetition(result.rows[0]),
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/admin/competitions/:id
export const deleteCompetition = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid competition ID.",
      });
    }

    const result = await db.query(
      `DELETE FROM competitions
       WHERE id = $1
       RETURNING id, title`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Competition not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Competition deleted successfully.",
      data: result.rows[0],
    });
  } catch (error) {
    next(error);
  }
};
