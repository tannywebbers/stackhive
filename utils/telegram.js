// utils/telegram.js
const TelegramBot = require('node-telegram-bot-api');
const { initializeTransaction, initiateTransfer, createTransferRecipient, getBankCodes } = require('./paystack');
const { getOrCreateUser, updateUserBalance, addTransaction, savePaystackRecipientCode, getPaystackRecipientCode, saveWalletAddress } = require('./db');
const { generateUniqueRef } = require('./helpers');
const { MAIN_MENU_KEYBOARD, BOT_MESSAGES, MIN_DEPOSIT_AMOUNT, MIN_WITHDRAW_AMOUNT, EMAIL_REGEX, BEP20_USDT_REGEX, INVESTMENT_PLANS } = require('../config/constants');

// Initialize bot instance for webhook mode (no polling: true)
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN);

// State to manage user interactions
const userStates = {}; // { chatId: { step: 'awaiting_amount' | 'awaiting_email' | 'awaiting_withdrawal_amount' | 'awaiting_bank_details' | 'awaiting_wallet_address', data: {} } }

/**
 * Sets up the Telegram webhook for the bot.
 * Checks if the webhook is already set to the correct URL before setting.
 */
async function setupWebhook() {
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;

    if (!webhookUrl) {
        console.error('TELEGRAM_WEBHOOK_URL environment variable is not set!');
        return;
    }

    try {
        const webhookInfo = await bot.getWebhookInfo();
        if (webhookInfo.url !== webhookUrl) {
            await bot.setWebhook(webhookUrl);
            console.log(`✅ Telegram webhook successfully set to: ${webhookUrl}`);
        } else {
            console.log(`➡️ Telegram webhook already correctly set to: ${webhookUrl}`);
        }
    } catch (error) {
        console.error('❌ Error setting Telegram webhook:', error.message);
        // Optionally, throw the error or handle it more robustly
    }
}

/**
 * Processes incoming Telegram updates (called by Vercel's API endpoint).
 * @param {object} body - The raw update body from Telegram.
 */
async function processUpdate(body) {
    try {
        bot.processUpdate(body); // This line handles the update and triggers bot.on('message'), etc.
    } catch (error) {
        console.error('❌ Error processing Telegram update:', error.message);
    }
}

/**
 * Sends a message to a Telegram chat.
 * @param {number} chatId - The ID of the chat to send the message to.
 * @param {string} message - The message text.
 * @param {object} options - Optional message parameters (parse_mode, reply_markup, etc.).
 */
async function sendTelegramMessage(chatId, message, options = {}) {
    try {
        await bot.sendMessage(chatId, message, options);
    } catch (error) {
        console.error(`❌ Error sending message to chat ${chatId}:`, error.message);
    }
}

// --- Bot Command Handlers ---

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const firstName = msg.from.first_name;
    const username = msg.from.username;

    // Check for referral link in /start payload
    let referrerId = null;
    const startPayload = msg.text.split(' ')[1]; // Get the part after /start
    if (startPayload && !isNaN(parseInt(startPayload))) {
        referrerId = parseInt(startPayload);
        // Add logic to verify if referrerId exists
        const referrer = await getOrCreateUser(referrerId);
        if (referrer && referrer.telegramId !== telegramId) {
            console.log(`User ${telegramId} referred by ${referrerId}`);
            // You might want to give a bonus to the referrer here, or track it.
        } else {
            referrerId = null; // Invalid referrer
        }
    }

    const user = await getOrCreateUser(telegramId, firstName, username, referrerId);

    bot.sendMessage(
        chatId,
        BOT_MESSAGES.WELCOME(user.firstName, user.balance),
        { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD }
    );
});

bot.onText(/💰 Balance/, async (msg) => {
    const chatId = msg.chat.id;
    const user = await getOrCreateUser(msg.from.id);

    const pendingDeposits = user.transactions
        .filter(t => t.type === 'deposit' && t.status === 'pending')
        .reduce((sum, t) => sum + t.amount, 0);

    bot.sendMessage(
        chatId,
        BOT_MESSAGES.BALANCE_INFO(user.balance, pendingDeposits),
        { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD }
    );
});

