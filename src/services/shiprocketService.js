/**
 * Shiprocket Logistics & Courier Integration Service
 * Supports both live Shiprocket API and resilient sandbox fallback mode.
 */

class ShiprocketService {
  constructor() {
    this.env = process.env.SHIPROCKET_ENV || 'sandbox';
    this.baseUrl = (process.env.SHIPROCKET_BASE_URL || 'https://api-sandbox.shiprocket.in').replace(/\/$/, '');
    this.email = process.env.SHIPROCKET_EMAIL;
    this.password = process.env.SHIPROCKET_PASSWORD;
    this.pickupLocation = process.env.SHIPROCKET_PICKUP_LOCATION || 'Primary';

    this.cachedToken = null;
    this.tokenExpiresAt = null;
    this.isSandboxRestricted = false; // Flag if sandbox ALB returns 498
  }

  /**
   * Helper: check if credentials are configured
   */
  isConfigured() {
    return Boolean(this.email && this.password);
  }

  /**
   * Obtain or refresh Shiprocket Bearer Authentication Token
   */
  async getAuthToken() {
    if (!this.isConfigured()) {
      throw new Error('Shiprocket credentials (SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD) are not configured.');
    }

    // Return cached token if valid (valid for up to 10 days, buffer 1 hour)
    if (this.cachedToken && this.tokenExpiresAt && Date.now() < this.tokenExpiresAt - 3600000) {
      return this.cachedToken;
    }

    try {
      const loginUrl = `${this.baseUrl}/v1/external/auth/login`;
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
      });

      if (response.status === 498) {
        console.warn('[Shiprocket] Received 498 Access Denied from sandbox ALB. Operating in resilient sandbox emulation mode.');
        this.isSandboxRestricted = true;
        this.cachedToken = 'SR_SANDBOX_MOCK_TOKEN_' + Date.now();
        this.tokenExpiresAt = Date.now() + 240 * 3600000;
        return this.cachedToken;
      }

      const data = await response.json().catch(() => null);

      if (!response.ok || !data?.token) {
        const errorMsg = data?.message || `HTTP ${response.status}: Failed to authenticate with Shiprocket`;
        console.warn(`[Shiprocket] Auth failed (${errorMsg}). Using sandbox fallback.`);
        if (this.env === 'sandbox') {
          this.isSandboxRestricted = true;
          this.cachedToken = 'SR_SANDBOX_MOCK_TOKEN_' + Date.now();
          this.tokenExpiresAt = Date.now() + 240 * 3600000;
          return this.cachedToken;
        }
        throw new Error(errorMsg);
      }

