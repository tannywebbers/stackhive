// api/webhook.js
const { verifyWebhookSignature, verifyTransaction } = require('../utils/paystack');
const { updateUserBalance, addTransaction, updateTransactionStatus } = require('../utils/db');
const { sendTelegramMessage } = require('../utils/telegram');
const { BOT_MESSAGES } = require('../config/constants');
const crypto = require('crypto');

module.exports = async (req, res) => {
    res.status(200).send('Webhook received');

    const secret = process.env.PAYSTACK_SECRET_KEY;
    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.rawBody;
    const payload = req.body;

    if (!secret) {
        console.error('PAYSTACK_SECRET_KEY is not set! Cannot verify Paystack webhook signature.');
        return;
    }

    try {
        const hash = crypto.createHmac('sha512', secret).update(rawBody.toString('utf8')).digest('hex');
        if (hash !== signature) {
            console.warn('Paystack webhook: Invalid signature received! Calculated:', hash, 'Received:', signature);
            return;
        }
    } catch (e) {
        console.error('Error during signature verification:', e);
        return;
    }

    const event = payload.event;
    const data = payload.data;
    const reference = data.reference;
    const amount = data.amount / 100;

    console.log(`Received Paystack webhook event: ${event} for reference: ${reference}`);

    try {
        if (event === 'charge.success') {
            const metadata = data.metadata;
            const telegramId = metadata ? (metadata.userId || metadata.telegramId) : null;
            const chatId = metadata ? metadata.chatId : null;

            console.log(`Webhook charge.success - Metadata:`, metadata);
            console.log(`Webhook charge.success - Extracted telegramId: ${telegramId}, chatId: ${chatId}`);

            if (!telegramId || !chatId) {
                console.warn(`Webhook: charge.success missing telegramId or chatId in metadata for reference: ${reference}. Cannot update user or send message.`);
                return;
            }

            const verificationResponse = await verifyTransaction(reference);

            if (verificationResponse && verificationResponse.status && verificationResponse.data.status === 'success') {
                console.log(`Webhook charge.success - Transaction verified successfully for reference: ${reference}`);

                // --- MODIFIED DOUBLE-CREDIT CHECK LOGIC ---
                // We'll fetch the user and then find the transaction within their array
                // This gives us more control and precise status checking.
                const user = await require('../utils/db').User.findOne({ telegramId });

                if (user) {
                    const existingTransaction = user.transactions.find(t => t.reference === reference);

                    console.log(`Webhook charge.success - Found user. Existing transaction status for ${reference}: ${existingTransaction ? existingTransaction.status : 'NOT_FOUND'}`);

                    if (existingTransaction && existingTransaction.status === 'completed') {
                        console.warn(`Webhook: charge.success for reference ${reference} already completed. Avoiding double credit.`);
                        return; // Transaction already processed
                    }

                    // If transaction found but not 'completed', or not found (meaning first time processing),
                    // then proceed to update and credit.
                    // If the transaction wasn't found at all, it's a new one or error in initial add.
                    // The `updateTransactionStatus` (which needs to find by ref & telegramId) will handle it.

                    await updateTransactionStatus(reference, 'completed', telegramId);
                    const newBalance = await updateUserBalance(telegramId, amount);

                    const message = BOT_MESSAGES.DEPOSIT_SUCCESS(amount, newBalance);
                    await sendTelegramMessage(chatId, message, { parse_mode: 'Markdown', ...BOT_MESSAGES.MAIN_MENU_KEYBOARD });
                    console.log(`Deposit successful for user ${telegramId}: NGN ${amount}. New balance: ${newBalance}`);

                } else {
                    console.warn(`Webhook: charge.success - User with telegramId ${telegramId} not found in DB for reference ${reference}.`);
                    // This implies a serious issue where the user initiating payment doesn't exist
                    // or metadata telegramId is wrong. Consider logging user creation flow.
                    return;
                }

            } else {
                await updateTransactionStatus(reference, 'failed', telegramId);
                await sendTelegramMessage(chatId, BOT_MESSAGES.DEPOSIT_FAILED(amount, reference), { parse_mode: 'Markdown', ...BOT_MESSAGES.MAIN_MENU_KEYBOARD });
                console.warn(`Webhook: charge.success for reference ${reference} but verification failed. Status: ${verificationResponse ? verificationResponse.data.status : 'N/A'}`);
            }
        } else if (event === 'transfer.success') {
            const updatedUser = await updateTransactionStatus(reference, 'completed');

            if (updatedUser) {
                const chatId = updatedUser.telegramId;
                const message = BOT_MESSAGES.WITHDRAWAL_INITIATED.replace('You will receive it shortly.', 'Funds have been sent to your account.');
                await sendTelegramMessage(chatId, message, { ...BOT_MESSAGES.MAIN_MENU_KEYBOARD });
                console.log(`Withdrawal successful for user ${updatedUser.telegramId}, reference: ${reference}`);
            } else {
                console.warn(`Webhook: transfer.success for reference ${reference} but user/transaction not found after update.`);
            }
        } else if (event === 'transfer.failed' || event === 'transfer.reversed') {
            const updatedUser = await updateTransactionStatus(reference, event, null, { reason: data.failures ? data.failures.join(', ') : 'Unknown reason' });

            if (updatedUser) {
                const transaction = updatedUser.transactions.find(t => t.reference === reference);
                if (transaction) {
                    if (transaction.status !== 'reverted' && transaction.status !== 'failed' && transaction.status !== 'cancelled') {
                        const newBalance = await updateUserBalance(updatedUser.telegramId, transaction.amount);
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
    }
};
