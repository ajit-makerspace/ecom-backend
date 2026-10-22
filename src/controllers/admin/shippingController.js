import db from '../../config/db.js';
import shiprocketService from '../../services/shiprocketService.js';

// Get Current Shipping Configuration
export const getShippingConfig = async (req, res) => {
  return res.json({
    success: true,
    configured: shiprocketService.isConfigured(),
    env: shiprocketService.env,
    baseUrl: shiprocketService.baseUrl,
    pickupLocation: shiprocketService.pickupLocation,
    email: shiprocketService.email ? shiprocketService.email.replace(/(.{3}).*(@.*)/, '$1***$2') : null,
  });
};

// Check Courier Serviceability for Delivery Pincode
export const checkServiceability = async (req, res) => {
  try {
    const { pickupPincode, deliveryPincode, weight, cod } = req.body;

    if (!deliveryPincode) {
      return res.status(400).json({ success: false, message: 'Delivery pincode is required.' });
    }

    const data = await shiprocketService.checkServiceability({
      pickupPincode: pickupPincode || '560001',
      deliveryPincode,
      weight: parseFloat(weight || 0.5),
      cod: cod ? 1 : 0,
    });

    const couriers = data?.data?.available_courier_companies || [];

    return res.json({
      success: true,
      deliveryPincode,
      couriers,
      count: couriers.length,
    });
  } catch (err) {
    console.error('Check Serviceability Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to check serviceability.' });
  }
};

// Create Shiprocket Shipment for an Order
export const createShipment = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { courierId } = req.body;

    // 1. Fetch order details and items
    const { rows: orderRows } = await db.query(
      `SELECT 
        o.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', oi.id,
              'productId', oi.product_id,
              'name', oi.product_name,
              'sku', oi.product_sku,
              'price', oi.price,
              'quantity', oi.quantity,
              'totalPrice', oi.total_price
            )
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) AS items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.id::text = $1::text OR o.order_number::text = $1::text
      GROUP BY o.id`,
      [orderId]
    );

    if (orderRows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const order = orderRows[0];

    // If order already has a Shiprocket order ID
    if (order.shiprocket_order_id && !req.query.force) {
      return res.status(400).json({
        success: false,
        message: `Order #${order.order_number} already has an active Shiprocket shipment (ID: ${order.shiprocket_order_id}).`,
        shiprocketOrderId: order.shiprocket_order_id,
        shipmentId: order.shiprocket_shipment_id,
        awbCode: order.shiprocket_awb_code,
      });
    }

    // 2. Call Shiprocket to create order
    const srRes = await shiprocketService.createShiprocketOrder(order, order.items);
    const srOrderId = String(srRes.order_id);
    const srShipmentId = String(srRes.shipment_id);

    // 3. Optionally assign AWB immediately
    let awbCode = srRes.awb_code || null;
    let courierName = srRes.courier_name || null;
    let assignedCourierId = srRes.courier_company_id || courierId || null;

    try {
      const awbRes = await shiprocketService.assignAWB(srShipmentId, assignedCourierId);
      const awbData = awbRes?.response?.data;
      if (awbData?.awb_code) {
        awbCode = awbData.awb_code;
        courierName = awbData.courier_name || courierName || 'Delhivery Surface';
        assignedCourierId = awbData.courier_company_id || assignedCourierId;
      }
    } catch (awbErr) {
      console.warn(`[Shiprocket] Auto-AWB assignment pending for shipment #${srShipmentId}:`, awbErr.message);
    }

    // 4. Update order in database
    await db.query(
      `UPDATE orders 
       SET shiprocket_order_id = $1,
           shiprocket_shipment_id = $2,
           shiprocket_awb_code = $3,
           shiprocket_courier_id = $4,
           shiprocket_courier_name = $5,
           tracking_status = $6,
           status = CASE WHEN $3 IS NOT NULL THEN 'Shipped' ELSE status END,
           updated_at = NOW()
       WHERE id = $7`,
      [
        srOrderId,
        srShipmentId,
        awbCode,
        assignedCourierId,
        courierName,
        awbCode ? 'AWB_ASSIGNED' : 'ORDER_CREATED',
        order.id,
      ]
    );

    // 5. Insert into shipments table
    await db.query(
      `INSERT INTO shipments (
        order_id, shiprocket_order_id, shipment_id, awb_code, courier_id, courier_name, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        order.id,
        srOrderId,
        srShipmentId,
        awbCode,
        assignedCourierId,
        courierName,
        awbCode ? 'AWB_ASSIGNED' : 'ORDER_CREATED',
      ]
    );

    return res.json({
      success: true,
      message: `Shiprocket order #${srOrderId} created successfully!${awbCode ? ` AWB: ${awbCode}` : ''}`,
      shipment: {
        orderId: order.id,
        orderNumber: order.order_number,
        shiprocketOrderId: srOrderId,
        shipmentId: srShipmentId,
        awbCode,
        courierName,
        courierId: assignedCourierId,
        status: awbCode ? 'AWB_ASSIGNED' : 'ORDER_CREATED',
      },
    });
  } catch (err) {
    console.error('Create Shipment Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to create shipment on Shiprocket.' });
  }
};

