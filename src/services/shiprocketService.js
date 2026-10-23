/**
 * Shiprocket Logistics & Courier Integration Service
 * Real-time Courier Serviceability and TAT (Turnaround Time) Integration.
 */

class ShiprocketService {
  constructor() {
    this.env = (process.env.SHIPROCKET_ENV || 'production').toLowerCase();
    const rawBase = (process.env.SHIPROCKET_BASE_URL || 'https://apiv2.shiprocket.in').replace(/\/$/, '');
    this.baseUrl = rawBase.replace(/\/v1\/external\/?$/, '');
    this.email = process.env.SHIPROCKET_EMAIL;
    this.password = process.env.SHIPROCKET_PASSWORD;
    this.pickupLocation = process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary';

    this.cachedToken = null;
    this.tokenExpiresAt = null;
  }

  /**
   * Helper: check if credentials are configured
   */
  isConfigured() {
    return Boolean(this.email && this.password);
  }

  /**
   * Clear cached authentication token
   */
  clearAuthToken() {
    this.cachedToken = null;
    this.tokenExpiresAt = null;
  }

  /**
   * Obtain or refresh Shiprocket Bearer Authentication Token
   */
  async getAuthToken() {
    if (!this.isConfigured()) {
      throw new Error('Shiprocket credentials (SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD) are not configured.');
    }

    // Return cached token if valid (buffer 1 hour before expiry)
    if (this.cachedToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt - 3600000) {
      return this.cachedToken;
    }

    const loginUrl = `${this.baseUrl}/v1/external/auth/login`;

    try {
      const response = await fetch(loginUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'MakerspaceShop-Ecom/1.0',
        },
        body: JSON.stringify({
          email: this.email,
          password: this.password,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 498) {
        throw new Error('Shiprocket sandbox gateway returned HTTP 498: Access Denied. Sandbox upstream ALB is currently restricting external calls.');
      }

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }

      if (!response.ok || !data?.token) {
        const errorMsg = data?.message || `HTTP ${response.status}: Failed to authenticate with Shiprocket`;
        throw new Error(errorMsg);
      }

      this.cachedToken = data.token;
      // Tokens are generally valid for 10 days (240 hours)
      this.tokenExpiresAt = Date.now() + 240 * 3600000;
      return this.cachedToken;
    } catch (err) {
      this.clearAuthToken();
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new Error('Shiprocket authentication request timed out.');
      }
      throw err;
    }
  }

  /**
   * Internal authenticated fetch helper
   */
  async request(endpoint, options = {}) {
    const token = await this.getAuthToken();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const url = `${this.baseUrl}${cleanEndpoint}`;

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'MakerspaceShop-Ecom/1.0',
      ...(options.headers || {}),
    };

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: options.signal || AbortSignal.timeout(10000),
      });

      // If token expired upstream, clear cache
      if (response.status === 401) {
        this.clearAuthToken();
      }

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }

      if (!response.ok) {
        const err = new Error(data?.message || `Shiprocket error on ${endpoint} (HTTP ${response.status})`);
        err.status = response.status;
        err.upstreamData = data;
        throw err;
      }

      return data;
    } catch (err) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new Error(`Shiprocket request to ${endpoint} timed out.`);
      }
      throw err;
    }
  }

  /**
   * Normalize Shiprocket courier companies list into standard TAT estimate objects
   */
  normalizeCourierEstimates(couriers = []) {
    if (!Array.isArray(couriers)) return [];

    return couriers.map((courier) => {
      // 1. Courier name
      const courierName = courier.courier_name ? String(courier.courier_name).trim() : null;

      // 2. Estimated Days (extract integer)
      let estimatedDays = null;
      if (courier.estimated_delivery_days != null) {
        if (typeof courier.estimated_delivery_days === 'number') {
          estimatedDays = Math.round(courier.estimated_delivery_days);
        } else {
          const match = String(courier.estimated_delivery_days).match(/\d+/);
          if (match) {
            estimatedDays = parseInt(match[0], 10);
          }
        }
      }

      // 3. Estimated Date (YYYY-MM-DD)
      let estimatedDate = null;
      if (courier.etd) {
        try {
          const etdStr = String(courier.etd).trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(etdStr)) {
            estimatedDate = etdStr;
          } else {
            const parsedDate = new Date(etdStr);
            if (!isNaN(parsedDate.getTime())) {
              estimatedDate = parsedDate.toISOString().split('T')[0];
            }
          }
        } catch {
          estimatedDate = null;
        }
      }

      // 4. Estimated Hours
      let estimatedHours = null;
      if (courier.etd_hours != null) {
        const hoursNum = Number(courier.etd_hours);
        if (!isNaN(hoursNum) && isFinite(hoursNum)) {
          estimatedHours = hoursNum;
        }
      } else if (estimatedDays !== null) {
        estimatedHours = estimatedDays * 24;
      }

      // 5. Shipping Charge (prefer freight_charge, fallback to rate)
      let shippingCharge = null;
      if (courier.freight_charge != null && !isNaN(parseFloat(courier.freight_charge))) {
        shippingCharge = parseFloat(courier.freight_charge);
      } else if (courier.rate != null && !isNaN(parseFloat(courier.rate))) {
        shippingCharge = parseFloat(courier.rate);
      }

      // 6. Courier Company ID
      let courierCompanyId = null;
      if (courier.courier_company_id != null && !isNaN(Number(courier.courier_company_id))) {
        courierCompanyId = Number(courier.courier_company_id);
      }

      return {
        courierName,
        estimatedDays,
        estimatedDate,
        estimatedHours,
        shippingCharge,
        courierCompanyId,
      };
    });
  }

  /**
   * Check Courier Serviceability for Delivery Pincode
   */
  async checkServiceability({ pickupPincode, deliveryPincode, weight = 1, cod = 0 }) {
    if (!pickupPincode) {
      throw new Error('Pickup pincode is required to check serviceability.');
    }
    if (!deliveryPincode) {
      throw new Error('Delivery pincode is required to check serviceability.');
    }

    const params = new URLSearchParams({
      pickup_postcode: String(pickupPincode).trim(),
      delivery_postcode: String(deliveryPincode).trim(),
      weight: String(weight),
      cod: String(cod ? 1 : 0),
    });

    const endpoint = `/v1/external/courier/serviceability/?${params.toString()}`;
    return this.request(endpoint, { method: 'GET' });
  }

  /**
   * Create an Order / Shipment on Shiprocket
   */
  async createShiprocketOrder(order, items = []) {
    const orderDate = new Date(order.createdAt || Date.now());
    const formattedDate = `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, '0')}-${String(orderDate.getDate()).padStart(2, '0')} ${String(orderDate.getHours()).padStart(2, '0')}:${String(orderDate.getMinutes()).padStart(2, '0')}`;

    // Parse Customer Name
    const fullName = (order.customerName || 'Valued Customer').trim();
    const nameParts = fullName.split(' ');
    const firstName = nameParts[0] || 'Valued';
    const lastName = nameParts.slice(1).join(' ') || 'Customer';

    // Map order items to Shiprocket items
    const orderItems = (items && items.length > 0 ? items : order.items || []).map((it) => ({
      name: it.name || it.productName || 'Electronic Component',
      sku: it.sku || it.productSku || `SKU-${it.productId || it.id || 'ITEM'}`,
      units: parseInt(it.quantity || 1, 10),
      selling_price: parseFloat(it.price || it.unitPrice || 0),
      discount: 0,
      tax: 0,
      hsn: 85423100, // Electronics HSN code default
    }));

    // Calculate dimensions & weight defaults for electronics parcel
    const totalQty = orderItems.reduce((acc, it) => acc + (it.units || 1), 0);
    const weightKg = Math.max(0.2, Math.min(10.0, totalQty * 0.25));

    const payload = {
      order_id: String(order.orderNumber || order.id),
      order_date: formattedDate,
      pickup_location: this.pickupLocation,
      channel_id: '',
      comment: `Order #${order.orderNumber || order.id} from Makerspace Masters Store`,
      billing_customer_name: firstName,
      billing_last_name: lastName,
      billing_address: String(order.shippingAddress || 'Store Address').trim(),
      billing_address_2: '',
      billing_city: order.shippingCity || 'Bengaluru',
      billing_pincode: String(order.shippingPostalCode || '560001').replace(/\D/g, '').slice(0, 6),
      billing_state: order.shippingState || 'Karnataka',
      billing_country: order.shippingCountry || 'India',
      billing_email: order.customerEmail || 'orders@makerspacemasters.com',
      billing_phone: String(order.customerPhone || '9876543210').replace(/\D/g, '').slice(-10),
      shipping_is_billing: true,
      order_items: orderItems,
      payment_method: String(order.paymentMethod || '').toLowerCase() === 'cod' ? 'COD' : 'Prepaid',
      shipping_charges: parseFloat(order.shippingFee || 0),
      giftwrap_charges: 0,
      transaction_charges: 0,
      total_discount: 0,
      sub_total: parseFloat(order.subtotal || order.totalAmount || 0),
      length: 15,
      breadth: 15,
      height: 10,
      weight: weightKg,
    };

    return this.request('/v1/external/orders/create/adhoc', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Assign Courier & Generate AWB
   */
  async assignAWB(shipmentId, courierId = null) {
    if (!shipmentId) throw new Error('Shipment ID is required to generate AWB.');

    const payload = { shipment_id: shipmentId };
    if (courierId) {
      payload.courier_id = courierId;
    }

    return this.request('/v1/external/courier/assign/awb', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Schedule Courier Pickup
   */
  async requestPickup(shipmentId) {
    if (!shipmentId) throw new Error('Shipment ID is required to request pickup.');

    return this.request('/v1/external/courier/generate/pickup', {
      method: 'POST',
      body: JSON.stringify({
        shipment_id: Array.isArray(shipmentId) ? shipmentId : [shipmentId],
      }),
    });
  }

  /**
   * Generate Shipping Label
   */
  async generateLabel(shipmentId) {
    if (!shipmentId) throw new Error('Shipment ID is required to generate shipping label.');

    return this.request('/v1/external/courier/generate/label', {
      method: 'POST',
      body: JSON.stringify({
        shipment_id: Array.isArray(shipmentId) ? shipmentId : [shipmentId],
      }),
    });
  }

  /**
   * Generate Order Invoice
   */
  async generateInvoice(orderId) {
    if (!orderId) throw new Error('Shiprocket Order ID is required to generate invoice.');

    return this.request('/v1/external/orders/print/invoice', {
      method: 'POST',
      body: JSON.stringify({
        ids: Array.isArray(orderId) ? orderId : [orderId],
      }),
    });
  }

  /**
   * Track Shipment by AWB
   */
  async trackAWB(awbCode) {
    if (!awbCode) throw new Error('AWB code is required for tracking.');

    return this.request(`/v1/external/courier/track/awb/${encodeURIComponent(awbCode)}`, {
      method: 'GET',
    });
  }

  /**
   * Track Shipment by Shipment ID
   */
  async trackShipment(shipmentId) {
    if (!shipmentId) throw new Error('Shipment ID is required for tracking.');

    return this.request(`/v1/external/courier/track/shipment/${encodeURIComponent(shipmentId)}`, {
      method: 'GET',
    });
  }

  /**
   * Cancel Shipment by AWB
   */
  async cancelShipment(awbs) {
    const awbArray = Array.isArray(awbs) ? awbs : [awbs];
    return this.request('/v1/external/orders/cancel/shipment/awbs', {
      method: 'POST',
      body: JSON.stringify({ awbs: awbArray }),
    });
  }
}

export default new ShiprocketService();
