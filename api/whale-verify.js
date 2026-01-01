// Vercel serverless function for whale-verify API
const crypto = require('crypto');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const { Connection, PublicKey } = require('@solana/web3.js');

// Environment variables
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const TOKEN_MINT = '4FdojUmXeaFMBG6yUaoufAC5Bz7u9AwnSAMizkx5pump';
const MIN_TOKEN_AMOUNT = 10_000_000;
const NONCE_EXPIRY = 5 * 60 * 1000; // 5 minutes

// In-memory storage (for serverless, you'd want to use Redis or similar)
const nonces = new Map();
const verifiedWallets = new Set();

// Helper functions
const generateNonce = () => crypto.randomBytes(32).toString('hex');

const verifySignature = (message, signature, publicKey) => {
  try {
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);
    const publicKeyBytes = bs58.decode(publicKey);
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
};

const checkTokenBalance = async (walletAddress) => {
  try {
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const walletPubkey = new PublicKey(walletAddress);
    const mintPubkey = new PublicKey(TOKEN_MINT);
    
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPubkey, {
      mint: mintPubkey
    });

    if (tokenAccounts.value.length === 0) {
      return 0;
    }

    const balance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount.uiAmount;
    return balance;
  } catch (error) {
    console.error('Token balance check error:', error);
    return 0;
  }
};

const createTelegramInviteLink = async () => {
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/createChatInviteLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        member_limit: 1,
        expire_date: Math.floor(Date.now() / 1000) + 600 // 10 minutes
      })
    });

    const data = await response.json();
    if (!data.ok) {
      throw new Error(data.description || 'Failed to create invite link');
    }

    return data.result.invite_link;
  } catch (error) {
    console.error('Telegram invite link error:', error);
    throw error;
  }
};

// Main handler
module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname.replace('/api/whale-verify', '');

    // Route: GET /nonce
    if (path === '/nonce' && req.method === 'GET') {
      const nonce = generateNonce();
      nonces.set(nonce, Date.now());
      
      // Clean up old nonces
      for (const [key, timestamp] of nonces.entries()) {
        if (Date.now() - timestamp > NONCE_EXPIRY) {
          nonces.delete(key);
        }
      }

      return res.status(200).json({ success: true, nonce });
    }

    // Route: POST /verify
    if (path === '/verify' && req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const { walletAddress, signature, nonce } = body;

      if (!walletAddress || !signature || !nonce) {
        return res.status(400).json({ 
          success: false, 
          error: 'Missing required fields' 
        });
      }

      // Check if wallet already verified (in memory only - resets on cold start)
      if (verifiedWallets.has(walletAddress)) {
        return res.status(400).json({ 
          success: false, 
          error: 'This wallet has already been verified' 
        });
      }

      // Verify nonce
      const nonceTimestamp = nonces.get(nonce);
      if (!nonceTimestamp) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid or expired nonce' 
        });
      }

      if (Date.now() - nonceTimestamp > NONCE_EXPIRY) {
        nonces.delete(nonce);
        return res.status(400).json({ 
          success: false, 
          error: 'Nonce expired' 
        });
      }

      // Verify signature
      const message = `Whale Verify: ${nonce}`;
      if (!verifySignature(message, signature, walletAddress)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid signature' 
        });
      }

      // Delete used nonce
      nonces.delete(nonce);

      // Check token balance
      const balance = await checkTokenBalance(walletAddress);
      if (balance < MIN_TOKEN_AMOUNT) {
        return res.status(400).json({ 
          success: false, 
          error: `Insufficient token balance. You have ${balance.toLocaleString()} CORE, but need at least ${MIN_TOKEN_AMOUNT.toLocaleString()} CORE.` 
        });
      }

      // Create Telegram invite link
      const inviteLink = await createTelegramInviteLink();

      // Add to verified wallets (in memory)
      verifiedWallets.add(walletAddress);

      return res.status(200).json({ 
        success: true, 
        inviteLink,
        balance: balance.toLocaleString()
      });
    }

    // Route not found
    return res.status(404).json({ 
      success: false, 
      error: 'Endpoint not found' 
    });

  } catch (error) {
    console.error('Whale verify API error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      message: error.message 
    });
  }
};
