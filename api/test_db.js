// api/test-db.js
const { connectDB } = require('../utils/db');
const mongoose = require('mongoose'); // Import mongoose to disconnect

module.exports = async (req, res) => {
    console.log('Test DB function invoked.');
    const mongoDbUri = process.env.MONGODB_URL;

    if (!mongoDbUri) {
        console.error('❌ MONGODB_URL environment variable is not set in Vercel!');
        return res.status(500).send('MONGODB_URL environment variable is missing.');
    }

    try {
        console.log('Attempting to connect to MongoDB from Vercel...');
        await connectDB(mongoDbUri); // Use your existing connectDB function

        // Optional: Perform a simple query to ensure full connectivity
        // If User model is accessible globally after connectDB, you can do this:
        try {
            const { User } = require('../utils/db'); // Re-import to get the model after connection
            const userCount = await User.countDocuments();
            console.log(`Total users in database: ${userCount}`);
            res.status(200).json({ status: 'success', message: 'Successfully connected to MongoDB!', userCount: userCount });
        } catch (queryError) {
            console.error('Error performing test query:', queryError);
            res.status(500).json({ status: 'error', message: 'Connected to DB, but test query failed.', error: queryError.message });
        }

    } catch (error) {
        console.error('💥 Failed to connect to MongoDB from Vercel:', error);
        res.status(500).json({ status: 'error', message: 'Failed to connect to MongoDB.', error: error.message });
    } finally {
        // It's generally not necessary to manually disconnect in serverless functions
        // as the connection persists across warm invocations. However, if you want
        // to ensure a clean exit for this specific test function:
        // if (mongoose.connection.readyState === 1) {
        //     await mongoose.disconnect();
        //     console.log('MongoDB connection closed after test.');
        // }
    }
};
