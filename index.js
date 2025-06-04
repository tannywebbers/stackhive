// index.js
const express = require('express');
const dotenv = require('dotenv');
const { setupWebhook } = require('./utils/telegram');
const { connectDB } = require('./utils/db'); // Import connectDB
const botWebhookHandler = require('./api/bot'); // Import Vercel's bot webhook handler
const paystackWebhookHandler = require('./api/webhook'); // Import Vercel's Paystack webhook handler

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON for our local server
app.use(express.json());

// Routes for local development
app.post('/api/bot', botWebhookHandler); // This route will be handled by api/bot.js on Vercel
app.post('/api/webhook', paystackWebhookHandler); // This route will be handled by api/webhook.js on Vercel

// Root endpoint for health check
app.get('/', (req, res) => {
    res.send('Telegram Investment Bot Server is running!');
});

// Start the server for local development
 app.listen(PORT, async () => {
    /**console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Telegram Bot Webhook URL for local testing: http://localhost:${PORT}/api/bot`); **/
   /** console.log(`Paystack Webhook URL for local testing: http://localhost:${PORT}/api/webhook`); **/
    // Connect to DB once for local development
    await connectDB();

    // Set Telegram Webhook for local testing (optional, usually done once after deployment)
    // For Vercel, this is done automatically by Vercel on deployment.
    // Uncomment and run once if you want to test webhook locally with ngrok
    // await setupWebhook();
});
