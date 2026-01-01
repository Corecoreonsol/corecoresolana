const crypto = require('crypto');

// Nonce with embedded timestamp (no database needed)
// Format: timestamp.randomhex
function generateNonce() {
  const timestamp = Date.now();
  const random = crypto.randomBytes(32).toString('hex');
  return `${timestamp}.${random}`;
}

function verifyNonceTimestamp(nonce) {
  try {
    const parts = nonce.split('.');
    if (parts.length !== 2) {
      return false;
    }
    
    const timestamp = parseInt(parts[0]);
    if (isNaN(timestamp)) {
      return false;
    }
    
    const age = Date.now() - timestamp;
    const NONCE_EXPIRY = 5 * 60 * 1000; // 5 minutes
    
    return age >= 0 && age < NONCE_EXPIRY;
  } catch (error) {
    return false;
  }
}

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const nonce = generateNonce();
    const message = `Whale Verify: ${nonce}`;
    return res.status(200).json({ success: true, nonce, message });
  } catch (error) {
    console.error('Nonce generation error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to generate nonce',
      message: error.message 
    });
  }
};

// Export for verify endpoint
module.exports.verifyNonceTimestamp = verifyNonceTimestamp;
