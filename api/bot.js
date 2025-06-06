// api/bot.js
const TelegramBot = require('node-telegram-bot-api');
const { connectDB, updateTransactionStatus, getOrCreateUser, updateUserBalance } = require('../utils/db');
const { registerBotHandlers } = require('../utils/bot_handlers');
const { verifyTransaction } = require('../utils/paystack');
const { BOT_MESSAGES } = require('../config/constants');
const express = require('express');
const crypto = require('crypto');

const app = express();
let isDbConnected = false; // Add a flag to track DB connection state

// Middleware to parse JSON bodies
app.use(express.json());

// Initialize bot without polling for webhook
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

// --- Connect to DB and Register Handlers ASYNCHRONOUSLY at Cold Start ---
async function initializeBotAndDB() {
    try {
        console.log('Initiating DB connection and bot setup...');
        await connectDB(process.env.MONGODB_URL);
        isDbConnected = true; // Set flag after successful connection
        console.log('✅ Database connected for Vercel deployment. Registering bot handlers.');
        
        // Register bot handlers ONLY after DB connection is successful
        registerBotHandlers(bot);

        // Optional: Set webhook here if you absolutely need it to run on cold start,
        // but typically better to set once via a separate script or Vercel config.
        // const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
        // if (webhookUrl) {
        //     await bot.setWebhook(webhookUrl);
        //     console.log(`Webhook set to: ${webhookUrl}`);
        // } else {
        //     console.warn('TELEGRAM_WEBHOOK_URL not set. Webhook not explicitly set by bot.');
        // }

    } catch (err) {
        isDbConnected = false; // Ensure flag is false on error
        console.error('❌ FATAL: Database connection or bot setup failed:', err);
        // In a real application, consider a way to notify yourself.
        // For Vercel, this function will simply fail the current request.
        // Subsequent requests might re-attempt initialization.
    }
}

// Call the initialization function. This will run once per cold start.
// Subsequent invocations of the same warm function instance will skip it due to 'isConnected' in db.js.
initializeBotAndDB();


// --- MIDDLEWARE TO ENSURE DB IS CONNECTED FOR REQUESTS ---
// This middleware will block requests until DB is connected.
// If the connection fails, it will return an error to Telegram/Paystack.
app.use(async (req, res, next) => {
    if (isDbConnected) {
        return next(); // DB is already connected, proceed
    }

    // If not connected, try to connect again or wait for ongoing connection
    try {
        console.log('DB not yet connected, attempting connection or waiting for initialization...');
        await connectDB(process.env.MONGODB_URL); // This will either connect or reuse existing pending connection
        isDbConnected = true; // Mark as connected
        next(); // Proceed once connected
    } catch (err) {
        console.error('❌ Request received before DB connection established and failed:', err);
        // Respond with an error to the client (Telegram/Paystack)
        res.status(503).send('Database connection unavailable. Please try again.');
    }
});


// Telegram webhook endpoint
app.post('/api/bot', async (req, res) => {
    // console.log('Received Telegram webhook update:', req.body); // Log for debugging
    try {
        // Process update only if DB is connected (guaranteed by middleware above)
        await bot.processUpdate(req.body);
        res.status(200).send('OK');
    } catch (error) {
        console.error('Error processing Telegram update:', error.message);
        res.status(500).send('Error');
    }
});

// Paystack webhook endpoint
app.post('/api/webhook', async (req, res) => {
    console.log('Received Paystack webhook event.');

    const secret = process.env.PAYSTACK_SECRET_KEY;
    
    if (!secret) {
        console.error('PAYSTACK_SECRET_KEY is not set! Cannot verify Paystack webhook signature.');
        return res.status(500).send('Server configuration error');
    }

    const hash = crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
        console.warn('Paystack webhook: Invalid signature received!');
        return res.status(400).send('Invalid signature');
    }

    const event = req.body;
    console.log(`Paystack event type: ${event.event}`);

    if (event.event === 'charge.success') {
        const reference = event.data.reference;
        const amount = event.data.amount / 100;
        const userId = event.data.metadata ? event.data.metadata.userId : null;
        const chatId = event.data.metadata ? event.data.metadata.chatId : null;

        if (!userId) {
            console.error(`Paystack webhook: No userId found in metadata for reference ${reference}.`);
            return res.status(400).send('Missing userId in metadata');
        }

        try {
            const transaction = await updateTransactionStatus(reference, 'completed', userId);

            if (transaction && transaction.type === 'deposit' && transaction.status === 'completed') {
                await updateUserBalance(userId, amount);
                console.log(`Deposit confirmed for user ${userId}, amount ${amount}.`);

                if (chatId) {
                    await bot.sendMessage(chatId, BOT_MESSAGES.PAYMENT_CONFIRMED(amount));
                }
            } else if (transaction && transaction.type === 'withdrawal' && transaction.status === 'pending') {
                 console.log(`Paystack webhook: Withdrawal reference ${reference} might need attention.`);
            }
        } catch (error) {
            console.error(`Error processing successful charge for reference ${reference}:`, error);
        }
    } else if (event.event === 'transfer.success') {
        const reference = event.data.reference;
        const recipientCode = event.data.recipient.recipient_code;

        try {
            const transaction = await updateTransactionStatus(reference, 'completed');
            if (transaction && transaction.type === 'withdrawal') {
                console.log(`Withdrawal confirmed as successful for reference ${reference}.`);
            }
        } catch (error) {
            console.error(`Error processing successful transfer for reference ${reference}:`, error);
        }
    } else if (event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
        const reference = event.data.reference;
        const reason = event.data.reason;

        try {
            const transaction = await updateTransactionStatus(reference, 'failed');
            if (transaction && transaction.type === 'withdrawal' && transaction.status === 'failed') {
                const user = await getOrCreateUser(transaction.metadata.userId);
                if (user) {
                    await updateUserBalance(user.telegramId, transaction.amount);
                    await bot.sendMessage(user.telegramId, `❌ Your withdrawal of ₦${transaction.amount.toFixed(2)} with reference \`${reference}\` failed: ${reason}. Your balance has been reverted.`);
                    console.log(`Withdrawal failed for reference ${reference}, balance reverted for user ${user.telegramId}.`);
                }
            }
        } catch (error) {
            console.error(`Error processing failed/reversed transfer for reference ${reference}:`, error);
        }
    }

    res.status(200).send('OK');
});

module.exports = app;
