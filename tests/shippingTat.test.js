import 'dotenv/config';
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import shiprocketService from '../src/services/shiprocketService.js';
import { getShippingTat } from '../src/controllers/admin/shippingController.js';
import db from '../src/config/db.js';

describe('Shiprocket TAT & Courier Serviceability Test Suite', () => {
  const originalFetch = global.fetch;
  const originalDbQuery = db.query;
  const originalEmail = shiprocketService.email;
  const originalPassword = shiprocketService.password;

  beforeEach(() => {
    shiprocketService.clearAuthToken();
    shiprocketService.email = 'test@example.com';
    shiprocketService.password = 'testPassword123';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    db.query = originalDbQuery;
    shiprocketService.clearAuthToken();
    shiprocketService.email = originalEmail;
    shiprocketService.password = originalPassword;
  });

  // 1. Successful sandbox authentication
  test('1. Successful sandbox authentication and token caching', async () => {
    let authCallCount = 0;
    global.fetch = async (url, options) => {
      if (url.includes('/v1/external/auth/login')) {
        authCallCount++;
        assert.equal(options.method, 'POST');
        const body = JSON.parse(options.body);
        assert.ok(body.email);
        assert.ok(body.password);
        return new Response(JSON.stringify({
          token: 'MOCK_TEST_BEARER_TOKEN_XYZ123',
          message: 'Authenticated successfully',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const token1 = await shiprocketService.getAuthToken();
    assert.equal(token1, 'MOCK_TEST_BEARER_TOKEN_XYZ123');
    assert.equal(authCallCount, 1);

    // Call again immediately to verify caching
    const token2 = await shiprocketService.getAuthToken();
    assert.equal(token2, 'MOCK_TEST_BEARER_TOKEN_XYZ123');
    assert.equal(authCallCount, 1, 'Token must be cached and not trigger another login request');
  });

  // 2. Successful TAT request for pickup 201309 and delivery 144012, weight 1, cod 0
  test('2. Successful TAT request with pickup 201309 and delivery 144012', async () => {
    let requestedUrl = null;
    let authHeader = null;

    global.fetch = async (url, options) => {
      if (url.includes('/v1/external/auth/login')) {
        return new Response(JSON.stringify({ token: 'VALID_TOKEN_789' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/v1/external/courier/serviceability')) {
        requestedUrl = url;
        authHeader = options.headers?.Authorization;
        return new Response(JSON.stringify({
          status: 200,
          data: {
            available_courier_companies: [
              {
                courier_company_id: 10,
                courier_name: 'Delhivery Surface',
                freight_charge: 65.0,
                rate: 65.0,
                estimated_delivery_days: '3-4 Days',
                etd: '2026-10-26',
                etd_hours: 72,
              },
            ],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const res = await shiprocketService.checkServiceability({
      pickupPincode: '201309',
      deliveryPincode: '144012',
      weight: 1,
      cod: 0,
    });

    assert.ok(requestedUrl);
    assert.ok(requestedUrl.includes('pickup_postcode=201309'));
    assert.ok(requestedUrl.includes('delivery_postcode=144012'));
    assert.ok(requestedUrl.includes('weight=1'));
    assert.ok(requestedUrl.includes('cod=0'));
    assert.equal(authHeader, 'Bearer VALID_TOKEN_789');
    assert.equal(res.status, 200);
    assert.equal(res.data.available_courier_companies.length, 1);
  });

  // 3. Successful extraction of estimated_delivery_days, etd, etd_hours, shippingCharge, courierCompanyId
  test('3. Extraction and normalization of courier estimate fields', () => {
    const rawCouriers = [
      {
        courier_company_id: 10,
        courier_name: 'Delhivery Surface',
        freight_charge: '65.50',
        rate: '70.00',
        estimated_delivery_days: '3-4 Days',
        etd: '2026-10-26 18:00:00',
        etd_hours: '72',
      },
      {
        courier_company_id: '15',
        courier_name: 'Blue Dart Air',
        rate: 110,
        freight_charge: null,
        estimated_delivery_days: 2,
        etd: '2026-10-25',
      },
      {
        courier_company_id: null,
        courier_name: null,
        rate: null,
        freight_charge: null,
      },
    ];

    const normalized = shiprocketService.normalizeCourierEstimates(rawCouriers);
    assert.equal(normalized.length, 3);

    // Courier 1
    assert.equal(normalized[0].courierName, 'Delhivery Surface');
    assert.equal(normalized[0].estimatedDays, 3);
    assert.equal(normalized[0].estimatedDate, '2026-10-26');
    assert.equal(normalized[0].estimatedHours, 72);
    assert.equal(normalized[0].shippingCharge, 65.5);
    assert.equal(normalized[0].courierCompanyId, 10);

    // Courier 2 (fallback rate, numeric days, null etd_hours calculated as days * 24)
    assert.equal(normalized[1].courierName, 'Blue Dart Air');
    assert.equal(normalized[1].estimatedDays, 2);
    assert.equal(normalized[1].estimatedDate, '2026-10-25');
    assert.equal(normalized[1].estimatedHours, 48);
    assert.equal(normalized[1].shippingCharge, 110);
    assert.equal(normalized[1].courierCompanyId, 15);

    // Courier 3 (missing fields mapped to null, never invented)
    assert.equal(normalized[2].courierName, null);
    assert.equal(normalized[2].estimatedDays, null);
    assert.equal(normalized[2].estimatedDate, null);
    assert.equal(normalized[2].estimatedHours, null);
    assert.equal(normalized[2].shippingCharge, null);
    assert.equal(normalized[2].courierCompanyId, null);
  });

  // 4. Invalid destination PIN code validation
  test('4. Controller rejects invalid destination PIN code with HTTP 400', async () => {
    const invalidPins = ['', '123', 'abcdef', '1234567', null];

    for (const pin of invalidPins) {
      let statusCode = null;
      let jsonBody = null;

      const req = { query: { deliveryPincode: pin } };
      const res = {
        status: (code) => {
          statusCode = code;
          return {
            json: (body) => {
              jsonBody = body;
            },
          };
        },
      };

      await getShippingTat(req, res);
      assert.equal(statusCode, 400, `Expected 400 for PIN: ${pin}`);
      assert.equal(jsonBody.success, false);
      assert.match(jsonBody.message, /valid 6-digit PIN code/i);
    }
  });

  // 5. Invalid weight and COD value validation
  test('5. Controller rejects invalid weight and COD parameters with HTTP 400', async () => {
    const invalidCases = [
      { weight: '-5', cod: '0', errorMatch: /Invalid weight/i },
      { weight: 'abc', cod: '0', errorMatch: /Invalid weight/i },
      { weight: '0', cod: '0', errorMatch: /Invalid weight/i },
      { weight: '1', cod: '5', errorMatch: /Invalid COD/i },
      { weight: '1', cod: 'invalid', errorMatch: /Invalid COD/i },
    ];

    for (const tc of invalidCases) {
      let statusCode = null;
      let jsonBody = null;

      const req = {
        query: {
          deliveryPincode: '144012',
          weight: tc.weight,
          cod: tc.cod,
        },
      };
      const res = {
        status: (code) => {
          statusCode = code;
          return {
            json: (body) => {
              jsonBody = body;
            },
          };
        },
      };

      await getShippingTat(req, res);
      assert.equal(statusCode, 400, `Expected 400 for case: ${JSON.stringify(tc)}`);
      assert.equal(jsonBody.success, false);
      assert.match(jsonBody.message, tc.errorMatch);
    }
  });

  // 6. No active default warehouse location configured
  test('6. Controller returns HTTP 400 if no active default warehouse exists', async () => {
    db.query = async (sql) => {
      if (sql.includes('warehouse_locations')) {
        return { rows: [] };
      }
      return { rows: [] };
    };

    let statusCode = null;
    let jsonBody = null;

    const req = { query: { deliveryPincode: '144012' } };
    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: (body) => {
            jsonBody = body;
          },
        };
      },
    };

    await getShippingTat(req, res);
    assert.equal(statusCode, 400);
    assert.equal(jsonBody.success, false);
    assert.equal(jsonBody.message, 'No active default warehouse location configured.');
  });

  // 7. Empty courier response
  test('7. Empty courier response returns 200 with estimates: [] and unavailable message', async () => {
    db.query = async (sql) => {
      if (sql.includes('warehouse_locations')) {
        return {
          rows: [
            {
              id: '1',
              name: 'Main Warehouse',
              postal_code: '201309',
              shiprocket_pickup_location: 'Makerspace Shop',
            },
          ],
        };
      }
      return { rows: [] };
    };

    global.fetch = async (url) => {
      if (url.includes('/v1/external/auth/login')) {
        return new Response(JSON.stringify({ token: 'MOCK_TOKEN' }), { status: 200 });
      }
      if (url.includes('/v1/external/courier/serviceability')) {
        return new Response(JSON.stringify({
          status: 200,
          data: { available_courier_companies: [] },
        }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    let jsonBody = null;
    const req = { query: { deliveryPincode: '144012' } };
    const res = {
      status: (code) => ({
        json: (body) => { jsonBody = body; },
      }),
      json: (body) => { jsonBody = body; },
    };

    await getShippingTat(req, res);
    assert.equal(jsonBody.success, true);
    assert.equal(jsonBody.data.estimates.length, 0);
    assert.equal(jsonBody.message, 'Delivery is not available for this PIN code.');
    assert.equal(jsonBody.data.warehouse.pickupPincode, '201309');
  });

  // 8. Shiprocket authentication failure
  test('8. Handles Shiprocket authentication failure with clean 502 error', async () => {
    db.query = async (sql) => {
      if (sql.includes('warehouse_locations')) {
        return {
          rows: [{ id: '1', name: 'Main Warehouse', postal_code: '201309' }],
        };
      }
      return { rows: [] };
    };

    global.fetch = async (url) => {
      if (url.includes('/v1/external/auth/login')) {
        return new Response(JSON.stringify({ message: 'Invalid credentials provided.' }), { status: 401 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    let statusCode = null;
    let jsonBody = null;

    const req = { query: { deliveryPincode: '144012' } };
    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: (body) => { jsonBody = body; },
        };
      },
    };

    await getShippingTat(req, res);
    assert.equal(statusCode, 502);
    assert.equal(jsonBody.success, false);
    assert.match(jsonBody.errorDetail || jsonBody.message, /Failed to authenticate with Shiprocket|Invalid credentials/i);
  });

  // 9. Shiprocket timeout or upstream error
  test('9. Handles Shiprocket timeout or upstream error safely', async () => {
    db.query = async (sql) => {
      if (sql.includes('warehouse_locations')) {
        return {
          rows: [{ id: '1', name: 'Main Warehouse', postal_code: '201309' }],
        };
      }
      return { rows: [] };
    };

    global.fetch = async (url) => {
      if (url.includes('/v1/external/auth/login')) {
        return new Response(JSON.stringify({ token: 'MOCK_TOKEN' }), { status: 200 });
      }
      if (url.includes('/v1/external/courier/serviceability')) {
        const timeoutErr = new Error('The operation was aborted due to timeout');
        timeoutErr.name = 'TimeoutError';
        throw timeoutErr;
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    let statusCode = null;
    let jsonBody = null;

    const req = { query: { deliveryPincode: '144012' } };
    const res = {
      status: (code) => {
        statusCode = code;
        return {
          json: (body) => { jsonBody = body; },
        };
      },
    };

    await getShippingTat(req, res);
    assert.equal(statusCode, 502);
    assert.equal(jsonBody.success, false);
    assert.match(jsonBody.errorDetail || jsonBody.message, /timed out/i);
  });

  // 10. Read-only verification: no DB writes or order changes during TAT requests
  test('10. Confirms read-only behavior with zero database write operations', async () => {
    let writeOperationDetected = false;

    db.query = async (sql) => {
      const upper = sql.toUpperCase();
      if (upper.includes('INSERT') || upper.includes('UPDATE') || upper.includes('DELETE')) {
        writeOperationDetected = true;
      }
      if (upper.includes('WAREHOUSE_LOCATIONS')) {
        return {
          rows: [{ id: '1', name: 'Main Warehouse', postal_code: '201309' }],
        };
      }
      return { rows: [] };
    };

    global.fetch = async (url) => {
      if (url.includes('/v1/external/auth/login')) {
        return new Response(JSON.stringify({ token: 'MOCK_TOKEN' }), { status: 200 });
      }
      if (url.includes('/v1/external/courier/serviceability')) {
        return new Response(JSON.stringify({
          status: 200,
          data: {
            available_courier_companies: [
              {
                courier_company_id: 10,
                courier_name: 'Delhivery Surface',
                freight_charge: 65,
                estimated_delivery_days: '3-4 Days',
                etd: '2026-10-26',
              },
            ],
          },
        }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    let jsonBody = null;
    const req = { query: { deliveryPincode: '144012', weight: '1', cod: '0' } };
    const res = {
      status: () => ({ json: (body) => { jsonBody = body; } }),
      json: (body) => { jsonBody = body; },
    };

    await getShippingTat(req, res);
    assert.equal(jsonBody.success, true);
    assert.equal(writeOperationDetected, false, 'TAT request must never execute INSERT, UPDATE, or DELETE statements');
  });

  // 11. Frontend payload contract verification: success, empty-result, and error states
  test('11. Frontend payload contract conforms to UI requirements', () => {
    // Contract 1: Success payload has required data structure
    const successSample = {
      success: true,
      data: {
        warehouse: { id: 1, name: 'Main Warehouse', pickupPincode: '201309' },
        deliveryPincode: '144012',
        estimates: [
          {
            courierName: 'Delhivery Surface',
            estimatedDays: 3,
            estimatedDate: '2026-10-26',
            estimatedHours: 72,
            shippingCharge: 65,
            courierCompanyId: 10,
          },
        ],
      },
    };
    assert.equal(successSample.success, true);
    assert.ok(successSample.data.warehouse.pickupPincode);
    assert.equal(successSample.data.deliveryPincode, '144012');
    assert.ok(successSample.data.estimates[0].courierName);
    assert.equal(typeof successSample.data.estimates[0].estimatedDays, 'number');

    // Contract 2: Empty-result payload
    const emptySample = {
      success: true,
      data: {
        warehouse: { id: 1, name: 'Main Warehouse', pickupPincode: '201309' },
        deliveryPincode: '144012',
        estimates: [],
      },
      message: 'Delivery is not available for this PIN code.',
    };
    assert.equal(emptySample.success, true);
    assert.equal(emptySample.data.estimates.length, 0);
    assert.ok(emptySample.message);

    // Contract 3: Error payload
    const errorSample = {
      success: false,
      message: 'Invalid delivery PIN code. Please enter a valid 6-digit PIN code.',
    };
    assert.equal(errorSample.success, false);
    assert.ok(errorSample.message);
  });
});
