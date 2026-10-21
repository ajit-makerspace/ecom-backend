
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
const validateCompetitionDates = (competitionDate, registrationStartDate) => {
  const competition = normalizeDate(competitionDate);
  const registration = normalizeDate(registrationStartDate);

  if (!competition || !registration) {
    return null; // Keep invalid/missing-date handling in existing validation
  }

  if (registration > competition) {
    return 'Registration Start Date must be on or before the Competition Date.';
  }

  return null;
};

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

    // if (typeof title !== 'string' || !title.trim()) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Banner title is required.',
    //   });
    // }

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
        // title.trim(),
        // description ?? subtitle ?? '',
        // ctaText ?? ctaLabel ?? 'Register Now',
        // ctaLink ?? ctaUrl ?? '',
        typeof title === 'string' ? title.trim() : '',
typeof description === 'string'
  ? description.trim()
  : typeof subtitle === 'string'
    ? subtitle.trim()
    : '',
typeof ctaText === 'string'
  ? ctaText.trim()
  : typeof ctaLabel === 'string'
    ? ctaLabel.trim()
    : '',
typeof ctaLink === 'string'
  ? ctaLink.trim()
  : typeof ctaUrl === 'string'
    ? ctaUrl.trim()
    : '',
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

    // if (typeof title !== 'string' || !title.trim()) {
    //   return res.status(400).json({
    //     success: false,
    //     message: 'Banner title is required.',
    //   });
    // }

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
        // title.trim(),
        // description ?? subtitle ?? '',
        // ctaText ?? ctaLabel ?? 'Register Now',
        // ctaLink ?? ctaUrl ?? '',
             typeof title === 'string' ? title.trim() : '',
typeof description === 'string'
  ? description.trim()
  : typeof subtitle === 'string'
    ? subtitle.trim()
    : '',
typeof ctaText === 'string'
  ? ctaText.trim()
  : typeof ctaLabel === 'string'
    ? ctaLabel.trim()
    : '',
typeof ctaLink === 'string'
  ? ctaLink.trim()
  : typeof ctaUrl === 'string'
    ? ctaUrl.trim()
    : '',
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

// -------------------------------------------------------
// COMPETITION CRUD
// -------------------------------------------------------

const formatCompetition = (row) => ({
  id: String(row.id),
  title: row.title,
  competitionDate: row.competition_date,
  registrationStartDate: row.registration_start_date,
  topic: row.topic,
  advisorOrganizer: row.advisor_organizer,
  competitionUrl: row.competition_url,
  overview: row.overview,
  objective: row.objective,
  participants: row.participants,
  imageUrl: row.image_url,
  isActive: row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const competitionColumns = `
  id,
  title,
  competition_date,
  registration_start_date,
  topic,
  advisor_organizer,
  competition_url,
  overview,
  objective,
  participants,
  image_url,
  is_active,
  created_at,
  updated_at
`;

// -------------------------------------------------------
// VALIDATION AND NORMALIZATION HELPERS
// -------------------------------------------------------

const isValidDate = (value) => {
  if (value === undefined || value === null || value === '') {
    return true;
  }

  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
};

const normalizeDate = (value) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return value;
};

const normalizeText = (value) => {
  if (value === undefined || value === null) {
    return '';
  }

  return typeof value === 'string' ? value.trim() : null;
};

const normalizeActive = (value, defaultValue = true) => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (
    value === true ||
    value === 1 ||
    value === 'true' ||
    value === '1'
  ) {
    return true;
  }

  if (
    value === false ||
    value === 0 ||
    value === 'false' ||
    value === '0'
  ) {
    return false;
  }

  return null;
};

const validateCompetition = (body) => {
  const errors = [];

  if (typeof body.title !== 'string' || !body.title.trim()) {
    errors.push('Competition title is required.');
  } else if (body.title.trim().length > 255) {
    errors.push('Competition title cannot exceed 255 characters.');
  }

  if (
    body.topic !== undefined &&
    body.topic !== null &&
    (typeof body.topic !== 'string' || body.topic.length > 255)
  ) {
    errors.push('Topic must be text with a maximum of 255 characters.');
  }

  if (
    body.advisorOrganizer !== undefined &&
    body.advisorOrganizer !== null &&
    (
      typeof body.advisorOrganizer !== 'string' ||
      body.advisorOrganizer.length > 255
    )
  ) {
    errors.push(
      'Advisor/Organizer must be text with a maximum of 255 characters.'
    );
  }

  if (
    !isValidDate(body.competitionDate) ||
    !isValidDate(body.registrationStartDate)
  ) {
    errors.push('Please provide valid dates in YYYY-MM-DD format.');
  }

  const activeValue =
    body.isActive !== undefined ? body.isActive : body.is_active;

  if (
    activeValue !== undefined &&
    normalizeActive(activeValue, true) === null
  ) {
    errors.push('Active status must be true or false.');
  }

  const textFields = [
    'competitionUrl',
    'overview',
    'objective',
    'participants',
    'imageUrl',
    'image',
  ];

  for (const field of textFields) {
    if (
      body[field] !== undefined &&
      body[field] !== null &&
      typeof body[field] !== 'string'
    ) {
      errors.push(`${field} must be text.`);
    }
  }

  return errors;
};

// -------------------------------------------------------
// GET /api/admin/competitions
// -------------------------------------------------------

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

// -------------------------------------------------------
// GET /api/admin/competitions/:id
// -------------------------------------------------------

export const getCompetitionById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid competition ID.',
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
        message: 'Competition not found.',
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