bot.onText(/💳 Deposit/, (msg) => {
    const chatId = msg.chat.id;
    userStates[chatId] = { step: 'awaiting_deposit_amount' };
    bot.sendMessage(chatId, BOT_MESSAGES.DEPOSIT_PROMPT_AMOUNT, { parse_mode: 'Markdown' });
});

bot.onText(/📤 Withdraw/, async (msg) => {
    const chatId = msg.chat.id;
    const user = await getOrCreateUser(msg.from.id);

    if (user.balance < MIN_WITHDRAW_AMOUNT) {
        bot.sendMessage(chatId, BOT_MESSAGES.INSUFFICIENT_BALANCE(user.balance), { ...MAIN_MENU_KEYBOARD });
        return;
    }

    // Offer withdrawal methods
    bot.sendMessage(chatId, "How would you like to withdraw?", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🇳🇬 Bank Transfer", callback_data: "withdraw_naira" }],
                [{ text: "💸 USDT (BEP20)", callback_data: "withdraw_usdt" }]
            ]
        }
    });
});

bot.onText(/🗂 Wallet/, async (msg) => {
    const chatId = msg.chat.id;
    const user = await getOrCreateUser(msg.from.id);

    if (user.walletAddress) {
        bot.sendMessage(chatId, BOT_MESSAGES.WALLET_CURRENT(user.walletAddress), {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Update Wallet Address", callback_data: "set_wallet_address" }]
                ]
            }
        });
    } else {
        bot.sendMessage(chatId, BOT_MESSAGES.WALLET_NOT_SET, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "Set Wallet Address", callback_data: "set_wallet_address" }]
                ]
            }
        });
    }
});

bot.onText(/👫 Referrals/, async (msg) => {
    const chatId = msg.chat.id;
    const user = await getOrCreateUser(msg.from.id);
    bot.sendMessage(chatId, BOT_MESSAGES.REFERRAL_MESSAGE(user.referralLink), { parse_mode: 'Markdown', disable_web_page_preview: true, ...MAIN_MENU_KEYBOARD });
});

bot.onText(/🆘 Support/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, BOT_MESSAGES.SUPPORT_MESSAGE, { ...MAIN_MENU_KEYBOARD });
});

bot.onText(/📊 Invest/, async (msg) => {
    const chatId = msg.chat.id;
    const user = await getOrCreateUser(msg.from.id);

    // Prepare investment plan options for inline keyboard
    const inlineKeyboard = INVESTMENT_PLANS.map(plan => ([
        { text: `${plan.name} (${plan.roi}) - Min: ₦${plan.min}`, callback_data: `select_plan_${plan.id}` }
    ]));

    bot.sendMessage(
        chatId,
        BOT_MESSAGES.INVEST_INFO,
        {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: inlineKeyboard
            },
            ...MAIN_MENU_KEYBOARD // Keep main menu below inline keyboard
        }
    );
});


