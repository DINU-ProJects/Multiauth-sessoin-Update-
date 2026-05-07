// lib/antiDelete.js
const fs = require('fs-extra');
const path = require('path');
const config = require('../config');
const { downloadMediaMessage, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { uploadToGitHub, getFromGitHub } = require('./githubBackup');
const { cacheMessage } = require('./antiEdit');

const MESSAGE_DATA_DIR = path.join(process.cwd(), 'message_data');
const VIEWONCE_DIR = path.join(process.cwd(), 'viewonce_data');

if (!fs.existsSync(MESSAGE_DATA_DIR)) fs.mkdirSync(MESSAGE_DATA_DIR, { recursive: true });
if (!fs.existsSync(VIEWONCE_DIR)) fs.mkdirSync(VIEWONCE_DIR, { recursive: true });

function getSafeJid(remoteJid) {
    return remoteJid.replace(/[:@]/g, '_');
}

function loadMessageData(remoteJid, messageId) {
    const filePath = path.join(MESSAGE_DATA_DIR, getSafeJid(remoteJid), `${messageId}.json`);
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return null;
    }
}

function saveMessageData(remoteJid, messageId, message) {
    const dirPath = path.join(MESSAGE_DATA_DIR, getSafeJid(remoteJid));
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, `${messageId}.json`), JSON.stringify(message, null, 2));
}

