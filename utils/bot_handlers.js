// utils/bot_handlers.js
const { getOrCreateUser, updateUserBalance, addTransaction, saveBankDetails, updateTransactionStatus, User, deleteUser } = require('./db');
const { initializeTransaction, initiateTransfer, createTransferRecipient, getBankCodes, resolveAccount } = require('./paystack');
const { generateUniqueRef } = require('./helpers');
const { MAIN_MENU_KEYBOARD, ADMIN_MENU_KEYBOARD, BOT_MESSAGES, MIN_DEPOSIT_AMOUNT, MIN_WITHDRAW_AMOUNT, EMAIL_REGEX, INVESTMENT_PLANS, POPULAR_NIGERIAN_BANKS, WELCOME_BONUS_AMOUNT, calculateProjectedReturn } = require('../config/constants');

// State to manage user interactions
const userStates = {}; // We no longer need botMessageIds since we're not deleting

// Get admin IDs from environment variable
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id.trim())) : [];
const ADMIN_NOTIFICATION_CHAT_ID = process.env.ADMIN_NOTIFICATION_CHAT_ID;
const PAYMENT_GROUP_ID = process.env.PAYMENT_GROUP_ID;
const PAYSTACK_ALLOW_TRANSFERS = process.env.PAYSTACK_ALLOW_TRANSFERS === 'true';

// Helper to format bank list into inline keyboard
const formatBanksForKeyboard = (banks) => {
    const rows = [];
    let currentRow = [];
    for (let i = 0; i < banks.length; i++) {
        const bank = banks[i];
        currentRow.push({ text: bank.name, callback_data: `select_bank_${bank.code}` });
        if (currentRow.length === 2) { // 2 buttons per row
            rows.push(currentRow);
            currentRow = [];
        }
    }
    if (currentRow.length > 0) {
        rows.push(currentRow);
    }
    return { inline_keyboard: rows };
};

// Removed deletePreviousBotMessage function as it's no longer needed

