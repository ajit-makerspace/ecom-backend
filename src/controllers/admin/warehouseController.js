import db from '../../config/db.js';

// 1. Get All Warehouse Locations
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
      ORDER BY is_default DESC, id ASC`
    );

    return res.json({
      success: true,
      warehouses: rows,
      count: rows.length,
    });
  } catch (err) {
    console.error('Get Warehouses Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve warehouse locations.' });
  }
};

// 2. Get Default / Primary Active Warehouse Location
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
    console.error('Get Default Warehouse Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to retrieve default warehouse.' });
  }
};

// 3. Create a New Warehouse Location
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

  if (!name || !addressLine1 || !city || !state || !postalCode) {
    return res.status(400).json({
      success: false,
      message: 'Warehouse name, address line 1, city, state, and postal code are required.',
    });
  }

  const cleanName = String(name).trim();
  const cleanPickup = shiprocketPickupLocation ? String(shiprocketPickupLocation).trim() : cleanName;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Check duplicate name
    const { rows: duplicate } = await client.query(
      'SELECT id FROM public.warehouse_locations WHERE LOWER(name) = LOWER($1)',
      [cleanName]
    );
    if (duplicate.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'A warehouse with this name already exists.' });
    }

    // Check if any warehouses exist currently
    const { rows: countRows } = await client.query('SELECT COUNT(*)::int AS count FROM public.warehouse_locations');
    const isFirst = (countRows[0]?.count || 0) === 0;
    const shouldBeDefault = Boolean(isDefault) || isFirst;

    if (shouldBeDefault) {
      await client.query('UPDATE public.warehouse_locations SET is_default = FALSE WHERE is_default = TRUE');
    }

    const { rows } = await client.query(
      `INSERT INTO public.warehouse_locations (
        name, contact_name, phone, address_line1, address_line2,
        city, state, postal_code, country, shiprocket_pickup_location,
        is_default, is_active, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      RETURNING 
        id, name, contact_name AS "contactName", phone,
        address_line1 AS "addressLine1", address_line2 AS "addressLine2",
        city, state, postal_code AS "postalCode", country,
        shiprocket_pickup_location AS "shiprocketPickupLocation",
        is_default AS "isDefault", is_active AS "isActive", created_at AS "createdAt"`,
      [
        cleanName,
        contactName ? String(contactName).trim() : null,
        phone ? String(phone).trim() : null,
        String(addressLine1).trim(),
        addressLine2 ? String(addressLine2).trim() : null,
        String(city).trim(),
        String(state).trim(),
        String(postalCode).trim(),
        String(country).trim(),
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
    console.error('Create Warehouse Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create warehouse location.' });
  } finally {
    client.release();
  }
};

// 4. Update Warehouse Location
export const updateWarehouse = async (req, res) => {
  const { id } = req.params;
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
      'SELECT id, is_default, is_active FROM public.warehouse_locations WHERE id = $1',
      [id]
    );

    if (existingRows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Warehouse location not found.' });
    }

    // Check duplicate name
    if (name) {
      const { rows: dup } = await client.query(
        'SELECT id FROM public.warehouse_locations WHERE LOWER(name) = LOWER($1) AND id != $2',
        [String(name).trim(), id]
      );
      if (dup.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ success: false, message: 'Another warehouse with this name already exists.' });
      }
    }

    if (isDefault) {
      await client.query('UPDATE public.warehouse_locations SET is_default = FALSE WHERE is_default = TRUE');
    }

    const { rows } = await client.query(
      `UPDATE public.warehouse_locations
       SET name = COALESCE($1, name),
           contact_name = COALESCE($2, contact_name),
           phone = COALESCE($3, phone),
           address_line1 = COALESCE($4, address_line1),
           address_line2 = COALESCE($5, address_line2),
           city = COALESCE($6, city),
           state = COALESCE($7, state),
           postal_code = COALESCE($8, postal_code),
           country = COALESCE($9, country),
           shiprocket_pickup_location = COALESCE($10, shiprocket_pickup_location),
           is_default = COALESCE($11, is_default),
           is_active = COALESCE($12, is_active),
           updated_at = NOW()
       WHERE id = $13
       RETURNING 
         id, name, contact_name AS "contactName", phone,
         address_line1 AS "addressLine1", address_line2 AS "addressLine2",
         city, state, postal_code AS "postalCode", country,
         shiprocket_pickup_location AS "shiprocketPickupLocation",
         is_default AS "isDefault", is_active AS "isActive", updated_at AS "updatedAt"`,
      [
        name ? String(name).trim() : null,
        contactName !== undefined ? (contactName ? String(contactName).trim() : null) : null,
        phone !== undefined ? (phone ? String(phone).trim() : null) : null,
        addressLine1 ? String(addressLine1).trim() : null,
        addressLine2 !== undefined ? (addressLine2 ? String(addressLine2).trim() : null) : null,
        city ? String(city).trim() : null,
        state ? String(state).trim() : null,
        postalCode ? String(postalCode).trim() : null,
        country ? String(country).trim() : null,
        shiprocketPickupLocation ? String(shiprocketPickupLocation).trim() : null,
        isDefault !== undefined ? Boolean(isDefault) : null,
        isActive !== undefined ? Boolean(isActive) : null,
        id,
      ]
    );

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: 'Warehouse location updated successfully.',
      warehouse: rows[0],
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Update Warehouse Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update warehouse location.' });
  } finally {
    client.release();
  }
};

// 5. Set Warehouse as Default
export const setDefaultWarehouse = async (req, res) => {
  const { id } = req.params;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT id, name FROM public.warehouse_locations WHERE id = $1', [id]);
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Warehouse location not found.' });
    }

    await client.query('UPDATE public.warehouse_locations SET is_default = FALSE WHERE is_default = TRUE');
    await client.query('UPDATE public.warehouse_locations SET is_default = TRUE, is_active = TRUE, updated_at = NOW() WHERE id = $1', [id]);

    await client.query('COMMIT');

    return res.json({
      success: true,
      message: `"${rows[0].name}" is now set as the default fulfillment warehouse.`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Set Default Warehouse Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to set default warehouse.' });
  } finally {
    client.release();
  }
};

// 6. Delete Warehouse Location
export const deleteWarehouse = async (req, res) => {
  try {
    const { id } = req.params;

    const { rows } = await db.query(
      'SELECT id, name, is_default FROM public.warehouse_locations WHERE id = $1',
      [id]
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

    await db.query('DELETE FROM public.warehouse_locations WHERE id = $1', [id]);

    return res.json({
      success: true,
      message: `Warehouse "${rows[0].name}" deleted successfully.`,
    });
  } catch (err) {
    console.error('Delete Warehouse Error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete warehouse location.' });
  }
};
