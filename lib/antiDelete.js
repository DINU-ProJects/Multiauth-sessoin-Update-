// lib/antiDelete.js
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

const MESSAGE_DATA_DIR = path.join(process.cwd(), 'message_data');

// Ensure message data directory exists
if (!fs.existsSync(MESSAGE_DATA_DIR)) {
    fs.mkdirSync(MESSAGE_DATA_DIR, { recursive: true });
}

function loadMessageData(remoteJid, messageId) {
    const filePath = path.join(MESSAGE_DATA_DIR, remoteJid.replace(/[:@]/g, '_'), `${messageId}.json`);
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
}

function saveMessageData(remoteJid, messageId, message) {
    const safeJid = remoteJid.replace(/[:@]/g, '_');
    const dirPath = path.join(MESSAGE_DATA_DIR, safeJid);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    
    const filePath = path.join(dirPath, `${messageId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(message, null, 2));
}

function deleteMessageData(remoteJid, messageId) {
    const safeJid = remoteJid.replace(/[:@]/g, '_');
    const filePath = path.join(MESSAGE_DATA_DIR, safeJid, `${messageId}.json`);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
}

async function handleIncomingMessage(sock, message, from, botNumber) {
    if (!config.ANTI_DELETE) return;
    
    const messageId = message.key.id;
    const remoteJid = from;
    
    // Skip if it's a status message
    if (remoteJid === 'status@broadcast') return;
    
    // Skip if it's from the bot itself
    if (message.key.fromMe) return;
    
    // Save message data
    const messageData = {
        id: messageId,
        from: remoteJid,
        sender: message.key.participant || message.key.remoteJid,
        timestamp: message.messageTimestamp,
        type: Object.keys(message.message || {})[0],
        message: message.message,
        raw: message,
        pushName: message.pushName || 'Unknown'
    };
    
    saveMessageData(remoteJid, messageId, messageData);
}

async function handleMessageRevocation(sock, revocation, from, botNumber) {
    if (!config.ANTI_DELETE) return;
    
    const messageId = revocation.key.id;
    const remoteJid = from;
    
    const originalMessage = loadMessageData(remoteJid, messageId);
    
    if (!originalMessage) {
        console.log('⚠️ Original message not found for anti-delete');
        return;
    }
    
    const deletedBy = revocation.participant || revocation.key.remoteJid;
    const sentBy = originalMessage.sender;
    
    // Skip if deleted by the sender or bot
    if (deletedBy === sentBy || deletedBy.includes(botNumber)) return;
    
    const deletedByNumber = deletedBy.split('@')[0];
    const sentByNumber = sentBy.split('@')[0];
    const sentByName = originalMessage.pushName || sentByNumber;
    
    // FIX: Determine where to send the anti-delete message
    let targetJid = config.ANTI_DELETE_LOGS;
    if (!targetJid || targetJid.toLowerCase() === 'any') {
        // Send to the same chat where message was deleted
        targetJid = remoteJid;
    }
    
    // FIX: Proper JID display - Group vs User
    const isGroup = remoteJid.includes('@g.us');
    const chatInfo = isGroup 
        ? `👥 *Group:* ${remoteJid}`
        : `👤 *Chat:* ${sentByNumber}`;
    
    // Prepare anti-delete message
    let antiDeleteText = `╭───❍ 《 𝗔𝗡𝗧𝗜 𝗗𝗘𝗟𝗘𝗧𝗘 》\n` +
                        `│ 🚫 *Deleted By:* @${deletedByNumber}\n` +
                        `│ 📩 *Sent By:* @${sentByNumber} (${sentByName})\n` +
                        `│ ${chatInfo}\n` +
                        `│ ⏰ *Time:* ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}\n` +
                        `╰───❍\n\n`;
    
    const messageType = originalMessage.type;
    const msgContent = originalMessage.message;
    
    try {
        // FIX: Handle all media types properly
        if (messageType === 'conversation') {
            const text = msgContent.conversation;
            if (text && !text.includes('chat.whatsapp.com')) {
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText + `📝 *Message:*\n${text}`,
                    mentions: [deletedBy, sentBy]
                });
            }
        }
        else if (messageType === 'extendedTextMessage') {
            const text = msgContent.extendedTextMessage?.text;
            if (text && !text.includes('chat.whatsapp.com')) {
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText + `📝 *Message:*\n${text}`,
                    mentions: [deletedBy, sentBy]
                });
            }
        }
        else if (messageType === 'imageMessage') {
            try {
                const caption = msgContent.imageMessage?.caption || '';
                const buffer = await downloadMediaMessage(originalMessage.raw, 'buffer', {}, {
                    reuploadRequest: sock.updateMediaMessage
                });
                
                await sock.sendMessage(targetJid, {
                    image: buffer,
                    caption: antiDeleteText + (caption ? `📝 *Caption:*\n${caption}` : ''),
                    mentions: [deletedBy, sentBy]
                });
            } catch (err) {
                console.error('Image download failed:', err.message);
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText + `⚠️ *Image deleted* (Download failed)`,
                    mentions: [deletedBy, sentBy]
                });
            }
        }
        else if (messageType === 'videoMessage') {
            try {
                const caption = msgContent.videoMessage?.caption || '';
                const buffer = await downloadMediaMessage(originalMessage.raw, 'buffer', {}, {
                    reuploadRequest: sock.updateMediaMessage
                });
                
                await sock.sendMessage(targetJid, {
                    video: buffer,
                    caption: antiDeleteText + (caption ? `📝 *Caption:*\n${caption}` : ''),
                    mentions: [deletedBy, sentBy],
                    gifPlayback: msgContent.videoMessage?.gifPlayback || false
                });
            } catch (err) {
                console.error('Video download failed:', err.message);
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText + `⚠️ *Video deleted* (Download failed)`,
                    mentions: [deletedBy, sentBy]
                });
            }
        }
        else if (messageType === 'audioMessage') {
            try {
                const buffer = await downloadMediaMessage(originalMessage.raw, 'buffer', {}, {
                    reuploadRequest: sock.updateMediaMessage
                });
                await sock.sendMessage(targetJid, {
                    audio: buffer,
                    mimetype: msgContent.audioMessage?.mimetype || 'audio/mpeg',
                    ptt: msgContent.audioMessage?.ptt || false
                });
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText,
                    mentions: [deletedBy, sentBy]
                });
            } catch (err) {
                console.error('Audio download failed:', err.message);
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText + `⚠️ *Audio deleted* (Download failed)`,
                    mentions: [deletedBy, sentBy]
                });
            }
        }
        else if (messageType === 'stickerMessage') {
            try {
                const buffer = await downloadMediaMessage(originalMessage.raw, 'buffer', {}, {
                    reuploadRequest: sock.updateMediaMessage
                });
                await sock.sendMessage(targetJid, { sticker: buffer });
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText,
                    mentions: [deletedBy, sentBy]
                });
            } catch (err) {
                console.error('Sticker download failed:', err.message);
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText + `⚠️ *Sticker deleted* (Download failed)`,
                    mentions: [deletedBy, sentBy]
                });
            }
        }
        else if (messageType === 'documentMessage') {
            try {
                const buffer = await downloadMediaMessage(originalMessage.raw, 'buffer', {}, {
                    reuploadRequest: sock.updateMediaMessage
                });
                const fileName = msgContent.documentMessage?.fileName || 'document';
                await sock.sendMessage(targetJid, {
                    document: buffer,
                    fileName: fileName,
                    mimetype: msgContent.documentMessage?.mimetype,
                    caption: antiDeleteText,
                    mentions: [deletedBy, sentBy]
                });
            } catch (err) {
                console.error('Document download failed:', err.message);
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText + `⚠️ *Document deleted* (${msgContent.documentMessage?.fileName || 'file'})`,
                    mentions: [deletedBy, sentBy]
                });
            }
        }
        else {
            // Unknown message type
            await sock.sendMessage(targetJid, {
                text: antiDeleteText + `⚠️ *Message Type:* ${messageType}`,
                mentions: [deletedBy, sentBy]
            });
        }
        
        console.log(`✅ Anti-delete sent for ${messageType} from ${sentByNumber}`);
        
        // Delete saved message data
        deleteMessageData(remoteJid, messageId);
        
    } catch (error) {
        console.error('Anti-delete error:', error);
        // Fallback: Send at least the text
        try {
            await sock.sendMessage(targetJid, {
                text: antiDeleteText + `❌ *Error recovering message:* ${error.message}`,
                mentions: [deletedBy, sentBy]
            });
        } catch (e) {}
    }
}

async function cleanupOldMessages() {
    // Clean messages older than 1 hour
    try {
        const dirs = fs.readdirSync(MESSAGE_DATA_DIR);
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        
        for (const dir of dirs) {
            const dirPath = path.join(MESSAGE_DATA_DIR, dir);
            if (!fs.statSync(dirPath).isDirectory()) continue;
            
            const files = fs.readdirSync(dirPath);
            
            for (const file of files) {
                const filePath = path.join(dirPath, file);
                const stats = fs.statSync(filePath);
                if (stats.mtimeMs < oneHourAgo) {
                    fs.unlinkSync(filePath);
                }
            }
            
            // Delete empty directories
            if (fs.readdirSync(dirPath).length === 0) {
                fs.rmdirSync(dirPath);
            }
        }
    } catch (e) {
        console.error('Cleanup error:', e.message);
    }
}

// Run cleanup every hour
setInterval(cleanupOldMessages, 60 * 60 * 1000);

module.exports = {
    handleIncomingMessage,
    handleMessageRevocation
};
