// Whale Verification API Endpoints
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('./db');
const solana = require('./solana');
const telegram = require('./telegram');

const router = express.Router();

// Rate limiting
const verifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Max 5 requests per IP
    message: { error: 'Too many verification attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const nonceLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 10, // Max 10 nonces per minute
    message: { error: 'Too many nonce requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Store nonces temporarily (in production, use Redis)
const nonceStore = new Map();

// Clean up old nonces every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [nonce, timestamp] of nonceStore.entries()) {
        if (now - timestamp > 5 * 60 * 1000) { // 5 minutes
            nonceStore.delete(nonce);
        }
    }
}, 5 * 60 * 1000);

/**
 * GET /api/whale-verify/nonce
 * Generate a nonce for message signing
 */
router.get('/nonce', nonceLimiter, (req, res) => {
    try {
        const nonce = solana.generateNonce();
        const message = solana.createSignMessage(nonce);
        
        // Store nonce with timestamp
        nonceStore.set(nonce, Date.now());
        
        res.json({
            success: true,
            nonce,
            message
        });
    } catch (error) {
        console.error('Error generating nonce:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate nonce'
        });
    }
});

/**
 * POST /api/whale-verify/verify
 * Verify wallet and create Telegram invite
 * 
 * Request body:
 * {
 *   walletAddress: string,
 *   signature: string,
 *   message: string,
 *   nonce: string
 * }
 */
router.post('/verify', verifyLimiter, async (req, res) => {
    try {
        const { walletAddress, signature, message, nonce } = req.body;

        // Validation
        if (!walletAddress || !signature || !message || !nonce) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }

        // Check if nonce exists and is valid
        if (!nonceStore.has(nonce)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid or expired nonce. Please request a new one.'
            });
        }

        // Remove used nonce
        nonceStore.delete(nonce);

        // Verify message contains the nonce
        if (!message.includes(nonce)) {
            return res.status(400).json({
                success: false,
                error: 'Message does not contain the provided nonce'
            });
        }

        console.log(`\n🔍 Verifying wallet: ${walletAddress}`);

        // Check if wallet already verified
        if (db.hasWalletBeenVerified(walletAddress)) {
            console.log('⚠️ Wallet already verified');
            return res.status(400).json({
                success: false,
                error: 'This wallet has already been verified. Each wallet can only receive one invite link.'
            });
        }

        // Verify signature
        const signatureValid = solana.verifySignature(message, signature, walletAddress);
        if (!signatureValid) {
            console.log('❌ Invalid signature');
            return res.status(401).json({
                success: false,
                error: 'Invalid signature. Please try again.'
            });
        }

        console.log('✅ Signature verified');

        // Check token balance
        const whaleStatus = await solana.checkWhaleStatus(walletAddress);
        
        if (!whaleStatus.qualified) {
            console.log(`❌ Insufficient tokens: ${whaleStatus.balance} / ${whaleStatus.required}`);
            return res.status(403).json({
                success: false,
                error: 'Not enough tokens',
                balance: whaleStatus.balance,
                required: whaleStatus.required,
                message: `You need at least ${whaleStatus.required.toLocaleString()} CORE tokens to join the Whale Club. Your balance: ${whaleStatus.balance.toLocaleString()} CORE`
            });
        }

        console.log('✅ Whale status confirmed');

        // Create Telegram invite link
        const inviteLink = await telegram.createInviteLink(walletAddress);
        
        // Save to database
        const ipAddress = req.ip || req.headers['x-forwarded-for'] || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';
        
        const saveResult = db.saveVerification(walletAddress, inviteLink, ipAddress, userAgent);
        
        if (!saveResult.success) {
            console.log('❌ Failed to save verification');
            return res.status(500).json({
                success: false,
                error: 'Failed to save verification'
            });
        }

        console.log('✅ Verification saved to database');
        console.log(`🎉 Whale Club invite created for ${walletAddress}\n`);

        res.json({
            success: true,
            inviteLink,
            balance: whaleStatus.balance,
            expiresIn: 600, // 10 minutes in seconds
            message: 'Welcome to the Whale Club! Your invite link is valid for 10 minutes and can only be used once.'
        });

    } catch (error) {
        console.error('❌ Verification error:', error);
        res.status(500).json({
            success: false,
            error: 'Verification failed. Please try again.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * GET /api/whale-verify/stats
 * Get verification statistics (admin only - add authentication in production)
 */
router.get('/stats', (req, res) => {
    try {
        const stats = db.getStats();
        res.json({
            success: true,
            stats
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch statistics'
        });
    }
});

/**
 * POST /api/whale-verify/cleanup
 * Cleanup expired invites (call periodically or via cron)
 */
router.post('/cleanup', (req, res) => {
    try {
        const deleted = db.cleanupExpiredInvites();
        res.json({
            success: true,
            deleted
        });
    } catch (error) {
        console.error('Error cleaning up:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to cleanup expired invites'
        });
    }
});

/**
 * GET /api/whale-verify/members
 * Get all wallet-Telegram pairings (admin endpoint)
 */
router.get('/members', (req, res) => {
    try {
        const verifications = db.getAllVerifications();
        
        const members = verifications.map(v => ({
            wallet: v.wallet_address,
            telegram: {
                user_id: v.telegram_user_id,
                username: v.telegram_username ? `@${v.telegram_username}` : null,
                first_name: v.telegram_first_name
            },
            created_at: new Date(v.created_at).toISOString(),
            joined_at: v.joined_at ? new Date(v.joined_at).toISOString() : null,
            status: v.telegram_user_id ? 'joined' : (v.used ? 'link_used' : 'pending')
        }));
        
        res.json({
            success: true,
            count: members.length,
            members
        });
    } catch (error) {
        console.error('Error fetching members:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch members'
        });
    }
});

/**
 * POST /api/whale-verify/verify-admin
 * Verify admin panel password
 */
router.post('/verify-admin', (req, res) => {
    try {
        const { password } = req.body;
        const adminPassword = process.env.ADMIN_PASSWORD || 'WhaleCore2026';
        
        console.log('🔐 Admin login attempt');
        console.log('   Received password length:', password ? password.length : 0);
        console.log('   Expected password length:', adminPassword ? adminPassword.length : 0);
        console.log('   Match:', password === adminPassword);
        
        if (password === adminPassword) {
            // Generate simple token (timestamp + random)
            const token = Buffer.from(`${Date.now()}-${Math.random()}`).toString('base64');
            console.log('   ✅ Login successful');
            res.json({
                success: true,
                token: token
            });
        } else {
            console.log('   ❌ Login failed - password mismatch');
            res.status(401).json({
                success: false,
                error: 'Invalid password'
            });
        }
    } catch (error) {
        console.error('Error verifying admin:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
});

/**
 * POST /api/whale-verify/link-telegram
 * Manually link a wallet to Telegram user (admin endpoint)
 */
router.post('/link-telegram', (req, res) => {
    try {
        const { wallet_address, telegram_user_id, telegram_username, telegram_first_name } = req.body;
        
        if (!wallet_address || !telegram_user_id) {
            return res.status(400).json({
                success: false,
                error: 'Wallet address and Telegram user ID are required'
            });
        }
        
        const result = db.updateTelegramInfo(
            wallet_address,
            telegram_user_id,
            telegram_username,
            telegram_first_name
        );
        
        if (result.success) {
            res.json({
                success: true,
                message: 'Telegram info updated successfully'
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error
            });
        }
    } catch (error) {
        console.error('Error linking Telegram:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to link Telegram info'
        });
    }
});

module.exports = router;
