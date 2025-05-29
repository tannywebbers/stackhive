// config/constants.js
module.exports = {
    // Main Menu for Telegram Keyboard
    MAIN_MENU_KEYBOARD: {
        reply_markup: {
            keyboard: [
                ["💰 Balance", "💳 Deposit"],
                ["📊 Invest", "📤 Withdraw"],
                ["🗂 Wallet", "👫 Referrals"],
                ["🆘 Support"]
            ],
            resize_keyboard: true
        }
    },
    // Bot Messages
    BOT_MESSAGES: {
        WELCOME: (firstName, balance) => `👋 Welcome *${firstName}* to SportyVest!\n💰 Your balance: ₦${balance.toFixed(2)}\n\nUse the buttons below to navigate:`,
        DEPOSIT_PROMPT_AMOUNT: '💵 *Enter Deposit Amount*\n\nPlease send the amount you want to deposit (e.g., "5000")\nMinimum: ₦500',
        INVALID_AMOUNT: '❌ Invalid amount. Please send numbers only.',
        MIN_DEPOSIT_AMOUNT_ERROR: '❌ Minimum deposit is ₦500',
        DEPOSIT_PROMPT_EMAIL: '📧 *Enter Your Email*\n\nPlease reply with your email address for payment verification:',
        INVALID_EMAIL_FORMAT: '❌ Invalid email format. Please include a valid email.',
        PROCESSING_DEPOSIT: '⏳ Processing your deposit request...',
        PAYMENT_LINK_GENERATED: (amount, authUrl, email, reference) =>
            `✅ *Payment Link Generated*\n\n` +
            `🔗 [Click to Pay ₦${amount.toFixed(2)}](${authUrl})\n\n` +
            `📧 Email: ${email}\n` +
            `📌 Reference: \`${reference}\`\n\n` + // Use backticks for monospace reference
            `🔄 I'll notify you when payment is confirmed`,
        DEPOSIT_SUCCESS: (amount, newBalance) => `🎉 Your deposit of ₦${amount.toFixed(2)} was successful!\n\n💰 Your new balance is: ₦${newBalance.toFixed(2)}`,
        DEPOSIT_FAILED: (amount, reference) => `💔 Your deposit of ₦${amount.toFixed(2)} (Ref: \`${reference}\`) failed. Please try again or contact support.`,
        BALANCE_INFO: (availableBalance, pendingDeposits) =>
            `💵 *Account Balance*\n\n` +
            `💰 Available: ₦${availableBalance.toFixed(2)}\n` +
            `📊 Pending deposits: ₦${pendingDeposits.toFixed(2)}`,
        GENERIC_ERROR: 'An unexpected error occurred. Please try again or contact support.',
        PAYSTACK_INIT_ERROR: 'Payment initialization failed. Please try again.',
        INVALID_COMMAND: 'Sorry, I don\'t understand that. Please use the menu buttons or /start.',
        WITHDRAW_PROMPT_AMOUNT: '📤 *Enter Withdrawal Amount*\n\nPlease send the amount you want to withdraw (e.g., "10000")\nMinimum: ₦1000',
        MIN_WITHDRAW_AMOUNT_ERROR: '❌ Minimum withdrawal is ₦1000',
        INSUFFICIENT_BALANCE: (balance) => `❌ Insufficient balance for withdrawal. Your current balance is ₦${balance.toFixed(2)}.`,
        WITHDRAW_PROMPT_BANK_DETAILS: '🏦 *Enter Bank Details*\n\nPlease provide your bank name, account number, and account name in the format:\n\n`Bank Name, Account Number, Account Name`\n\nExample: `Zenith Bank, 0012345678, John Doe`',
        INVALID_BANK_DETAILS_FORMAT: '❌ Invalid format. Please use: `Bank Name, Account Number, Account Name`',
        BANK_NOT_FOUND: '❌ Could not find bank. Please ensure the bank name is correct or contact support.',
        PROCESSING_WITHDRAWAL: '⏳ Processing your withdrawal request...',
        WITHDRAWAL_INITIATED: '✅ Your withdrawal request has been placed. You will receive it shortly.',
        WITHDRAWAL_FAILED: (amount, reason) => `💔 Your withdrawal of ₦${amount.toFixed(2)} failed. Reason: ${reason || 'Unknown'}. Funds have been returned to your balance.`,
        WALLET_PROMPT: '🗂 *Wallet Management*\n\nDo you want to set or update your withdrawal wallet address?',
        WALLET_SET_PROMPT: 'Please send your BEP20 USDT wallet address:',
        INVALID_WALLET_ADDRESS: '❌ Invalid wallet address format. Please send a valid BEP20 USDT address.',
        WALLET_UPDATED: (address) => `✅ Your withdrawal wallet address has been updated to: \`${address}\``,
        WALLET_CURRENT: (address) => `💰 Your current withdrawal wallet address is: \`${address}\`\n\nYou can update it anytime.`,
        WALLET_NOT_SET: '❌ You have not set a withdrawal wallet address yet. Please use the button below to set one.',
        SUPPORT_MESSAGE: '🆘 For support, please contact our team via @SportyVestSupport',
        REFERRAL_MESSAGE: (referralLink) =>
            `👫 *Referral Program*\n\n` +
            `Share your unique referral link to earn bonuses!\n` +
            `🔗 Your Referral Link: ${referralLink}\n\n` +
            `You earn a percentage of deposits made by users you refer. More details coming soon!`,
        INVEST_INFO: '📊 *Investment Plans*\n\n' +
            'We offer various investment plans with attractive returns. Choose a plan to get started:'
        // Add more messages as needed
    },
    MIN_INVEST_AMOUNT: 100, // Example, adjust as needed
    MIN_DEPOSIT_AMOUNT: 500,
    MIN_WITHDRAW_AMOUNT: 1000,
    // Other configurations like investment plans, interest rates, etc.
    // Example:
    INVESTMENT_PLANS: [
        { id: 'plan_1', name: 'Daily Saver', min: 1000, max: 100000, roi: '1% daily' },
        { id: 'plan_2', name: 'Monthly Growth', min: 50000, max: 500000, roi: '10% monthly' },
    ],
    // Regular expression for basic email validation
    EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    // Regex for BEP20 USDT addresses (starts with 0x)
    BEP20_USDT_REGEX: /^0x[a-fA-F0-9]{40}$/
};
