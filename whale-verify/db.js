// Database module for Whale Verification
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'whale-verify.db');
const db = new Database(dbPath);

// Initialize database schema
function initializeDatabase() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS verifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wallet_address TEXT UNIQUE NOT NULL,
            invite_link TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            used BOOLEAN DEFAULT 0,
            ip_address TEXT,
            user_agent TEXT,
            telegram_user_id TEXT,
            telegram_username TEXT,
            telegram_first_name TEXT,
            joined_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_wallet ON verifications(wallet_address);
        CREATE INDEX IF NOT EXISTS idx_expires ON verifications(expires_at);
        CREATE INDEX IF NOT EXISTS idx_telegram_user ON verifications(telegram_user_id);
    `);
    
    console.log('✅ Database initialized successfully');
}

// Check if wallet has already received an invite
function hasWalletBeenVerified(walletAddress) {
    const stmt = db.prepare('SELECT id FROM verifications WHERE wallet_address = ?');
    const result = stmt.get(walletAddress);
    return result !== undefined;
}

// Save verification record
function saveVerification(walletAddress, inviteLink, ipAddress, userAgent) {
    const now = Date.now();
    const expiresAt = now + (10 * 60 * 1000); // 10 minutes

    const stmt = db.prepare(`
        INSERT INTO verifications (wallet_address, invite_link, created_at, expires_at, ip_address, user_agent)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    try {
        const result = stmt.run(walletAddress, inviteLink, now, expiresAt, ipAddress, userAgent);
        return {
            success: true,
            id: result.lastInsertRowid
        };
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return {
                success: false,
                error: 'WALLET_ALREADY_VERIFIED'
            };
        }
        throw error;
    }
}

// Get verification by wallet
function getVerificationByWallet(walletAddress) {
    const stmt = db.prepare('SELECT * FROM verifications WHERE wallet_address = ?');
    return stmt.get(walletAddress);
}

// Mark invite as used
function markInviteUsed(walletAddress) {
    const stmt = db.prepare('UPDATE verifications SET used = 1 WHERE wallet_address = ?');
    return stmt.run(walletAddress);
}

// Clean up expired invites (call periodically)
function cleanupExpiredInvites() {
    const now = Date.now();
    const stmt = db.prepare('DELETE FROM verifications WHERE expires_at < ? AND used = 0');
    const result = stmt.run(now);
    return result.changes;
}

// Get statistics
function getStats() {
    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM verifications');
    const usedStmt = db.prepare('SELECT COUNT(*) as count FROM verifications WHERE used = 1');
    const activeStmt = db.prepare('SELECT COUNT(*) as count FROM verifications WHERE used = 0 AND expires_at > ?');
    const joinedStmt = db.prepare('SELECT COUNT(*) as count FROM verifications WHERE telegram_user_id IS NOT NULL');
    
    const now = Date.now();
    
    return {
        total: totalStmt.get().count,
        used: usedStmt.get().count,
        active: activeStmt.get(now).count,
        joined: joinedStmt.get().count
    };
}

// Update Telegram info when user joins
function updateTelegramInfo(walletAddress, telegramUserId, telegramUsername, telegramFirstName) {
    const stmt = db.prepare(`
        UPDATE verifications 
        SET telegram_user_id = ?, 
            telegram_username = ?, 
            telegram_first_name = ?,
            joined_at = ?
        WHERE wallet_address = ?
    `);
    
    try {
        const result = stmt.run(
            telegramUserId, 
            telegramUsername, 
            telegramFirstName,
            Date.now(),
            walletAddress
        );
        return {
            success: true,
            changes: result.changes
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

// Get all verifications with Telegram info
function getAllVerifications() {
    const stmt = db.prepare(`
        SELECT 
            wallet_address,
            telegram_user_id,
            telegram_username,
            telegram_first_name,
            created_at,
            joined_at,
            used
        FROM verifications
        ORDER BY created_at DESC
    `);
    return stmt.all();
}

// Get wallet by Telegram user ID
function getWalletByTelegramId(telegramUserId) {
    const stmt = db.prepare('SELECT * FROM verifications WHERE telegram_user_id = ?');
    return stmt.get(telegramUserId);
}

// Initialize on module load
initializeDatabase();

// Export functions
module.exports = {
    hasWalletBeenVerified,
    saveVerification,
    getVerificationByWallet,
    markInviteUsed,
    cleanupExpiredInvites,
    getStats,
    updateTelegramInfo,
    getAllVerifications,
    getWalletByTelegramId,
    db
};
