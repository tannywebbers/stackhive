// utils/paystack.js
const axios = require('axios');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_AUTHORIZATION_URL = 'https://api.paystack.co'; // Keep this consistent

// Ensure secret key is set
if (!PAYSTACK_SECRET_KEY) {
    console.error('PAYSTACK_SECRET_KEY is not set in environment variables!');
    // In a production app, you might want to throw an error or exit here.
}

// Function to initialize a payment
const initializeTransaction = async (email, amount, metadata = {}) => {
    try {
        const response = await axios.post(
            `${PAYSTACK_AUTHORIZATION_URL}/transaction/initialize`,
            {
                email: email,
                amount: amount * 100, // Paystack expects amount in kobo
                metadata: metadata,
                callback_url: process.env.PAYSTACK_CALLBACK_URL // Assuming this is set up correctly for webhooks
            },
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data; // Contains authorization_url, reference etc.
    } catch (error) {
        console.error('Paystack initialization error:', error.response ? error.response.data : error.message);
        throw error;
    }
};

// NEW FUNCTION: Get list of Nigerian banks
const getBankCodes = async () => {
    try {
        const response = await axios.get(
            `${PAYSTACK_AUTHORIZATION_URL}/bank?country=nigeria&use_cursor=true`,
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
                }
            }
        );
        return response.data.data; // Array of bank objects {id, name, slug, code, longcode}
    } catch (error) {
        console.error('Error fetching bank codes:', error.response ? error.response.data : error.message);
        throw error;
    }
};

// NEW FUNCTION: Resolve account number to get account name
const resolveAccount = async (accountNumber, bankCode) => {
    try {
        const response = await axios.get(
            `${PAYSTACK_AUTHORIZATION_URL}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
                }
            }
        );
        return response.data; // Contains {status, message, data: {account_number, account_name, bank_id}}
    } catch (error) {
        console.error('Error resolving account number:', error.response ? error.response.data : error.message);
        throw error;
    }
};


// NEW FUNCTION: Create a transfer recipient
const createTransferRecipient = async (name, accountNumber, bankCode) => {
    try {
        const response = await axios.post(
            `${PAYSTACK_AUTHORIZATION_URL}/transferrecipient`,
            {
                type: 'nuban', // Nigerian Universal Bank Account Number
                name: name,
                account_number: accountNumber,
                bank_code: bankCode,
                currency: 'NGN'
            },
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data; // Contains {status, message, data: {recipient_code, ...}}
    } catch (error) {
        console.error('Error creating transfer recipient:', error.response ? error.response.data : error.message);
        throw error;
    }
};

// Function to initiate a transfer
const initiateTransfer = async (recipientCode, amount, reference, reason) => {
    try {
        const response = await axios.post(
            `${PAYSTACK_AUTHORIZATION_URL}/transfer`,
            {
                source: 'balance', // Transfer from Paystack balance
                amount: amount * 100, // Amount in kobo
                recipient: recipientCode,
                reason: reason,
                reference: reference
            },
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        return response.data; // Contains {status, message, data: {id, status, ...}}
    } catch (error) {
        console.error('Paystack transfer initiation error:', error.response ? error.response.data : error.message);
        throw error;
    }
};

// Function to verify a transaction (e.g., from webhook or on demand)
const verifyTransaction = async (reference) => {
    try {
        const response = await axios.get(
            `${PAYSTACK_AUTHORIZATION_URL}/transaction/verify/${reference}`,
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
                }
            }
        );
        return response.data; // Contains {status, message, data: {amount, currency, status, ...}}
    } catch (error) {
        console.error('Paystack verification error:', error.response ? error.response.data : error.message);
        throw error;
    }
};


module.exports = {
    initializeTransaction,
    getBankCodes, // Export new functions
    resolveAccount, // Export new functions
    createTransferRecipient, // Export new functions
    initiateTransfer,
    verifyTransaction
};