      this.cachedToken = data.token;
      // Tokens are valid for 10 days (240 hours)
      this.tokenExpiresAt = Date.now() + 240 * 3600000;
      this.isSandboxRestricted = false;
      console.log('[Shiprocket] Successfully authenticated and retrieved access token.');
      return this.cachedToken;
    } catch (err) {
      console.warn('[Shiprocket] Login network exception:', err.message);
      if (this.env === 'sandbox') {
        this.isSandboxRestricted = true;
        this.cachedToken = 'SR_SANDBOX_MOCK_TOKEN_' + Date.now();
        this.tokenExpiresAt = Date.now() + 240 * 3600000;
        return this.cachedToken;
      }
      throw err;
    }
  }

  /**
   * Internal authenticated fetch helper
   */
  async request(endpoint, options = {}) {
    const token = await this.getAuthToken();

    // If in sandbox emulation mode due to network / ALB 498
    if (this.isSandboxRestricted && token.startsWith('SR_SANDBOX_MOCK_TOKEN')) {
      return this.handleSandboxEmulation(endpoint, options);
    }

    const url = `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
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
      });

      if (response.status === 498) {
        console.warn(`[Shiprocket] 498 on ${endpoint}. Falling back to sandbox emulation.`);
        this.isSandboxRestricted = true;
        return this.handleSandboxEmulation(endpoint, options);
      }

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { text };
      }

      if (!response.ok) {
        throw new Error(data?.message || `Shiprocket error on ${endpoint} (HTTP ${response.status})`);
      }

      return data;
    } catch (err) {
      if (this.env === 'sandbox') {
        console.warn(`[Shiprocket] Exception on ${endpoint}: ${err.message}. Emulating sandbox response.`);
        return this.handleSandboxEmulation(endpoint, options);
      }
      throw err;
    }
  }

  /**
   * Resilient Sandbox Mock Handler
   * Used when sandbox ALB blocks external IPs with 498
   */
  handleSandboxEmulation(endpoint, options = {}) {
    console.log(`[Shiprocket:Sandbox] Emulating response for endpoint: ${endpoint}`);

    // 1. Serviceability Check
    if (endpoint.includes('/courier/serviceability')) {
      return {
        status: 200,
        data: {
          available_courier_companies: [
            {
              courier_company_id: 10,
              courier_name: 'Delhivery Surface',
              rate: 65.0,
              rating: 4.6,
              estimated_delivery_days: '3-4 Days',
              etd: new Date(Date.now() + 4 * 86400000).toISOString().split('T')[0],
              cod: 1,
            },
            {
              courier_company_id: 2,
              courier_name: 'Blue Dart Express',
              rate: 95.0,
              rating: 4.8,
              estimated_delivery_days: '2 Days',
              etd: new Date(Date.now() + 2 * 86400000).toISOString().split('T')[0],
              cod: 1,
            },
            {
              courier_company_id: 14,
              courier_name: 'DTDC Surface',
              rate: 55.0,
              rating: 4.2,
              estimated_delivery_days: '4-5 Days',
              etd: new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0],
              cod: 1,
            },
          ],
        },
      };
    }

    // 2. Create Order / Adhoc
    if (endpoint.includes('/orders/create/adhoc')) {
      const payload = typeof options.body === 'string' ? JSON.parse(options.body) : (options.body || {});
      const randomOrderId = Math.floor(10000000 + Math.random() * 90000000);
      const randomShipmentId = Math.floor(20000000 + Math.random() * 80000000);
      return {
        order_id: randomOrderId,
        shipment_id: randomShipmentId,
        status: 'NEW',
        status_code: 1,
        onboarding_completed_now: 0,
        awb_code: '',
        courier_company_id: '',
        courier_name: '',
      };
    }

    // 3. Assign AWB
    if (endpoint.includes('/courier/assign/awb')) {
      const payload = typeof options.body === 'string' ? JSON.parse(options.body) : (options.body || {});
      const randomAwb = 'SR' + Math.floor(1000000000 + Math.random() * 9000000000);
      return {
        awb_assign_status: 1,
        response: {
          data: {
            awb_code: randomAwb,
            courier_company_id: payload.courier_id || 10,
            courier_name: payload.courier_id === 2 ? 'Blue Dart Express' : 'Delhivery Surface',
            shipment_id: payload.shipment_id || Math.floor(20000000 + Math.random() * 80000000),
          },
        },
      };
    }

    // 4. Generate Pickup
    if (endpoint.includes('/courier/generate/pickup')) {
      return {
        pickup_status: 1,
        response: {
          pickup_token_number: 'PKP' + Math.floor(100000 + Math.random() * 900000),
          pickup_scheduled_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        },
      };
    }

    // 5. Generate Label
    if (endpoint.includes('/courier/generate/label')) {
      return {
        label_created: 1,
        label_url: `/api/admin/shipping/view-label?sandbox=true&ts=${Date.now()}`,
      };
    }

    // 6. Generate Invoice
    if (endpoint.includes('/orders/print/invoice')) {
      return {
        is_invoice_created: true,
        invoice_url: `/api/admin/shipping/view-invoice?sandbox=true&ts=${Date.now()}`,
      };
    }

    // 7. Track AWB / Shipment
    if (endpoint.includes('/courier/track')) {
      return {
        tracking_data: {
          track_status: 1,
          shipment_status: 6,
          shipment_track: [
            {
              id: 1,
              current_status: 'IN TRANSIT',
              origin: 'Bengaluru Hub',
              destination: 'Customer City',
              courier_name: 'Delhivery Surface',
              etd: new Date(Date.now() + 2 * 86400000).toISOString(),
              scans: [
                {
                  date: new Date(Date.now() - 3600000).toISOString(),
                  activity: 'Shipment has departed originating sorting facility',
                  location: 'Bengaluru Hub',
                  status: 'IN TRANSIT',
                },
                {
                  date: new Date(Date.now() - 14400000).toISOString(),
                  activity: 'Package received at central logistics center',
                  location: 'Bengaluru Logistics Center',
                  status: 'PICKED UP',
                },
                {
                  date: new Date(Date.now() - 28800000).toISOString(),
                  activity: 'Manifest generated & courier assigned',
                  location: 'Makerspace Warehouse',
                  status: 'MANIFEST GENERATED',
                },
              ],
            },
          ],
        },
      };
    }

    // 8. Cancel Shipment
    if (endpoint.includes('/orders/cancel')) {
      return {
        status: 200,
        message: 'Shipment cancelled successfully in sandbox.',
      };
    }

    return { status: 200, message: 'Sandbox request completed' };
  }

  /**
   * Check Courier Serviceability for Delivery Pincode
   */
  async checkServiceability({ pickupPincode = '560001', deliveryPincode, weight = 0.5, cod = 0 }) {
    if (!deliveryPincode) {
      throw new Error('Delivery pincode is required to check serviceability.');
    }

    const endpoint = `/v1/external/courier/serviceability/?pickup_postcode=${pickupPincode}&delivery_postcode=${deliveryPincode}&weight=${weight}&cod=${cod ? 1 : 0}`;
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
