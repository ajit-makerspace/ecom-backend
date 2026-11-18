
import crypto from 'crypto';
import db from '../../config/db.js';

const RAZORPAY_BASE_URL = 'https://api.razorpay.com/v1';

const getRazorpayAuth = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials are not configured.');
  }

  return {
    keyId,
    keySecret,
    authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
  };
};

// Convert INR to paise safely
const toPaise = (amount) => {
  const value = Number(amount);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Invalid quotation amount.');
  }

  return Math.round(value * 100);
};

// Common Razorpay API request
const razorpayRequest = async (url, options = {}) => {
  const { authorization } = getRazorpayAuth();

  const response = await fetch(`${RAZORPAY_BASE_URL}${url}`, {
    ...options,
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error?.description || 'Razorpay API request failed.'
    );
  }

  return data;
};

/**
 * 1. Create Razorpay Order for an accepted print quotation
 *
 * POST /print-requests/:id/payment/create-order
 */
export const createPrintRequestPaymentOrder = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    if (!/^\d+$/.test(String(id)) || Number(id) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid print request ID.',
      });
    }

    // 1. Fetch customer's accepted quotation.
    const { rows } = await db.query(
      `
      SELECT
        pr.id AS print_request_id,
        pr.user_id,
        pr.status AS request_status,
        pr.accepted_quotation_id,
        q.id AS quotation_id,
        q.version_number,
        q.amount,
        q.is_current
      FROM print_requests pr
      INNER JOIN print_request_quotations q
        ON q.id = pr.accepted_quotation_id
      WHERE pr.id = $1
        AND pr.user_id = $2
        AND q.is_current = TRUE
      LIMIT 1
      `,
      [id, userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Accepted quotation not found for this print request.',
      });
    }

    const request = rows[0];

    // 2. Validate request status.
    if (request.request_status !== 'awaiting_payment') {
      return res.status(400).json({
        success: false,
        message: 'This print request is not awaiting payment.',
        currentStatus: request.request_status,
      });
    }

    const amountInPaise = toPaise(request.amount);
    const { keyId } = getRazorpayAuth();

    // 3. Check for an existing pending payment attempt.
    const existingPayment = await db.query(
      `
      SELECT
        id,
        razorpay_order_id,
        amount,
        currency
      FROM print_request_payments
      WHERE print_request_id = $1
        AND quotation_id = $2
        AND status = 'PENDING'
        AND razorpay_order_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [request.print_request_id, request.quotation_id]
    );

    // 4. Reuse existing Razorpay order if available.
    if (existingPayment.rows.length > 0) {
      const payment = existingPayment.rows[0];

      if (
        Number(payment.amount) !== amountInPaise ||
        payment.currency !== 'INR'
      ) {
        return res.status(409).json({
          success: false,
          message: 'Existing payment amount does not match the quotation.',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Existing payment order retrieved.',
        payment: {
          paymentId: payment.id,
          printRequestId: request.print_request_id,
          quotationId: request.quotation_id,
          quotationVersion: request.version_number,
          amount: amountInPaise,
          amountInRupees: Number(request.amount),
          currency: 'INR',
          razorpayOrderId: payment.razorpay_order_id,
          keyId,
        },
      });
    }

    // 5. Create a new Razorpay order.
    const razorpayOrder = await razorpayRequest('/orders', {
      method: 'POST',
      body: JSON.stringify({
        amount: amountInPaise,
        currency: 'INR',
        receipt: `print_${request.print_request_id}_${Date.now()}`,
        notes: {
          type: '3D_PRINTING',
          print_request_id: String(request.print_request_id),
          quotation_id: String(request.quotation_id),
          user_id: String(userId),
          quotation_version: String(request.version_number),
        },
      }),
    });

    // 6. Save payment attempt.
    const paymentResult = await db.query(
      `
      INSERT INTO print_request_payments (
        print_request_id,
        quotation_id,
        razorpay_order_id,
        amount,
        currency,
        status
      )
      VALUES ($1, $2, $3, $4, 'INR', 'PENDING')
      RETURNING *
      `,
      [
        request.print_request_id,
        request.quotation_id,
        razorpayOrder.id,
        amountInPaise,
      ]
    );

    return res.status(201).json({
      success: true,
      message: 'Payment order created successfully.',
      payment: {
        paymentId: paymentResult.rows[0].id,
        printRequestId: request.print_request_id,
        quotationId: request.quotation_id,
        quotationVersion: request.version_number,
        amount: amountInPaise,
        amountInRupees: Number(request.amount),
        currency: 'INR',
        razorpayOrderId: razorpayOrder.id,
        keyId,
      },
    });
  } catch (error) {
    console.error('Create Print Payment Order Error:', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to create payment order.',
    });
  }
};

/**
 * 2. Verify Razorpay Payment
 *
 * POST /print-requests/:id/payment/verify
 */
export const verifyPrintRequestPayment = async (req, res) => {
  let client;
  let transactionStarted = false;

  try {
    client = await db.pool.connect();

    const { id } = req.params;
    const userId = req.user?.id;

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    if (!/^\d+$/.test(String(id)) || Number(id) <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid print request ID.',
      });
    }

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        success: false,
        message: 'Missing Razorpay verification parameters.',
      });
    }

    const { keySecret } = getRazorpayAuth();

    // Verify Razorpay signature.
    const expectedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const receivedBuffer = Buffer.from(
      String(razorpay_signature),
      'hex'
    );

    if (
      expectedBuffer.length !== receivedBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Razorpay payment signature.',
      });
    }

    // Retrieve the payment attempt belonging to this customer.
    const paymentLookup = await db.query(
      `
      SELECT
        p.*,
        pr.user_id,
        pr.status AS request_status,
        pr.accepted_quotation_id
      FROM print_request_payments p
      INNER JOIN print_requests pr
        ON pr.id = p.print_request_id
      WHERE p.print_request_id = $1
        AND p.razorpay_order_id = $2
        AND pr.user_id = $3
      LIMIT 1
      `,
      [id, razorpay_order_id, userId]
    );

    if (paymentLookup.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment record not found.',
      });
    }

    const existingPayment = paymentLookup.rows[0];

    // Handle already verified payment.
    if (existingPayment.status === 'SUCCESS') {
      if (
        existingPayment.razorpay_payment_id !== razorpay_payment_id
      ) {
        return res.status(409).json({
          success: false,
          message: 'This order has already been paid using another payment ID.',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Payment already verified.',
        isDuplicate: true,
        payment: existingPayment,
      });
    }

    // Verify that the payment ID has not been used by another payment record.
    const duplicateCheck = await db.query(
      `
      SELECT id
      FROM print_request_payments
      WHERE razorpay_payment_id = $1
        AND id <> $2
      LIMIT 1
      `,
      [razorpay_payment_id, existingPayment.id]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'This payment ID has already been processed.',
      });
    }

    // Verify payment directly with Razorpay.
    const razorpayPayment = await razorpayRequest(
      `/payments/${encodeURIComponent(razorpay_payment_id)}`,
      { method: 'GET' }
    );

    if (razorpayPayment.order_id !== razorpay_order_id) {
      return res.status(400).json({
        success: false,
        message: 'Payment does not belong to the supplied Razorpay order.',
      });
    }

    if (razorpayPayment.status !== 'captured') {
      return res.status(400).json({
        success: false,
        message: `Payment is not captured. Current status: ${razorpayPayment.status}`,
      });
    }

    if (
      Number(razorpayPayment.amount) !== Number(existingPayment.amount) ||
      razorpayPayment.currency !== existingPayment.currency
    ) {
      return res.status(400).json({
        success: false,
        message: 'Payment amount or currency mismatch.',
      });
    }

    await client.query('BEGIN');
    transactionStarted = true;

    // Lock print request to prevent concurrent confirmations.
    const requestResult = await client.query(
      `
      SELECT
        id,
        user_id,
        status,
        accepted_quotation_id
      FROM print_requests
      WHERE id = $1
        AND user_id = $2
      FOR UPDATE
      `,
      [id, userId]
    );

    if (requestResult.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return res.status(404).json({
        success: false,
        message: 'Print request not found.',
      });
    }

    const printRequest = requestResult.rows[0];

    // Lock payment attempt.
    const lockedPayment = await client.query(
      `
      SELECT *
      FROM print_request_payments
      WHERE razorpay_order_id = $1
        AND print_request_id = $2
      FOR UPDATE
      `,
      [razorpay_order_id, id]
    );

    if (lockedPayment.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return res.status(404).json({
        success: false,
        message: 'Payment attempt not found.',
      });
    }

    const payment = lockedPayment.rows[0];

    // Handle concurrent or repeated verification.
    if (payment.status === 'SUCCESS') {
      await client.query('COMMIT');
      transactionStarted = false;

      if (payment.razorpay_payment_id !== razorpay_payment_id) {
        return res.status(409).json({
          success: false,
          message: 'This order has already been paid using another payment ID.',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Payment already verified.',
        isDuplicate: true,
        payment,
      });
    }

    // Ensure only pending payments can be verified.
    if (payment.status !== 'PENDING') {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        message: 'This payment attempt is no longer pending.',
        currentPaymentStatus: payment.status,
      });
    }

    // Validate the accepted quotation from the database.
    const quotationResult = await client.query(
      `
      SELECT
        id,
        amount,
        is_current
      FROM print_request_quotations
      WHERE id = $1
        AND print_request_id = $2
      FOR UPDATE
      `,
      [printRequest.accepted_quotation_id, id]
    );

    if (quotationResult.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        message: 'Accepted quotation not found.',
      });
    }

    const quotation = quotationResult.rows[0];

    if (
      !quotation.is_current ||
      String(quotation.id) !== String(payment.quotation_id) ||
      toPaise(quotation.amount) !== Number(payment.amount)
    ) {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        message: 'Accepted quotation does not match the payment.',
      });
    }

    // Validate payment and quotation details.
    if (
      Number(payment.amount) !== Number(razorpayPayment.amount) ||
      payment.currency !== razorpayPayment.currency ||
      String(payment.quotation_id) !==
        String(printRequest.accepted_quotation_id)
    ) {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        message: 'Quotation or payment details no longer match.',
      });
    }

    if (printRequest.status !== 'awaiting_payment') {
      await client.query('ROLLBACK');
      transactionStarted = false;

      return res.status(409).json({
        success: false,
        message: 'Print request is not awaiting payment.',
        currentStatus: printRequest.status,
      });
    }

    // Mark payment successful.
    const updatedPayment = await client.query(
      `
      UPDATE print_request_payments
      SET
        razorpay_payment_id = $1,
        status = 'SUCCESS',
        payment_method = $2,
        failure_reason = NULL,
        updated_at = NOW()
      WHERE id = $3
      RETURNING *
      `,
      [
        razorpay_payment_id,
        razorpayPayment.method || 'razorpay',
        payment.id,
      ]
    );

    // Confirm print request only after verified captured payment.
    const updatedRequest = await client.query(
      `
      UPDATE print_requests
      SET
        status = 'confirmed',
        updated_at = NOW()
      WHERE id = $1
        AND user_id = $2
        AND accepted_quotation_id = $3
        AND status = 'awaiting_payment'
      RETURNING id, status, accepted_quotation_id
      `,
      [
        id,
        userId,
        payment.quotation_id,
      ]
    );

    if (updatedRequest.rows.length === 0) {
      throw new Error('Unable to confirm print request after payment.');
    }

    await client.query('COMMIT');
    transactionStarted = false;

    return res.status(200).json({
      success: true,
      message: 'Payment verified and print request confirmed successfully.',
      printRequest: updatedRequest.rows[0],
      payment: updatedPayment.rows[0],
    });
  } catch (error) {
    if (transactionStarted && client) {
      await client.query('ROLLBACK');
      transactionStarted = false;
    }

    console.error('Verify Print Payment Error:', error);

    return res.status(500).json({
      success: false,
      message: error.message || 'Payment verification failed.',
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * 3. Record failed payment attempt
 *
 * POST /print-requests/:id/payment/failure
 */
export const recordPrintRequestPaymentFailure = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const {
      razorpay_order_id,
      error_description,
      error_reason,
      error_code,
    } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    if (!razorpay_order_id) {
      return res.status(400).json({
        success: false,
        message: 'Razorpay order ID is required.',
      });
    }

    const failureReason =
      error_description ||
      error_reason ||
      error_code ||
      'Payment failed or cancelled by customer';

    const { rows } = await db.query(
      `
      UPDATE print_request_payments p
      SET
        status = 'FAILED',
        failure_reason = $1,
        updated_at = NOW()
      FROM print_requests pr
      WHERE p.print_request_id = pr.id
        AND p.print_request_id = $2
        AND p.razorpay_order_id = $3
        AND pr.user_id = $4
        AND p.status = 'PENDING'
      RETURNING p.*
      `,
      [
        String(failureReason).slice(0, 1000),
        id,
        razorpay_order_id,
        userId,
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Pending payment attempt not found.',
      });
    }

    return res.json({
      success: true,
      message: 'Payment failure recorded successfully.',
      payment: rows[0],
    });
  } catch (error) {
    console.error('Print Payment Failure Error:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to record payment failure.',
    });
  }
};

/**
 * 4. Get payment details for a print request
 *
 * GET /print-requests/:id/payment
 */
export const getPrintRequestPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const { rows } = await db.query(
      `
      SELECT
        p.id,
        p.print_request_id,
        p.quotation_id,
        p.razorpay_order_id,
        p.razorpay_payment_id,
        p.amount,
        p.currency,
        p.status,
        p.payment_method,
        p.failure_reason,
        p.created_at,
        p.updated_at
      FROM print_request_payments p
      INNER JOIN print_requests pr
        ON pr.id = p.print_request_id
      WHERE p.print_request_id = $1
        AND pr.user_id = $2
      ORDER BY p.created_at DESC
      `,
      [id, userId]
    );

    return res.json({
      success: true,
      count: rows.length,
      payments: rows,
    });
  } catch (error) {
    console.error('Get Print Request Payment Error:', error);

    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve print request payment details.',
    });
  }
};
