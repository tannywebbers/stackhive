// api/cron/payouts.js
// This script is designed to be run as a Vercel Serverless Cron Job.
// It will be triggered periodically by Vercel.

const mongoose = require('mongoose');
const { User, updateUserBalance, addTransaction } = require('../../utils/db'); // Adjust path
const { INVESTMENT_PLANS, calculateProjectedReturn, BOT_MESSAGES } = require('../../config/constants'); // Adjust path

// Import TelegramBot to send notifications (if needed)
const TelegramBot = require('node-telegram-bot-api');
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN); // Initialize bot for sending messages

async function connectDb() {
    const MONGODB_URL = process.env.MONGODB_URL; // Consistent with your .env
    if (!MONGODB_URL) {
        console.error('MONGODB_URL is not defined in environment variables!');
        // In a serverless context, we might throw an error or just return.
        // For cron, it's better to exit early.
        throw new Error('MONGODB_URL not configured.');
    }

    if (mongoose.connection.readyState === 0) {
        // Ensure connection is not already open from previous invocations in the same container.
        try {
            await mongoose.connect(MONGODB_URL);
            console.log('MongoDB connected for cron job.');
        } catch (error) {
            console.error('MongoDB Connection Error in cron job:', error);
            throw error;
        }
    } else {
        console.log('MongoDB already connected.');
    }
}

// Main handler for the serverless function
module.exports = async (req, res) => {
    // Basic security: Ensure it's a cron job request (optional but good practice)
    // Vercel Cron Jobs send a 'x-vercel-cron-event' header
    if (req.headers['x-vercel-cron-event'] !== 'true') {
        console.log('Received non-cron request. Ignoring.');
        return res.status(403).send('Forbidden');
    }

    console.log('Starting daily payout cron job...');

    try {
        await connectDb();

        const today = new Date();
        // Set to start of the day in UTC for consistent comparison across timezones if needed,
        // or ensure your application dates are stored consistently.
        // For simplicity with `new Date()`, we'll set to 00:00:00 local time.
        today.setHours(0, 0, 0, 0);

        // Find users with active investments that have matured by today
        // We ensure we only process 'active' investments that haven't been processed
        const usersWithMaturedInvestments = await User.find({
            'investments.status': 'active',
            'investments.maturityDate': { $lte: today }
        });

        if (usersWithMaturedInvestments.length === 0) {
            console.log('No matured investments found today.');
            return res.status(200).send('No matured investments to process.');
        }

        for (const user of usersWithMaturedInvestments) {
            console.log(`Processing user: ${user.telegramId}`);
            let userUpdated = false;

            for (let i = 0; i < user.investments.length; i++) {
                const investment = user.investments[i];

                if (investment.status === 'active' && investment.maturityDate <= today) {
                    const plan = INVESTMENT_PLANS.find(p => p.id === investment.planId);

                    if (!plan) {
                        console.warn(`Investment plan ${investment.planId} not found for user ${user.telegramId}. Skipping investment.`);
                        continue;
                    }

                    const projectedReturn = calculateProjectedReturn(investment.amount, plan);
                    const profit = projectedReturn - investment.amount;

                    console.log(`  Matured investment for user ${user.telegramId}: Plan ${plan.name}, Invested ₦${investment.amount.toFixed(2)}, Return ₦${projectedReturn.toFixed(2)}`);

                    // 1. Update user's balance
                    // Using updateUserBalance function from db.js
                    await updateUserBalance(user.telegramId, projectedReturn);

                    // 2. Add a transaction record for the payout
                    // Using addTransaction function from db.js
                    await addTransaction(
                        user.telegramId,
                        'investment_payout',
                        projectedReturn,
                        'completed',
                        `payout_${investment.reference}`, // Unique reference for payout
                        {
                            originalInvestmentRef: investment.reference,
                            planName: plan.name,
                            investedAmount: investment.amount,
                            profit: profit
                        }
                    );

                    // 3. Update the investment status to 'matured' in the user object
                    user.investments[i].status = 'matured';
                    userUpdated = true;

                    // 4. Notify the user via Telegram bot
                    try {
                        await bot.sendMessage(
                            user.telegramId,
                            BOT_MESSAGES.AUTOMATED_PAYOUT_SUCCESS(plan.name, investment.amount, projectedReturn),
                            { parse_mode: 'Markdown' }
                        );
                        console.log(`  Notified user ${user.telegramId} about matured investment.`);
                    } catch (botError) {
                        console.error(`  Error notifying user ${user.telegramId}:`, botError.message);
                    }
                }
            }
            if (userUpdated) {
                // Save the user document only once after processing all their investments
                await user.save();
                console.log(`User ${user.telegramId} investments updated and saved.`);
            }
        }
        console.log('Daily payout cron job completed successfully.');
        res.status(200).send('Payout job completed successfully.');

    } catch (error) {
        console.error('Error during daily payout cron job:', error);
        res.status(500).send('Error processing payouts.');
    } finally {
        // In a serverless function, the connection might persist across invocations
        // within the same container, but it's good practice to ensure cleanup if needed.
        // For Vercel, it often manages connections implicitly.
        // mongoose.disconnect(); // Not strictly necessary for Vercel functions, but optional.
    }
};
