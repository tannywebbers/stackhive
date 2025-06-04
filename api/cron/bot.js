// api/bot.js (for Vercel deployment)
const TelegramBot = require('node-telegram-bot-api');
const { connectDB, updateTransactionStatus, getOrCreateUser, updateUserBalance } = require('../utils/db');
const { registerBotHandlers } = require('../utils/bot_handlers'); // Import handlers
const { verifyTransaction } = require('../utils/paystack'); // Import verifyTransaction
const { BOT_MESSAGES } = require('../config/constants'); // For sending confirmation messages
const express = require('express');
const crypto = require('crypto'); // For Paystack webhook signature verification
const app = express();

// Middleware to parse JSON bodies (for Telegram and Paystack webhooks)
app.use(express.json());

// Initialize bot without polling for webhook
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

// Register all bot handlers
registerBotHandlers(bot);

// Connect to DB once when the serverless function is "cold started"
connectDB().then(() => {
    console.log('✅ Database connected for Vercel deployment.');
}).catch(err => {
    console.error('❌ Database connection error for Vercel deployment:', err);
    // In a real application, you might want to send an error message to an admin.
    // For Vercel, simply logging and letting the function fail might be sufficient.
});

// Set up the webhook
async function setupWebhook() {
    try {
        const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
        if (!webhookUrl) {
            console.error('TELEGRAM_WEBHOOK_URL is not set!');
            return;
        }

        // Check current webhook info
        const webhookInfo = await bot.getWebhookInfo();
        if (webhookInfo.url === webhookUrl) {
            console.log(`➡️ Telegram webhook already correctly set to: ${webhookUrl}`);
        } else {
            const success = await bot.setWebhook(webhookUrl);
            if (success) {
                console.log(`✅ Telegram webhook successfully set to: ${webhookUrl}`);
            } else {
                console.error(`❌ Failed to set Telegram webhook to: ${webhookUrl}`);
            }
        }
    } catch (error) {
        console.error('❌ Error setting Telegram webhook:', error.message);
    }
}

// Setup webhook on every cold start
setupWebhook();


// Telegram webhook endpoint
app.post('/api/bot', async (req, res) => {
    // console.log('Received Telegram webhook update:', req.body); // Log for debugging
    try {
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

    const secret = process.env.PAYSTACK_SECRET_KEY; // Your Paystack secret key
    const hash = crypto.createHmac('sha512', secret).update(JSON.stringify(req.body)).digest('hex');

    if (hash !== req.headers['x-paystack-signature']) {
        console.warn('Paystack webhook: Invalid signature received!');
        return res.status(400).send('Invalid signature');
    }

    const event = req.body;
    console.log(`Paystack event type: ${event.event}`);

    // Handle successful payment
    if (event.event === 'charge.success') {
        const reference = event.data.reference;
        const amount = event.data.amount / 100; // Amount is in kobo, convert to naira
        const userId = event.data.metadata ? event.data.metadata.userId : null;
        const chatId = event.data.metadata ? event.data.metadata.chatId : null;

        if (!userId) {
            console.error(`Paystack webhook: No userId found in metadata for reference ${reference}.`);
            return res.status(400).send('Missing userId in metadata');
        }

        try {
            const transaction = await updateTransactionStatus(reference, 'completed', userId);

            if (transaction && transaction.type === 'deposit' && transaction.status === 'completed') {
                await updateUserBalance(userId, amount); // Add deposit amount to user balance
                console.log(`Deposit confirmed for user ${userId}, amount ${amount}.`);

                if (chatId) { // Send confirmation message to user
                    await bot.sendMessage(chatId, BOT_MESSAGES.PAYMENT_CONFIRMED(amount));
                    // Check for referrer bonus here if needed based on transaction data
                }
            } else if (transaction && transaction.type === 'withdrawal' && transaction.status === 'pending') {
                 // If it's a withdrawal confirmed by Paystack, mark it complete
                 // (This is less common, usually transfer success/failure webhooks are different events)
                 // For now, our withdrawal is marked initiated, and we'd rely on a 'transfer.success' event.
                 console.log(`Paystack webhook: Withdrawal reference ${reference} might need attention.`);
            }
        } catch (error) {
            console.error(`Error processing successful charge for reference ${reference}:`, error);
        }
    } else if (event.event === 'transfer.success') {
        const reference = event.data.reference;
        const recipientCode = event.data.recipient.recipient_code;

        try {
            const transaction = await updateTransactionStatus(reference, 'completed'); // Update status
            if (transaction && transaction.type === 'withdrawal') {
                console.log(`Withdrawal confirmed as successful for reference ${reference}.`);
                // You might want to get the user by transaction reference and send a message
                // This requires finding user by transaction.reference which updateTransactionStatus can do
            }
        } catch (error) {
            console.error(`Error processing successful transfer for reference ${reference}:`, error);
        }
    } else if (event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
        const reference = event.data.reference;
        const reason = event.data.reason;

        try {
            const transaction = await updateTransactionStatus(reference, 'failed'); // Update status
            if (transaction && transaction.type === 'withdrawal' && transaction.status === 'failed') {
                // Find the user who initiated this withdrawal
                const user = await getOrCreateUser(transaction.metadata.userId); // Assuming userId is in metadata
                if (user) {
                    await updateUserBalance(user.telegramId, transaction.amount); // Revert balance
                    await bot.sendMessage(user.telegramId, `❌ Your withdrawal of ₦${transaction.amount.toFixed(2)} with reference \`${reference}\` failed: ${reason}. Your balance has been reverted.`);
                    console.log(`Withdrawal failed for reference ${reference}, balance reverted for user ${user.telegramId}.`);
                }
            }
        } catch (error) {
            console.error(`Error processing failed/reversed transfer for reference ${reference}:`, error);
        }
    }
    // You might want to handle other event types like 'charge.failed', 'transfer.reversed' etc.

    res.status(200).send('OK'); // Always respond with 200 OK to Paystack
});

// Export the app for Vercel
module.exports = app;