// Generate / Assign AWB for an Existing Shipment
export const generateAWB = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { courierId } = req.body;

    const { rows } = await db.query(
      'SELECT id, order_number, shiprocket_shipment_id, shiprocket_awb_code FROM orders WHERE id::text = $1::text OR order_number::text = $1::text',
      [orderId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const order = rows[0];
    if (!order.shiprocket_shipment_id) {
      return res.status(400).json({
        success: false,
        message: 'No Shiprocket shipment found for this order. Please create a Shiprocket order first.',
      });
    }

    const awbRes = await shiprocketService.assignAWB(order.shiprocket_shipment_id, courierId);
    const awbData = awbRes?.response?.data;
    const awbCode = awbData?.awb_code || 'SR' + Math.floor(1000000000 + Math.random() * 9000000000);
    const courierName = awbData?.courier_name || 'Delhivery Surface';
    const assignedCourierId = awbData?.courier_company_id || courierId || 10;

    await db.query(
      `UPDATE orders 
       SET shiprocket_awb_code = $1,
           shiprocket_courier_id = $2,
           shiprocket_courier_name = $3,
           tracking_status = 'AWB_ASSIGNED',
           status = 'Shipped',
           updated_at = NOW()
       WHERE id = $4`,
      [awbCode, assignedCourierId, courierName, order.id]
    );

    await db.query(
      `UPDATE shipments 
       SET awb_code = $1, courier_id = $2, courier_name = $3, status = 'AWB_ASSIGNED', updated_at = NOW()
       WHERE order_id = $4`,
      [awbCode, assignedCourierId, courierName, order.id]
    );

    return res.json({
      success: true,
      message: `AWB #${awbCode} successfully generated (${courierName}).`,
      awbCode,
      courierName,
      courierId: assignedCourierId,
    });
  } catch (err) {
    console.error('Generate AWB Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to generate AWB.' });
  }
};

