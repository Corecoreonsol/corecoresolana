// Monitor new group members and link them with wallets
const { sql } = require('@vercel/postgres');

let isMonitoring = false;
let lastUpdateId = 0;

/**
 * Start monitoring group for new members
 */
async function startMonitoring() {
    if (isMonitoring) {
        console.log('⚠️  Group monitoring already running');
        return;
    }
    
    isMonitoring = true;
    console.log('👁️  Starting group member monitoring...');
    
    // Poll every 5 seconds
    monitorLoop();
}

async function monitorLoop() {
    if (!isMonitoring) return;
    
    try {
        await checkNewMembers();
    } catch (error) {
        console.error('❌ Monitor error:', error.message);
    }
    
    // Schedule next check
    setTimeout(monitorLoop, 5000); // 5 seconds
}

/**
 * Check for new group members via getUpdates
 */
async function checkNewMembers() {
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
    
    if (!BOT_TOKEN || !CHAT_ID) return;
    
    try {
        const https = require('https');
        
        const updates = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.telegram.org',
                path: `/bot${BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=0&allowed_updates=["chat_member"]`,
                method: 'GET'
            };
            
            https.get(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        resolve(json.ok ? json.result : []);
                    } catch (e) {
                        reject(e);
                    }
                });
            }).on('error', reject);
        });
        
        for (const update of updates) {
            if (update.update_id > lastUpdateId) {
                lastUpdateId = update.update_id;
            }
            
            // Check for new chat member
            if (update.chat_member && update.chat_member.chat.id.toString() === CHAT_ID.toString()) {
                const newStatus = update.chat_member.new_chat_member.status;
                const oldStatus = update.chat_member.old_chat_member.status;
                const user = update.chat_member.new_chat_member.user;
                
                // User joined the group
                if ((oldStatus === 'left' || oldStatus === 'kicked') && 
                    (newStatus === 'member' || newStatus === 'administrator')) {
                    
                    console.log(`\n🐋 New member joined: @${user.username || user.first_name} (ID: ${user.id})`);
                    
                    // Find recent verification (within last 15 minutes)
                    await linkMemberToWallet(user);
                }
            }
        }
    } catch (error) {
        // Silent fail for monitoring
        if (error.message && !error.message.includes('ECONNRESET')) {
            console.error('Monitor check error:', error.message);
        }
    }
}

/**
 * Try to link a new member to a wallet
 */
async function linkMemberToWallet(user) {
    try {
        // Get all pending verifications from last 15 minutes
        const fifteenMinutesAgo = new Date(Date.now() - (15 * 60 * 1000));
        
        const result = await sql`
            SELECT * FROM verifications 
            WHERE telegram_user_id IS NULL 
            AND created_at > ${fifteenMinutesAgo}
            ORDER BY created_at DESC
        `;
        
        const pendingVerifications = result.rows;
        
        if (pendingVerifications.length === 0) {
            console.log('   ℹ️  No pending verifications found');
            return;
        }
        
        // If only one pending verification, link it
        if (pendingVerifications.length === 1) {
            const verification = pendingVerifications[0];
            
            await sql`
                UPDATE verifications 
                SET telegram_user_id = ${user.id.toString()},
                    telegram_username = ${user.username || ''},
                    telegram_first_name = ${user.first_name || ''},
                    joined_at = NOW()
                WHERE wallet_address = ${verification.wallet_address}
            `;
            
            console.log(`   ✅ Linked @${user.username || user.first_name} → ${verification.wallet_address.substring(0, 8)}...`);
            console.log(`   💾 Telegram info saved to database`);
        } else {
            console.log(`   ⚠️  Multiple pending verifications (${pendingVerifications.length}), cannot auto-link`);
            console.log(`   💡 User should re-verify after 15 minutes`);
        }
    } catch (error) {
        console.error('   ❌ Failed to link member:', error.message);
    }
}

/**
 * Stop monitoring
 */
function stopMonitoring() {
    isMonitoring = false;
    console.log('🛑 Stopped group member monitoring');
}

/**
 * Get monitoring status
 */
function getStatus() {
    return {
        isMonitoring,
        lastUpdateId
    };
}

module.exports = {
    startMonitoring,
    stopMonitoring,
    getStatus
};