function deleteMessageData(remoteJid, messageId) {
    const filePath = path.join(MESSAGE_DATA_DIR, getSafeJid(remoteJid), `${messageId}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

async function saveViewOnceMedia(remoteJid, messageId, buffer, messageType, mimetype, caption) {
    const dirPath = path.join(VIEWONCE_DIR, getSafeJid(remoteJid));
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });

    let ext = 'bin';
    if (mimetype?.includes('image/jpeg')) ext = 'jpg';
    else if (mimetype?.includes('image/png')) ext = 'png';
    else if (mimetype?.includes('image/webp')) ext = 'webp';
    else if (mimetype?.includes('video/mp4')) ext = 'mp4';
    else if (mimetype?.includes('video')) ext = 'mp4';
    else if (mimetype?.includes('audio/ogg')) ext = 'ogg';
    else if (mimetype?.includes('audio/mpeg')) ext = 'mp3';
    else if (mimetype?.includes('audio')) ext = 'mp3';
    else if (messageType === 'image') ext = 'jpg';
    else if (messageType === 'video') ext = 'mp4';

    const fileName = `${messageId}.${ext}`;
    const filePath = path.join(dirPath, fileName);
    const metaPath = path.join(dirPath, `${messageId}.json`);

    fs.writeFileSync(filePath, buffer);

    const githubPath = `viewonce/${getSafeJid(remoteJid)}/${fileName}`;
    const githubUrl = await uploadToGitHub(githubPath, buffer, `ViewOnce: ${messageId}`);

    fs.writeFileSync(metaPath, JSON.stringify({
        messageId,
        type: messageType,
        mimetype,
        caption,
        filePath,
        githubUrl,
        timestamp: Date.now()
    }));

    return filePath;
}

async function loadViewOnceData(remoteJid, messageId) {
    const dirPath = path.join(VIEWONCE_DIR, getSafeJid(remoteJid));
    const metaPath = path.join(dirPath, `${messageId}.json`);

    try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

        if (meta.filePath && fs.existsSync(meta.filePath)) {
            return { buffer: fs.readFileSync(meta.filePath),...meta };
        } else if (meta.githubUrl) {
            console.log(`📥 Downloading from GitHub...`);
            const fileName = meta.filePath.split('/').pop();
            const buffer = await getFromGitHub(`viewonce/${getSafeJid(remoteJid)}/${fileName}`);
            if (buffer) {
                fs.writeFileSync(meta.filePath, buffer);
                return { buffer,...meta };
            }
        }
    } catch (e) {
        console.error('LoadViewOnce error:', e.message);
    }
    return null;
}

async function handleIncomingMessage(sock, message, from, botNumber) {
    if (!config.ANTI_DELETE) return;

    const messageId = message.key.id;
    const remoteJid = from;

    if (remoteJid === 'status@broadcast') return;
    if (message.key.fromMe) return;

    const messageType = Object.keys(message.message || {})[0];
    const msgContent = message.message[messageType];

    // FIX: Edit message වල text cache කරන්න
    const text = msgContent?.conversation || msgContent?.text || msgContent?.caption ||
                 message.message?.editedMessage?.message?.conversation ||
                 message.message?.editedMessage?.message?.extendedTextMessage?.text || '';

    if (text) cacheMessage(messageId, text);

    // FIX: ViewOnce download
    if (msgContent?.viewOnce) {
        try {
            const mediaType = messageType.replace('Message', '');
            console.log(`📥 Downloading ViewOnce ${mediaType}...`);

            const buffer = await downloadMediaMessage(
                message,
                'buffer',
                {},
                {
                    logger: pino({ level: 'silent' }),
                    reuploadRequest: sock.updateMediaMessage
                }
            );

            if (!buffer || buffer.length === 0) {
                console.log('❌ ViewOnce buffer empty');
                return;
            }

            await saveViewOnceMedia(remoteJid, messageId, buffer, mediaType, msgContent.mimetype, msgContent.caption || '');
            console.log(`📸 ViewOnce ${mediaType} saved: ${messageId}`);
        } catch (e) {
            console.error('ViewOnce save error:', e.message);
        }
    }

    const messageData = {
        id: messageId,
        from: remoteJid,
        sender: message.key.participant || message.key.remoteJid,
        timestamp: message.messageTimestamp,
        type: messageType,
        message: message.message,
        raw: message,
        pushName: message.pushName || 'Unknown',
        isViewOnce: msgContent?.viewOnce || false
    };

    saveMessageData(remoteJid, messageId, messageData);
}

async function handleMessageReaction(sock, reaction, from, botNumber) {
    if (!config.ANTI_DELETE) return;

    const messageId = reaction.key.id;
    const remoteJid = from;
    const reactor = reaction.participant || reaction.key.remoteJid;
    const emoji = reaction.text;

    const viewOnceData = await loadViewOnceData(remoteJid, messageId);
    if (viewOnceData) {
        const targetJid = config.ANTI_DELETE_LOGS || from;
        const sentBy = loadMessageData(remoteJid, messageId)?.sender || reactor;
        const sentByNumber = sentBy.split('@')[0];

        const reactText = `╭───❍ 《 𝗩𝗜𝗘𝗪 𝗢𝗡𝗖𝗘 𝗨𝗡𝗟𝗢𝗖𝗞𝗘𝗗 》
│ 👁️ *Unlocked By:* @${reactor.split('@')[0]}
│ 📩 *Sent By:* @${sentByNumber}
│ ⏰ *Time:* ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}
│ 🎭 *Reaction:* ${emoji}
╰───❍\n\n`;

        try {
            if (viewOnceData.type === 'image') {
                await sock.sendMessage(targetJid, {
                    image: viewOnceData.buffer,
                    caption: reactText + (viewOnceData.caption? `📝 *Caption:*\n${viewOnceData.caption}` : ''),
                    mentions: [reactor, sentBy]
                });
            } else if (viewOnceData.type === 'video') {
                await sock.sendMessage(targetJid, {
                    video: viewOnceData.buffer,
                    caption: reactText + (viewOnceData.caption? `📝 *Caption:*\n${viewOnceData.caption}` : ''),
                    mentions: [reactor, sentBy]
                });
            }
            console.log(`✅ ViewOnce unlocked via reaction from ${reactor.split('@')[0]}`);
        } catch (e) {
            console.error('ViewOnce unlock error:', e.message);
        }
    }
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

    if (deletedBy === sentBy || deletedBy.includes(botNumber)) return;

    const deletedByNumber = deletedBy.split('@')[0];
    const sentByNumber = sentBy.split('@')[0];
    const sentByName = originalMessage.pushName || sentByNumber;

    let targetJid = config.ANTI_DELETE_LOGS;
    if (!targetJid || targetJid.toLowerCase() === 'any') {
        targetJid = remoteJid;
    }

    const isGroup = remoteJid.includes('@g.us');
    const chatInfo = isGroup? `👥 *Group:* ${remoteJid}` : `👤 *Chat:* ${sentByNumber}`;

    let antiDeleteText = `╭───❍ 《 𝗔𝗡𝗧𝗜 𝗗𝗘𝗟𝗘𝗧𝗘 》
│ 🚫 *Deleted By:* @${deletedByNumber}
│ 📩 *Sent By:* @${sentByNumber} (${sentByName})
│ ${chatInfo}
│ ⏰ *Time:* ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}
╰───❍\n\n`;

    const messageType = originalMessage.type;
    const msgContent = originalMessage.message;

    try {
        // FIX: Edit message detect
        if (originalMessage.message?.editedMessage) {
            const oldText = cacheMessage(messageId);
            const newText = originalMessage.message.editedMessage.message?.conversation ||
                           originalMessage.message.editedMessage.message?.extendedTextMessage?.text || '';

            await sock.sendMessage(targetJid, {
                text: `╭───❍ 《 𝗔𝗡𝗧𝗜 𝗘𝗗𝗜𝗧 》
