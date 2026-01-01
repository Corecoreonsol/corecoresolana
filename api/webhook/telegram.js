const { sql } = require('@vercel/postgres');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const update = req.body;
    console.log('📨 Webhook received:', JSON.stringify(update, null, 2));

    // Check for new chat member
    if (update.chat_member) {
      const { chat, new_chat_member, old_chat_member } = update.chat_member;
      const user = new_chat_member.user;
      
      // User joined the group
      if ((old_chat_member.status === 'left' || old_chat_member.status === 'kicked') && 
          (new_chat_member.status === 'member' || new_chat_member.status === 'administrator')) {
        
        console.log(`🐋 New member: @${user.username || user.first_name} (ID: ${user.id})`);
        
        // Find recent verification (within last 15 minutes) without telegram_user_id
        const fifteenMinutesAgo = new Date(Date.now() - (15 * 60 * 1000));
        
        const result = await sql`
          SELECT * FROM verifications 
          WHERE telegram_user_id IS NULL 
          AND created_at > ${fifteenMinutesAgo}
          ORDER BY created_at DESC
          LIMIT 1
        `;
        
        if (result.rows.length === 1) {
          const verification = result.rows[0];
          
          // Update with Telegram info
          await sql`
            UPDATE verifications 
            SET telegram_user_id = ${user.id.toString()},
                telegram_username = ${user.username || ''},
                telegram_first_name = ${user.first_name || ''},
                joined_at = NOW()
            WHERE wallet_address = ${verification.wallet_address}
          `;
          
          console.log(`✅ Linked @${user.username || user.first_name} → ${verification.wallet_address.substring(0, 8)}...`);
          
          return res.status(200).json({ 
            ok: true, 
            message: 'Member linked successfully' 
          });
        } else {
          console.log(`⚠️ No pending verification found (found ${result.rows.length})`);
        }
      }
    }
    
    return res.status(200).json({ ok: true });
    
  } catch (error) {
    console.error('❌ Webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
};
