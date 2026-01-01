const { sql } = require('@vercel/postgres');

// Simple admin endpoint to delete wallet verification
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
    const { wallet, password } = body;

    // Simple password check
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(403).json({ success: false, error: 'Invalid password' });
    }

    if (!wallet) {
      return res.status(400).json({ success: false, error: 'Wallet address required' });
    }

    // Delete from database
    const result = await sql`
      DELETE FROM verifications WHERE wallet_address = ${wallet}
    `;

    console.log(`Deleted wallet: ${wallet}`);

    return res.status(200).json({ 
      success: true, 
      message: `Wallet ${wallet} removed from database`,
      deleted: result.rowCount
    });

  } catch (error) {
    console.error('Delete error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      message: error.message 
    });
  }
};
