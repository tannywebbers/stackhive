// config/constants.js

const MAIN_MENU_KEYBOARD = {
    reply_markup: {
        keyboard: [
            [{ text: '💰 Balance' }, { text: '💳 Deposit' }],
            [{ text: '📤 Withdraw' }, { text: '🗂 Wallet' }],
            [{ text: '📊 Invest' }, { text: '👫 Referrals' }],
            [{ text: '🆘 Support' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
};

const ADMIN_MENU_KEYBOARD = {
    reply_markup: {
        keyboard: [
            [{ text: '➕ Add Funds' }, { text: '➖ Remove Funds' }],
            [{ text: '📝 Pending Withdrawals' }, { text: '🔝 Top Referrers' }],
            [{ text: '🗑 Delete User' }, { text: '📢 Broadcast Message' }], // ADDED BROADCAST BUTTON
            [{ text: '↩️ Main Menu' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
};

const BOT_MESSAGES = {
    WELCOME: (firstName, balance) => `👋 Welcome, ${firstName}! Your current balance is ₦${balance.toFixed(2)}.\n\nHow can I help you today?`,
    WELCOME_BONUS_RECEIVED: (amount) => `🎁 Congratulations! You've received a welcome bonus of ₦${amount.toFixed(2)}!`,
    BALANCE_INFO: (firstName, username, telegramId, balance, pending) => {
        let message = `
🌟 *Your Profile:*
👤 Name: ${firstName || 'N/A'}
✨ Username: @${username || 'N/A'}
🆔 Telegram ID: \`${telegramId}\`

💰 *Your Balance:* ₦${balance.toFixed(2)}
${pending > 0 ? `⏳ Pending Deposits: ₦${pending.toFixed(2)}` : 'Everything looks good! 👍'}
`;
        return message;
    },
    CURRENT_INVESTMENTS: (investments) => {
        if (!investments || investments.length === 0) {
            return "\n\n_You currently have no active investments. Start investing today!_ 🚀";
        }
        let invSummary = "\n\n📈 *Your Investments:*\n";
        investments.forEach(inv => {
            const plan = INVESTMENT_PLANS.find(p => p.id === inv.planId);
            const planName = plan ? plan.name : 'Unknown Plan';
            invSummary += `\n*• ${planName}* (₦${inv.amount.toFixed(2)})`;
            invSummary += `\n  _Matures: ${new Date(inv.maturityDate).toDateString()}_`;
            invSummary += `\n  _Status: ${inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}_`;
            invSummary += `\n  _Projected Return: ₦${inv.projectedReturn.toFixed(2)}_\n`;
        });
        return invSummary;
    },

    DEPOSIT_PROMPT_AMOUNT: '💳 How much do you want to deposit? (e.g., 1000)',
    INVALID_AMOUNT: '❌ Oops! That\'s an invalid amount. Please enter a valid number (e.g., 1000).',
    MIN_DEPOSIT_AMOUNT_ERROR: '⚠️ Minimum deposit amount is ₦1,000.',
    DEPOSIT_PROMPT_EMAIL: '📧 Great! Now, please provide your email address to generate the payment link:',
    INVALID_EMAIL_FORMAT: '❌ That doesn\'t look like a valid email. Please try again (e.g., example@email.com).',
    PROCESSING_DEPOSIT: '✨ Generating your secure payment link... Please wait a moment. ✨',
    PAYSTACK_INIT_ERROR: 'Oops! 😟 An error occurred while setting up your payment. Please try again later or contact support.',
    PAYMENT_LINK_GENERATED: (amount, authUrl, email, reference) => `✅ Your payment link for ₦${amount.toFixed(2)} is ready!\n\n🔗 [Tap here to complete payment](${authUrl})\n\n📧 Email used: \`${email}\`\n🔢 Reference: \`${reference}\`\n\n_Your balance will be updated automatically after successful payment,kindly check balance after deposit. ✨_`, 
    PAYMENT_CONFIRMED: (amount) => `🎉 Your deposit of ₦${amount.toFixed(2)} has been successfully confirmed! Your balance is updated. Enjoy!`,
    PAYMENT_FAILED: (reference) => `❌ Your payment with reference \`${reference}\` failed or could not be confirmed. Please check your transaction details or contact support.`,

    WITHDRAW_BANK_NOT_SET: '🚫 You need to set up your bank account details first before you can withdraw.\n\nTap the button below to get started! 👇',
    WITHDRAW_PROMPT_AMOUNT_NAIRA: '💰 How much would you like to withdraw in NGN? (Minimum ₦1,000)',
    INSUFFICIENT_BALANCE: (balance) => `😞 Insufficient balance. Your current balance is ₦${balance.toFixed(2)}.`,
    MIN_WITHDRAW_AMOUNT_ERROR: '⚠️ Minimum withdrawal amount is ₦1,000.',
    PROCESSING_WITHDRAWAL: '🚀 Initiating your withdrawal... This might take a moment. ✨',
    WITHDRAWAL_INITIATED: '✅ Your withdrawal request has been successfully initiated! You should receive your funds shortly. Thank you!',
    WITHDRAWAL_INITIATED_MANUAL: (amount) => `✅ Your withdrawal request for ₦${amount.toFixed(2)} has been submitted!\n\n_Your request is currently being processed manually. You will receive your funds shortly._`,
    GENERIC_ERROR: '❌ An unexpected error occurred. Please try again later. If the problem persists, contact support.',

    // --- NEW / MODIFIED BANK ACCOUNT MESSAGES (Multi-step) ---
    PROMPT_ACCOUNT_NUMBER: '🏦 Please send your 10-digit bank *Account Number*:',
    INVALID_ACCOUNT_NUMBER_FORMAT: '❌ Invalid account number. Please ensure it\'s a 10-digit number only.',
    PROMPT_BANK_NAME: '💳 Now, please select your *Bank Name* from the list below, or type it if not found (e.g., Access Bank):',
    BANK_NOT_FOUND: '❌ Sorry, we couldn\'t find that bank. Please choose from the provided list or double-check the bank name.',
    ACCOUNT_NAME_VERIFIED: (accountName) => `🔍 We found this account name: *${accountName}*\n\nIs this correct?`,
    ACCOUNT_NAME_CONFIRMATION_INVALID: '❌ Please tap "Yes" or "No" to confirm the account name, or type "Yes" / "No".',
    PROMPT_ACCOUNT_NAME: '👤 Please send your *Account Name* exactly as it appears on your bank account:', // Fallback, only if resolve fails
    VERIFYING_BANK_DETAILS: '🔍 Verifying your bank details... Please wait. ✨',
    ACCOUNT_VERIFICATION_FAILED: '❌ Account verification failed. The account number or bank might be incorrect. Please check and try again.',
    BANK_ACCOUNT_UPDATED_SUCCESS: '✅ Your bank account details have been successfully updated! You can now withdraw funds. 🎉',
    BANK_ACCOUNT_CURRENT: (accName, accNum, bankName) => `🏦 Your current linked bank account:\n\n*Account Name:* \`${accName}\`\n*Account Number:* \`${accNum}\`\n*Bank:* \`${bankName}\`\n\nLooks good! ✨`,
    BANK_ACCOUNT_NOT_SET: '🚫 No bank account details set yet. Let\'s link your account for easy withdrawals! 👇',
    TOO_MANY_BANKS: 'Too many banks to display. Please type your bank name.',

    REFERRAL_MESSAGE: (referralLink) => `👫 Share your unique referral link to earn fantastic bonuses!\n\n🔗 Your Referral Link: [${referralLink}](${referralLink})\n\n_You will earn 10% of your referred user\'s first deposit! Let\'s grow together! 🌱_`,
    SUPPORT_MESSAGE: (supportUrl) => `🆘 Need help or have questions? Our support team is here for you! \n\n👉 [Click here to chat with Support](${supportUrl})\n\n_We\'re available to assist you!_`,

    INVEST_INFO: '📊 Explore our amazing investment plans and start growing your money! ✨',
    INVESTMENT_CONFIRMATION: (planName, amount, roi, durationDays, projectedReturn) => `
*Confirm Your Investment:*
📈 *Plan:* ${planName}
💰 *Amount:* ₦${amount.toFixed(2)}
🚀 *ROI:* ${roi} (${durationDays} Days)
💸 *Projected Return:* ₦${projectedReturn.toFixed(2)}

_Are you sure you want to invest this amount?_
`,
    INVESTMENT_SUCCESS: (amount, planName, maturityDate) => `✅ You have successfully invested ₦${amount.toFixed(2)} in the "${planName}" plan!\n\nYour investment will mature on: ${maturityDate.toDateString()}.\n\n_Your earnings will be credited automatically upon maturity. Happy investing! 💰_`,
    // Removed old investment maturity messages, added new automated payout message
    AUTOMATED_PAYOUT_SUCCESS: (planName, investedAmount, returnAmount) => `🎉 Your investment of ₦${investedAmount.toFixed(2)} in the "${planName}" plan has matured!\n\n*Total Return:* ₦${returnAmount.toFixed(2)} has been credited to your balance automatically! 💰`,
    AUTOMATED_PAYOUT_FAILED: (planName, investedAmount, errorReason) =>
        `⚠️ *Investment Payout Failed* ⚠️\n\n` +
        `Your *${planName}* investment of ₦${investedAmount.toFixed(2)} has matured, but the payout failed.\n` +
        `Reason: _${errorReason || 'Unknown error'}_.\n\n` +
        `Our team has been notified and will resolve this promptly. Please contact support if you have concerns.`,

    // --- ADMIN PANEL MESSAGES ---
    ADMIN_ACCESS_DENIED: '🚫 Access Denied. You are not authorized to use the admin panel.',
    ADMIN_WELCOME: '👋 Welcome to the Admin Dashboard! How can I help you?',
    ADMIN_PROMPT_USER_ID: '🆔 Please enter the Telegram ID of the user:',
    ADMIN_INVALID_USER_ID: '❌ Invalid User ID. Please enter a valid number.',
    ADMIN_USER_NOT_FOUND: '🤷‍♀️ User not found with that Telegram ID.',
    ADMIN_PROMPT_AMOUNT: '💰 Please enter the amount (e.g., 5000):',
    ADMIN_INVALID_AMOUNT: '❌ Invalid amount. Please enter a valid number.',
    ADMIN_FUNDS_ADDED: (amount, userId, newBalance) => `✅ Successfully added ₦${amount.toFixed(2)} to user \`${userId}\`'s balance. New balance: ₦${newBalance.toFixed(2)}.`,
    ADMIN_FUNDS_REMOVED: (amount, userId, newBalance) => `✅ Successfully removed ₦${amount.toFixed(2)} from user \`${userId}\`'s balance. New balance: ₦${newBalance.toFixed(2)}.`,
    ADMIN_USER_DELETED: (userId) => `🗑 User \`${userId}\` and all their data have been deleted.`,
    ADMIN_TOP_REFERRERS: (referrers) => {
        if (referrers.length === 0) return '📊 No referrers found yet.';
        let message = '🔝 *Top 20 Referrers:*\n\n';
        referrers.forEach((user, index) => {
            message += `${index + 1}. @${user.username || user.firstName} (ID: \`${user.telegramId}\`) - Referrals: ${user.referralCount} | Bonus: ₦${user.referralBonusEarned.toFixed(2)}\n`;
        });
        return message;
    },
    ADMIN_NO_PENDING_WITHDRAWALS: '✅ No pending manual withdrawals at the moment.',
    // NEW: Single pending withdrawal display
    ADMIN_PENDING_WITHDRAWAL_DETAIL: (withdrawal, currentIndex, totalWithdrawals) => `
📝 *Pending Withdrawal ${currentIndex + 1}/${totalWithdrawals}*
---------------------------------------
👤 *User ID:* \`${withdrawal.metadata.userId}\`
💰 *Amount:* ₦${withdrawal.amount.toFixed(2)}
🏦 *Account Name:* *${withdrawal.metadata.accountName}*
🔢 *Account Number:* \`${withdrawal.metadata.accountNumber}\`
💳 *Bank:* *${withdrawal.metadata.bankName}*
🔗 *Ref:* \`${withdrawal.reference}\`
🗓️ *Date:* ${new Date(withdrawal.date).toLocaleString()}
---------------------------------------
`,
    ADMIN_MANUAL_WITHDRAWAL_NOTIFICATION: (telegramId, amount, accName, accNum, bankName, reference) =>
        `🚨 *NEW PENDING WITHDRAWAL ALERT* 🚨\n\n` +
        `👤 User ID: \`${telegramId}\`\n` +
        `💰 Amount: ₦${amount.toFixed(2)}\n\n` +
        `🏦 Account Name: *${accName}*\n` +
        `🔢 Account Number: \`${accNum}\`\n` +
        `💳 Bank: *${bankName}*\n\n` +
        `🔗 Reference: \`${reference}\`\n\n` +
        `_Manage with /admindash -> Pending Withdrawals_`, // Simplified message for group
    ADMIN_WITHDRAWAL_ACTION_PROMPT: (reference) => `What action do you want to take for withdrawal \`${reference}\`?`,
    ADMIN_WITHDRAWAL_ACTION_KEYBOARD: (reference) => ({
        inline_keyboard: [
            [{ text: "✅ Approve (Mark Completed)", callback_data: `approve_withdrawal_${reference}` }],
            [{ text: "❌ Decline & Refund", callback_data: `decline_withdrawal_${reference}` }]
        ]
    }),
    ADMIN_WITHDRAWAL_MARKED_COMPLETE: (reference) => `✅ Withdrawal \`${reference}\` marked as completed.`,
    ADMIN_WITHDRAWAL_PROMPT_DECLINE_REASON: '📝 Please provide a reason for declining this withdrawal:',
    ADMIN_WITHDRAWAL_DECLINED_SUCCESS: (reference, userId, amount) => `❌ Withdrawal \`${reference}\` for user \`${userId}\` (₦${amount.toFixed(2)}) has been declined and refunded.`,
    USER_WITHDRAWAL_DECLINED: (amount, reason) => `❌ Your withdrawal request for ₦${amount.toFixed(2)} was declined.\n\n*Reason:* ${reason}\n\nYour funds have been returned to your balance.`,
    ADMIN_DELETE_USER_CONFIRMATION: (firstName, telegramId) => `⚠️ Are you sure you want to delete *${firstName}* (ID: \`${telegramId}\`) and all their data? This action is irreversible.`,

    // --- NEW BROADCAST MESSAGES ---
    ADMIN_PROMPT_BROADCAST_MESSAGE: '✍️ Please send the message you want to broadcast to ALL users. You can use Markdown formatting.',
    ADMIN_BROADCAST_CONFIRMATION: (message) => `You are about to broadcast the following message:\n\n---\n${message}\n---\n\nAre you sure you want to send this to ALL users?`,
    ADMIN_BROADCAST_IN_PROGRESS: '🚀 Broadcasting message... This might take a while for many users. Please wait.',
    ADMIN_BROADCAST_COMPLETE: (successCount, failureCount) => `✅ Broadcast complete!\n\nSent to: ${successCount} users.\nFailed for: ${failureCount} users.`,
    ADMIN_BROADCAST_CANCELLED: '❌ Broadcast cancelled.',
    ADMIN_BROADCAST_NO_USERS: '🤷‍♂️ No users found in the database to broadcast to.',
};

// Constants values are now based on your provided "old" code
const MIN_DEPOSIT_AMOUNT = 1000;
const MIN_WITHDRAW_AMOUNT = 1500;
const WELCOME_BONUS_AMOUNT = 200;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INVESTMENT_PLANS = [
    { id: 'rookie', name: 'Rookie Plan', roi: '15%', min: 1000, max: 10000, durationDays: 3 },
    { id: 'standard', name: 'Standard Plan', roi: '18%', min: 10000, max: 50000, durationDays: 28 },
    { id: 'investor', name: 'Investor Plan', roi: '25%', min: 50000, max: 200000, durationDays: 14 }, // Added 'name' property
];

// This calculation logic is provided by you, and handles specific ROI interpretation.
const calculateProjectedReturn = (amount, plan) => {
    let percentage = parseFloat(plan.roi.replace('%', ''));
    let totalReturnPercentage = 0;

    if (plan.id === 'rookie') { // Changed from plan.roi.toLowerCase().includes('rookie') to plan.id for robustness
        totalReturnPercentage = percentage * plan.durationDays;
    } else if (plan.id === 'standard') { // Changed from plan.roi.toLowerCase().includes('standard')
        const numWeeks = plan.durationDays / 7;
        totalReturnPercentage = percentage * numWeeks;
    } else if (plan.id === 'investor') { // Changed from plan.roi.toLowerCase().includes('investor')
        const numMonths = plan.durationDays / 30;
        totalReturnPercentage = percentage * numMonths;
    } else {
        totalReturnPercentage = percentage; // Fallback or direct percentage if no specific logic applies
    }

    return amount * (1 + (totalReturnPercentage / 100));
};


const POPULAR_NIGERIAN_BANKS = [
    { name: 'Access Bank', code: '044' },
    { name: 'Zenith Bank', code: '057' },
    { name: 'Guaranty Trust Bank', code: '058' },
    { name: 'First Bank of Nigeria', code: '011' },
    { name: 'United Bank for Africa (UBA)', code: '033' },
    { name: 'Kuda MFB', code: '090267' },
    { name: 'Fidelity Bank', code: '070' },
    { name: 'Union Bank of Nigeria', code: '032' },
    { name: 'Sterling Bank', code: '232' },
    { name: 'Wema Bank', code: '023' },
    { name: 'Heritage Bank', code: '030' },
    { name: 'Keystone Bank', code: '082' },
    { name: 'Polaris Bank', code: '076' },
    { name: 'Stanbic IBTC Bank', code: '221' },
    { name: 'Standard Chartered Bank', code: '068' },
    { name: 'Opay paycom', code: '810' },
    { name: 'Globus Bank', code: '001031' },
    { name: 'Palmpay', code: '100033' },
    { name: 'Providus Bank', code: '101' },
    { name: 'Moniepoint MFB', code: '50197' }
];


module.exports = {
    MAIN_MENU_KEYBOARD,
    ADMIN_MENU_KEYBOARD,
    BOT_MESSAGES,
    MIN_DEPOSIT_AMOUNT,
    MIN_WITHDRAW_AMOUNT,
    WELCOME_BONUS_AMOUNT,
    EMAIL_REGEX,
    INVESTMENT_PLANS,
    POPULAR_NIGERIAN_BANKS,
    calculateProjectedReturn
};
