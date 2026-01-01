// Solana utilities for whale verification
const { Connection, PublicKey } = require('@solana/web3.js');
const { getAccount, getAssociatedTokenAddress } = require('@solana/spl-token');
const nacl = require('tweetnacl');
const bs58Module = require('bs58');
const bs58 = bs58Module.default || bs58Module;

// Configuration
const TOKEN_MINT = '4FdojUmXeaFMBG6yUaoufAC5Bz7u9AwnSAMizkx5pump';
const MIN_TOKENS = 10_000_000; // 10 million tokens
const TOKEN_DECIMALS = 6; // Standard SPL token decimals

// RPC Connection (use environment variable or default)
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL, 'confirmed');

console.log(`🔗 Connected to Solana RPC: ${RPC_URL}`);

/**
 * Verify message signature from Solana wallet
 * @param {string} message - Original message that was signed
 * @param {string} signature - Base58 encoded signature
 * @param {string} publicKey - Base58 encoded public key
 * @returns {boolean} - True if signature is valid
 */
function verifySignature(message, signature, publicKey) {
    try {
        console.log('🔍 Verifying signature...');
        console.log('   Message length:', message.length);
        console.log('   Signature (first 20):', signature.substring(0, 20) + '...');
        console.log('   Public key (first 20):', publicKey.substring(0, 20) + '...');
        
        const messageBytes = new TextEncoder().encode(message);
        const signatureBytes = bs58.decode(signature);
        const publicKeyBytes = bs58.decode(publicKey);

        console.log('   Message bytes length:', messageBytes.length);
        console.log('   Signature bytes length:', signatureBytes.length);
        console.log('   Public key bytes length:', publicKeyBytes.length);

        const verified = nacl.sign.detached.verify(
            messageBytes,
            signatureBytes,
            publicKeyBytes
        );

        console.log(`🔐 Signature verification: ${verified ? '✅ VALID' : '❌ INVALID'}`);
        return verified;
    } catch (error) {
        console.error('❌ Error verifying signature:', error.message);
        return false;
    }
}

/**
 * Get SPL token balance for a wallet
 * @param {string} walletAddress - Wallet public key (base58)
 * @returns {Promise<number>} - Token balance (with decimals)
 */
async function getTokenBalance(walletAddress) {
    try {
        const walletPublicKey = new PublicKey(walletAddress);
        const mintPublicKey = new PublicKey(TOKEN_MINT);

        // Get associated token account address
        const tokenAccountAddress = await getAssociatedTokenAddress(
            mintPublicKey,
            walletPublicKey
        );

        console.log(`🔍 Checking token account: ${tokenAccountAddress.toString()}`);

        // Get token account info
        const tokenAccount = await getAccount(connection, tokenAccountAddress);
        
        // Convert balance from smallest units
        const balance = Number(tokenAccount.amount) / Math.pow(10, TOKEN_DECIMALS);
        
        console.log(`💰 Token balance: ${balance.toLocaleString()} CORE`);
        return balance;

    } catch (error) {
        // If account doesn't exist, balance is 0
        if (error.message && (error.message.includes('could not find account') || 
            error.message.includes('Account does not exist'))) {
            console.log('💰 Token balance: 0 CORE (no token account)');
            return 0;
        }
        
        // Check for TokenAccountNotFoundError or other common errors
        if (error.name === 'TokenAccountNotFoundError' || 
            (error.toString && error.toString().includes('could not find'))) {
            console.log('💰 Token balance: 0 CORE (no token account)');
            return 0;
        }
        
        console.error('❌ Error fetching token balance:', error);
        console.error('❌ Error type:', error.constructor.name);
        console.error('❌ Error message:', error.message);
        throw new Error(`Failed to fetch token balance: ${error.message || error.toString()}`);
    }
}

/**
 * Check if wallet meets minimum token requirement
 * @param {string} walletAddress - Wallet public key (base58)
 * @returns {Promise<{qualified: boolean, balance: number, required: number}>}
 */
async function checkWhaleStatus(walletAddress) {
    const balance = await getTokenBalance(walletAddress);
    const qualified = balance >= MIN_TOKENS;

    console.log(`🐋 Whale status: ${qualified ? '✅ QUALIFIED' : '❌ NOT QUALIFIED'}`);
    console.log(`   Balance: ${balance.toLocaleString()} / ${MIN_TOKENS.toLocaleString()} CORE`);

    return {
        qualified,
        balance,
        required: MIN_TOKENS
    };
}

/**
 * Generate nonce for message signing
 * @returns {string} - Random nonce
 */
function generateNonce() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
}

/**
 * Create message to be signed
 * @param {string} nonce - Random nonce
 * @returns {string} - Message for signing
 */
function createSignMessage(nonce) {
    return `CORE Whale Verification\n\nBy signing this message, you verify ownership of this wallet.\n\nNonce: ${nonce}\nTimestamp: ${Date.now()}`;
}

module.exports = {
    verifySignature,
    getTokenBalance,
    checkWhaleStatus,
    generateNonce,
    createSignMessage,
    TOKEN_MINT,
    MIN_TOKENS
};
