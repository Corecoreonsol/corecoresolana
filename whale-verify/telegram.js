// Telegram Bot integration for whale verification
const https = require('https');

/**
 * Get configuration from environment variables
 * This is a function to ensure we get the latest values
 */
function getConfig() {
    return {
        BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
        CHAT_ID: process.env.TELEGRAM_CHAT_ID
    };
}

/**
 * Make Telegram API request
 * @param {string} method - API method name
 * @param {object} data - Request data
 * @returns {Promise<object>} - API response
 */
function telegramRequest(method, data) {
    const { BOT_TOKEN } = getConfig();
    
    return new Promise((resolve, reject) => {
        const postData = JSON.stringify(data);
        
        const options = {
            hostname: 'api.telegram.org',
            port: 443,
            path: `/bot${BOT_TOKEN}/${method}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            
            res.on('data', (chunk) => {
                body += chunk;
            });
            
            res.on('end', () => {
                try {
                    const response = JSON.parse(body);
                    if (response.ok) {
                        resolve(response.result);
                    } else {
                        reject(new Error(`Telegram API error: ${response.description}`));
                    }
                } catch (error) {
                    reject(new Error(`Failed to parse Telegram response: ${error.message}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(new Error(`Telegram request failed: ${error.message}`));
        });

        req.write(postData);
        req.end();
    });
}

/**
 * Create single-use invite link for Telegram group
 * @param {string} walletAddress - Wallet address (for logging)
 * @returns {Promise<string>} - Invite link
 */
async function createInviteLink(walletAddress) {
    const { BOT_TOKEN, CHAT_ID } = getConfig();
    
    if (!BOT_TOKEN || !CHAT_ID) {
        throw new Error('Telegram bot configuration missing. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env file');
    }

    try {
        console.log(`📨 Creating Telegram invite for wallet: ${walletAddress.substring(0, 8)}...`);

        const now = Math.floor(Date.now() / 1000);
        const expiresIn = now + (10 * 60); // 10 minutes from now

        const result = await telegramRequest('createChatInviteLink', {
            chat_id: CHAT_ID,
            name: `Whale ${walletAddress.substring(0, 8)}`,
            expire_date: expiresIn,
            member_limit: 1, // Single use
            creates_join_request: false
        });

        console.log(`✅ Invite link created: ${result.invite_link}`);
        return result.invite_link;

    } catch (error) {
        console.error('❌ Failed to create Telegram invite:', error.message);
        throw new Error(`Failed to create Telegram invite: ${error.message}`);
    }
}

/**
 * Revoke invite link
 * @param {string} inviteLink - Link to revoke
 * @returns {Promise<boolean>} - Success status
 */
async function revokeInviteLink(inviteLink) {
    try {
        await telegramRequest('revokeChatInviteLink', {
            chat_id: CHAT_ID,
            invite_link: inviteLink
        });
        console.log(`🔒 Revoked invite link: ${inviteLink}`);
        return true;
    } catch (error) {
        console.error('❌ Failed to revoke invite:', error.message);
        return false;
    }
}

/**
 * Get bot info (for testing)
 * @returns {Promise<object>} - Bot information
 */
async function getBotInfo() {
    try {
        const result = await telegramRequest('getMe', {});
        console.log(`🤖 Bot info: @${result.username} (${result.first_name})`);
        return result;
    } catch (error) {
        console.error('❌ Failed to get bot info:', error.message);
        throw error;
    }
}

/**
 * Test Telegram configuration
 * @returns {Promise<boolean>} - Configuration is valid
 */
async function testTelegramConfig() {
    const { BOT_TOKEN, CHAT_ID } = getConfig();
    
    try {
        if (!BOT_TOKEN || !CHAT_ID) {
            console.error('❌ Telegram configuration missing');
            return false;
        }

        await getBotInfo();
        console.log('✅ Telegram bot configuration is valid');
        return true;
    } catch (error) {
        console.error('❌ Telegram configuration test failed:', error.message);
        return false;
    }
}

module.exports = {
    createInviteLink,
    revokeInviteLink,
    getBotInfo,
    testTelegramConfig,
    getGroupMembers,
    getChatMember
};

/**
 * Get list of group administrators (includes all members data)
 * @returns {Promise<Array>} - List of administrators
 */
async function getGroupMembers() {
    const { CHAT_ID } = getConfig();
    
    try {
        const admins = await telegramRequest('getChatAdministrators', {
            chat_id: CHAT_ID
        });
        
        return admins.map(admin => ({
            user_id: admin.user.id,
            username: admin.user.username,
            first_name: admin.user.first_name,
            last_name: admin.user.last_name,
            is_bot: admin.user.is_bot
        }));
    } catch (error) {
        console.error('❌ Failed to get group members:', error.message);
        throw error;
    }
}

/**
 * Get information about a specific chat member
 * @param {string|number} userId - Telegram user ID
 * @returns {Promise<object>} - Member info
 */
async function getChatMember(userId) {
    const { CHAT_ID } = getConfig();
    
    try {
        const member = await telegramRequest('getChatMember', {
            chat_id: CHAT_ID,
            user_id: userId
        });
        
        return {
            user_id: member.user.id,
            username: member.user.username,
            first_name: member.user.first_name,
            last_name: member.user.last_name,
            status: member.status
        };
    } catch (error) {
        console.error(`❌ Failed to get chat member ${userId}:`, error.message);
        throw error;
    }
}

// Auto-test configuration on module load (with delay to ensure .env is loaded)
setTimeout(async () => {
    const { BOT_TOKEN, CHAT_ID } = getConfig();
    
    if (BOT_TOKEN && CHAT_ID) {
        try {
            const botInfo = await getBotInfo();
            console.log('✅ Telegram bot configured successfully');
            console.log('📱 Telegram Bot Info:');
            console.log(`   Bot Name: ${botInfo.first_name}`);
            console.log(`   Username: @${botInfo.username}`);
            console.log(`   Chat ID: ${CHAT_ID}`);
        } catch (error) {
            console.error('❌ Telegram bot configuration error:', error.message);
        }
    } else {
        console.log('⚠️  Telegram bot not configured (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)');
    }
}, 100); // Small delay to ensure environment is loaded
