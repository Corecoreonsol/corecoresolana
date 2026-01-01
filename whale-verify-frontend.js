// Whale Verification Frontend
// Solana wallet connection and verification logic

(function() {
    'use strict';

    console.log('Whale Verification module loaded');

    // Configuration
    const API_BASE = window.location.origin;
    const VERIFY_ENDPOINT = `${API_BASE}/api/whale-verify/verify`;
    const NONCE_ENDPOINT = `${API_BASE}/api/whale-verify/nonce`;

    // State
    let currentWallet = null;
    let currentNonce = null;
    let currentMessage = null;
    let isVerifying = false;

    // DOM Elements
    const verifyBtn = document.getElementById('whaleVerifyBtn');
    const statusMessage = document.getElementById('whaleStatusMessage');

    if (!verifyBtn || !statusMessage) {
        console.error('❌ Whale verify elements not found');
        return;
    }

    // Utility: Update status message
    function setStatus(message, type = 'info') {
        statusMessage.textContent = message;
        statusMessage.style.color = type === 'error' ? '#ff4444' : 
                                     type === 'success' ? '#00ff00' : 
                                     'var(--core-text-blue)';
    }

    // Utility: Set button state
    function setButtonState(text, disabled = false) {
        verifyBtn.textContent = text;
        verifyBtn.disabled = disabled;
    }

    // Detect available Solana wallets
    function detectWallet() {
        if (window.phantom?.solana?.isPhantom) {
            return window.phantom.solana;
        }
        if (window.solflare?.isSolflare) {
            return window.solflare;
        }
        if (window.solana) {
            return window.solana;
        }
        return null;
    }

    // Connect to Solana wallet
    async function connectWallet() {
        console.log('Attempting to connect wallet...');
        
        const wallet = detectWallet();
        
        if (!wallet) {
            throw new Error('No Solana wallet found. Please install Phantom or Solflare.');
        }

        try {
            const response = await wallet.connect({ onlyIfTrusted: false });
            const publicKey = response.publicKey || wallet.publicKey;
            
            if (!publicKey) {
                throw new Error('Failed to get wallet public key');
            }

            currentWallet = {
                provider: wallet,
                publicKey: publicKey.toString()
            };

            console.log('Wallet connected:', currentWallet.publicKey.substring(0, 8) + '...');
            return currentWallet;

        } catch (error) {
            console.error('Wallet connection failed:', error);
            if (error.message.includes('User rejected')) {
                throw new Error('Wallet connection rejected by user');
            }
            throw new Error(`Failed to connect wallet: ${error.message}`);
        }
    }

    // Get nonce from backend
    async function getNonce() {
        console.log('Requesting nonce...');
        
        try {
            const response = await fetch(NONCE_ENDPOINT);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const data = await response.json();
            
            if (!data.success || !data.nonce || !data.message) {
                throw new Error('Invalid nonce response');
            }

            console.log('Nonce received');
            return { nonce: data.nonce, message: data.message };

        } catch (error) {
            console.error('Failed to get nonce:', error);
            throw new Error(`Failed to get nonce: ${error.message}`);
        }
    }

    // Sign message with wallet
    async function signMessage(message) {
        console.log('Requesting message signature...');
        
        if (!currentWallet || !currentWallet.provider) {
            throw new Error('Wallet not connected');
        }

        try {
            // Use TextEncoder safely
            const encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : {
                encode: (str) => new Uint8Array([...str].map(c => c.charCodeAt(0)))
            };
            const encodedMessage = encoder.encode(message);
            
            const signedMessage = await currentWallet.provider.signMessage(encodedMessage, 'utf8');
            
            // Convert signature to base58 - use Buffer which works in browser
            const signatureArray = new Uint8Array(signedMessage.signature);
            const base58Signature = base58Encode(signatureArray);
            
            console.log('Message signed');
            console.log('Signature (first 20 chars):', base58Signature.substring(0, 20) + '...');
            return base58Signature;

        } catch (error) {
            console.error('Signature failed:', error);
            if (error.message && error.message.includes('User rejected')) {
                throw new Error('Signature rejected by user');
            }
            throw new Error(`Failed to sign message: ${error.message || 'Unknown error'}`);
        }
    }

    // Simple base58 encoding function
    function base58Encode(buffer) {
        const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
        const base = 58n;
        
        // Convert buffer to BigInt
        let num = 0n;
        for (let i = 0; i < buffer.length; i++) {
            num = num * 256n + BigInt(buffer[i]);
        }
        
        // Convert to base58
        let encoded = '';
        while (num > 0n) {
            const remainder = num % base;
            num = num / base;
            encoded = ALPHABET[Number(remainder)] + encoded;
        }
        
        // Add leading 1s for leading zeros
        for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
            encoded = '1' + encoded;
        }
        
        return encoded || '1';
    }

    // Verify wallet with backend
    async function verifyWallet(walletAddress, signature, message, nonce) {
        console.log('Verifying wallet with backend...');
        
        try {
            const response = await fetch(VERIFY_ENDPOINT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    walletAddress,
                    signature,
                    message,
                    nonce
                })
            });

            const data = await response.json();

            if (!response.ok) {
                // Check if it's a "not enough tokens" error with details
                if (data.error === 'Not enough tokens' && data.balance !== undefined && data.required !== undefined) {
                    const shortage = data.required - data.balance;
                    throw new Error(`Not enough tokens!\n\nYour balance: ${data.balance.toLocaleString()} CORE\nRequired: ${data.required.toLocaleString()} CORE\nYou need ${shortage.toLocaleString()} more CORE tokens`);
                }
                throw new Error(data.error || data.message || `HTTP ${response.status}`);
            }

            if (!data.success) {
                throw new Error(data.error || 'Verification failed');
            }

            console.log('Verification successful');
            return data;

        } catch (error) {
            console.error('Verification failed:', error);
            throw error;
        }
    }

    // Main verification flow
    async function handleVerification() {
        if (isVerifying) {
            console.log('Verification already in progress');
            return;
        }

        isVerifying = true;
        setButtonState('CONNECTING...', true);
        setStatus('Connecting to wallet...');

        try {
            // Step 1: Connect wallet
            await connectWallet();
            setStatus(`Connected: ${currentWallet.publicKey.substring(0, 8)}...`);
            
            // Step 2: Get nonce
            setButtonState('REQUESTING NONCE...', true);
            setStatus('Requesting verification nonce...');
            const nonceData = await getNonce();
            currentNonce = nonceData.nonce;
            currentMessage = nonceData.message;

            // Step 3: Sign message
            setButtonState('SIGN MESSAGE', false);
            setStatus('Please sign the message in your wallet');
            
            // Wait a bit for user to see the message
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const signature = await signMessage(currentMessage);

            // Step 4: Verify with backend
            setButtonState('VERIFYING...', true);
            setStatus('Verifying your wallet...');
            
            const result = await verifyWallet(
                currentWallet.publicKey,
                signature,
                currentMessage,
                currentNonce
            );

            // Step 5: Success - show invite link
            setButtonState('VERIFIED', true);
            setStatus('');
            
            // Create success message with invite link
            const successDiv = document.createElement('div');
            successDiv.style.cssText = 'display: flex; flex-direction: column; align-items: center; gap: 0.75rem; padding: 1.25rem; background: rgba(0, 255, 255, 0.03); border: 1px solid rgba(102, 204, 255, 0.3); border-radius: 4px; margin-top: 1rem; box-shadow: 0 0 15px rgba(0, 255, 255, 0.1);';
            
            successDiv.innerHTML = `
                <div style="font-size: 0.95rem; color: var(--core-cyan); font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase;">
                    Welcome to the Whale Club
                </div>
                <div style="font-size: 0.8rem; color: var(--core-text-blue); text-align: center; line-height: 1.4; opacity: 0.9;">
                    Your balance: ${result.balance.toLocaleString()} CORE
                </div>
                <a href="${result.inviteLink}" 
                   target="_blank"
                   style="display: inline-block; padding: 0.8rem 2rem; background: var(--core-cyan); color: #000; text-decoration: none; font-weight: 700; border-radius: 2px; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.1em; transition: all 0.3s ease; box-shadow: 0 0 20px rgba(0, 255, 255, 0.4);"
                   onmouseover="this.style.transform='scale(1.05)'; this.style.boxShadow='0 0 30px rgba(0, 255, 255, 0.6)';"
                   onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='0 0 20px rgba(0, 255, 255, 0.4)';">
                    Join Telegram Group
                </a>
                <div style="font-size: 0.7rem; color: rgba(102, 204, 255, 0.5); text-align: center; letter-spacing: 0.03em;">
                    LINK EXPIRES IN 10 MINUTES · SINGLE USE ONLY
                </div>
            `;
            
            const container = document.getElementById('whaleVerifyContainer');
            container.appendChild(successDiv);
            
            console.log('Verification complete!');

        } catch (error) {
            console.error('❌ Verification error:', error);
            
            // Handle specific errors
            if (error.message.includes('Not enough tokens')) {
                // Extract and display detailed token info
                setStatus(error.message.replace(/\n/g, ' • '));
            } else if (error.message.includes('already been verified')) {
                setStatus('ERROR: This wallet has already been verified');
            } else if (error.message.includes('rejected')) {
                setStatus('ERROR: Request was rejected');
            } else if (error.message.includes('No Solana wallet')) {
                setStatus('ERROR: Please install Phantom or Solflare wallet');
            } else {
                setStatus(`ERROR: ${error.message}`);
            }
            
            setButtonState('VERIFY WALLET', false);
        } finally {
            isVerifying = false;
        }
    }

    // Event listeners
    verifyBtn.addEventListener('click', handleVerification);

    // Check if wallet is already connected on page load
    window.addEventListener('load', async () => {
        const wallet = detectWallet();
        if (wallet && wallet.isConnected) {
            try {
                const publicKey = wallet.publicKey;
                if (publicKey) {
                    currentWallet = {
                        provider: wallet,
                        publicKey: publicKey.toString()
                    };
                    setStatus(`Wallet connected: ${currentWallet.publicKey.substring(0, 8)}...`);
                }
            } catch (error) {
                console.log('Wallet not auto-connected');
            }
        }
    });

    console.log('Whale verification initialized');

})();
