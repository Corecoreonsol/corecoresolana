const { sql } = require('@vercel/postgres');

// Get all verified members
module.exports = async (req, res) => {
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
    // Get all verifications
    const result = await sql`
      SELECT 
        wallet_address,
        telegram_user_id,
        telegram_username,
        telegram_first_name,
        created_at,
        joined_at,
        used,
        expires_at
      FROM verifications
      ORDER BY created_at DESC
    `;

    // Add status field based on joined_at and used
    const members = result.rows.map(row => {
      let status = 'pending';
      if (row.joined_at) {
        status = 'joined';
      } else if (row.used) {
        status = 'link_used';
      }
      
      return {
        wallet: row.wallet_address,
        telegram: {
          username: row.telegram_username,
          first_name: row.telegram_first_name,
          user_id: row.telegram_user_id
        },
        status,
        created_at: row.created_at,
        joined_at: row.joined_at
      };
    });

    return res.status(200).json({ 
      success: true, 
      members
    });

  } catch (error) {
    console.error('Members list error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error',
      message: error.message 
    });
  }
};
