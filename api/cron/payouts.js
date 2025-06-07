// api/cron/payouts.js
// This script processes matured investments and credits users' internal balances.

const { User, updateUserBalance, addTransaction, updateInvestmentStatus, getMaturedInvestments } = require('../../utils/db');
const { INVESTMENT_PLANS, calculateProjectedReturn, BOT_MESSAGES } = require('../../config/constants');
const { sendTelegramMessage } = require('../../utils/telegram');


module.exports = async (req, res) => {
    console.log('Starting daily investment maturity credit cron job...');

    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Sets time to 00:00:00.000 today

        const usersWithMaturedInvestments = await getMaturedInvestments(today);

        if (usersWithMaturedInvestments.length === 0) {
            console.log('No matured investments found today.');
            return res.status(200).send('No matured investments to process.');
        }

        console.log(`Found ${usersWithMaturedInvestments.length} users with matured investments.`);

        for (const user of usersWithMaturedInvestments) {
            console.log(`Processing user: ${user.telegramId}`);
            let userUpdated = false;

            for (let i = 0; i < user.investments.length; i++) {
                const investment = user.investments[i];

                // Check if the investment is active and has matured
                if (investment.status === 'active' && investment.maturityDate <= today) {
                    const plan = INVESTMENT_PLANS.find(p => p.id === investment.planId);

                    if (!plan) {
                        console.warn(`Investment plan ${investment.planId} not found for user ${user.telegramId}. Skipping investment.`);
                        // Optionally update status to reflect missing plan
                        await updateInvestmentStatus(investment._id, 'plan_not_found', user.telegramId);
                        userUpdated = true;
                        continue; // Move to the next investment
                    }

                    // Recalculate projected return using your specific logic from constants.js
                    const projectedReturn = calculateProjectedReturn(investment.amount, plan);
                    const profit = projectedReturn - investment.amount;
                    const creditAmount = projectedReturn; // The amount to credit to the user's balance

                    console.log(`  Matured investment for user ${user.telegramId}: Plan ${plan.name}, Invested ₦${investment.amount.toFixed(2)}, Crediting ₦${creditAmount.toFixed(2)}`);

                    try {
                        // 1. Update user's balance by crediting the projected return
                        const updatedUser = await updateUserBalance(user.telegramId, creditAmount);
                        if (!updatedUser) {
                            throw new Error('Failed to update user balance.');
                        }
                        console.log(`  User ${user.telegramId} balance updated. New balance: ₦${updatedUser.balance.toFixed(2)}`);

                        // 2. Add a transaction record for the investment payout
                        const payoutReference = `INV-MATURE-${investment.reference}`; // Generate an internal reference
                        await addTransaction(
                            user.telegramId,
                            'investment_payout',
                            creditAmount,
                            'completed',
                            payoutReference,
                            {
                                originalInvestmentRef: investment.reference,
                                planName: plan.name,
                                investedAmount: investment.amount,
                                profit: profit
                            }
                        );
                        console.log(`  Transaction added for user ${user.telegramId}, ref: ${payoutReference}`);

                        // 3. Update the investment status to 'paid_out'
                        user.investments[i].status = 'paid_out';
                        user.investments[i].payoutReference = payoutReference; // Store internal reference
                        user.investments[i].projectedReturn = projectedReturn; // Ensure this is stored
                        userUpdated = true;

                        // 4. Notify the user via Telegram bot
                        try {
                            const message = BOT_MESSAGES.AUTOMATED_PAYOUT_SUCCESS(plan.name, investment.amount, creditAmount);
                            await sendTelegramMessage(
                                user.telegramId,
                                message,
                                { parse_mode: 'Markdown' }
                            );
                            console.log(`  Notified user ${user.telegramId} about matured investment payout.`);
                        } catch (botError) {
                            console.error(`  Error notifying user ${user.telegramId} about payout:`, botError.message);
                        }

                    } catch (creditError) {
                        // Handle errors during internal crediting/status update
                        console.error(`  Error processing payout for user ${user.telegramId}, investment ${investment._id}:`, creditError.message);
                        user.investments[i].status = 'payout_error'; // Mark as internal error
                        user.investments[i].payoutError = creditError.message;
                        userUpdated = true;

                        // Optionally notify user about internal error or log for manual review
                        try {
                            const message = BOT_MESSAGES.AUTOMATED_PAYOUT_FAILED(plan.name, investment.amount, `Internal system error: ${creditError.message}`);
                            await sendTelegramMessage(
                                user.telegramId,
                                message,
                                { parse_mode: 'Markdown' }
                            );
                        } catch (botError) {
                            console.error(`  Error notifying user ${user.telegramId} about failed internal payout:`, botError.message);
                        }
                    }
                }
            }

            if (userUpdated) {
                // Save user document only if any investments were updated
                await user.save();
                console.log(`User ${user.telegramId} investments updated and saved.`);
            }
        }
        console.log('Daily investment maturity credit job completed successfully.');
        res.status(200).send('Investment maturity job completed successfully.');

    } catch (error) {
        console.error('Error during daily investment maturity credit cron job:', error);
        res.status(500).send('Error processing investment maturities.');
    }
};
