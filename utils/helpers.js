// utils/helpers.js

/**
 * Generates a unique reference string.
 * @param {string} userId - Telegram user ID.
 * @param {string} type - Transaction type (e.g., 'deposit', 'withdrawal', 'invest').
 * @returns {string} - Unique reference.
 */
function generateUniqueRef(userId, type) {
    return `${type.substring(0, 3).toUpperCase()}-${userId}-${Date.now()}`;
}

module.exports = {
    generateUniqueRef
};
