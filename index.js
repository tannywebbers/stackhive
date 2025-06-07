// index.js
require('dotenv').config(); // Load environment variables from .env first

const express = require('express');
const path = require('path'); // Import path module for serving HTML files
const bodyParser = require('body-parser'); // Import body-parser for webhook raw body
const { connectDB } = require('./utils/db'); // Import connectDB

// Import your webhook handlers
const botWebhookHandler = require('./api/bot');
const paystackWebhookHandler = require('./api/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for Paystack webhook: Use raw body parser ONLY for /api/webhook
// This ensures `req.rawBody` is available for signature verification.
app.post('/api/webhook', bodyParser.raw({ type: 'application/json' }), (req, res, next) => {
    req.rawBody = req.body; // Store the raw body buffer
    try {
        req.body = JSON.parse(req.rawBody.toString()); // Parse it for subsequent middleware/handlers
    } catch (e) {
        console.error('Failed to parse JSON body for webhook:', e);
        return res.status(400).send('Invalid JSON payload');
    }
    next();
}, paystackWebhookHandler);

// General JSON parsing for other routes (like /api/bot)
// This should come AFTER any specific raw body parsing for webhooks that need it.
app.use(express.json());

// Serve static files from a 'public' directory
// Make sure you create a folder named 'public' in your project root
app.use(express.static(path.join(__dirname, 'public')));


// --- Payment Success Route ---
// This serves your HTML page after a successful payment callback
app.get('/payment-successful', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'payment-successful.html'));
});


// Route for Telegram Bot webhook
app.post('/api/bot', botWebhookHandler);


// Root endpoint for health check
app.get('/', (req, res) => {
    res.send('Telegram Investment Bot Server is running!');
});

// Start the server
app.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Telegram Bot Webhook URL for local testing: http://localhost:${PORT}/api/bot`);
    console.log(`Paystack Webhook URL for local testing: http://localhost:${PORT}/api/webhook`);
    console.log(`Payment Success Callback URL for local testing: http://localhost:${PORT}/payment-success`);


    // Connect to DB once for application startup (essential for Render)
    const MONGODB_URI = process.env.MONGODB_URL;
    if (!MONGODB_URI) {
        console.error('\x1b[31m%s\x1b[0m', '❌ ERROR: MONGODB_URL is not set. Please set it in your .env file or Render environment variables.');
        process.exit(1); // Exit if DB connection fails, as the app can't function
    }
    await connectDB(MONGODB_URI)
        .then(() => console.log('✅ MongoDB Connected for Application!'))
        .catch(err => {
            console.error('❌ MongoDB Connection Error for Application:', err);
            process.exit(1); // Exit if DB connection fails
        });
});
