import db from '../../config/db.js';

// Helper: Sanitize & validate postal code
function sanitizePostalCode(val) {
  if (!val) return '';
  return String(val).trim().toUpperCase();
}

// Helper: Sanitize phone
function sanitizePhone(val) {
  if (!val) return null;
  const clean = String(val).trim();
  return clean.length > 0 ? clean.slice(0, 50) : null;
}

/**
 * 1. Get All Warehouse Locations (Admin)
 * GET /api/admin/warehouses
 */
export const getWarehouses = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT 
        id,
        name,
        contact_name AS "contactName",
        phone,
        address_line1 AS "addressLine1",
        address_line2 AS "addressLine2",
        city,
        state,
        postal_code AS "postalCode",
        country,
        shiprocket_pickup_location AS "shiprocketPickupLocation",
        is_default AS "isDefault",
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM public.warehouse_locations
      ORDER BY is_default DESC, is_active DESC, id ASC`
    );

    return res.json({
      success: true,
      warehouses: rows,
      count: rows.length,
    });
  } catch (err) {
    console.error('[Get Warehouses Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve warehouse locations.' });
  }
};

/**
 * 2. Get Single Warehouse by ID
 * GET /api/admin/warehouses/:id
 */
export const getWarehouseById = async (req, res) => {
  try {
    const whId = parseInt(req.params.id, 10);
    if (!whId || isNaN(whId)) {
      return res.status(400).json({ success: false, message: 'Invalid warehouse ID.' });
    }

    const { rows } = await db.query(
      `SELECT 
        id,
        name,
        contact_name AS "contactName",
        phone,
        address_line1 AS "addressLine1",
        address_line2 AS "addressLine2",
        city,
        state,
        postal_code AS "postalCode",
        country,
        shiprocket_pickup_location AS "shiprocketPickupLocation",
        is_default AS "isDefault",
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM public.warehouse_locations
      WHERE id = $1`,
      [whId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Warehouse location not found.' });
    }

    return res.json({
      success: true,
      warehouse: rows[0],
    });
  } catch (err) {
    console.error('[Get Warehouse By ID Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve warehouse location.' });
  }
};

/**
 * 3. Get Default / Primary Active Warehouse Location (Public / Storefront)
 * GET /api/admin/warehouses/default or /api/user/warehouse/default
 */
export const getDefaultWarehouse = async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT 
        id,
        name,
        contact_name AS "contactName",
        phone,
        address_line1 AS "addressLine1",
        address_line2 AS "addressLine2",
        city,
        state,
        postal_code AS "postalCode",
        country,
        shiprocket_pickup_location AS "shiprocketPickupLocation",
        is_default AS "isDefault",
        is_active AS "isActive"
      FROM public.warehouse_locations
      WHERE is_active = TRUE
      ORDER BY is_default DESC, id ASC
      LIMIT 1`
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'No active warehouse location found.' });
    }

    const wh = rows[0];
    const parts = [];
    if (wh.addressLine1) parts.push(wh.addressLine1.trim());
    if (wh.addressLine2) parts.push(wh.addressLine2.trim());

    const a1 = (wh.addressLine1 || '').toLowerCase();
    const c = (wh.city || '').trim();
    const cLower = c.toLowerCase();
    if (c && !a1.includes(cLower) && !(a1.includes('noida') && cLower.includes('gautam budh nagar'))) {
      parts.push(c);
    }
    if (wh.state) parts.push(wh.state.trim());
    if (wh.postalCode) parts.push(wh.postalCode.trim());

    const formattedAddress = parts.join(', ');

    let displayPhone = wh.phone ? String(wh.phone).trim() : '';
    if (!displayPhone || displayPhone.includes('YOUR_WAREHOUSE_PHONE') || displayPhone.length < 5) {
      displayPhone = '1800 120 5900';
    }

    return res.json({
      success: true,
      warehouse: {
        ...wh,
        phone: displayPhone,
        formattedAddress,
      },
    });
  } catch (err) {
    console.error('[Get Default Warehouse Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve default warehouse.' });
  }
};

/**
 * 4. Create a New Warehouse Location
 * POST /api/admin/warehouses
 */
