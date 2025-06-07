// api/webhook.js
const { verifyWebhookSignature, verifyTransaction } = require('../utils/paystack');
const { updateUserBalance, addTransaction, updateTransactionStatus } = require('../utils/db');
const { sendTelegramMessage } = require('../utils/telegram'); // Make sure this function exists and is implemented
const { BOT_MESSAGES } = require('../config/constants');
const crypto = require('crypto'); // Used for signature verification

// This module exports an Express-compatible middleware function.
module.exports = async (req, res) => {
    // Acknowledge receipt immediately to avoid re-sends from Paystack.
    // The actual processing will happen asynchronously in the background.
    res.status(200).send('Webhook received');

    const secret = process.env.PAYSTACK_SECRET_KEY; // Your Paystack Secret Key from environment variables
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.rawBody; // This is provided by the custom middleware in index.js
    const payload = req.body; // This is the parsed JSON object from the custom middleware in index.js

    // --- 1. Verify webhook signature ---
    if (!secret) {
        console.error('PAYSTACK_SECRET_KEY is not set! Cannot verify Paystack webhook signature.');
        // Don't send 400 here, as we already sent 200. Just log and exit processing.
        return;
    }

    const hash = crypto.createHmac('sha512', secret).update(rawBody.toString('utf8')).digest('hex'); // Use utf8 encoding

    if (hash !== signature) {
        console.warn('Paystack webhook: Invalid signature received! Calculated:', hash, 'Received:', signature);
        // Don't send 400 here, as we already sent 200. Just log and exit processing.
        return;
    }

    const event = payload.event;
    const data = payload.data;
    const reference = data.reference;
    // Amount is in kobo from Paystack, convert to actual currency (e.g., NGN)
    const amount = data.amount / 100;

    console.log(`Received Paystack webhook event: ${event} for reference: ${reference}`);

    try {
        if (event === 'charge.success') {
            const metadata = data.metadata;
            const telegramId = metadata ? (metadata.userId || metadata.telegramId) : null;
            const chatId = metadata ? metadata.chatId : null; // Assuming userId is often same as chatId for private bots

            if (!telegramId || !chatId) {
                console.warn(`Webhook: charge.success missing telegramId or chatId in metadata for reference: ${reference}. Cannot update user or send message.`);
                return;
            }

            // Verify the transaction again with Paystack's API (good practice)
            const verificationResponse = await verifyTransaction(reference);

            if (verificationResponse && verificationResponse.status && verificationResponse.data.status === 'success') {
                // Prevent double crediting: Check if transaction is already completed
                const userWithTransaction = await require('../utils/db').User.findOne({
                    telegramId,
                    'transactions.reference': reference,
                    'transactions.status': 'completed'
                });

                if (userWithTransaction) {
                    console.warn(`Webhook: charge.success for reference ${reference} already completed. Avoiding double credit.`);
                    return; // Transaction already processed
                }

                // Update transaction status in DB to 'completed'
                await updateTransactionStatus(reference, 'completed', telegramId);
                // Credit user balance
                const newBalance = await updateUserBalance(telegramId, amount);

                // Send success message to user
                const message = BOT_MESSAGES.DEPOSIT_SUCCESS(amount, newBalance);
                await sendTelegramMessage(chatId, message, { parse_mode: 'Markdown', ...BOT_MESSAGES.MAIN_MENU_KEYBOARD });
                console.log(`Deposit successful for user ${telegramId}: NGN ${amount}. New balance: ${newBalance}`);
            } else {
                // Payment was not successfully verified by Paystack's API
                await updateTransactionStatus(reference, 'failed', telegramId);
                await sendTelegramMessage(chatId, BOT_MESSAGES.DEPOSIT_FAILED(amount, reference), { parse_mode: 'Markdown', ...BOT_MESSAGES.MAIN_MENU_KEYBOARD });
                console.warn(`Webhook: charge.success for reference ${reference} but verification failed. Status: ${verificationResponse ? verificationResponse.data.status : 'N/A'}`);
            }
        } else if (event === 'transfer.success') {
            // Find the user and update the transaction status
            // updateTransactionStatus now returns the user object if found
            const updatedUser = await updateTransactionStatus(reference, 'completed');

            if (updatedUser) {
                const chatId = updatedUser.telegramId; // Get chat ID from the updated user
                const message = BOT_MESSAGES.WITHDRAWAL_INITIATED.replace('You will receive it shortly.', 'Funds have been sent to your account.'); // Adapt message
                await sendTelegramMessage(chatId, message, { ...BOT_MESSAGES.MAIN_MENU_KEYBOARD });
                console.log(`Withdrawal successful for user ${updatedUser.telegramId}, reference: ${reference}`);
            } else {
                console.warn(`Webhook: transfer.success for reference ${reference} but user/transaction not found after update.`);
            }
        } else if (event === 'transfer.failed' || event === 'transfer.reversed') {
            // Find the user and update the transaction status
            const updatedUser = await updateTransactionStatus(reference, event, null, { reason: data.failures ? data.failures.join(', ') : 'Unknown reason' });

            if (updatedUser) {
                const transaction = updatedUser.transactions.find(t => t.reference === reference);
                if (transaction) {
                    // Revert balance (only if not already reverted)
                    // You might want a specific 'reverted' status to prevent future reverts if this webhook is re-sent
                    if (transaction.status !== 'reverted' && transaction.status !== 'failed' && transaction.status !== 'cancelled') {
                        const newBalance = await updateUserBalance(updatedUser.telegramId, transaction.amount); // Add amount back
                        const message = BOT_MESSAGES.WITHDRAWAL_FAILED(transaction.amount, data.failures ? data.failures.join(', ') : 'Unknown reason') + ` Your new balance is ₦${newBalance.toFixed(2)}.`;
                        await sendTelegramMessage(updatedUser.telegramId, message, { parse_mode: 'Markdown', ...BOT_MESSAGES.MAIN_MENU_KEYBOARD });
                        console.warn(`Withdrawal failed/reversed for user ${updatedUser.telegramId}: NGN ${transaction.amount}. Event: ${event}. Balance reverted.`);
                    } else {
                        console.warn(`Webhook: withdrawal for reference ${reference} already marked as ${transaction.status}. Avoiding double revert.`);
                    }
                } else {
                    console.warn(`Webhook: transfer.failed/reversed for reference ${reference} but transaction not found in user's history.`);
                }
            } else {
                console.warn(`Webhook: transfer.failed/reversed for reference ${reference} but user/transaction not found after update.`);
            }
        } else {
            console.log(`Unhandled Paystack event: ${event}`);
        }
    } catch (error) {
        console.error('Error processing Paystack webhook:', error);
        // Errors here means something went wrong AFTER the 200 OK was sent to Paystack.
        // It's logged for your debugging.
    }
};