│ ✏️ *Edited By:* @${deletedByNumber}
│ ⏰ *Time:* ${new Date().toLocaleString('en-US', { timeZone: 'Asia/Colombo' })}
╰───❍

📝 *Old Message:*
${oldText || 'Not cached'}

📝 *New Message:*
${newText}`,
                mentions: [deletedBy]
            });
            return;
        }

        if (messageType === 'conversation') {
            const text = msgContent.conversation;
            if (text &&!text.includes('chat.whatsapp.com')) {
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText + `📝 *Message:*\n${text}`,
                    mentions: [deletedBy, sentBy]
                });
            }
        }
        else if (messageType === 'extendedTextMessage') {
            const text = msgContent.extendedTextMessage?.text;
            if (text &&!text.includes('chat.whatsapp.com')) {
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText + `📝 *Message:*\n${text}`,
                    mentions: [deletedBy, sentBy]
                });
            }
        }
        else if (messageType === 'imageMessage') {
            try {
                const viewOnceData = originalMessage.isViewOnce? await loadViewOnceData(remoteJid, messageId) : null;

                if (viewOnceData) {
                    await sock.sendMessage(targetJid, {
                        image: viewOnceData.buffer,
                        caption: antiDeleteText + `👁️ *ViewOnce Image*` + (viewOnceData.caption? `\n📝 *Caption:*\n${viewOnceData.caption}` : ''),
                        mentions: [deletedBy, sentBy]
                    });
                } else {
                    const caption = msgContent.imageMessage?.caption || '';
                    const buffer = await downloadMediaMessage(originalMessage.raw, 'buffer', {}, {
                        logger: pino({ level: 'silent' }),
                        reuploadRequest: sock.updateMediaMessage
                    });

                    await sock.sendMessage(targetJid, {
                        image: buffer,
                        caption: antiDeleteText + (caption? `📝 *Caption:*\n${caption}` : ''),
                        mentions: [deletedBy, sentBy]
                    });
                }
            } catch (err) {
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText + `⚠️ *Image deleted* (Download failed)`,
                    mentions: [deletedBy, sentBy]
                });
            }
        }
        else if (messageType === 'videoMessage') {
            try {
                const viewOnceData = originalMessage.isViewOnce? await loadViewOnceData(remoteJid, messageId) : null;

                if (viewOnceData) {
                    await sock.sendMessage(targetJid, {
                        video: viewOnceData.buffer,
                        caption: antiDeleteText + `👁️ *ViewOnce Video*` + (viewOnceData.caption? `\n📝 *Caption:*\n${viewOnceData.caption}` : ''),
                        mentions: [deletedBy, sentBy]
                    });
                } else {
                    const caption = msgContent.videoMessage?.caption || '';
                    const buffer = await downloadMediaMessage(originalMessage.raw, 'buffer', {}, {
                        logger: pino({ level: 'silent' }),
                        reuploadRequest: sock.updateMediaMessage
                    });

                    await sock.sendMessage(targetJid, {
                        video: buffer,
                        caption: antiDeleteText + (caption? `📝 *Caption:*\n${caption}` : ''),
                        mentions: [deletedBy, sentBy],
                        gifPlayback: msgContent.videoMessage?.gifPlayback || false
                    });
                }
            } catch (err) {
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText + `⚠️ *Video deleted* (Download failed)`,
                    mentions: [deletedBy, sentBy]
                });
            }
        }
        else if (messageType === 'audioMessage') {
            try {
                const buffer = await downloadMediaMessage(originalMessage.raw, 'buffer', {}, {
                    logger: pino({ level: 'silent' }),
                    reuploadRequest: sock.updateMediaMessage
                });
                await sock.sendMessage(targetJid, {
                    audio: buffer,
                    mimetype: msgContent.audioMessage?.mimetype || 'audio/mpeg',
                    ptt: msgContent.audioMessage?.ptt || false
                });
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText + (msgContent.audioMessage?.ptt? `🎤 *Voice Note*` : `🎵 *Audio*`),
                    mentions: [deletedBy, sentBy]
                });
            } catch (err) {
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText + `⚠️ *Audio deleted* (Download failed)`,
                    mentions: [deletedBy, sentBy]
                });
            }
        }
        else if (messageType === 'stickerMessage') {
            try {
                const buffer = await downloadMediaMessage(originalMessage.raw, 'buffer', {}, {
                    logger: pino({ level: 'silent' }),
                    reuploadRequest: sock.updateMediaMessage
                });
                await sock.sendMessage(targetJid, { sticker: buffer });
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText + `🎨 *Sticker*`,
                    mentions: [deletedBy, sentBy]
                });
            } catch (err) {
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText + `⚠️ *Sticker deleted* (Download failed)`,
                    mentions: [deletedBy, sentBy]
                });
            }
        }
        else if (messageType === 'documentMessage') {
            try {
                const buffer = await downloadMediaMessage(originalMessage.raw, 'buffer', {}, {
                    logger: pino({ level: 'silent' }),
                    reuploadRequest: sock.updateMediaMessage
                });
                const fileName = msgContent.documentMessage?.fileName || 'document';
                await sock.sendMessage(targetJid, {
                    document: buffer,
                    fileName: fileName,
                    mimetype: msgContent.documentMessage?.mimetype,
                    caption: antiDeleteText + `📄 *Document:* ${fileName}`,
                    mentions: [deletedBy, sentBy]
                });
            } catch (err) {
                await sock.sendMessage(targetJid, {
                    text: antiDeleteText + `⚠️ *Document deleted* (${msgContent.documentMessage?.fileName || 'file'})`,
                    mentions: [deletedBy, sentBy]
                });
            }
        }
        else if (messageType === 'contactMessage') {
            const vcard = msgContent.contactMessage?.vcard || '';
            const displayName = msgContent.contactMessage?.displayName || 'Contact';
            await sock.sendMessage(targetJid, {
                text: antiDeleteText + `👤 *Contact:*\n${displayName}\n\n\`\`\`${vcard}\`\`\``,
                mentions: [deletedBy, sentBy]
            });
        }
        else if (messageType === 'locationMessage') {
            const lat = msgContent.locationMessage?.degreesLatitude;
            const lng = msgContent.locationMessage?.degreesLongitude;
            await sock.sendMessage(targetJid, {
                location: { degreesLatitude: lat, degreesLongitude: lng },
            });
            await sock.sendMessage(targetJid, {
                text: antiDeleteText + `📍 *Location*\nLat: ${lat}\nLng: ${lng}`,
                mentions: [deletedBy, sentBy]
            });
        }
        else if (messageType === 'pollCreationMessage') {
            const pollName = msgContent.pollCreationMessage?.name || 'Poll';
            const options = msgContent.pollCreationMessage?.options?.map(o => o.optionName).join('\n• ') || '';
            await sock.sendMessage(targetJid, {
                text: antiDeleteText + `📊 *Poll:* ${pollName}\n\n*Options:*\n• ${options}`,
                mentions: [deletedBy, sentBy]
            });
        }
        else {
            await sock.sendMessage(targetJid, {
                text: antiDeleteText + `⚠️ *Message Type:* ${messageType}`,
                mentions: [deletedBy, sentBy]
            });
        }

        console.log(`✅ Anti-delete sent for ${messageType} from ${sentByNumber}`);
        deleteMessageData(remoteJid, messageId);

    } catch (error) {
        console.error('Anti-delete error:', error);
        try {
            await sock.sendMessage(targetJid, {
                text: antiDeleteText + `❌ *Error:* ${error.message}`,
                mentions: [deletedBy, sentBy]
            });
        } catch (e) {}
    }
}

async function cleanupOldMessages() {
    try {
        const dirs = [MESSAGE_DATA_DIR, VIEWONCE_DIR];
        const oneHourAgo = Date.now() - (60 * 60 * 1000);

        for (const baseDir of dirs) {
            if (!fs.existsSync(baseDir)) continue;
            const subDirs = fs.readdirSync(baseDir);

            for (const dir of subDirs) {
                const dirPath = path.join(baseDir, dir);
                if (!fs.statSync(dirPath).isDirectory()) continue;

                const files = fs.readdirSync(dirPath);
                for (const file of files) {
                    const filePath = path.join(dirPath, file);
                    const stats = fs.statSync(filePath);
                    if (stats.mtimeMs < oneHourAgo) {
                        fs.unlinkSync(filePath);
                    }
                }

                if (fs.readdirSync(dirPath).length === 0) {
                    fs.rmdirSync(dirPath);
                }
            }
        }
    } catch (e) {
        console.error('Cleanup error:', e.message);
    }
}

setInterval(cleanupOldMessages, 60 * 60 * 1000);

module.exports = {
    handleIncomingMessage,
    handleMessageRevocation,
    handleMessageReaction
};