// Function to register all bot handlers
const registerBotHandlers = (bot) => {

    bot.onText(/\/start/, async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;
        const firstName = msg.from.first_name;
        const username = msg.from.username;

        // No more deletion for /start command

        let referrerId = null;
        const startPayload = msg.text.split(' ')[1];
        if (startPayload && startPayload.startsWith('ref_') && !isNaN(parseInt(startPayload.substring(4)))) {
            referrerId = parseInt(startPayload.substring(4));
            // Ensure referrer exists and is not self
            const referrer = await User.findOne({ telegramId: referrerId });
            if (referrer && referrer.telegramId !== telegramId) {
                console.log(`User ${telegramId} referred by ${referrerId}`);
            } else {
                referrerId = null;
            }
        }

        const user = await getOrCreateUser(telegramId, firstName, username, referrerId);

        // Handle Welcome Bonus for new users
        if (!user.hasReceivedWelcomeBonus) {
            user.balance += WELCOME_BONUS_AMOUNT;
            user.hasReceivedWelcomeBonus = true;
            user.transactions.push({
                type: 'deposit', // Treat welcome bonus as a deposit for simplicity in transaction history
                amount: WELCOME_BONUS_AMOUNT,
                status: 'completed',
                reference: `welcome_bonus_${telegramId}`,
                metadata: { source: 'welcome_bonus' }
            });
            await user.save();
            bot.sendMessage(chatId, BOT_MESSAGES.WELCOME_BONUS_RECEIVED(WELCOME_BONUS_AMOUNT), { parse_mode: 'Markdown' });
        }

        await bot.sendMessage(
            chatId,
            BOT_MESSAGES.WELCOME(user.firstName, user.balance),
            { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD }
        );
    });

    // ADMIN DASHBOARD COMMAND
    bot.onText(/\/admindash/, async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;

        if (!ADMIN_IDS.includes(telegramId)) {
            await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_ACCESS_DENIED, { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD });
            return;
        }

        userStates[chatId] = { step: 'admin_menu' };
        await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_WELCOME, { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });
    });

    // UPDATED BALANCE HANDLER
    bot.onText(/💰 Balance/, async (msg) => {
        const chatId = msg.chat.id;
        // Ensure that if a user is in an admin state, they switch back to main menu
        if (userStates[chatId] && userStates[chatId].step.startsWith('admin_')) {
            delete userStates[chatId]; // Exit admin state
        }

        const user = await getOrCreateUser(msg.from.id);

        const pendingDeposits = user.transactions
            .filter(t => t.type === 'deposit' && t.status === 'pending')
            .reduce((sum, t) => sum + t.amount, 0);

        // Get active investments for display
        const activeInvestments = user.investments.filter(inv => inv.status === 'active');

        const balanceMessage = BOT_MESSAGES.BALANCE_INFO(user.firstName, user.username, user.telegramId, user.balance, pendingDeposits);
        const investmentSummary = BOT_MESSAGES.CURRENT_INVESTMENTS(activeInvestments);

        await bot.sendMessage(
            chatId,
            `${balanceMessage}${investmentSummary}`, // Combine messages
            { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD }
        );
    });

    bot.onText(/💳 Deposit/, async (msg) => {
        const chatId = msg.chat.id;
        // Ensure that if a user is in an admin state, they switch back to main menu
        if (userStates[chatId] && userStates[chatId].step.startsWith('admin_')) {
            delete userStates[chatId]; // Exit admin state
        }

        userStates[chatId] = { step: 'awaiting_deposit_amount' };
        await bot.sendMessage(chatId, BOT_MESSAGES.DEPOSIT_PROMPT_AMOUNT, { parse_mode: 'Markdown' });
    });

    bot.onText(/📤 Withdraw/, async (msg) => {
        const chatId = msg.chat.id;
        const user = await getOrCreateUser(msg.from.id);

        // Ensure that if a user is in an admin state, they switch back to main menu
        if (userStates[chatId] && userStates[chatId].step.startsWith('admin_')) {
            delete userStates[chatId]; // Exit admin state
        }

        if (user.balance < MIN_WITHDRAW_AMOUNT) {
            await bot.sendMessage(chatId, BOT_MESSAGES.INSUFFICIENT_BALANCE(user.balance), { ...MAIN_MENU_KEYBOARD });
            return;
        }

        if (!user.bankDetails || !user.bankDetails.accountNumber) {
            await bot.sendMessage(chatId, BOT_MESSAGES.WITHDRAW_BANK_NOT_SET, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Set Bank Account", callback_data: "set_bank_account" }]
                    ]
                }
            });
            return;
        }

        userStates[chatId] = { step: 'awaiting_withdrawal_amount_naira' };
        await bot.sendMessage(chatId, BOT_MESSAGES.WITHDRAW_PROMPT_AMOUNT_NAIRA, { parse_mode: 'Markdown' });
    });

    bot.onText(/🗂 Wallet/, async (msg) => {
        const chatId = msg.chat.id;
        // Ensure that if a user is in an admin state, they switch back to main menu
        if (userStates[chatId] && userStates[chatId].step.startsWith('admin_')) {
            delete userStates[chatId]; // Exit admin state
        }

        const user = await getOrCreateUser(msg.from.id);

        if (user.bankDetails && user.bankDetails.accountNumber) {
            await bot.sendMessage(chatId, BOT_MESSAGES.BANK_ACCOUNT_CURRENT(user.bankDetails.accountName, user.bankDetails.accountNumber, user.bankDetails.bankName), {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Update Bank Account", callback_data: "set_bank_account" }]
                    ]
                }
            });
        } else {
            await bot.sendMessage(chatId, BOT_MESSAGES.BANK_ACCOUNT_NOT_SET, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Set Bank Account", callback_data: "set_bank_account" }]
                    ]
                }
            });
        }
    });

    bot.onText(/👫 Referrals/, async (msg) => {
        const chatId = msg.chat.id.toString();
        // Ensure that if a user is in an admin state, they switch back to main menu
        if (userStates[chatId] && userStates[chatId].step.startsWith('admin_')) {
            delete userStates[chatId]; // Exit admin state
        }

        const user = await getOrCreateUser(msg.from.id);
        const botUsername = process.env.TELEGRAM_BOT_USERNAME;
        if (!botUsername) {
            await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR + " (Bot username not configured for referrals.)", { ...MAIN_MENU_KEYBOARD });
            return;
        }
        const referralLink = `https://t.me/${botUsername}?start=ref_${user.telegramId}`;

        await bot.sendMessage(chatId, BOT_MESSAGES.REFERRAL_MESSAGE(referralLink), { parse_mode: 'Markdown', disable_web_page_preview: true, ...MAIN_MENU_KEYBOARD });
    });

    bot.onText(/🆘 Support/, async (msg) => {
        const chatId = msg.chat.id;
        // Ensure that if a user is in an admin state, they switch back to main menu
        if (userStates[chatId] && userStates[chatId].step.startsWith('admin_')) {
            delete userStates[chatId]; // Exit admin state
        }

        const supportUrl = process.env.SUPPORT_URL;
        if (!supportUrl) {
            await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR + " (Support URL not configured.)", { ...MAIN_MENU_KEYBOARD });
            return;
        }
        await bot.sendMessage(chatId, BOT_MESSAGES.SUPPORT_MESSAGE(supportUrl), { parse_mode: 'Markdown', disable_web_page_preview: true, ...MAIN_MENU_KEYBOARD });
    });

    // INVEST HANDLER: Now without claim button, as it's automated by cron
    bot.onText(/📊 Invest/, async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;
        // Ensure that if a user is in an admin state, they switch back to main menu
        if (userStates[chatId] && userStates[chatId].step.startsWith('admin_')) {
            delete userStates[chatId]; // Exit admin state
        }

        const inlineKeyboardRows = INVESTMENT_PLANS.map(plan => ([
            { text: `${plan.name} (${plan.roi}) - Min: ₦${plan.min.toLocaleString()}`, callback_data: `select_plan_${plan.id}` }
        ]));

        await bot.sendMessage(
            chatId,
            BOT_MESSAGES.INVEST_INFO,
            {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: inlineKeyboardRows
                }
            }
        );
    });

    // ADMIN MENU BUTTONS HANDLERS
    bot.onText(/🔝 Top Referrers/, async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;

        if (!ADMIN_IDS.includes(telegramId)) {
            await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_ACCESS_DENIED, { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD });
            return;
        }
        // Count referrals for each user and sort
        try {
            const users = await User.aggregate([
                {
                    $match: { referrerId: { $ne: null } }
                },
                {
                    $group: {
                        _id: "$referrerId",
                        referralCount: { $sum: 1 },
                    }
                },
                {
                    $lookup: {
                        from: 'users',
                        localField: '_id',
                        foreignField: 'telegramId',
                        as: 'referrerDetails'
                    }
                },
                {
                    $unwind: '$referrerDetails'
                },
                {
                    $project: {
                        _id: 0,
                        telegramId: '$_id',
                        firstName: '$referrerDetails.firstName',
                        username: '$referrerDetails.username',
                        referralCount: '$referralCount',
                        referralBonusEarned: '$referrerDetails.referralBonusEarned'
                    }
                },
                {
                    $sort: { referralCount: -1 }
                },
                {
                    $limit: 20
                }
            ]);

            await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_TOP_REFERRERS(users), { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });

        } catch (error) {
            console.error('Error fetching top referrers:', error);
            await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR, { ...ADMIN_MENU_KEYBOARD });
        }
    });

    bot.onText(/➕ Add Funds/, async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;

        if (!ADMIN_IDS.includes(telegramId)) {
            await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_ACCESS_DENIED, { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD });
            return;
        }
        userStates[chatId] = { step: 'admin_awaiting_target_id_add' };
        await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_PROMPT_USER_ID, { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });
    });

    bot.onText(/➖ Remove Funds/, async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;

        if (!ADMIN_IDS.includes(telegramId)) {
            await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_ACCESS_DENIED, { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD });
            return;
        }
        userStates[chatId] = { step: 'admin_awaiting_target_id_remove' };
        await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_PROMPT_USER_ID, { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });
    });

    bot.onText(/🗑 Delete User/, async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;

        if (!ADMIN_IDS.includes(telegramId)) {
            await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_ACCESS_DENIED, { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD });
            return;
        }
        userStates[chatId] = { step: 'admin_awaiting_target_id_delete' };
        await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_PROMPT_USER_ID, { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });
    });

    // MODIFIED: Fetching pending withdrawals, showing one at a time
    bot.onText(/📝 Pending Withdrawals/, async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;

        if (!ADMIN_IDS.includes(telegramId)) {
            await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_ACCESS_DENIED, { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD });
            return;
        }

        try {
            const pendingWithdrawals = await User.aggregate([
                { $unwind: '$transactions' },
                {
                    $match: {
                        'transactions.type': 'withdrawal',
                        'transactions.status': 'pending_manual_review'
                    }
                },
                {
                    $project: {
                        _id: 0,
                        telegramId: '$telegramId',
                        transaction: '$transactions'
                    }
                },
                {
                    $replaceRoot: { newRoot: { $mergeObjects: ['$transaction', { userId: '$telegramId' }] } }
                }
            ]);

            userStates[chatId] = {
                step: 'admin_viewing_pending_withdrawals',
                data: {
                    withdrawals: pendingWithdrawals,
                    currentIndex: 0
                }
            };

            if (pendingWithdrawals.length === 0) {
                await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_NO_PENDING_WITHDRAWALS, { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });
            } else {
                displayPendingWithdrawal(chatId, bot, userStates[chatId].data.withdrawals, userStates[chatId].data.currentIndex);
            }
        } catch (error) {
            console.error('Error fetching pending withdrawals:', error);
            await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR, { ...ADMIN_MENU_KEYBOARD });
        }
    });

    // Helper function to display a single pending withdrawal
    async function displayPendingWithdrawal(chatId, botInstance, withdrawals, index) {
        if (!withdrawals || withdrawals.length === 0) {
            await botInstance.sendMessage(chatId, BOT_MESSAGES.ADMIN_NO_PENDING_WITHDRAWALS, { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });
            delete userStates[chatId]; // Clear state
            return;
        }

        const withdrawal = withdrawals[index];
        const total = withdrawals.length;

        const navigationButtons = [];
        if (index > 0) {
            navigationButtons.push({ text: '⬅️ Previous', callback_data: 'prev_withdrawal' });
        }
        if (index < total - 1) {
            navigationButtons.push({ text: 'Next ➡️', callback_data: 'next_withdrawal' });
        }

        const inlineKeyboard = [
            [{ text: "✅ Approve (Mark Completed)", callback_data: `approve_withdrawal_${withdrawal.reference}` }],
            [{ text: "❌ Decline & Refund", callback_data: `decline_withdrawal_${withdrawal.reference}` }]
        ];
        if (navigationButtons.length > 0) {
            inlineKeyboard.push(navigationButtons);
        }

        await botInstance.sendMessage(
            chatId,
            BOT_MESSAGES.ADMIN_PENDING_WITHDRAWAL_DETAIL(withdrawal, index, total),
            {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: inlineKeyboard }
            }
        );
    }

    bot.onText(/↩️ Main Menu/, async (msg) => {
        const chatId = msg.chat.id;
        delete userStates[chatId]; // Clear any admin state
        await bot.sendMessage(chatId, 'Returning to main menu.', { ...MAIN_MENU_KEYBOARD });
    });

    // NEW: Broadcast Message Handler
    bot.onText(/📢 Broadcast Message/, async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;

        if (!ADMIN_IDS.includes(telegramId)) {
            await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_ACCESS_DENIED, { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD });
            return;
        }

        userStates[chatId] = { step: 'admin_awaiting_broadcast_message' };
        await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_PROMPT_BROADCAST_MESSAGE, {
            parse_mode: 'Markdown',
            reply_markup: {
                force_reply: true // This prompts the admin to reply to this specific message
            }
        });
    });

    // --- General Message Handler for stateful interactions ---
    bot.on('message', async (msg) => {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;
        const text = msg.text;

        // Ignore commands or main menu/admin menu buttons
        // Added the Broadcast Message button text to the ignore list
        if (text.startsWith('/') ||
            MAIN_MENU_KEYBOARD.reply_markup.keyboard.flat().map(btn => btn.text).includes(text) ||
            (ADMIN_IDS.includes(telegramId) && ADMIN_MENU_KEYBOARD.reply_markup.keyboard.flat().map(btn => btn.text).includes(text)) ||
            text === '📢 Broadcast Message' // Explicitly ignore this button text
        ) {
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
            await bot.sendMessage(chatId, BOT_MESSAGES.DEPOSIT_PROMPT_EMAIL, { parse_mode: 'Markdown' });
            return;

        } else if (state === 'awaiting_deposit_email') {
            const email = text.trim();
            if (!EMAIL_REGEX.test(email)) {
                return bot.sendMessage(chatId, BOT_MESSAGES.INVALID_EMAIL_FORMAT);
            }

            const { amount, telegramId: userId, username } = userStates[chatId].data;
            const metadata = { userId, chatId, username };

            try {
                const processingMessage = await bot.sendMessage(chatId, BOT_MESSAGES.PROCESSING_DEPOSIT);

                const payment = await initializeTransaction(email, amount, metadata);

                await addTransaction(userId, 'deposit', amount, 'pending', payment.data.reference, { email, authorization_url: payment.data.authorization_url });

                await bot.sendMessage(
                    chatId,
                    BOT_MESSAGES.PAYMENT_LINK_GENERATED(amount, payment.data.authorization_url, email, payment.data.reference),
                    {
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true,
                        ...MAIN_MENU_KEYBOARD
                    }
                );
            } catch (error) {
                console.error('Error in deposit email step:', error.response ? error.response.data : error.message);
                await bot.sendMessage(chatId, BOT_MESSAGES.PAYSTACK_INIT_ERROR);
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
                await bot.sendMessage(chatId, BOT_MESSAGES.INSUFFICIENT_BALANCE(user.balance), { ...MAIN_MENU_KEYBOARD });
                delete userStates[chatId]; // Clear state
                return;
            }

            const { accountNumber, bankName, recipientCode, accountName } = user.bankDetails;
            const reference = generateUniqueRef(telegramId, 'withdrawal');

            try {
                // Determine withdrawal method based on PAYSTACK_ALLOW_TRANSFERS
                if (PAYSTACK_ALLOW_TRANSFERS) {
                    await addTransaction(telegramId, 'withdrawal', amount, 'pending', reference, { bankName, accountNumber, accountName, recipientCode, userId: telegramId });
                    await updateUserBalance(telegramId, -amount);

                    const processingMessage = await bot.sendMessage(chatId, BOT_MESSAGES.PROCESSING_WITHDRAWAL);

                    await initiateTransfer(recipientCode, amount, reference, `Withdrawal for user ${telegramId}`);
                    // If transfer initiated successfully, update to completed
                    await updateTransactionStatus(reference, 'completed');

                    await bot.sendMessage(chatId, BOT_MESSAGES.WITHDRAWAL_INITIATED, { ...MAIN_MENU_KEYBOARD });

                } else {
                    // Manual withdrawal fallback
                    await addTransaction(telegramId, 'withdrawal', amount, 'pending_manual_review', reference, { bankName, accountNumber, accountName, userId: telegramId });
                    await updateUserBalance(telegramId, -amount); // Deduct balance immediately

                    await bot.sendMessage(chatId, BOT_MESSAGES.WITHDRAWAL_INITIATED_MANUAL(amount), { ...MAIN_MENU_KEYBOARD });

                    // Notify admin payment group (NEW: Use PAYMENT_GROUP_ID)
                    if (PAYMENT_GROUP_ID) {
                        try {
                            await bot.sendMessage(PAYMENT_GROUP_ID,
                                BOT_MESSAGES.ADMIN_MANUAL_WITHDRAWAL_NOTIFICATION(telegramId, amount, accountName, accountNumber, bankName, reference),
                                { parse_mode: 'Markdown' }
                            );
                        } catch (groupError) {
                            console.error('Error sending withdrawal notification to payment group:', groupError.message);
                            // Log but don't stop the user's flow
                        }
                    }
                }

            } catch (error) {
                console.error('Error processing Naira withdrawal:', error.response ? error.response.data : error.message);
                await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR, { ...MAIN_MENU_KEYBOARD });

                await updateUserBalance(telegramId, amount); // Refund balance if transfer fails
                await updateTransactionStatus(reference, 'failed', { error: error.message }); // Add error to metadata
            } finally {
                delete userStates[chatId];
            }
        }
        // --- Multi-step Bank Details Flow ---
        else if (state === 'awaiting_account_number') {
            const accountNumber = text.trim();
            if (!/^\d{10}$/.test(accountNumber)) {
                return bot.sendMessage(chatId, BOT_MESSAGES.INVALID_ACCOUNT_NUMBER_FORMAT, { parse_mode: 'Markdown' });
            }
            userStates[chatId] = { step: 'awaiting_bank_name', data: { accountNumber } };

            const keyboard = formatBanksForKeyboard(POPULAR_NIGERIAN_BANKS);
            await bot.sendMessage(chatId, BOT_MESSAGES.PROMPT_BANK_NAME, {
                reply_markup: keyboard,
                parse_mode: 'Markdown'
            });

        } else if (state === 'awaiting_bank_name') {
            const bankNameOrCode = text.trim();
            let bank = null;

            bank = POPULAR_NIGERIAN_BANKS.find(b => b.code === bankNameOrCode) ||
                   POPULAR_NIGERIAN_BANKS.find(b => b.name.toLowerCase().includes(bankNameOrCode.toLowerCase()));

            if (!bank) {
                try {
                    const allBanks = await getBankCodes();
                    bank = allBanks.find(b => b.code === bankNameOrCode) ||
                           allBanks.find(b => b.name.toLowerCase().includes(bankNameOrCode.toLowerCase()));
                } catch (error) {
                    console.error('Error fetching all bank codes for validation:', error);
                }
            }

            if (!bank) {
                await bot.sendMessage(chatId, BOT_MESSAGES.BANK_NOT_FOUND, { ...MAIN_MENU_KEYBOARD });
                delete userStates[chatId]; // Clear state
                return;
            }

            userStates[chatId].data.bankCode = bank.code;
            userStates[chatId].data.bankName = bank.name;
            userStates[chatId].step = 'verifying_account_name';

            try {
                const verifyingMessage = await bot.sendMessage(chatId, BOT_MESSAGES.VERIFYING_BANK_DETAILS);

                const accountVerification = await resolveAccount(userStates[chatId].data.accountNumber, bank.code);

                if (!accountVerification || !accountVerification.status) {
                    delete userStates[chatId];
                    await bot.sendMessage(chatId, BOT_MESSAGES.ACCOUNT_VERIFICATION_FAILED, { ...MAIN_MENU_KEYBOARD });
                    return;
                }

                const resolvedAccountName = accountVerification.data.account_name;
                userStates[chatId].data.resolvedAccountName = resolvedAccountName;
                userStates[chatId].step = 'awaiting_account_name_confirmation';

                await bot.sendMessage(chatId, BOT_MESSAGES.ACCOUNT_NAME_VERIFIED(resolvedAccountName), {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Yes, that's me!", callback_data: "confirm_account_name_yes" }],
                            [{ text: "❌ No, try again", callback_data: "confirm_account_name_no" }]
                        ]
                    }
                });

            } catch (error) {
                console.error('Error resolving account name:', error.response ? error.response.data : error.message);
                delete userStates[chatId];
                await bot.sendMessage(chatId, BOT_MESSAGES.ACCOUNT_VERIFICATION_FAILED, { ...MAIN_MENU_KEYBOARD });
            }

        } else if (state === 'awaiting_account_name_confirmation') {
            const confirmation = text.trim().toLowerCase();
            if (confirmation === 'yes') {
                const { accountNumber, bankCode, bankName, resolvedAccountName } = userStates[chatId].data;
                try {
                    let recipientCode = null;
                    if (PAYSTACK_ALLOW_TRANSFERS) {
                        const recipientResponse = await createTransferRecipient(resolvedAccountName, accountNumber, bankCode);
                        if (!recipientResponse || !recipientResponse.status) {
                            await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR + " (Failed to create Paystack recipient. Please contact support.)", { ...MAIN_MENU_KEYBOARD });
                            delete userStates[chatId];
                            return;
                        }
                        recipientCode = recipientResponse.data.recipient_code;
                    }

                    await saveBankDetails(telegramId, accountNumber, bankName, resolvedAccountName, recipientCode);
                    await bot.sendMessage(chatId, BOT_MESSAGES.BANK_ACCOUNT_UPDATED_SUCCESS, { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD });

                } catch (error) {
                    console.error('Error saving bank details or creating recipient:', error.response ? error.response.data : error.message);
                    await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR, { ...MAIN_MENU_KEYBOARD });
                } finally {
                    delete userStates[chatId];
                }
            } else if (confirmation === 'no') {
                delete userStates[chatId]; // Clear state
                await bot.sendMessage(chatId, 'Okay, let\'s start again. Please provide your 10-digit bank *Account Number*:', { parse_mode: 'Markdown' });
                userStates[chatId] = { step: 'awaiting_account_number' };
            } else {
                // Don't delete message here, just send the error
                bot.sendMessage(chatId, BOT_MESSAGES.ACCOUNT_NAME_CONFIRMATION_INVALID);
            }
        }
        // --- Investment Flow ---
        else if (state === 'awaiting_investment_amount') {
            const amount = parseFloat(text);
            const planId = userStates[chatId].data.planId;
            const selectedPlan = INVESTMENT_PLANS.find(p => p.id === planId);

            if (!selectedPlan) {
                delete userStates[chatId];
                await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR + " (Investment plan not found.)", { ...MAIN_MENU_KEYBOARD });
                return;
            }

            if (isNaN(amount) || amount < selectedPlan.min || amount > selectedPlan.max) {
                return bot.sendMessage(chatId, `❌ Please enter a valid amount between ₦${selectedPlan.min.toLocaleString()} and ₦${selectedPlan.max.toLocaleString()} for the ${selectedPlan.name} plan.`);
            }

            const user = await getOrCreateUser(telegramId);
            if (user.balance < amount) {
                await bot.sendMessage(chatId, BOT_MESSAGES.INSUFFICIENT_BALANCE(user.balance), { ...MAIN_MENU_KEYBOARD });
                delete userStates[chatId];
                return;
            }

            const projectedReturn = calculateProjectedReturn(amount, selectedPlan);
            userStates[chatId].data.amount = amount;
            userStates[chatId].data.projectedReturn = projectedReturn;
            userStates[chatId].step = 'confirm_investment';

            await bot.sendMessage(chatId, BOT_MESSAGES.INVESTMENT_CONFIRMATION(selectedPlan.name, amount, selectedPlan.roi, selectedPlan.durationDays, projectedReturn), {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Confirm Investment', callback_data: 'confirm_investment_yes' }],
                        [{ text: '❌ Cancel', callback_data: 'confirm_investment_no' }]
                    ]
                }
            });
        }
        // --- Admin Handlers (State-based) ---
        else if (state === 'admin_awaiting_target_id_add') {
            const targetId = parseInt(text);
            if (isNaN(targetId)) {
                return bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_INVALID_USER_ID, { ...ADMIN_MENU_KEYBOARD });
            }
            const user = await User.findOne({ telegramId: targetId }); // Use User model directly
            if (!user) {
                return bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_USER_NOT_FOUND, { ...ADMIN_MENU_KEYBOARD });
            }
            userStates[chatId] = { step: 'admin_awaiting_amount_add', data: { targetId } };
            await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_PROMPT_AMOUNT, { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });

        } else if (state === 'admin_awaiting_amount_add') {
            const amount = parseFloat(text);
            if (isNaN(amount) || amount <= 0) {
                return bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_INVALID_AMOUNT, { ...ADMIN_MENU_KEYBOARD });
            }
            const { targetId } = userStates[chatId].data;
            try {
                const user = await updateUserBalance(targetId, amount);
                await addTransaction(targetId, 'deposit', amount, 'completed', generateUniqueRef(targetId, 'admin_add'), { source: 'admin_add', adminId: telegramId });
                await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_FUNDS_ADDED(amount, targetId, user.balance), { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });
            } catch (error) {
                console.error('Admin add funds error:', error);
                await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR, { ...ADMIN_MENU_KEYBOARD });
            } finally {
                delete userStates[chatId];
            }

        } else if (state === 'admin_awaiting_target_id_remove') {
            const targetId = parseInt(text);
            if (isNaN(targetId)) {
                return bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_INVALID_USER_ID, { ...ADMIN_MENU_KEYBOARD });
            }
            const user = await User.findOne({ telegramId: targetId }); // Use User model directly
            if (!user) {
                return bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_USER_NOT_FOUND, { ...ADMIN_MENU_KEYBOARD });
            }
            userStates[chatId] = { step: 'admin_awaiting_amount_remove', data: { targetId } };
            await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_PROMPT_AMOUNT, { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });

        } else if (state === 'admin_awaiting_amount_remove') {
            const amount = parseFloat(text);
            if (isNaN(amount) || amount <= 0) {
                return bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_INVALID_AMOUNT, { ...ADMIN_MENU_KEYBOARD });
            }
            const { targetId } = userStates[chatId].data;
            try {
                const user = await updateUserBalance(targetId, -amount);
                await addTransaction(targetId, 'withdrawal', amount, 'completed', generateUniqueRef(targetId, 'admin_remove'), { source: 'admin_remove', adminId: telegramId });
                await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_FUNDS_REMOVED(amount, targetId, user.balance), { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });
            } catch (error) {
                console.error('Admin remove funds error:', error);
                await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR, { ...ADMIN_MENU_KEYBOARD });
            } finally {
                delete userStates[chatId];
            }

        } else if (state === 'admin_awaiting_target_id_delete') {
            const targetId = parseInt(text);
            if (isNaN(targetId)) {
                return bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_INVALID_USER_ID, { ...ADMIN_MENU_KEYBOARD });
            }
            const user = await User.findOne({ telegramId: targetId });
            if (!user) {
                return bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_USER_NOT_FOUND, { ...ADMIN_MENU_KEYBOARD });
            }
            userStates[chatId] = { step: 'admin_confirm_delete_user', data: { targetId, firstName: user.firstName } };
            await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_DELETE_USER_CONFIRMATION(user.firstName, targetId), {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Yes, Delete User", callback_data: `confirm_delete_user_${targetId}` }],
                        [{ text: "No, Cancel", callback_data: `cancel_delete_user_${targetId}` }]
                    ]
                }
            });
        }
        // NEW: Awaiting decline reason for withdrawal
        else if (state === 'admin_awaiting_decline_reason') {
            const declineReason = text.trim();
            const { reference, userId, amount } = userStates[chatId].data;

            if (!declineReason) {
                return bot.sendMessage(chatId, 'Please provide a reason for declining.');
            }

            try {
                // Update transaction status to declined
                await updateTransactionStatus(reference, 'declined', { declineReason });

                // Refund the user's balance
                const user = await updateUserBalance(userId, amount);
                if (!user) {
                    console.error(`User ${userId} not found for refund during decline`);
                }

                await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_WITHDRAWAL_DECLINED_SUCCESS(reference, userId, amount), { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });

                // Notify the user about the decline
                if (userId) {
                    bot.sendMessage(userId, BOT_MESSAGES.USER_WITHDRAWAL_DECLINED(amount, declineReason), { parse_mode: 'Markdown' });
                }

            } catch (error) {
                console.error('Error declining withdrawal:', error);
                await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR, { ...ADMIN_MENU_KEYBOARD });
            } finally {
                delete userStates[chatId];
            }
        }
        // NEW: Broadcast Message State Handler
        else if (state === 'admin_awaiting_broadcast_message') {
            const broadcastMessage = text.trim(); // Trim whitespace from message
            if (!broadcastMessage) {
                await bot.sendMessage(chatId, "The broadcast message cannot be empty.", { ...ADMIN_MENU_KEYBOARD }); // Added keyboard for convenience
                delete userStates[chatId]; // Clear state as invalid input
                return;
            }

            userStates[chatId] = {
                step: 'admin_confirm_broadcast',
                data: { broadcastMessage }
            };

            // Capture the message_id of the confirmation message to edit it later
            const confirmationMsg = await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_BROADCAST_CONFIRMATION(broadcastMessage), {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Yes, Broadcast!', callback_data: `confirm_broadcast:${Buffer.from(broadcastMessage).toString('base64')}` }],
                        [{ text: '❌ No, Cancel', callback_data: 'cancel_broadcast' }]
                    ]
                }
            });
            userStates[chatId].data.confirmationMessageId = confirmationMsg.message_id; // Store message_id
        }

    });

    // --- Callback Query Handlers ---
    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const chatId = msg.chat.id;
        const telegramId = callbackQuery.from.id;
        const data = callbackQuery.data;

        bot.answerCallbackQuery(callbackQuery.id); // Answer the callback query to remove the loading state

        if (data.startsWith('select_bank_')) {
            const bankCode = data.substring('select_bank_'.length);
            const selectedBank = POPULAR_NIGERIAN_BANKS.find(b => b.code === bankCode);

            if (!selectedBank) {
                await bot.sendMessage(chatId, BOT_MESSAGES.BANK_NOT_FOUND, { ...MAIN_MENU_KEYBOARD });
                delete userStates[chatId];
                return;
            }

            if (userStates[chatId] && userStates[chatId].step === 'awaiting_bank_name') {
                userStates[chatId].data.bankCode = selectedBank.code;
                userStates[chatId].data.bankName = selectedBank.name;
                userStates[chatId].step = 'verifying_account_name';

                try {
                    const verifyingMessage = await bot.sendMessage(chatId, BOT_MESSAGES.VERIFYING_BANK_DETAILS);

                    const accountVerification = await resolveAccount(userStates[chatId].data.accountNumber, selectedBank.code);

                    if (!accountVerification || !accountVerification.status) {
                        delete userStates[chatId];
                        await bot.sendMessage(chatId, BOT_MESSAGES.ACCOUNT_VERIFICATION_FAILED, { ...MAIN_MENU_KEYBOARD });
                        return;
                    }

                    const resolvedAccountName = accountVerification.data.account_name;
                    userStates[chatId].data.resolvedAccountName = resolvedAccountName;
                    userStates[chatId].step = 'awaiting_account_name_confirmation';

                    await bot.sendMessage(chatId, BOT_MESSAGES.ACCOUNT_NAME_VERIFIED(resolvedAccountName), {
                        parse_mode: 'Markdown',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "✅ Yes, that's me!", callback_data: "confirm_account_name_yes" }],
                                [{ text: "❌ No, try again", callback_data: "confirm_account_name_no" }]
                            ]
                        }
                    });
                } catch (error) {
                    console.error('Error resolving account name (from callback):', error.response ? error.response.data : error.message);
                    delete userStates[chatId];
                    await bot.sendMessage(chatId, BOT_MESSAGES.ACCOUNT_VERIFICATION_FAILED, { ...MAIN_MENU_KEYBOARD });
                }
            } else {
                await bot.sendMessage(chatId, "Please start the bank setup process again by tapping 'Set Bank Account'.", { ...MAIN_MENU_KEYBOARD });
            }
        }
        else if (data === 'set_bank_account') {
            userStates[chatId] = { step: 'awaiting_account_number' };
            await bot.sendMessage(chatId, BOT_MESSAGES.PROMPT_ACCOUNT_NUMBER, { parse_mode: 'Markdown' });
        }
        else if (data === 'confirm_account_name_yes') {
            if (userStates[chatId] && userStates[chatId].step === 'awaiting_account_name_confirmation') {
                const { accountNumber, bankCode, bankName, resolvedAccountName } = userStates[chatId].data;
                try {
                    let recipientCode = null;
                    if (PAYSTACK_ALLOW_TRANSFERS) {
                        const recipientResponse = await createTransferRecipient(resolvedAccountName, accountNumber, bankCode);
                        if (!recipientResponse || !recipientResponse.status) {
                            await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR + " (Failed to create Paystack recipient. Please contact support.)", { ...MAIN_MENU_KEYBOARD });
                            delete userStates[chatId];
                            return;
                        }
                        recipientCode = recipientResponse.data.recipient_code;
                    }

                    await saveBankDetails(telegramId, accountNumber, bankName, resolvedAccountName, recipientCode);
                    await bot.sendMessage(chatId, BOT_MESSAGES.BANK_ACCOUNT_UPDATED_SUCCESS, { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD });
                } catch (error) {
                    console.error('Error saving bank details (from callback):', error.response ? error.response.data : error.message);
                    await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR, { ...MAIN_MENU_KEYBOARD });
                } finally {
                    delete userStates[chatId];
                }
            }
        }
        else if (data === 'confirm_account_name_no') {
            delete userStates[chatId];
            await bot.sendMessage(chatId, 'Okay, let\'s start again. Please provide your 10-digit bank *Account Number*:', { parse_mode: 'Markdown' });
            userStates[chatId] = { step: 'awaiting_account_number' };
        }
        else if (data.startsWith('select_plan_')) {
            const planId = data.substring('select_plan_'.length);
            const selectedPlan = INVESTMENT_PLANS.find(p => p.id === planId);

            if (selectedPlan) {
                userStates[chatId] = { step: 'awaiting_investment_amount', data: { planId } };
                await bot.sendMessage(chatId, `📈 You selected the *${selectedPlan.name}* plan (${selectedPlan.roi} for ${selectedPlan.durationDays} days).\n\nPlease enter the amount you wish to invest (₦${selectedPlan.min.toLocaleString()} - ₦${selectedPlan.max.toLocaleString()}):`, { parse_mode: 'Markdown' });
            } else {
                await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR + " (Investment plan not found.)", { ...MAIN_MENU_KEYBOARD });
            }
        }
        else if (data === 'confirm_investment_yes') {
            if (userStates[chatId] && userStates[chatId].step === 'confirm_investment') {
                const { amount, planId, projectedReturn } = userStates[chatId].data;
                const selectedPlan = INVESTMENT_PLANS.find(p => p.id === planId);

                if (!selectedPlan) {
                    delete userStates[chatId];
                    await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR + " (Investment plan not found.)", { ...MAIN_MENU_KEYBOARD });
                    return;
                }

                try {
                    const user = await getOrCreateUser(telegramId);
                    if (user.balance < amount) {
                        await bot.sendMessage(chatId, BOT_MESSAGES.INSUFFICIENT_BALANCE(user.balance), { ...MAIN_MENU_KEYBOARD });
                        delete userStates[chatId];
                        return;
                    }

                    // Deduct from balance
                    user.balance -= amount;

                    const investmentStartDate = new Date();
                    const investmentMaturityDate = new Date();
                    investmentMaturityDate.setDate(investmentStartDate.getDate() + selectedPlan.durationDays);

                    const investmentReference = generateUniqueRef(telegramId, 'investment'); // Unique ref for investment itself

                    // Add new investment to the 'investments' array
                    user.investments.push({
                        planId: selectedPlan.id,
                        amount: amount,
                        startDate: investmentStartDate,
                        maturityDate: investmentMaturityDate, // Use maturityDate
                        projectedReturn: projectedReturn,
                        status: 'active', // Set initial status
                        reference: investmentReference // Store investment-specific reference
                    });

                    // Add a transaction record for the investment deduction
                    user.transactions.push({
                        type: 'investment',
                        amount: -amount, // Record as a deduction from balance
                        status: 'completed',
                        reference: investmentReference, // Same reference as the investment
                        metadata: {
                            plan: selectedPlan.name,
                            roi: selectedPlan.roi,
                            durationDays: selectedPlan.durationDays,
                            startDate: investmentStartDate.toISOString(),
                            maturityDate: investmentMaturityDate.toISOString()
                        }
                    });
                    await user.save(); // Save the updated user object with new investment and transaction

                    await bot.sendMessage(chatId, BOT_MESSAGES.INVESTMENT_SUCCESS(amount, selectedPlan.name, investmentMaturityDate), { parse_mode: 'Markdown', ...MAIN_MENU_KEYBOARD });

                } catch (error) {
                    console.error('Error confirming investment:', error);
                    await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR, { ...MAIN_MENU_KEYBOARD });
                } finally {
                    delete userStates[chatId];
                }
            }
        }
        else if (data === 'confirm_investment_no') {
            delete userStates[chatId];
            await bot.sendMessage(chatId, 'Investment cancelled. You can explore other options from the menu.', { ...MAIN_MENU_KEYBOARD });
        }
        // Admin Delete User Confirmation
        else if (data.startsWith('confirm_delete_user_')) {
            const targetId = parseInt(data.substring('confirm_delete_user_'.length));
            if (!ADMIN_IDS.includes(telegramId)) {
                return bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_ACCESS_DENIED, { parse_mode: 'Markdown' });
            }
            try {
                const deletedCount = await deleteUser(targetId);
                if (deletedCount > 0) {
                    await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_USER_DELETED(targetId), { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });
                } else {
                    await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_USER_NOT_FOUND, { ...ADMIN_MENU_KEYBOARD });
                }
            } catch (error) {
                console.error('Error deleting user via callback:', error);
                await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR, { ...ADMIN_MENU_KEYBOARD });
            } finally {
                delete userStates[chatId];
            }
        }
        else if (data.startsWith('cancel_delete_user_')) {
            const targetId = parseInt(data.substring('cancel_delete_user_'.length));
            await bot.sendMessage(chatId, `Deletion of user \`${targetId}\` cancelled.`, { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });
            delete userStates[chatId];
        }
        // NEW: Handle Approve/Decline actions for withdrawals
        else if (data.startsWith('approve_withdrawal_')) {
            const reference = data.substring('approve_withdrawal_'.length);

            if (!ADMIN_IDS.includes(telegramId)) {
                return bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_ACCESS_DENIED, { parse_mode: 'Markdown' });
            }

            try {
                const user = await User.findOne({
                    'transactions.reference': reference,
                    'transactions.status': 'pending_manual_review'
                });

                if (!user) {
                    await bot.sendMessage(chatId, '❌ Withdrawal not found or already processed.', { parse_mode: 'Markdown' });
                    // Re-display current pending withdrawal list state if possible
                    if (userStates[chatId] && userStates[chatId].step === 'admin_viewing_pending_withdrawals') {
                        const { withdrawals, currentIndex } = userStates[chatId].data;
                        // Filter out the processed one to ensure it's not shown again
                        userStates[chatId].data.withdrawals = withdrawals.filter(w => w.reference !== reference);
                        if (userStates[chatId].data.withdrawals.length === 0) {
                             await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_NO_PENDING_WITHDRAWALS, { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });
                             delete userStates[chatId];
                        } else {
                            // Adjust index if current one was removed and it was the last one
                            if (userStates[chatId].data.currentIndex >= userStates[chatId].data.withdrawals.length && userStates[chatId].data.currentIndex > 0) {
                                userStates[chatId].data.currentIndex--;
                            }
                            displayPendingWithdrawal(chatId, bot, userStates[chatId].data.withdrawals, userStates[chatId].data.currentIndex);
                        }
                    } else {
                        // Or return to admin menu if state is lost/irrelevant
                        await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_WELCOME, { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });
                    }
                    return;
                }

                await updateTransactionStatus(reference, 'completed', { adminId: telegramId, completionDate: new Date() });

                // Remove the approved withdrawal from the current list in state
                if (userStates[chatId] && userStates[chatId].step === 'admin_viewing_pending_withdrawals') {
                    userStates[chatId].data.withdrawals = userStates[chatId].data.withdrawals.filter(w => w.reference !== reference);
                    // Adjust index if current one was removed and it was the last one
                    if (userStates[chatId].data.currentIndex >= userStates[chatId].data.withdrawals.length && userStates[chatId].data.currentIndex > 0) {
                        userStates[chatId].data.currentIndex--;
                    }
                }

                await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_WITHDRAWAL_MARKED_COMPLETE(reference), { parse_mode: 'Markdown' });

                // Attempt to display the next pending withdrawal or show no more pending
                if (userStates[chatId].data.withdrawals.length > 0) {
                    displayPendingWithdrawal(chatId, bot, userStates[chatId].data.withdrawals, userStates[chatId].data.currentIndex);
                } else {
                    await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_NO_PENDING_WITHDRAWALS, { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });
                    delete userStates[chatId]; // Clear state as no more pending
                }

                const transaction = user.transactions.find(t => t.reference === reference);
                if (transaction && user.telegramId) {
                    bot.sendMessage(user.telegramId, `🎉 Your withdrawal of ₦${transaction.amount.toFixed(2)} (Ref: \`${reference}\`) has been processed and completed!`, { parse_mode: 'Markdown' });
                }

            } catch (error) {
                console.error('Error approving withdrawal:', error);
                await bot.sendMessage(chatId, BOT_MESSAGES.GENERIC_ERROR, { ...ADMIN_MENU_KEYBOARD });
            }
        }
        else if (data.startsWith('decline_withdrawal_')) {
            const reference = data.substring('decline_withdrawal_'.length);

            if (!ADMIN_IDS.includes(telegramId)) {
                return bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_ACCESS_DENIED, { parse_mode: 'Markdown' });
            }

            const user = await User.findOne({
                'transactions.reference': reference,
                'transactions.status': 'pending_manual_review'
            });

            if (!user) {
                await bot.sendMessage(chatId, '❌ Withdrawal not found or already processed.', { parse_mode: 'Markdown' });
                // Re-display current pending withdrawal list state if possible
                if (userStates[chatId] && userStates[chatId].step === 'admin_viewing_pending_withdrawals') {
                    const { withdrawals, currentIndex } = userStates[chatId].data;
                    // Filter out the processed one to ensure it's not shown again
                    userStates[chatId].data.withdrawals = withdrawals.filter(w => w.reference !== reference);
                    if (userStates[chatId].data.withdrawals.length === 0) {
                        await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_NO_PENDING_WITHDRAWALS, { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });
                        delete userStates[chatId];
                    } else {
                        // Adjust index if current one was removed and it was the last one
                        if (userStates[chatId].data.currentIndex >= userStates[chatId].data.withdrawals.length && userStates[chatId].data.currentIndex > 0) {
                            userStates[chatId].data.currentIndex--;
                        }
                        displayPendingWithdrawal(chatId, bot, userStates[chatId].data.withdrawals, userStates[chatId].data.currentIndex);
                    }
                } else {
                    // Or return to admin menu if state is lost/irrelevant
                    await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_WELCOME, { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });
                }
                return;
            }

            const transaction = user.transactions.find(t => t.reference === reference);
            if (!transaction) {
                await bot.sendMessage(chatId, '❌ Transaction details not found.', { parse_mode: 'Markdown' });
                return;
            }

            // Store info in state and prompt for reason
            userStates[chatId] = {
                step: 'admin_awaiting_decline_reason',
                data: {
                    reference: reference,
                    userId: user.telegramId,
                    amount: transaction.amount
                }
            };
            await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_WITHDRAWAL_PROMPT_DECLINE_REASON, { parse_mode: 'Markdown' });
        }
        // NEW: Navigation for pending withdrawals
        else if (data === 'next_withdrawal') {
            if (userStates[chatId] && userStates[chatId].step === 'admin_viewing_pending_withdrawals') {
                const { withdrawals, currentIndex } = userStates[chatId].data;
                if (currentIndex < withdrawals.length - 1) {
                    userStates[chatId].data.currentIndex++;
                    displayPendingWithdrawal(chatId, bot, withdrawals, userStates[chatId].data.currentIndex);
                } else {
                    // Already at the last one, maybe send a quick message or just do nothing
                    bot.answerCallbackQuery(callbackQuery.id, { text: 'Already at the last withdrawal.' });
                }
            }
        }
        else if (data === 'prev_withdrawal') {
            if (userStates[chatId] && userStates[chatId].step === 'admin_viewing_pending_withdrawals') {
                const { withdrawals, currentIndex } = userStates[chatId].data;
                if (currentIndex > 0) {
                    userStates[chatId].data.currentIndex--;
                    displayPendingWithdrawal(chatId, bot, withdrawals, userStates[chatId].data.currentIndex);
                } else {
                    // Already at the first one
                    bot.answerCallbackQuery(callbackQuery.id, { text: 'Already at the first withdrawal.' });
                }
            }
        }
        // NEW: Broadcast confirmation callbacks
        else if (data.startsWith('confirm_broadcast:')) {
            const encodedMessage = data.split(':')[1];
            const broadcastMessage = Buffer.from(encodedMessage, 'base64').toString('utf8');

            if (!ADMIN_IDS.includes(telegramId)) {
                return bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_ACCESS_DENIED, { parse_mode: 'Markdown' });
            }

            const confirmationMessageId = userStates[chatId]?.data?.confirmationMessageId;

            // Edit the confirmation message to show "Broadcasting..."
            if (confirmationMessageId) {
                await bot.editMessageText(BOT_MESSAGES.ADMIN_BROADCAST_IN_PROGRESS, {
                    chat_id: chatId,
                    message_id: confirmationMessageId
                });
            } else {
                 await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_BROADCAST_IN_PROGRESS);
            }

            let successCount = 0;
            let failureCount = 0;
            const allUsers = await User.find({}, 'telegramId'); // Get all user Telegram IDs

            if (allUsers.length === 0) {
                if (confirmationMessageId) {
                    await bot.editMessageText(BOT_MESSAGES.ADMIN_BROADCAST_NO_USERS, {
                        chat_id: chatId,
                        message_id: confirmationMessageId,
                    });
                } else {
                    await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_BROADCAST_NO_USERS);
                }
                await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_WELCOME, { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });
                delete userStates[chatId];
                return;
            }

            for (const user of allUsers) {
                try {
                    await bot.sendMessage(user.telegramId, broadcastMessage, { parse_mode: 'Markdown' }); // Send with Markdown
                    successCount++;
                    // Add a small delay for very large user bases to prevent rate limiting
                    await new Promise(resolve => setTimeout(resolve, 50)); // Added a small delay
                } catch (error) {
                    console.error(`Failed to send broadcast to ${user.telegramId}: ${error.message}`);
                    failureCount++;
                }
            }

            // Send a NEW message with the results and the admin keyboard
            await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_BROADCAST_COMPLETE(successCount, failureCount), { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD });

            // Delete the old "Broadcasting..." message if it exists
            if (confirmationMessageId) {
                try {
                    await bot.deleteMessage(chatId, confirmationMessageId);
                } catch (deleteError) {
                    console.error('Error deleting confirmation message:', deleteError.message);
                }
            }
            delete userStates[chatId]; // Clear state
        }
        else if (data === 'cancel_broadcast') {
            if (!ADMIN_IDS.includes(telegramId)) {
                return bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_ACCESS_DENIED, { parse_mode: 'Markdown' });
            }
            const confirmationMessageId = userStates[chatId]?.data?.confirmationMessageId;
            if (confirmationMessageId) {
                await bot.editMessageText(BOT_MESSAGES.ADMIN_BROADCAST_CANCELLED, {
                    chat_id: chatId,
                    message_id: confirmationMessageId,
                });
            } else {
                await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_BROADCAST_CANCELLED);
            }
            await bot.sendMessage(chatId, BOT_MESSAGES.ADMIN_WELCOME, { parse_mode: 'Markdown', ...ADMIN_MENU_KEYBOARD }); // Return to admin menu
            delete userStates[chatId]; // Clear state
        }
    });
};

module.exports = { registerBotHandlers };
