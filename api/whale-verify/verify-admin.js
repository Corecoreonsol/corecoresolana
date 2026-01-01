const crypto = require('crypto');

// Admin password verification endpoint
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { password } = body;

    if (!password) {
      return res.status(400).json({ success: false, error: 'Password required' });
    }

    // Verify password
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(403).json({ success: false, error: 'Invalid password' });
    }

    // Generate simple token (just timestamp + random)
    const token = crypto.randomBytes(32).toString('hex');

    return res.status(200).json({ 
      success: true, 
      token,
      message: 'Authentication successful'
    });

  } catch (error) {
    console.error('Admin auth error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      message: error.message 
    });
  }
};
