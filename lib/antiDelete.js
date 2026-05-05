// lib/antiDelete.js
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');

const MESSAGE_DATA_DIR = path.join(process.cwd(), 'message_data');

// Ensure message data directory exists
if (!fs.existsSync(MESSAGE_DATA_DIR)) {
    fs.mkdirSync(MESSAGE_DATA_DIR, { recursive: true });
}

function loadMessageData(remoteJid, messageId) {
    const filePath = path.join(MESSAGE_DATA_DIR, remoteJid, `${messageId}.json`);
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
}

function saveMessageData(remoteJid, messageId, message) {
    const dirPath = path.join(MESSAGE_DATA_DIR, remoteJid);
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
    
    const filePath = path.join(dirPath, `${messageId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(message, null, 2));
}

function deleteMessageData(remoteJid, messageId) {
    const filePath = path.join(MESSAGE_DATA_DIR, remoteJid, `${messageId}.json`);
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
        raw: message
    };
    
    saveMessageData(remoteJid, messageId, messageData);
}

async function handleMessageRevocation(sock, revocation, from, botNumber) {
    if (!config.ANTI_DELETE) return;
    
    const messageId = revocation.key.id;
    const remoteJid = from;
    
    const originalMessage = loadMessageData(remoteJid, messageId);
    
    if (!originalMessage) return;
    
    const deletedBy = revocation.participant || revocation.key.remoteJid;
    const sentBy = originalMessage.sender;
    
    // Skip if deleted by the sender or bot
    if (deletedBy === sentBy || deletedBy.includes(botNumber)) return;
    
    const deletedByName = deletedBy.split('@')[0];
    const sentByName = sentBy.split('@')[0];
    
    // Prepare anti-delete message
    let antiDeleteText = `╭───❍ 《 𝗔𝗡𝗧𝗜 𝗗𝗘𝗟𝗘𝗧𝗘 》
│ 🚫 𝗗𝗲𝗹𝗲𝘁𝗲𝗱 𝗕𝘆 : ${deletedByName}
│ 📩 𝗦𝗲𝗻𝘁 𝗕𝘆 : ${sentByName}
│ ⏰ 𝗧𝗶𝗺𝗲 : ${new Date().toLocaleString()}
╰───❍\n\n`;
    
    const messageType = originalMessage.type;
    const msgContent = originalMessage.message;
    
    try {
        // Handle different message types
        if (messageType === 'conversation') {
            const text = msgContent.conversation;
            if (!text.includes('chat.whatsapp.com')) {
                await sock.sendMessage(config.ANTI_DELETE_LOGS, {
                    text: antiDeleteText + `📝 𝗠𝗲𝘀𝘀𝗮𝗴𝗲 : ${text}`
                });
            }
        }
        else if (messageType === 'extendedTextMessage') {
            const text = msgContent.extendedTextMessage?.text;
            if (text && !text.includes('chat.whatsapp.com')) {
                await sock.sendMessage(config.ANTI_DELETE_LOGS, {
                    text: antiDeleteText + `📝 𝗠𝗲𝘀𝘀𝗮𝗴𝗲 : ${text}`
                });
            }
        }
        else if (messageType === 'imageMessage') {
            const caption = msgContent.imageMessage?.caption || '';
            const media = await sock.downloadMediaMessage(originalMessage.raw);
            
            await sock.sendMessage(config.ANTI_DELETE_LOGS, {
                image: media,
                caption: antiDeleteText + (caption ? `📝 𝗖𝗮𝗽𝘁𝗶𝗼𝗻 : ${caption}` : '')
            });
        }
        else if (messageType === 'videoMessage') {
            const caption = msgContent.videoMessage?.caption || '';
            const media = await sock.downloadMediaMessage(originalMessage.raw);
            
            await sock.sendMessage(config.ANTI_DELETE_LOGS, {
                video: media,
                caption: antiDeleteText + (caption ? `📝 𝗖𝗮𝗽𝘁𝗶𝗼𝗻 : ${caption}` : '')
            });
        }
        else if (messageType === 'audioMessage') {
            const media = await sock.downloadMediaMessage(originalMessage.raw);
            await sock.sendMessage(config.ANTI_DELETE_LOGS, {
                audio: media,
                mimetype: 'audio/mpeg'
            });
            await sock.sendMessage(config.ANTI_DELETE_LOGS, { text: antiDeleteText });
        }
        else if (messageType === 'stickerMessage') {
            const media = await sock.downloadMediaMessage(originalMessage.raw);
            await sock.sendMessage(config.ANTI_DELETE_LOGS, { sticker: media });
            await sock.sendMessage(config.ANTI_DELETE_LOGS, { text: antiDeleteText });
        }
        else if (messageType === 'documentMessage') {
            const media = await sock.downloadMediaMessage(originalMessage.raw);
            const fileName = msgContent.documentMessage?.fileName || 'document';
            await sock.sendMessage(config.ANTI_DELETE_LOGS, {
                document: media,
                fileName: fileName,
                mimetype: msgContent.documentMessage?.mimetype
            });
            await sock.sendMessage(config.ANTI_DELETE_LOGS, { text: antiDeleteText });
        }
        
        // Delete saved message data
        deleteMessageData(remoteJid, messageId);
        
    } catch (error) {
        console.error('Anti-delete error:', error);
    }
}

async function cleanupOldMessages() {
    // Clean messages older than 1 hour
    const dirs = fs.readdirSync(MESSAGE_DATA_DIR);
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    for (const dir of dirs) {
        const dirPath = path.join(MESSAGE_DATA_DIR, dir);
        const files = fs.readdirSync(dirPath);
        
        for (const file of files) {
            const filePath = path.join(dirPath, file);
            const stats = fs.statSync(filePath);
            if (stats.mtimeMs < oneHourAgo) {
                fs.unlinkSync(filePath);
            }
        }
    }
}

// Run cleanup every hour
setInterval(cleanupOldMessages, 60 * 60 * 1000);

module.exports = {
    handleIncomingMessage,
    handleMessageRevocation
};
