const crypto = require('crypto');
const { sql } = require('@vercel/postgres');

const NONCE_EXPIRY = 5 * 60 * 1000; // 5 minutes

// Database initialization
async function initDatabase() {
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS nonces (
        nonce TEXT PRIMARY KEY,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_nonce_created ON nonces(created_at)`;
  } catch (error) {
    console.error('Database initialization error:', error);
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
    await initDatabase();
    
    const nonce = crypto.randomBytes(32).toString('hex');
    
    // Save nonce to database
    await sql`INSERT INTO nonces (nonce) VALUES (${nonce})`;
    
    // Clean up old nonces (older than 5 minutes)
    await sql`DELETE FROM nonces WHERE created_at < NOW() - INTERVAL '5 minutes'`;

    return res.status(200).json({ success: true, nonce });
  } catch (error) {
    console.error('Nonce generation error:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to generate nonce',
      message: error.message 
    });
  }
};