// --- General Message Handler for stateful interactions ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const text = msg.text;

    // Ignore commands and button texts as they have specific handlers
    if (text.startsWith('/') || MAIN_MENU_KEYBOARD.reply_markup.keyboard.flat().includes(text)) {
        return;
    }

    const state = userStates[chatId] ? userStates[chatId].step : null;
    const stateData = userStates[chatId] ? userStates[chatId].data : {};

    // Deposit flow
    if (state === 'awaiting_deposit_amount') {
        const amount = parseInt(text);
        if (isNaN(amount)) {
            return bot.sendMessage(chatId, BOT_MESSAGES.INVALID_AMOUNT);
        }
        if (amount < MIN_DEPOSIT_AMOUNT) {
            return bot.sendMessage(chatId, BOT_MESSAGES.MIN_DEPOSIT_AMOUNT_ERROR);
        }
        userStates[chatId] = {
            step: 'awaiting_deposit_email',
            data: { amount, telegramId, username: msg.from.username }
        };
        return bot.sendMessage(chatId, BOT_MESSAGES.DEPOSIT_PROMPT_EMAIL, { parse_mode: 'Markdown' });

    } else if (state === 'awaiting_deposit_email') {
        const email = text.trim();
        if (!EMAIL_REGEX.test(email)) {
            return bot.sendMessage(chatId, BOT_MESSAGES.INVALID_EMAIL_FORMAT);
        }

        const { amount, telegramId: userId, username } = userStates[chatId].data;
        const metadata = { userId, chatId, username };

        try {
            await bot.sendMessage(chatId, BOT_MESSAGES.PROCESSING_DEPOSIT);
            const payment = await initializeTransaction(email, amount, metadata);

            await addTransaction(userId, 'deposit', amount, 'pending', payment.data.reference, { email, authorization_url: payment.data.authorization_url });

            bot.sendMessage(
                chatId,
                BOT_MESSAGES.PAYMENT_LINK_GENERATED(amount, payment.data.authorization_url, email, payment.data.reference),
                {
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true,
                    ...MAIN_MENU_KEYBOARD
                }
            );
        } catch (error) {
            console.error('Error in deposit email step:', error);
            bot.sendMessage(chatId, BOT_MESSAGES.PAYSTACK_INIT_ERROR);
        } finally {
            delete userStates[chatId];
        }

    } else if (state === 'awaiting_withdrawal_amount_naira') {
        const amount = parseFloat(text);
        if (isNaN(amount) || amount < MIN_WITHDRAW_AMOUNT) {
            return bot.sendMessage(chatId, BOT_MESSAGES.INVALID_AMOUNT);
        }

        const user = await getOrCreateUser(telegramId);
        if (user.balance < amount) {
            return bot.sendMessage(chatId, BOT_MESSAGES.INSUFFICIENT_BALANCE(user.balance), { ...MAIN_MENU_KEYBOARD });
        }

        userStates[chatId] = { step: 'awaiting_bank_details', data: { amount } };
        return bot.sendMessage(chatId, BOT_MESSAGES.WITHDRAW_PROMPT_BANK_DETAILS, { parse_mode: 'Markdown' });

    } else if (state === 'awaiting_bank_details') {
        const parts = text.split(',').map(s => s.trim());
        if (parts.length !== 3) {
            return bot.sendMessage(chatId, BOT_MESSAGES.INVALID_BANK_DETAILS_FORMAT, { parse_mode: 'Markdown' });
        }

        const [bankName, accountNumber, accountName] = parts;
        const amount = userStates[chatId].data.amount;

        try {
            const banks = await getBankCodes();
            const bank = banks.find(b => b.name.toLowerCase().includes(bankName.toLowerCase()));

            if (!bank) {
                return bot.sendMessage(chatId, BOT_MESSAGES.BANK_NOT_FOUND, { ...MAIN_MENU_KEYBOARD });
            }
            const bankCode = bank.code;

            const user = await getOrCreateUser(telegramId);
            let recipientCode = user.paystackRecipientCode;

            if (!recipientCode) {
                const recipientResponse = await createTransferRecipient(accountName, accountNumber, bankCode);
                if (recipientResponse && recipientResponse.status) {
                    recipientCode = recipientResponse.data.recipient_code;
                    await savePaystackRecipientCode(telegramId, recipientCode);
                } else {
                    return bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR + " (Recipient creation failed)", { ...MAIN_MENU_KEYBOARD });
                }
            }

            const reference = generateUniqueRef(telegramId, 'withdrawal');
            await addTransaction(telegramId, 'withdrawal', amount, 'pending', reference, { bankName, accountNumber, accountName, recipientCode });
            await updateUserBalance(telegramId, -amount); // Deduct immediately

            bot.sendMessage(chatId, BOT_MESSAGES.PROCESSING_WITHDRAWAL, { ...MAIN_MENU_KEYBOARD });

            // Initiate transfer (Paystack webhook will confirm success/failure)
            await initiateTransfer(recipientCode, amount, reference, `Withdrawal for user ${telegramId}`);
            bot.sendMessage(chatId, BOT_MESSAGES.WITHDRAWAL_INITIATED, { ...MAIN_MENU_KEYBOARD });

        } catch (error) {
            console.error('Error processing Naira withdrawal:', error);
            bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR, { ...MAIN_MENU_KEYBOARD });
            // Consider reverting balance if transfer initiation fails immediately
            await updateUserBalance(telegramId, amount); // Revert balance
            await addTransaction(telegramId, 'withdrawal', amount, 'failed', reference, { reason: 'Transfer initiation failed' });
        } finally {
            delete userStates[chatId];
        }

    } else if (state === 'awaiting_withdrawal_amount_usdt') {
        const amount = parseFloat(text);
        if (isNaN(amount) || amount < MIN_WITHDRAW_AMOUNT) { // Adjust min withdrawal for USDT
            return bot.sendMessage(chatId, BOT_MESSAGES.INVALID_AMOUNT);
        }

        const user = await getOrCreateUser(telegramId);
        if (user.balance < amount) {
            return bot.sendMessage(chatId, BOT_MESSAGES.INSUFFICIENT_BALANCE(user.balance), { ...MAIN_MENU_KEYBOARD });
        }
        if (!user.walletAddress) {
            return bot.sendMessage(chatId, BOT_MESSAGES.WALLET_NOT_SET, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Set Wallet Address", callback_data: "set_wallet_address" }]
                    ]
                }
            });
            return;
        }

        const reference = generateUniqueRef(telegramId, 'usdt_withdrawal');
        await addTransaction(telegramId, 'withdrawal', amount, 'pending', reference, { currency: 'USDT', walletAddress: user.walletAddress });
        await updateUserBalance(telegramId, -amount); // Deduct immediately

        bot.sendMessage(chatId, `⏳ Your USDT withdrawal of ${amount} is being processed to \`${user.walletAddress}\`...`, { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD });
        // ** TODO: Implement actual USDT transfer logic here (e.g., call a crypto payment gateway API) **
        // For now, this is a placeholder. You'll need to integrate with a crypto API.
        // Once the crypto transfer is confirmed (via webhook or internal process), update transaction status.
        // For demonstration, let's simulate success after a delay.
        setTimeout(async () => {
            await addTransaction(telegramId, 'withdrawal', amount, 'completed', reference);
            bot.sendMessage(chatId, `🎉 Your USDT withdrawal of ${amount} has been successfully sent!`, { ...MAIN_MENU_KEYBOARD });
        }, 5000); // Simulate 5-second processing time

        delete userStates[chatId];

    } else if (state === 'awaiting_wallet_address') {
        const walletAddress = text.trim();
        if (!BEP20_USDT_REGEX.test(walletAddress)) {
            return bot.sendMessage(chatId, BOT_MESSAGES.INVALID_WALLET_ADDRESS);
        }

        try {
            await saveWalletAddress(telegramId, walletAddress);
            bot.sendMessage(chatId, BOT_MESSAGES.WALLET_UPDATED(walletAddress), { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD });
        } catch (error) {
            console.error('Error saving wallet address:', error);
            bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR, { ...MAIN_MENU_KEYBOARD });
        } finally {
            delete userStates[chatId];
        }
    } else if (state === 'awaiting_investment_amount') {
        const amount = parseFloat(text);
        const planId = userStates[chatId].data.planId;
        const selectedPlan = INVESTMENT_PLANS.find(p => p.id === planId);

        if (isNaN(amount) || amount < selectedPlan.min || amount > selectedPlan.max) {
            return bot.sendMessage(chatId, `❌ Invalid amount. For "${selectedPlan.name}", please invest between ₦${selectedPlan.min} and ₦${selectedPlan.max}.`);
        }
        
        const user = await getOrCreateUser(telegramId);
        if (user.balance < amount) {
            return bot.sendMessage(chatId, BOT_MESSAGES.INSUFFICIENT_BALANCE(user.balance) + "\n\nUse /deposit to fund your account.", { ...MAIN_MENU_KEYBOARD });
        }

        // Deduct from balance
        await updateUserBalance(telegramId, -amount);
        const investmentReference = generateUniqueRef(telegramId, `invest-${planId}`);

        // Calculate maturity date (example for a 30-day plan)
        const maturityDate = new Date();
        // This logic needs to be dynamic based on your plan's ROI (e.g., 30 days for 10% monthly)
        // For simplicity, let's assume all plans mature in 30 days for this example
        maturityDate.setDate(maturityDate.getDate() + 30); 

        // Add investment record
        user.investments.push({
            planId: planId,
            amount: amount,
            startDate: new Date(),
            maturityDate: maturityDate,
            roi: selectedPlan.roi,
            status: 'active',
            reference: investmentReference
        });
        await user.save();

        // Add transaction record
        await addTransaction(telegramId, 'investment', amount, 'completed', investmentReference, { planName: selectedPlan.name, roi: selectedPlan.roi });

        bot.sendMessage(chatId, `✅ You have successfully invested ₦${amount.toFixed(2)} in the "${selectedPlan.name}" plan!\n\nYour investment will mature on: ${maturityDate.toDateString()}.\n\nYour current balance: ₦${(user.balance - amount).toFixed(2)}`, { ...MAIN_MENU_KEYBOARD });
        delete userStates[chatId];
    }
});

