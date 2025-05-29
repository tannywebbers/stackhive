// api/bot.js
const { processUpdate } = require('../utils/telegram');
const { connectDB } = require('../utils/db');

// Ensure database connection is established for each invocation
async function ensureDbConnection() {
    // connectDB checks if already connected, so it's safe to call on every invocation
    await connectDB();
}

// Vercel serverless function entry point
module.exports = async (req, res) => {
    if (req.method === 'POST') {
        await ensureDbConnection(); // Connect to DB on each invocation
        await processUpdate(req.body);
        res.status(200).send('OK');
    } else {
        res.status(405).send('Method Not Allowed');
    }
};
