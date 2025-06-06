// test_db_connection.js
require('dotenv').config(); // Load environment variables from .env file

const { connectDB, mongoose } = require('./utils/db'); // Import connectDB and mongoose from your db.js

const testConnection = async () => {
    try {
        const mongoDbUri = process.env.MONGODB_URL;

        if (!mongoDbUri) {
            console.error('❌ MONGODB_URL environment variable is not set!');
            process.exit(1);
        }

        console.log('Attempting to connect to MongoDB...');
        await connectDB(mongoDbUri); // Use your existing connectDB function

        console.log('🎉 Successfully connected to MongoDB!');

        // Optional: Perform a simple query to ensure full connectivity
        // You can import your User model here if you want to test it
        // const { User } = require('./utils/db');
        // const userCount = await User.countDocuments();
        // console.log(`Total users in database: ${userCount}`);

    } catch (error) {
        console.error('💥 Failed to connect to MongoDB:');
        console.error(error);
        process.exit(1); // Exit with an error code
    } finally {
        // Always close the connection when done with the test script
        if (mongoose.connection.readyState === 1) {
            await mongoose.disconnect();
            console.log('MongoDB connection closed.');
        }
        process.exit(0); // Exit successfully
    }
};

testConnection();
