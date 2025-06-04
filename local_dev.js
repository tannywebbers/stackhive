// local_dev.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { connectDB, mongoose } = require('./utils/db'); // Import connectDB and mongoose from utils/db
const { registerBotHandlers } = require('./utils/bot_handlers');

// --- Configuration Checks ---
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error('\x1b[31m%s\x1b[0m', '❌ ERROR: TELEGRAM_BOT_TOKEN is not set in your .env file.');
    process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URL; // Use MONGODB_URL as per your db.js (not MONGODB_URI)
if (!MONGODB_URI) {
    console.error('\x1b[31m%s\x1b[0m', '❌ ERROR: MONGODB_URL is not set in your .env file.');
    console.error('\x1b[33m%s\x1b[0m', '💡 Please ensure your .env file has MONGODB_URL defined.');
    process.exit(1);
}

// --- Initialize Bot ---
const bot = new TelegramBot(token, { polling: true });

// --- Start Application ---
async function startApp() {
    try {
        // Connect to MongoDB using the centralized function
        await connectDB(MONGODB_URI);

        // Register bot handlers after successful DB connection
        registerBotHandlers(bot);
        console.log('\x1b[32m%s\x1b[0m', '🚀 Bot is starting in polling mode...');
        console.log('\x1b[35m%s\x1b[0m', '✨ Enjoy your local development! ✨');

    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', 'Fatal error during application startup:');
        console.error(error);
        process.exit(1); // Exit if DB connection or other critical startup fails
    }
}

startApp(); // Call the async function to start the app

// --- Handle Graceful Shutdown ---
process.on('SIGINT', async () => {
    console.log('\n\x1b[33m%s\x1b[0m', ' gracefully Shutting down bot...');
    try {
        await mongoose.disconnect(); // Use mongoose instance from utils/db
        console.log('\x1b[32m%s\x1b[0m', '✅ MongoDB disconnected.');
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Error during MongoDB disconnection:');
        console.error(error);
    } finally {
        process.exit(0);
    }
});