// -------------------------------------------------------
// POST /api/admin/competitions
// -------------------------------------------------------

export const createCompetition = async (req, res, next) => {
  try {
    const body = req.body || {};
    const errors = validateCompetition(body);
    const dateError = validateCompetitionDates(
  body.competitionDate ?? body.competition_date,
  body.registrationStartDate ?? body.registration_start_date
);

if (dateError) {
  return res.status(400).json({
    success: false,
    message: dateError,
  });
}

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: errors.join(' '),
      });
    }

    const isActive = normalizeActive(
      body.isActive !== undefined ? body.isActive : body.is_active,
      true
    );

    const imageValue =
      body.imageUrl !== undefined ? body.imageUrl : body.image;

    const values = [
      body.title.trim(),
      normalizeDate(body.competitionDate),
      normalizeDate(body.registrationStartDate),
      normalizeText(body.topic),
      normalizeText(body.advisorOrganizer),
      normalizeText(body.competitionUrl),
      normalizeText(body.overview),
      normalizeText(body.objective),
      normalizeText(body.participants),
      normalizeText(imageValue),
      isActive,
    ];

    if (values.some((value) => value === null)) {
      return res.status(400).json({
        success: false,
        message:
          'Please provide valid text values for the competition fields.',
      });
    }

    const result = await db.query(
      `INSERT INTO competitions (
        title,
        competition_date,
        registration_start_date,
        topic,
        advisor_organizer,
        competition_url,
        overview,
        objective,
        participants,
        image_url,
        is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING ${competitionColumns}`,
      values
    );

    return res.status(201).json({
      success: true,
      message: 'Competition created successfully.',
      data: formatCompetition(result.rows[0]),
    });
  } catch (error) {
    next(error);
  }
};

// -------------------------------------------------------
// PUT /api/admin/competitions/:id
// -------------------------------------------------------

export const updateCompetition = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid competition ID.',
      });
    }

    const body = req.body || {};
    const errors = validateCompetition(body);

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: errors.join(' '),
      });
    }

    // Fetch the existing record so omitted fields can be preserved.
    const existingResult = await db.query(
      `SELECT ${competitionColumns}
       FROM competitions
       WHERE id = $1`,
      [id]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Competition not found.',
      });
    }

    const existing = existingResult.rows[0];

    const pick = (camelValue, snakeValue, existingValue) => {
      if (body[camelValue] !== undefined) {
        return body[camelValue];
      }

      if (snakeValue && body[snakeValue] !== undefined) {
        return body[snakeValue];
      }

      return existingValue;
    };

    const title = body.title !== undefined
      ? body.title.trim()
      : existing.title;

    const competitionDate = normalizeDate(
      pick('competitionDate', 'competition_date', existing.competition_date)
    );

    const registrationStartDate = normalizeDate(
      pick(
        'registrationStartDate',
        'registration_start_date',
        existing.registration_start_date
      )
    );

    const dateError = validateCompetitionDates(
  competitionDate,
  registrationStartDate
);

if (dateError) {
  return res.status(400).json({
    success: false,
    message: dateError,
  });
}

    const topic = normalizeText(
      pick('topic', null, existing.topic)
    );

    const advisorOrganizer = normalizeText(
      pick('advisorOrganizer', 'advisor_organizer', existing.advisor_organizer)
    );

    const competitionUrl = normalizeText(
      pick('competitionUrl', 'competition_url', existing.competition_url)
    );

    const overview = normalizeText(
      pick('overview', null, existing.overview)
    );

    const objective = normalizeText(
      pick('objective', null, existing.objective)
    );

    const participants = normalizeText(
      pick('participants', null, existing.participants)
    );

    // Preserve the existing image when the request doesn't include one.
    // An explicitly supplied empty string clears the image URL.
    const imageInput =
      body.imageUrl !== undefined
        ? body.imageUrl
        : body.image !== undefined
          ? body.image
          : existing.image_url;

    const imageUrl = normalizeText(imageInput);

    const activeInput =
      body.isActive !== undefined
        ? body.isActive
        : body.is_active !== undefined
          ? body.is_active
          : existing.is_active;

    const isActive = normalizeActive(activeInput, existing.is_active);

    const values = [
      id,
      title,
      competitionDate,
      registrationStartDate,
      topic,
      advisorOrganizer,
      competitionUrl,
      overview,
      objective,
      participants,
      imageUrl,
      isActive,
    ];

    if (values.some((value) => value === null)) {
      return res.status(400).json({
        success: false,
        message:
          'Please provide valid text values for the competition fields.',
      });
    }

    const result = await db.query(
      `UPDATE competitions
       SET
         title = $2,
         competition_date = $3,
         registration_start_date = $4,
         topic = $5,
         advisor_organizer = $6,
         competition_url = $7,
         overview = $8,
         objective = $9,
         participants = $10,
         image_url = $11,
         is_active = $12,
         updated_at = NOW()
       WHERE id = $1
       RETURNING ${competitionColumns}`,
      values
    );

    return res.status(200).json({
      success: true,
      message: 'Competition updated successfully.',
      data: formatCompetition(result.rows[0]),
    });
  } catch (error) {
    next(error);
  }
};

// -------------------------------------------------------
// DELETE /api/admin/competitions/:id
// -------------------------------------------------------

export const deleteCompetition = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!/^\d+$/.test(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid competition ID.',
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
        message: 'Competition not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Competition deleted successfully.',
      data: {
        id: String(result.rows[0].id),
        title: result.rows[0].title,
      },
    });
  } catch (error) {
    next(error);
  }
};
