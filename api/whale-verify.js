// Vercel serverless function for whale-verify API
const Database = require('better-sqlite3');
const { Connection, PublicKey } = require('@solana/web3.js');
const { getAccount, getMint } = require('@solana/spl-token');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default || require('bs58');

// Environment configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const TOKEN_MINT = '4FdojUmXeaFMBG6yUaoufAC5Bz7u9AwnSAMizkx5pump';
const MIN_TOKEN_AMOUNT = 10_000_000; // 10 million CORE tokens

// In-memory nonce storage (valid for 5 minutes)
const nonces = new Map();
const NONCE_EXPIRY = 5 * 60 * 1000;

// Telegram API functions
async function createInviteLink() {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createChatInviteLink`;
    const expireDate = Math.floor(Date.now() / 1000) + 600; // 10 minutes
    
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            member_limit: 1,
            expire_date: expireDate
        })
    });
    
    const data = await response.json();
    if (!data.ok) {
        throw new Error(`Telegram API error: ${data.description}`);
    }
    
    return data.result.invite_link;
}

// Solana verification functions
async function verifySignature(message, signature, publicKey) {
    try {
        const messageBytes = new TextEncoder().encode(message);
        const signatureBytes = bs58.decode(signature);
        const publicKeyBytes = new PublicKey(publicKey).toBytes();
        
        return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    } catch (error) {
        console.error('Signature verification error:', error);
        return false;
    }
}

async function checkTokenBalance(walletAddress) {
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const publicKey = new PublicKey(walletAddress);
    const mintPublicKey = new PublicKey(TOKEN_MINT);
    
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
        mint: mintPublicKey
    });
    
    if (tokenAccounts.value.length === 0) {
        return 0;
    }
    
    const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
    return balance;
}

// Rate limiting (simplified for serverless)
const rateLimits = new Map();

function checkRateLimit(ip, action, maxRequests, windowMs) {
    const key = `${ip}-${action}`;
    const now = Date.now();
    
    if (!rateLimits.has(key)) {
        rateLimits.set(key, { count: 1, resetAt: now + windowMs });
        return true;
    }
    
    const limit = rateLimits.get(key);
    
    if (now > limit.resetAt) {
        rateLimits.set(key, { count: 1, resetAt: now + windowMs });
        return true;
    }
    
    if (limit.count >= maxRequests) {
        return false;
    }
    
    limit.count++;
    return true;
}

// Database helper (note: SQLite won't persist on Vercel between requests)
function getDatabase() {
    // This will create a new database for each request on Vercel
    // For production, you should use Vercel KV or Postgres
    const db = new Database('/tmp/whale-verify.db');
    
    // Initialize schema
    db.exec(`
        CREATE TABLE IF NOT EXISTS verifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            wallet_address TEXT UNIQUE NOT NULL,
            invite_link TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            used INTEGER DEFAULT 0,
            ip_address TEXT,
            user_agent TEXT,
            telegram_user_id INTEGER,
            telegram_username TEXT,
            telegram_first_name TEXT,
            joined_at DATETIME
        )
    `);
    
    return db;
}

// Main handler
module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname.replace('/api/whale-verify', '');
    
    try {
        // GET /nonce
        if (req.method === 'GET' && pathname === '/nonce') {
            if (!checkRateLimit(ip, 'nonce', 10, 60000)) {
                return res.status(429).json({ error: 'Too many requests. Please try again later.' });
            }
            
            const nonce = Math.random().toString(36).substring(2, 15);
            nonces.set(nonce, Date.now());
            
            // Cleanup old nonces
            for (const [key, timestamp] of nonces.entries()) {
                if (Date.now() - timestamp > NONCE_EXPIRY) {
                    nonces.delete(key);
                }
            }
            
            return res.status(200).json({ nonce });
        }
        
        // POST /verify
        if (req.method === 'POST' && pathname === '/verify') {
            if (!checkRateLimit(ip, 'verify', 5, 15 * 60000)) {
                return res.status(429).json({ 
                    error: 'Too many verification attempts. Please try again in 15 minutes.' 
                });
            }
            
            const { walletAddress, signature, message } = req.body;
            
            if (!walletAddress || !signature || !message) {
                return res.status(400).json({ error: 'Missing required fields' });
            }
            
            // Check if wallet already verified
            const db = getDatabase();
            const existing = db.prepare('SELECT * FROM verifications WHERE wallet_address = ?').get(walletAddress);
            
            if (existing) {
                db.close();
                return res.status(400).json({ 
                    error: 'This wallet has already been verified',
                    alreadyVerified: true 
                });
            }
            
            // Verify nonce
            const nonceMatch = message.match(/Nonce: (\w+)/);
            if (!nonceMatch) {
                db.close();
                return res.status(400).json({ error: 'Invalid message format' });
            }
            
            const nonce = nonceMatch[1];
            const nonceTimestamp = nonces.get(nonce);
            
            if (!nonceTimestamp) {
                db.close();
                return res.status(400).json({ error: 'Invalid or expired nonce' });
            }
            
            if (Date.now() - nonceTimestamp > NONCE_EXPIRY) {
                nonces.delete(nonce);
                db.close();
                return res.status(400).json({ error: 'Nonce expired' });
            }
            
            // Verify signature
            const isValidSignature = await verifySignature(message, signature, walletAddress);
            if (!isValidSignature) {
                db.close();
                return res.status(400).json({ error: 'Invalid signature' });
            }
            
            // Check token balance
            const balance = await checkTokenBalance(walletAddress);
            if (balance < MIN_TOKEN_AMOUNT) {
                db.close();
                return res.status(400).json({ 
                    error: `Insufficient token balance. Required: ${MIN_TOKEN_AMOUNT.toLocaleString()} CORE, You have: ${balance.toLocaleString()} CORE`,
                    insufficientBalance: true,
                    required: MIN_TOKEN_AMOUNT,
                    actual: balance
                });
            }
            
            // Create Telegram invite link
            const inviteLink = await createInviteLink();
            
            // Save to database
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
            db.prepare(`
                INSERT INTO verifications 
                (wallet_address, invite_link, expires_at, ip_address, user_agent)
                VALUES (?, ?, ?, ?, ?)
            `).run(walletAddress, inviteLink, expiresAt, ip, req.headers['user-agent']);
            
            db.close();
            nonces.delete(nonce);
            
            return res.status(200).json({
                success: true,
                inviteLink,
                balance,
                expiresIn: 600
            });
        }
        
        // GET /stats
        if (req.method === 'GET' && pathname === '/stats') {
            const db = getDatabase();
            const stats = db.prepare(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN used = 1 THEN 1 ELSE 0 END) as used,
                    SUM(CASE WHEN telegram_user_id IS NOT NULL THEN 1 ELSE 0 END) as joined
                FROM verifications
            `).get();
            db.close();
            
            return res.status(200).json(stats);
        }
        
        // Not found
        return res.status(404).json({ error: 'Endpoint not found' });
        
    } catch (error) {
        console.error('API error:', error);
        return res.status(500).json({ 
            error: 'Internal server error',
            message: error.message 
        });
    }
};
