// utils/db.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

let isConnected = false; // Flag to track connection status

// Function to connect to MongoDB
const connectDB = async (dbUri) => {
    if (isConnected && mongoose.connection.readyState === 1) {
        console.log('\x1b[36m%s\x1b[0m', '💡 Reusing existing MongoDB connection.');
        return;
    }
    try {
        if (!dbUri) {
            throw new Error('MongoDB URI is not provided to connectDB function.');
        }
        await mongoose.connect(dbUri, {
            serverSelectionTimeoutMS: 90000,
            socketTimeoutMS: 45000,
            connectTimeoutMS: 60000,
            bufferCommands: false,
        });
        isConnected = true;
        console.log('\x1b[32m%s\x1b[0m', '✅ MongoDB Connected Successfully!');
    } catch (error) {
        isConnected = false;
        console.error('\x1b[31m%s\x1b[0m', '❌ MongoDB Connection Error:');
        console.error(error);
        throw error;
    }
};

// User Schema
const userSchema = new mongoose.Schema({
    telegramId: { type: Number, required: true, unique: true, index: true },
    firstName: { type: String, required: true },
    username: { type: String },
    balance: { type: Number, default: 0 },
    transactions: [{
        type: { type: String, enum: ['deposit', 'withdrawal', 'investment', 'referral_bonus', 'investment_payout'], required: true },
        amount: { type: Number, required: true },
        date: { type: Date, default: Date.now },
        status: { type: String, enum: ['pending', 'completed', 'failed', 'pending_manual_review', 'declined'], default: 'pending' },
        reference: { type: String, required: true, unique: true },
        metadata: { type: Schema.Types.Mixed }
    }],
    bankDetails: {
        accountNumber: { type: String },
        bankName: { type: String },
        accountName: { type: String },
        recipientCode: { type: String },
    },
    referrerId: { type: Number, default: null, index: true },
    referralBonusEarned: { type: Number, default: 0 },
    hasReceivedWelcomeBonus: { type: Boolean, default: false },
    investments: [{
        planId: { type: String, required: true }, // Changed from planKey to planId to match your structure
        amount: { type: Number, required: true },
        startDate: { type: Date, default: Date.now },
        maturityDate: { type: Date, required: true },
        projectedReturn: { type: Number, required: true },
        status: { type: String, enum: ['active', 'matured', 'paid_out', 'cancelled', 'payout_failed', 'plan_not_found', 'payout_error'], default: 'active' },
        reference: { type: String, required: true, unique: true },
        payoutReference: { type: String },
        payoutError: { type: Schema.Types.Mixed }
    }]
});

const User = mongoose.model('User', userSchema);

// --- Utility Functions ---

const getOrCreateUser = async (telegramId, firstName, username, referrerId = null) => {
    try {
        let user = await User.findOne({ telegramId });
        if (!user) {
            user = new User({ telegramId, firstName, username, referrerId });
            await user.save();
            console.log(`\x1b[36m%s\x1b[0m`, `👤 New user created: ${username || firstName} (${telegramId})`);
        }
        return user;
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Error in getOrCreateUser:');
        console.error(error);
        throw error;
    }
};

const updateUserBalance = async (telegramId, amount) => {
    try {
        const user = await User.findOneAndUpdate(
            { telegramId },
            { $inc: { balance: amount } },
            { new: true }
        );
        return user;
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Error in updateUserBalance:');
        console.error(error);
        throw error;
    }
};

const addTransaction = async (telegramId, type, amount, status, reference, metadata = {}) => {
    try {
        const user = await User.findOne({ telegramId });
        if (!user) {
            throw new Error('User not found');
        }
        const existingTransaction = user.transactions.find(t => t.reference === reference);
        if (existingTransaction) {
            console.warn(`Attempted to add duplicate transaction reference: ${reference} for user ${telegramId}. Ignoring.`);
            return user;
        }
        user.transactions.push({ type, amount, status, reference, metadata });
        await user.save();
        return user;
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Error in addTransaction:');
        console.error(error);
        throw error;
    }
};

const saveBankDetails = async (telegramId, accountNumber, bankName, accountName, recipientCode = null) => {
    try {
        const user = await User.findOneAndUpdate(
            { telegramId },
            {
                bankDetails: { accountNumber, bankName, accountName, recipientCode }
            },
            { new: true, upsert: true }
        );
        return user;
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Error in saveBankDetails:');
        console.error(error);
        throw error;
    }
};

const updateTransactionStatus = async (reference, status, telegramId, newMetadata = {}) => {
    try {
        let user;
        if (telegramId) {
            user = await User.findOne({ telegramId, 'transactions.reference': reference });
        } else {
            user = await User.findOne({ 'transactions.reference': reference });
        }

        if (!user) {
            throw new Error('Transaction not found or user not matching reference');
        }
        const transaction = user.transactions.find(t => t.reference === reference);
        if (transaction) {
            transaction.status = status;
            transaction.metadata = { ...(transaction.metadata || {}), ...newMetadata };
            await user.save();
        }
        return user;
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Error in updateTransactionStatus:');
        console.error(error);
        throw error;
    }
};

const saveWalletAddress = async (telegramId, address) => {
    try {
        const user = await User.findOneAndUpdate(
            { telegramId },
            { walletAddress: address },
            { new: true }
        );
        return user;
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Error in saveWalletAddress:');
        console.error(error);
        throw error;
    }
};

const deleteUser = async (telegramId) => {
    try {
        const result = await User.deleteOne({ telegramId });
        return result.deletedCount;
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Error deleting user:');
        console.error(error);
        throw error;
    }
};

// NEW FUNCTION: Get latest transactions for a user
const getLatestTransactions = async (telegramId, limit = 10) => {
    try {
        const user = await User.findOne(
            { telegramId },
            { 'transactions': { $slice: -limit } } // Use $slice to get the last 'limit' items
        );
        if (!user) {
            return [];
        }
        // Transactions are stored in chronological order, but $slice: -limit gets the last 'limit' in that order.
        // If you want them in reverse chronological (newest first for display), you'd reverse them here.
        return user.transactions.reverse(); // Reverse to show newest first
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Error in getLatestTransactions:', error);
        throw error;
    }
};


const getMaturedInvestments = async (currentDate) => {
    try {
        const users = await User.find({
            'investments.status': 'active',
            'investments.maturityDate': { $lte: currentDate }
        });
        return users;
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Error in getMaturedInvestments:', error);
        throw error;
    }
};

const updateInvestmentStatus = async (investmentId, newStatus, telegramId, errorDetails = null) => {
    try {
        const user = await User.findOneAndUpdate(
            { telegramId, 'investments._id': investmentId },
            {
                '$set': {
                    'investments.$.status': newStatus,
                    'investments.$.payoutError': errorDetails
                }
            },
            { new: true }
        );
        if (!user) {
            console.warn(`Investment with ID ${investmentId} not found for user ${telegramId} for status update.`);
        }
        return user;
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', `❌ Error updating investment status for ${investmentId} to ${newStatus}:`, error);
        throw error;
    }
};


// --- Exports ---
module.exports = {
    connectDB,
    User,
    mongoose,

    getOrCreateUser,
    updateUserBalance,
    addTransaction,
    saveBankDetails,
    updateTransactionStatus,
    saveWalletAddress,
    deleteUser,
    
    getLatestTransactions,
    
    getMaturedInvestments,
    updateInvestmentStatus,
};