export const createWarehouse = async (req, res) => {
  const {
    name,
    contactName,
    phone,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country = 'India',
    shiprocketPickupLocation,
    isDefault = false,
    isActive = true,
  } = req.body;

  // Strict validation on required fields
  if (!name || !String(name).trim()) {
    return res.status(400).json({ success: false, message: 'Warehouse name is required.' });
  }
  if (!addressLine1 || !String(addressLine1).trim()) {
    return res.status(400).json({ success: false, message: 'Address Line 1 is required.' });
  }
  if (!city || !String(city).trim()) {
    return res.status(400).json({ success: false, message: 'City is required.' });
  }
  if (!state || !String(state).trim()) {
    return res.status(400).json({ success: false, message: 'State is required.' });
  }
  if (!postalCode || !String(postalCode).trim()) {
    return res.status(400).json({ success: false, message: 'Postal code (PIN) is required.' });
  }

  const cleanName = String(name).trim().slice(0, 255);
  const cleanPostal = sanitizePostalCode(postalCode).slice(0, 20);
  const cleanPhone = sanitizePhone(phone);
  const cleanAddress1 = String(addressLine1).trim();
  const cleanAddress2 = addressLine2 && String(addressLine2).trim() ? String(addressLine2).trim() : null;
  const cleanCity = String(city).trim().slice(0, 100);
  const cleanState = String(state).trim().slice(0, 100);
  const cleanCountry = country && String(country).trim() ? String(country).trim().slice(0, 100) : 'India';
  const cleanPickup = shiprocketPickupLocation && String(shiprocketPickupLocation).trim()
    ? String(shiprocketPickupLocation).trim().slice(0, 150)
    : cleanName.slice(0, 150);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Duplicate name guard (case-insensitive)
    const { rows: duplicate } = await client.query(
      'SELECT id FROM public.warehouse_locations WHERE LOWER(name) = LOWER($1)',
      [cleanName]
    );
    if (duplicate.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: `A warehouse with name "${cleanName}" already exists.` });
    }

    // Check count: if this is the first warehouse, it MUST be default
    const { rows: countRows } = await client.query('SELECT COUNT(*)::int AS count FROM public.warehouse_locations');
    const isFirst = (countRows[0]?.count || 0) === 0;
    const shouldBeDefault = Boolean(isDefault) || isFirst;

    if (shouldBeDefault) {
      await client.query('UPDATE public.warehouse_locations SET is_default = FALSE WHERE is_default = TRUE');
    }

    const { rows } = await client.query(
      `INSERT INTO public.warehouse_locations (
        name,
        contact_name,
        phone,
        address_line1,
        address_line2,
        city,
        state,
        postal_code,
        country,
        shiprocket_pickup_location,
        is_default,
        is_active,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      RETURNING 
        id,
        name,
        contact_name AS "contactName",
        phone,
        address_line1 AS "addressLine1",
        address_line2 AS "addressLine2",
        city,
        state,
        postal_code AS "postalCode",
        country,
        shiprocket_pickup_location AS "shiprocketPickupLocation",
        is_default AS "isDefault",
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"`,
      [
        cleanName,
        contactName && String(contactName).trim() ? String(contactName).trim().slice(0, 150) : null,
        cleanPhone,
        cleanAddress1,
        cleanAddress2,
        cleanCity,
        cleanState,
        cleanPostal,
        cleanCountry,
        cleanPickup,
        shouldBeDefault,
        Boolean(isActive),
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      success: true,
      message: 'Warehouse location created successfully.',
      warehouse: rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Create Warehouse Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to create warehouse location.' });
  } finally {
    client.release();
  }
};

/**
 * 5. Update Warehouse Location
 * PUT /api/admin/warehouses/:id
 */
