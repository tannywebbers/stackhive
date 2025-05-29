// api/webhook.js
const { verifyWebhookSignature, verifyTransaction } = require('../utils/paystack');
const { updateUserBalance, addTransaction, updateTransactionStatus } = require('../utils/db');
const { sendTelegramMessage } = require('../utils/telegram');
const { BOT_MESSAGES } = require('../config/constants');
const bodyParser = require('body-parser'); // Import body-parser

// This wrapper is necessary for Vercel's serverless function environment
module.exports = async (req, res) => {
    // We need the raw body for signature verification
    // Use bodyParser.raw specifically for this webhook.
    bodyParser.raw({ type: 'application/json' })(req, res, async () => {
        const signature = req.headers['x-paystack-signature'];
        let payload;
        try {
            payload = JSON.parse(req.body.toString());
        } catch (e) {
            console.error('Failed to parse JSON body:', e);
            return res.status(400).send('Invalid JSON payload');
        }

        // 1. Verify webhook signature
        if (!process.env.PAYSTACK_WEBHOOK_SECRET || !verifyWebhookSignature(signature, payload)) {
            console.warn('Webhook signature verification failed!');
            return res.status(400).send('Invalid signature');
        }

        // Acknowledge receipt immediately
        res.status(200).send('Webhook received');

        const event = payload.event;
        const data = payload.data;
        const reference = data.reference;
        const amount = data.amount / 100; // Convert kobo to NGN

        console.log(`Received Paystack webhook event: ${event} for reference: ${reference}`);

        try {
            if (event === 'charge.success') {
                const metadata = data.metadata;
                const telegramId = metadata ? (metadata.userId || metadata.telegramId) : null; // Ensure userId is captured
                const chatId = metadata ? metadata.chatId : null;

                if (!telegramId || !chatId) {
                    console.warn(`Webhook: charge.success missing telegramId or chatId in metadata for reference: ${reference}`);
                    return; // Can't send message to user
                }

                // Verify the transaction again to be sure (good practice)
                const verificationResponse = await verifyTransaction(reference);

                if (verificationResponse && verificationResponse.status && verificationResponse.data.status === 'success') {
                    // Update transaction status in DB
                    await updateTransactionStatus(reference, 'completed', telegramId);
                    const newBalance = await updateUserBalance(telegramId, amount);

                    const message = BOT_MESSAGES.DEPOSIT_SUCCESS(amount, newBalance);
                    sendTelegramMessage(chatId, message, { parse_mode: 'Markdown', ...BOT_MESSAGES.MAIN_MENU_KEYBOARD });
                    console.log(`Deposit successful for user ${telegramId}: NGN ${amount}`);
                } else {
                    // Payment was not successfully verified
                    await updateTransactionStatus(reference, 'failed', telegramId);
                    sendTelegramMessage(chatId, BOT_MESSAGES.DEPOSIT_FAILED(amount, reference), { parse_mode: 'Markdown', ...BOT_MESSAGES.MAIN_MENU_KEYBOARD });
                    console.warn(`Webhook: charge.success but verification failed for reference: ${reference}`);
                }
            } else if (event === 'transfer.success') {
                const telegramId = reference.split('-')[1]; // Extract user ID from reference
                const user = await require('../utils/db').getOrCreateUser(telegramId); // Get user to obtain chat ID
                const chatId = user.telegramId; // Assuming telegramId is same as chatId for private chats

                if (!telegramId || !chatId) {
                     console.warn(`Webhook: transfer.success missing telegramId/chatId in reference for reference: ${reference}`);
                     return;
                }

                await updateTransactionStatus(reference, 'completed', telegramId);
                const message = BOT_MESSAGES.WITHDRAWAL_INITIATED.replace('You will receive it shortly.', 'Funds have been sent to your account.'); // Adapt message
                sendTelegramMessage(chatId, message, { ...BOT_MESSAGES.MAIN_MENU_KEYBOARD });
                console.log(`Withdrawal successful for user ${telegramId}: NGN ${amount}`);
            } else if (event === 'transfer.failed' || event === 'transfer.reversed') {
                const telegramId = reference.split('-')[1];
                const user = await require('../utils/db').getOrCreateUser(telegramId);
                const chatId = user.telegramId;

                if (!telegramId || !chatId) {
                     console.warn(`Webhook: transfer.failed/reversed missing telegramId/chatId in reference for reference: ${reference}`);
                     return;
                }

                // Revert balance and update transaction status
                const newBalance = await updateUserBalance(telegramId, amount);
                await updateTransactionStatus(reference, event, telegramId, { reason: data.failures ? data.failures.join(', ') : 'Unknown reason' });

                const message = BOT_MESSAGES.WITHDRAWAL_FAILED(amount, data.failures ? data.failures.join(', ') : 'Unknown reason') + ` Your new balance is ₦${newBalance.toFixed(2)}.`;
                sendTelegramMessage(chatId, message, { parse_mode: 'Markdown', ...BOT_MESSAGES.MAIN_MENU_KEYBOARD });
                console.warn(`Withdrawal failed/reversed for user ${telegramId}: NGN ${amount}. Event: ${event}`);
            } else {
                console.log(`Unhandled Paystack event: ${event}`);
            }
        } catch (error) {
            console.error('Error processing Paystack webhook:', error);
            // In a real scenario, you might log this to a monitoring system
            // and have a fallback mechanism for failed webhook processing.
        }
    });
};
