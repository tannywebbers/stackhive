// utils/db.js
const mongoose = require('mongoose');

// MongoDB User Schema
const userSchema = new mongoose.Schema({
    telegramId: { type: Number, required: true, unique: true },
    firstName: String,
    username: String,
    balance: { type: Number, default: 0 },
    walletAddress: String, // For crypto withdrawals
    paystackRecipientCode: String, // For Naira withdrawals
    referralLink: String, // Unique referral link for the user
    referredBy: { type: Number, ref: 'User' }, // Telegram ID of the referrer
    transactions: [{
        type: { type: String, enum: ['deposit', 'withdrawal', 'investment', 'referral_bonus'], required: true },
        amount: { type: Number, required: true },
        status: { type: String, enum: ['pending', 'completed', 'failed', 'reversed'], default: 'pending' },
        reference: String, // Paystack reference or internal reference
        date: { type: Date, default: Date.now },
        details: mongoose.Schema.Types.Mixed // Store additional details (e.g., bank info, plan)
    }],
    investments: [{ // Separate schema for investment tracking
        planId: String,
        amount: Number,
        startDate: { type: Date, default: Date.now },
        maturityDate: Date,
        roi: String, // e.g., "1% daily"
        status: { type: String, enum: ['active', 'matured', 'cancelled'], default: 'active' },
        reference: String // Link to deposit transaction
    }],
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Connect to MongoDB
async function connectDB() {
    if (mongoose.connection.readyState === 0) { // Check if not already connected
        try {
            await mongoose.connect(process.env.MONGODB_URI, {
                // useNewUrlParser: true, // Deprecated in Mongoose 6+
                // useUnifiedTopology: true, // Deprecated in Mongoose 6+
            });
            console.log('✅ Database connected');
        } catch (error) {
            console.error('❌ DB connection failed:', error.message);
            // In a Vercel serverless environment, this might just crash the function,
            // which Vercel handles by re-invoking. For local, you might want to exit.
            // process.exit(1);
            throw error; // Re-throw to indicate connection failure
        }
    }
}

// Helper function to initialize or get user
async function getOrCreateUser(telegramId, firstName, username, referrerId = null) {
    let user = await User.findOne({ telegramId });
    if (!user) {
        user = new User({
            telegramId,
            firstName,
            username,
            referralLink: `${process.env.TELEGRAM_WEBHOOK_URL}?start=${telegramId}`, // Example: direct referral link to bot
            referredBy: referrerId // Assign referrer if provided
        });
        await user.save();
        console.log(`New user created: ${username || firstName} (${telegramId})`);
    }
    return user;
}

// Update user balance
async function updateUserBalance(userId, amount) {
    const user = await User.findOneAndUpdate(
        { telegramId: userId },
        { $inc: { balance: amount } },
        { new: true } // Return the updated document
    );
    return user ? user.balance : 0;
}

// Add a transaction record
async function addTransaction(userId, type, amount, status, reference = null, details = {}) {
    const user = await User.findOneAndUpdate(
        { telegramId: userId },
        {
            $push: {
                transactions: {
                    type,
                    amount,
                    status,
                    reference,
                    details
                }
            }
        },
        { new: true }
    );
    return user;
}

// Update an existing transaction status
async function updateTransactionStatus(reference, status, userId = null, newDetails = {}) {
    const query = { 'transactions.reference': reference };
    if (userId) {
        query.telegramId = userId;
    }
    const update = {
        $set: {
            'transactions.$.status': status,
            'transactions.$.details': newDetails
        }
    };
    const user = await User.findOneAndUpdate(query, update, { new: true });
    return user;
}

// Save Paystack recipient code for withdrawals
async function savePaystackRecipientCode(userId, recipientCode) {
    const user = await User.findOneAndUpdate(
        { telegramId: userId },
        { paystackRecipientCode: recipientCode },
        { new: true }
    );
    return user;
}

// Get Paystack recipient code
async function getPaystackRecipientCode(userId) {
    const user = await User.findOne({ telegramId: userId });
    return user ? user.paystackRecipientCode : null;
}

// Save or update wallet address
async function saveWalletAddress(userId, address) {
    const user = await User.findOneAndUpdate(
        { telegramId: userId },
        { walletAddress: address },
        { new: true }
    );
    return user;
}

module.exports = {
    connectDB,
    User, // Export the model directly for schema operations
    getOrCreateUser,
    updateUserBalance,
    addTransaction,
    updateTransactionStatus,
    savePaystackRecipientCode,
    getPaystackRecipientCode,
    saveWalletAddress
};
