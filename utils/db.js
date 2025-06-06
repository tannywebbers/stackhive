// utils/db.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

let isConnected = false; // Flag to track connection status

// Function to connect to MongoDB
const connectDB = async (dbUri) => {
    if (isConnected && mongoose.connection.readyState === 1) { // Check if already connected and connection is open
        console.log('\x1b[36m%s\x1b[0m', '💡 Reusing existing MongoDB connection.'); // Prettier log
        return;
    }
    // If not connected, or if connection is broken (readyState != 1), try to connect
    try {
        if (!dbUri) { // Added a check to explicitly throw error if dbUri is missing
            throw new Error('MongoDB URI is not provided to connectDB function.');
        }
        await mongoose.connect(dbUri, {
            // *** ADDED/MODIFIED THESE OPTIONS FOR VERCEL DEPLOYMENT ***
            serverSelectionTimeoutMS: 30000, // Default is 30s in Mongoose 6, but good to be explicit
            socketTimeoutMS: 45000,        // Close sockets after 45 seconds of inactivity
            connectTimeoutMS: 30000,       // Establish connection within 30 seconds
            bufferCommands: false,         // Disable Mongoose's buffering. Important for serverless.
            // These options are deprecated in Mongoose 6+ and can usually be removed
            // useNewUrlParser: true,
            // useUnifiedTopology: true,
        });
        isConnected = true;
        console.log('\x1b[32m%s\x1b[0m', '✅ MongoDB Connected Successfully!'); // Prettier success log
    } catch (error) {
        isConnected = false;
        console.error('\x1b[31m%s\x1b[0m', '❌ MongoDB Connection Error:'); // Prettier error log
        console.error(error); // Log the full error object for debugging
        throw error; // Re-throw to allow calling script (local_dev.js) to handle exit
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
        recipientCode: { type: String }
    },
    referrerId: { type: Number, default: null, index: true },
    referralBonusEarned: { type: Number, default: 0 },
    hasReceivedWelcomeBonus: { type: Boolean, default: false },
    investments: [{
        planId: { type: String, required: true },
        amount: { type: Number, required: true },
        startDate: { type: Date, default: Date.now },
        maturityDate: { type: Date, required: true },
        projectedReturn: { type: Number, required: true },
        status: { type: String, enum: ['active', 'matured', 'cancelled'], default: 'active' },
        reference: { type: String, required: true, unique: true }
    }]
});

const User = mongoose.model('User', userSchema);

// --- Utility Functions ---

// Function to get or create a user
const getOrCreateUser = async (telegramId, firstName, username, referrerId = null) => {
    try {
        let user = await User.findOne({ telegramId });
        if (!user) {
            user = new User({ telegramId, firstName, username, referrerId });
            await user.save();
            console.log(`\x1b[36m%s\x1b[0m`, `👤 New user created: ${telegramId}`); // Prettier log
        }
        return user;
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Error in getOrCreateUser:');
        console.error(error);
        throw error;
    }
};

// Function to update user balance
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

// Function to add a transaction
const addTransaction = async (telegramId, type, amount, status, reference, metadata = {}) => {
    try {
        const user = await User.findOne({ telegramId });
        if (!user) {
            throw new Error('User not found');
        }
        user.transactions.push({ type, amount, status, reference, metadata });
        await user.save();
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Error in addTransaction:');
        console.error(error);
        throw error;
    }
};

// Function to save bank details
const saveBankDetails = async (telegramId, accountNumber, bankName, accountName, recipientCode = null) => {
    try {
        const user = await User.findOneAndUpdate(
            { telegramId },
            {
                bankDetails: { accountNumber, bankName, accountName, recipientCode }
            },
            { new: true }
        );
        return user;
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Error in saveBankDetails:');
        console.error(error);
        throw error;
    }
};

// Function to update transaction status
const updateTransactionStatus = async (reference, status, newMetadata = {}) => {
    try {
        const user = await User.findOne({ 'transactions.reference': reference });
        if (!user) {
            throw new Error('Transaction not found');
        }
        const transaction = user.transactions.find(t => t.reference === reference);
        if (transaction) {
            transaction.status = status;
            transaction.metadata = { ...transaction.metadata, ...newMetadata };
            await user.save();
        }
        return user;
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Error in updateTransactionStatus:');
        console.error(error);
        throw error;
    }
};

// Function to delete a user
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

// --- Exports ---
module.exports = {
    connectDB, // Export the connection function
    User, // Export the User model
    mongoose, // Export mongoose instance for graceful disconnect in local_dev.js

    // Export all other utility functions
    getOrCreateUser,
    updateUserBalance,
    addTransaction,
    saveBankDetails,
    updateTransactionStatus,
    deleteUser,
};
