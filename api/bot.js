// api/bot.js
const { processUpdate, setupWebhook } = require('../utils/telegram');
const { connectDB } = require('../utils/db');

let webhookSetupAttempted = false; // Flag to ensure webhook setup runs only once per cold start

module.exports = async (req, res) => {
    // 1. Ensure Database Connection
    await connectDB();

    // 2. Set Webhook (only once per cold start of the serverless function)
    if (!webhookSetupAttempted) {
        console.log('Attempting to set Telegram webhook...');
        await setupWebhook();
        webhookSetupAttempted = true;
    }

    // 3. Handle incoming Telegram updates
    if (req.method === 'POST') {
        await processUpdate(req.body);
        res.status(200).send('OK'); // Always respond OK to Telegram promptly
    } else if (req.method === 'GET') {
        // This GET handler is useful for debugging or manually triggering webhook setup
        // by visiting the Vercel URL in a browser.
        res.status(200).send('Telegram webhook endpoint for SportyVest bot. Webhook setup attempted.');
    } else {
        res.status(405).send('Method Not Allowed');
    }
};