// --- Callback Query Handler (for inline buttons) ---
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const telegramId = callbackQuery.from.id;
    const data = callbackQuery.data; // e.g., "withdraw_naira", "set_wallet_address", "select_plan_plan_1"

    await bot.answerCallbackQuery(callbackQuery.id); // Acknowledge the callback query

    if (data === 'withdraw_naira') {
        userStates[chatId] = { step: 'awaiting_withdrawal_amount_naira' };
        bot.sendMessage(chatId, BOT_MESSAGES.WITHDRAW_PROMPT_AMOUNT, { parse_mode: 'Markdown' });
    } else if (data === 'withdraw_usdt') {
        const user = await getOrCreateUser(telegramId);
        if (!user.walletAddress) {
            bot.sendMessage(chatId, BOT_MESSAGES.WALLET_NOT_SET, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Set Wallet Address", callback_data: "set_wallet_address" }]
                    ]
                }
            });
            return;
        }
        userStates[chatId] = { step: 'awaiting_withdrawal_amount_usdt' };
        bot.sendMessage(chatId, BOT_MESSAGES.WITHDRAW_PROMPT_AMOUNT + '\n(For USDT, enter amount in USD equivalent)', { parse_mode: 'Markdown' });
    } else if (data === 'set_wallet_address') {
        userStates[chatId] = { step: 'awaiting_wallet_address' };
        bot.sendMessage(chatId, BOT_MESSAGES.WALLET_SET_PROMPT);
    } else if (data.startsWith('select_plan_')) {
        const planId = data.split('_')[2];
        const selectedPlan = INVESTMENT_PLANS.find(p => p.id === planId);
        if (selectedPlan) {
            userStates[chatId] = { step: 'awaiting_investment_amount', data: { planId } };
            bot.sendMessage(chatId, `💰 You selected the *${selectedPlan.name}* plan.\n\nHow much would you like to invest? (Min: ₦${selectedPlan.min}, Max: ₦${selectedPlan.max})`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR);
        }
    }
    // Add more callback query handlers as needed
});


module.exports = {
    bot, // Export the bot instance
    setupWebhook,
    processUpdate,
    sendTelegramMessage // Export for webhook to send messages
};