export const updateWarehouse = async (req, res) => {
  const whId = parseInt(req.params.id, 10);
  if (!whId || isNaN(whId)) {
    return res.status(400).json({ success: false, message: 'Invalid warehouse ID.' });
  }

  const {
    name,
    contactName,
    phone,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    country,
    shiprocketPickupLocation,
    isDefault,
    isActive,
  } = req.body;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: existingRows } = await client.query(
      'SELECT id, name, is_default, is_active FROM public.warehouse_locations WHERE id = $1',
      [whId]
    );

    if (existingRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Warehouse location not found.' });
    }

    const currentWarehouse = existingRows[0];

    // Check duplicate name if name is provided and changed
    if (name && String(name).trim().toLowerCase() !== currentWarehouse.name.toLowerCase()) {
      const cleanName = String(name).trim();
      const { rows: dup } = await client.query(
        'SELECT id FROM public.warehouse_locations WHERE LOWER(name) = LOWER($1) AND id != $2',
        [cleanName, whId]
      );
      if (dup.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: `Another warehouse with name "${cleanName}" already exists.` });
      }
    }

    // Default status logic
    let shouldBeDefault = currentWarehouse.is_default;
    if (isDefault !== undefined) {
      if (isDefault) {
        // Setting this warehouse as default -> unset all others
        await client.query('UPDATE public.warehouse_locations SET is_default = FALSE WHERE is_default = TRUE');
        shouldBeDefault = true;
      } else if (currentWarehouse.is_default) {
        // Trying to unset default on the current default warehouse
        const { rows: countRows } = await client.query('SELECT COUNT(*)::int AS count FROM public.warehouse_locations');
        if ((countRows[0]?.count || 0) > 1) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            success: false,
            message: 'Cannot unset default status directly. Please set another warehouse as default instead.',
          });
        }
        // If it's the only warehouse, it must remain default
        shouldBeDefault = true;
      }
    }

    // Dynamic field building to avoid COALESCE clearing issues
    const updates = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(String(name).trim().slice(0, 255));
    }
    if (contactName !== undefined) {
      updates.push(`contact_name = $${idx++}`);
      values.push(contactName && String(contactName).trim() ? String(contactName).trim().slice(0, 150) : null);
    }
    if (phone !== undefined) {
      updates.push(`phone = $${idx++}`);
      values.push(sanitizePhone(phone));
    }
    if (addressLine1 !== undefined) {
      updates.push(`address_line1 = $${idx++}`);
      values.push(String(addressLine1).trim());
    }
    if (addressLine2 !== undefined) {
      updates.push(`address_line2 = $${idx++}`);
      values.push(addressLine2 && String(addressLine2).trim() ? String(addressLine2).trim() : null);
    }
    if (city !== undefined) {
      updates.push(`city = $${idx++}`);
      values.push(String(city).trim().slice(0, 100));
    }
    if (state !== undefined) {
      updates.push(`state = $${idx++}`);
      values.push(String(state).trim().slice(0, 100));
    }
    if (postalCode !== undefined) {
      updates.push(`postal_code = $${idx++}`);
      values.push(sanitizePostalCode(postalCode).slice(0, 20));
    }
    if (country !== undefined) {
      updates.push(`country = $${idx++}`);
      values.push(country && String(country).trim() ? String(country).trim().slice(0, 100) : 'India');
    }
    if (shiprocketPickupLocation !== undefined) {
      const pickVal = shiprocketPickupLocation && String(shiprocketPickupLocation).trim()
        ? String(shiprocketPickupLocation).trim().slice(0, 150)
        : (name ? String(name).trim().slice(0, 150) : currentWarehouse.name.slice(0, 150));
      updates.push(`shiprocket_pickup_location = $${idx++}`);
      values.push(pickVal);
    }
    if (isDefault !== undefined) {
      updates.push(`is_default = $${idx++}`);
      values.push(shouldBeDefault);
    }
    if (isActive !== undefined) {
      updates.push(`is_active = $${idx++}`);
      values.push(Boolean(isActive));
    }

    updates.push(`updated_at = NOW()`);

    values.push(whId);
    const idIdx = idx;

    const { rows } = await client.query(
      `UPDATE public.warehouse_locations
       SET ${updates.join(', ')}
       WHERE id = $${idIdx}
       RETURNING 
         id,
         name,
         contact_name AS "contactName",
         phone,
         address_line1 AS "addressLine1",
         address_line2 AS "addressLine2",
         city,
         state,
         postal_code AS "postalCode",
         country,
         shiprocket_pickup_location AS "shiprocketPickupLocation",
         is_default AS "isDefault",
         is_active AS "isActive",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      values
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: 'Warehouse location updated successfully.',
      warehouse: rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Update Warehouse Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to update warehouse location.' });
  } finally {
    client.release();
  }
};

/**
 * 6. Set Warehouse as Default
 * PATCH /api/admin/warehouses/:id/default
 */
export const setDefaultWarehouse = async (req, res) => {
  const whId = parseInt(req.params.id, 10);
  if (!whId || isNaN(whId)) {
    return res.status(400).json({ success: false, message: 'Invalid warehouse ID.' });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT id, name FROM public.warehouse_locations WHERE id = $1', [whId]);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Warehouse location not found.' });
    }

    // Set all others to false
    await client.query('UPDATE public.warehouse_locations SET is_default = FALSE WHERE is_default = TRUE');
    // Set target to true & activate it
    await client.query(
      'UPDATE public.warehouse_locations SET is_default = TRUE, is_active = TRUE, updated_at = NOW() WHERE id = $1',
      [whId]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: `"${rows[0].name}" is now set as the primary fulfillment warehouse.`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Set Default Warehouse Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to set default warehouse.' });
  } finally {
    client.release();
  }
};

/**
 * 7. Delete Warehouse Location
 * DELETE /api/admin/warehouses/:id
 */
export const deleteWarehouse = async (req, res) => {
  try {
    const whId = parseInt(req.params.id, 10);
    if (!whId || isNaN(whId)) {
      return res.status(400).json({ success: false, message: 'Invalid warehouse ID.' });
    }

    const { rows } = await db.query(
      'SELECT id, name, is_default FROM public.warehouse_locations WHERE id = $1',
      [whId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Warehouse location not found.' });
    }

    if (rows[0].is_default) {
      const { rows: countRows } = await db.query('SELECT COUNT(*)::int AS count FROM public.warehouse_locations');
      if ((countRows[0]?.count || 0) > 1) {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete the default warehouse. Please set another warehouse as default first.',
        });
      }
    }

    await db.query('DELETE FROM public.warehouse_locations WHERE id = $1', [whId]);

    return res.json({
      success: true,
      message: `Warehouse "${rows[0].name}" deleted successfully.`,
    });
  } catch (err) {
    console.error('[Delete Warehouse Error]:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete warehouse location.' });
  }
};
