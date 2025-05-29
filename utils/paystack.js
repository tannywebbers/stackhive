// utils/paystack.js
const axios = require('axios');
const crypto = require('crypto');
const { PAYSTACK_WEBHOOK_URL } = require('../config/constants'); // Will be replaced by env var

// Access environment variables directly here, as dotenv should be loaded once in main entry or Vercel config
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY;
const PAYSTACK_WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET;

const PAYSTACK_API_BASE_URL = 'https://api.paystack.co';

/**
 * Initializes a Paystack transaction.
 * @param {string} email - User's email.
 * @param {number} amount - Amount in NGN (will be converted to kobo).
 * @param {object} metadata - Custom metadata for the transaction.
 * @returns {Promise<object>} - Paystack initialization response.
 */
async function initializeTransaction(email, amount, metadata) {
    try {
        const response = await axios.post(`${PAYSTACK_API_BASE_URL}/transaction/initialize`, {
            email: email,
            amount: amount * 100, // amount in kobo
            currency: 'NGN',
            callback_url: process.env.PAYSTACK_WEBHOOK_URL, // Use the Vercel webhook URL
            metadata: metadata // Pass metadata directly
        }, {
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        console.error('Paystack transaction initialization error:', error.response ? error.response.data : error.message);
        throw new Error('Failed to initialize Paystack transaction');
    }
}

/**
 * Verifies a Paystack transaction.
 * @param {string} reference - Transaction reference.
 * @returns {Promise<object>} - Paystack verification response.
 */
async function verifyTransaction(reference) {
    try {
        const response = await axios.get(`${PAYSTACK_API_BASE_URL}/transaction/verify/${reference}`, {
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
            }
        });
        return response.data;
    } catch (error) {
        console.error('Paystack transaction verification error:', error.response ? error.response.data : error.message);
        throw new Error('Failed to verify Paystack transaction');
    }
}

/**
 * Initiates a Paystack transfer (withdrawal).
 * @param {string} recipientCode - Paystack recipient code.
 * @param {number} amount - Amount in NGN (will be converted to kobo).
 * @param {string} reference - Unique transfer reference.
 * @param {string} reason - Reason for transfer.
 * @returns {Promise<object>} - Paystack transfer response.
 */
async function initiateTransfer(recipientCode, amount, reference, reason) {
    try {
        const response = await axios.post(`${PAYSTACK_API_BASE_URL}/transfer`, {
            source: "balance", // Transfer from your Paystack balance
            reason: reason,
            amount: amount * 100, // amount in kobo
            recipient: recipientCode,
            reference: reference
        }, {
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        console.error('Paystack transfer initiation error:', error.response ? error.response.data : error.message);
        throw new Error('Failed to initiate Paystack transfer');
    }
}

/**
 * Creates a Paystack transfer recipient.
 * @param {string} name - Recipient name.
 * @param {string} account_number - Recipient account number.
 * @param {string} bank_code - Recipient bank code.
 * @returns {Promise<object>} - Paystack recipient creation response.
 */
async function createTransferRecipient(name, account_number, bank_code) {
    try {
        const response = await axios.post(`${PAYSTACK_API_BASE_URL}/transferrecipient`, {
            type: "nuban", // Nigerian bank account
            name: name,
            account_number: account_number,
            bank_code: bank_code,
            currency: "NGN"
        }, {
            headers: {
                Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        return response.data;
    } catch (error) {
        console.error('Paystack create recipient error:', error.response ? error.response.data : error.message);
        throw new Error('Failed to create Paystack transfer recipient');
    }
}

/**
 * Verifies Paystack webhook signature.
 * @param {string} signature - The X-Paystack-Signature header value.
 * @param {object} payload - The raw request body.
 * @returns {boolean} - True if signature is valid, false otherwise.
 */
function verifyWebhookSignature(signature, payload) {
    const hash = crypto.createHmac('sha512', PAYSTACK_WEBHOOK_SECRET)
                       .update(JSON.stringify(payload))
                       .digest('hex');
    return hash === signature;
}

/**
 * Fetches bank codes from Paystack.
 * @returns {Promise<Array>} - List of bank objects.
 */
async function getBankCodes() {
    try {
        const response = await axios.get(`${PAYSTACK_API_BASE_URL}/bank`, {
            headers: {
                Authorization: `Bearer ${PAYSTACK_PUBLIC_KEY}` // Public key is fine for this
            }
        });
        return response.data.data;
    } catch (error) {
        console.error('Error fetching bank codes:', error.response ? error.response.data : error.message);
        throw new Error('Failed to fetch bank codes');
    }
}

module.exports = {
    initializeTransaction,
    verifyTransaction,
    initiateTransfer,
    createTransferRecipient,
    verifyWebhookSignature,
    getBankCodes
};
