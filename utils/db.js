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
            bufferCommands: false, // Critical for Vercel
            // useNewUrlParser: true, // Deprecated in Mongoose 6+
            // useUnifiedTopology: true, // Deprecated in Mongoose 6+
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
        metadata: { type: Schema.Types.Mixed } // Retaining metadata for flexibility
    }],
    bankDetails: {
        accountNumber: { type: String },
        bankName: { type: String },
        accountName: { type: String },
        recipientCode: { type: String }, // Keep this field for Paystack recipient code
    },
    // Adding walletAddress from the old schema
    //walletAddress: { type: String }, // For crypto wallets etc.

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
            // Retain the prettier log, but ensure it logs useful info
            console.log(`\x1b[36m%s\x1b[0m`, `👤 New user created: ${username || firstName} (${telegramId})`);
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
        return user; // Return the full user object for flexibility
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Error in updateUserBalance:');
        console.error(error);
        throw error;
    }
};

// Function to add a transaction (using metadata for flexibility)
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

// Function to save bank details (now includes recipientCode directly)
const saveBankDetails = async (telegramId, accountNumber, bankName, accountName, recipientCode = null) => {
    try {
        const user = await User.findOneAndUpdate(
            { telegramId },
            {
                bankDetails: { accountNumber, bankName, accountName, recipientCode } // recipientCode now part of bankDetails
            },
            { new: true, upsert: true } // Use upsert to create if not exists
        );
        return user;
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Error in saveBankDetails:');
        console.error(error);
        throw error;
    }
};

// Function to update transaction status (using newMetadata to merge)
const updateTransactionStatus = async (reference, status, newMetadata = {}) => {
    try {
        const user = await User.findOne({ 'transactions.reference': reference });
        if (!user) {
            throw new Error('Transaction not found');
        }
        const transaction = user.transactions.find(t => t.reference === reference);
        if (transaction) {
            transaction.status = status;
            // Merge new metadata with existing metadata
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

// New function: Save or update wallet address
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
    connectDB,
    User, // Export the User model
    mongoose, // Export mongoose instance for graceful disconnect in local_dev.js

    // Export all utility functions
    getOrCreateUser,
    updateUserBalance,
    addTransaction,
    saveBankDetails,
    updateTransactionStatus,
    saveWalletAddress, // Export the newly added function
    deleteUser, // Export the existing deleteUser function
    // Removed old getPaystackRecipientCode as it's now handled via fetching user.bankDetails.recipientCode
    // Removed old savePaystackRecipientCode as it's now handled by saveBankDetails
};