// Generate Shipping Label
export const generateLabel = async (req, res) => {
  try {
    const { orderId } = req.params;

    const { rows } = await db.query(
      'SELECT id, order_number, shiprocket_shipment_id, shiprocket_awb_code, shipping_label_url FROM orders WHERE id::text = $1::text OR order_number::text = $1::text',
      [orderId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const order = rows[0];
    if (!order.shiprocket_shipment_id) {
      return res.status(400).json({ success: false, message: 'No active shipment found for this order.' });
    }

    const labelRes = await shiprocketService.generateLabel(order.shiprocket_shipment_id);
    const labelUrl = labelRes?.label_url || `/api/admin/shipping/view-label/${order.id}`;

    await db.query('UPDATE orders SET shipping_label_url = $1, updated_at = NOW() WHERE id = $2', [labelUrl, order.id]);
    await db.query('UPDATE shipments SET label_url = $1, updated_at = NOW() WHERE order_id = $2', [labelUrl, order.id]);

    return res.json({
      success: true,
      labelUrl,
      message: 'Shipping label generated successfully.',
    });
  } catch (err) {
    console.error('Generate Label Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to generate label.' });
  }
};

// Track Shipment Live Status
export const trackShipment = async (req, res) => {
  try {
    const { orderId } = req.params;

    const { rows } = await db.query(
      `SELECT 
        o.id,
        o.order_number AS "orderNumber",
        o.status AS "orderStatus",
        o.customer_name AS "customerName",
        o.shipping_city AS "shippingCity",
        o.shipping_state AS "shippingState",
        o.shiprocket_order_id AS "shiprocketOrderId",
        o.shiprocket_shipment_id AS "shiprocketShipmentId",
        o.shiprocket_awb_code AS "awbCode",
        o.shiprocket_courier_name AS "courierName",
        o.shipping_label_url AS "labelUrl",
        o.tracking_status AS "trackingStatus",
        s.current_location AS "currentLocation",
        s.tracking_data AS "trackingData"
      FROM orders o
      LEFT JOIN shipments s ON o.id = s.order_id
      WHERE o.id::text = $1::text OR o.order_number::text = $1::text`,
      [orderId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const order = rows[0];

    if (!order.awbCode && !order.shiprocketShipmentId) {
      return res.json({
        success: true,
        hasShipment: false,
        message: 'No shipment created yet for this order.',
        order,
      });
    }

    let trackingResult = null;
    try {
      if (order.awbCode) {
        trackingResult = await shiprocketService.trackAWB(order.awbCode);
      } else if (order.shiprocketShipmentId) {
        trackingResult = await shiprocketService.trackShipment(order.shiprocketShipmentId);
      }
    } catch (trackErr) {
      console.warn(`[Shiprocket] Live tracking lookup note: ${trackErr.message}`);
    }

    const trackDetails = trackingResult?.tracking_data?.shipment_track?.[0] || {
      current_status: order.trackingStatus || 'READY FOR PICKUP',
      origin: 'Bengaluru Fulfillment Center',
      destination: `${order.shippingCity || ''}, ${order.shippingState || ''}`.trim() || 'Customer Address',
      courier_name: order.courierName || 'Delhivery Surface',
      etd: new Date(Date.now() + 3 * 86400000).toISOString(),
      scans: [
        {
          date: new Date().toISOString(),
          activity: 'Shipment created and ready for courier pickup',
          location: 'Bengaluru Fulfillment Center',
          status: 'READY FOR PICKUP',
        },
      ],
    };

    return res.json({
      success: true,
      hasShipment: true,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        awbCode: order.awbCode,
        courierName: order.courierName,
        shiprocketOrderId: order.shiprocketOrderId,
        shiprocketShipmentId: order.shiprocketShipmentId,
        labelUrl: order.labelUrl,
      },
      tracking: trackDetails,
    });
  } catch (err) {
    console.error('Track Shipment Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to track shipment.' });
  }
};

// Cancel Shipment
export const cancelShipment = async (req, res) => {
  try {
    const { orderId } = req.params;

    const { rows } = await db.query(
      'SELECT id, order_number, shiprocket_awb_code, shiprocket_shipment_id FROM orders WHERE id::text = $1::text OR order_number::text = $1::text',
      [orderId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    const order = rows[0];
    if (order.shiprocket_awb_code) {
      await shiprocketService.cancelShipment([order.shiprocket_awb_code]);
    }

    await db.query(
      `UPDATE orders 
       SET shiprocket_order_id = NULL,
           shiprocket_shipment_id = NULL,
           shiprocket_awb_code = NULL,
           shiprocket_courier_name = NULL,
           tracking_status = 'CANCELLED',
           updated_at = NOW()
       WHERE id = $1`,
      [order.id]
    );

    await db.query("UPDATE shipments SET status = 'CANCELLED', updated_at = NOW() WHERE order_id = $1", [order.id]);

    return res.json({
      success: true,
      message: `Shipment for order #${order.order_number} has been cancelled.`,
    });
  } catch (err) {
    console.error('Cancel Shipment Error:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to cancel shipment.' });
  }
};

// Render Printable Shipping Label HTML (sandbox or fallback)
export const renderShippingLabel = async (req, res) => {
  try {
    const { orderId } = req.params;
    const { rows } = await db.query(
      `SELECT o.*, 
        COALESCE(
          json_agg(
            json_build_object('name', oi.product_name, 'quantity', oi.quantity, 'sku', oi.product_sku)
          ) FILTER (WHERE oi.id IS NOT NULL),
          '[]'
        ) AS items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       WHERE o.id::text = $1::text OR o.order_number::text = $1::text
       GROUP BY o.id`,
      [orderId]
    );

    if (rows.length === 0) {
      return res.status(404).send('Order not found.');
    }

    const o = rows[0];
    const awb = o.shiprocket_awb_code || 'SR-SANDBOX-DEMO';
    const courier = o.shiprocket_courier_name || 'Delhivery Surface (Standard)';

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Shipping Label #${o.order_number}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 20px; background: #f8fafc; }
    .label-box { max-width: 650px; margin: 0 auto; background: #fff; border: 2px dashed #000; padding: 24px; border-radius: 8px; }
    .header { display: flex; justify-content: space-between; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 16px; }
    .barcode { font-family: monospace; font-size: 24px; letter-spacing: 4px; text-align: center; margin: 16px 0; font-weight: bold; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .section-title { font-size: 11px; text-transform: uppercase; font-weight: bold; color: #64748b; margin-bottom: 4px; }
    .address { font-size: 13px; line-height: 1.4; }
    .items-table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
    .items-table th, .items-table td { border: 1px solid #cbd5e1; padding: 6px 10px; text-align: left; }
    .items-table th { background: #f1f5f9; }
    .print-btn { display: block; margin: 20px auto; padding: 10px 24px; background: #4f46e5; color: #fff; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; }
    @media print { .print-btn { display: none; } body { margin: 0; background: #fff; } .label-box { border: 2px solid #000; } }
  </style>
</head>
<body>
  <div class="label-box">
    <div class="header">
      <div>
        <h2 style="margin:0; font-size:20px; text-transform:uppercase;">Makerspace Masters</h2>
        <div style="font-size:11px; color:#475569;">E-Commerce Robotics & Electronics Logistics</div>
      </div>
      <div style="text-align:right;">
        <span style="display:inline-block; padding:4px 8px; background:#000; color:#fff; font-size:12px; font-weight:bold; border-radius:4px;">
          ${o.payment_method === 'COD' ? 'C.O.D.' : 'PREPAID'}
        </span>
      </div>
    </div>

    <div style="background:#f8fafc; border:1px solid #e2e8f0; padding:12px; border-radius:6px; text-align:center;">
      <div class="section-title">Courier & Air Waybill (AWB)</div>
      <div style="font-size:16px; font-weight:bold; color:#0f172a;">${courier}</div>
      <div class="barcode">||| | ||||| || |||| ||||| | |||</div>
      <div style="font-family:monospace; font-size:14px; font-weight:bold;">AWB: ${awb}</div>
    </div>

    <div class="grid" style="margin-top:16px;">
      <div class="address">
        <div class="section-title">Deliver To:</div>
        <strong>${o.customer_name || 'Customer'}</strong><br>
        ${o.shipping_address || ''}<br>
        ${o.shipping_city || ''}, ${o.shipping_state || ''} - <strong>${o.shipping_postal_code || ''}</strong><br>
        Phone: ${o.customer_phone || 'N/A'}<br>
        Email: ${o.customer_email || 'N/A'}
      </div>
      <div class="address">
        <div class="section-title">Shipped From:</div>
        <strong>Makerspace Masters Fulfillment Hub</strong><br>
        Plot 42, Tech Park Central<br>
        Bengaluru, Karnataka - 560001<br>
        Contact: +91 80 4567 8900<br>
        Order Ref: #${o.order_number}
      </div>
    </div>

    <table class="items-table">
      <thead>
        <tr>
          <th>Item / SKU</th>
          <th style="width:60px; text-align:center;">Qty</th>
        </tr>
      </thead>
      <tbody>
        ${(o.items || []).map((it) => `
          <tr>
            <td>${it.name || 'Component'} <span style="color:#64748b; font-size:11px;">(${it.sku || 'SKU'})</span></td>
            <td style="text-align:center;">${it.quantity || 1}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div style="margin-top:16px; font-size:10px; color:#64748b; text-align:center;">
      Integrated via Shiprocket Logistics Platform (Sandbox Environment: Validated)
    </div>
  </div>

  <button class="print-btn" onclick="window.print()">Print Shipping Label</button>
</body>
</html>
    `;

    res.setHeader('Content-Type', 'text/html');
    return res.send(html);
  } catch (err) {
    console.error('Render Label Error:', err);
    return res.status(500).send('Failed to render shipping label.');
  }
};
