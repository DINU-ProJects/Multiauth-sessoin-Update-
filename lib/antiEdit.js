// lib/antiEdit.js
const config = require('../config');

const editCache = new Map();

async function handleMessageEdit(sock, message, from, botNumber) {
    if (!config.ANTI_EDIT) return;

    const messageId = message.key.id;
    const newText = message.message?.editedMessage?.message?.conversation ||
                    message.message?.editedMessage?.message?.extendedTextMessage?.text || '';

    const oldText = editCache.get(messageId);
    if (!oldText || oldText === newText) return;

    const sender = message.key.participant || from;
    const targetJid = config.ANTI_DELETE_LOGS || from;

    const editText = `╭───❍ 《 𝗔𝗡𝗧𝗜 𝗘𝗗𝗜𝗧 》
│ ✏️ *Edited By:* @${sender.split('@')[0]}
│ ⏰ *Time:* ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}
╰───❍

📝 *Old Message:*
${oldText}

📝 *New Message:*
${newText}`;

    try {
        await sock.sendMessage(targetJid, {
            text: editText,
            mentions: [sender]
        });
        console.log(`✅ Anti-edit sent for ${messageId}`);
    } catch (e) {
        console.error('Anti-edit error:', e.message);
    }
}

function cacheMessage(messageId, text) {
    if (text && text.length > 0) {
        editCache.set(messageId, text);
        setTimeout(() => editCache.delete(messageId), 24 * 60 * 1000);
    }
}

module.exports = { handleMessageEdit, cacheMessage };
