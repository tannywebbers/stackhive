// index.js
require('dotenv').config(); // Load environment variables from .env first

const express = require('express');
const { connectDB } = require('./utils/db'); // Import connectDB
// Assuming utils/telegram.js handles setupWebhook if you decide to use it locally
// const { setupWebhook } = require('./utils/telegram');

// Import your Vercel-style handlers
const botWebhookHandler = require('./api/bot');
const paystackWebhookHandler = require('./api/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON for our local server
app.use(express.json());

// Routes for local development
app.post('/api/bot', botWebhookHandler);
app.post('/api/webhook', paystackWebhookHandler);

// Root endpoint for health check
app.get('/', (req, res) => {
    res.send('Telegram Investment Bot Server is running!');
});

// Start the server for local development
app.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Telegram Bot Webhook URL for local testing: http://localhost:${PORT}/api/bot`);
    console.log(`Paystack Webhook URL for local testing: http://localhost:${PORT}/api/webhook`);

    // Connect to DB once for local development
    // Pass the MONGODB_URL from environment variables
    const MONGODB_URI = process.env.MONGODB_URL;
    if (!MONGODB_URI) {
        console.error('\x1b[31m%s\x1b[0m', '❌ ERROR: MONGODB_URL is not set for local server.');
        process.exit(1);
    }
    await connectDB(MONGODB_URI)
        .then(() => console.log('✅ Local MongoDB Connected for index.js!'))
        .catch(err => {
            console.error('❌ Local MongoDB Connection Error for index.js:', err);
            process.exit(1); // Exit if DB connection fails
        });

    // Set Telegram Webhook for local testing (optional, usually done once after deployment)
    // For Vercel, this is handled by Vercel's environment.
    // If you need to test webhooks locally with ngrok, uncomment the following and ensure setupWebhook is defined:
    // const TELEGRAM_WEBHOOK_URL_LOCAL = process.env.TELEGRAM_WEBHOOK_URL || `https://your-ngrok-url/api/bot`;
    // await setupWebhook(TELEGRAM_WEBHOOK_URL_LOCAL); // You would need to define setupWebhook in utils/telegram.js
});
