
// index.js - උඩම, import ටිකට පස්සේ
const { File } = require('node:buffer');
if (typeof globalThis.File === 'undefined') {
  globalThis.File = File;
}

const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const axios = require('axios'); // ← මේක තියෙනවද බලපන්
const {
    makeWASocket,
    useMultiFileAuthState,
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    downloadContentFromMessage
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const FileType = require('file-type'); // ← මේක add කරන්න
const config = require('./config');

// ============ FIX: fetchJson function එක add කරපන් ============
async function fetchJson(url, options = {}) {
    try {
        const res = await axios.get(url, options);
        return res.data;
    } catch (e) {
        console.error('fetchJson error:', e.message);
        return null;
    }
}
// =============================================================

const { initDatabase, getSettings } = require('./lib/database');
const { saveCredsToDB, loadCredsFromDB, SESSION_BASE_PATH, updateSessionActive, removeSession, getAllActiveSessions } = require('./lib/credsManager');
const { getTimestamp, sleep, formatJid, runtime, getBuffer } = require('./lib/functions');
const { handleIncomingMessage, handleMessageRevocation, handleMessageReaction } = require('./lib/antiDelete');
const { handleMessageEdit } = require('./lib/antiEdit');
const { getCommand, getAllCommands } = require('./plugins/command');

// Load plugins
require('./plugins/main');
require('./plugins/download');

console.log('📦 Commands loaded:', getAllCommands().length);
console.log('📋 Command list:', getAllCommands().map(c => c.pattern));

const app = express();
const PORT = process.env.PORT || 10000;

// Active sockets storage
const activeSockets = new Map();
const socketStartTimes = new Map();
const reconnectAttempts = new Map();
global.pairingRequests = new Map();

// Helper function
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============ START BOT FUNCTION ============
async function startBot(number, credsData = null) {
    const cleanNumber = number? number.replace(/[^0-9]/g, '') : null;

    if (cleanNumber && activeSockets.has(cleanNumber)) {
        console.log(`⚠️ Bot already running for ${cleanNumber}`);
        return activeSockets.get(cleanNumber);
    }

    const sessionPath = path.join(SESSION_BASE_PATH, cleanNumber? `session_${cleanNumber}` : 'session_default');
    await fs.ensureDir(sessionPath);

    // FIX: DB එකෙන් load කරලා file එකට ලියන්නේ useMultiFileAuthState එකෙන්
    if (credsData && cleanNumber) {
        // DB එකේ තියෙන creds file එකට දාන්න
        await fs.writeFile(path.join(sessionPath, 'creds.json'), JSON.stringify(credsData, null, 2));
        console.log(`📁 Loaded session from DB for ${cleanNumber}`);
    } else if (cleanNumber) {
        // DB එකෙන් auto load කරන්න
        const dbCreds = await loadCredsFromDB(cleanNumber);
        if (dbCreds) {
            await fs.writeFile(path.join(sessionPath, 'creds.json'), JSON.stringify(dbCreds, null, 2));
            console.log(`📁 Auto-loaded session from DB for ${cleanNumber}`);
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: 'fatal' });
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: Browsers.ubuntu('Chrome'),
        getMessage: async (key) => {
            return { conversation: "Hello" };
        },
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        defaultQueryTimeoutMs: 60000,
    });

    // FIX: Creds update උනාම DB එකට auto save
    sock.ev.on('creds.update', async () => {
        await saveCreds();
        const credsPath = path.join(sessionPath, 'creds.json');
        if (await fs.pathExists(credsPath) && cleanNumber) {
            try {
                const updatedCreds = await fs.readJson(credsPath);
                await saveCredsToDB(cleanNumber, updatedCreds, true);
                console.log('📝 Session auto-saved to DB');
            } catch (e) {
                console.log('⚠️ DB save error:', e.message);
            }
        }
    });

    if (cleanNumber) {
        activeSockets.set(cleanNumber, sock);
        reconnectAttempts.delete(cleanNumber);
    }
    socketStartTimes.set(cleanNumber || 'default', Date.now());

    // ============ BUTTON FUNCTIONS ============
    sock.edit = async (mek, newmg) => {
        await sock.relayMessage(mek.key.remoteJid, {
            protocolMessage: {
                key: mek.key,
                type: 14,
                editedMessage: {
                    conversation: newmg
                }
            }
        }, {})
    }

    sock.sendFileUrl = async (jid, url, caption, quoted, options = {}) => {
        let mime = '';
        let res = await axios.head(url)
        mime = res.headers['content-type']
        if (mime.split("/")[1] === "gif") {
            return sock.sendMessage(jid, {
                video: await getBuffer(url),
                caption: caption,
                gifPlayback: true,
               ...options
            }, {
                quoted: quoted,
               ...options
            })
        }
        let type = mime.split("/")[0] + "Message"
        if (mime === "application/pdf") {
            return sock.sendMessage(jid, {
                document: await getBuffer(url),
                mimetype: 'application/pdf',
                caption: caption,
               ...options
            }, {
                quoted: quoted,
               ...options
            })
        }
        if (mime.split("/")[0] === "image") {
            return sock.sendMessage(jid, {
                image: await getBuffer(url),
                caption: caption,
               ...options
            }, {
                quoted: quoted,
               ...options
            })
        }
        if (mime.split("/")[0] === "video") {
            return sock.sendMessage(jid, {
                video: await getBuffer(url),
                caption: caption,
                mimetype: 'video/mp4',
               ...options
            }, {
                quoted: quoted,
               ...options
            })
        }
        if (mime.split("/")[0] === "audio") {
            return sock.sendMessage(jid, {
                audio: await getBuffer(url),
                caption: caption,
                mimetype: 'audio/mpeg',
               ...options
            }, {
                quoted: quoted,
               ...options
            })
        }
    }

    sock.sendButtonMessage = async (jid, buttons, quoted, opts = {}) => {
        let header;
        if (opts?.video) {
            var video = await prepareWAMessageMedia({
                video: {
                    url: opts && opts.video? opts.video : ''
                }
            }, {
                upload: sock.waUploadToServer
            })
            header = {
                title: opts && opts.header? opts.header : '',
                hasMediaAttachment: true,
                videoMessage: video.videoMessage,
            }
        } else if (opts?.image) {
            var image = await prepareWAMessageMedia({
                image: {
                    url: opts && opts.image? opts.image : ''
                }
            }, {
                upload: sock.waUploadToServer
            })
            header = {
                title: opts && opts.header? opts.header : '',
                hasMediaAttachment: true,
                imageMessage: image.imageMessage,
            }
        } else {
            header = {
                title: opts && opts.header? opts.header : '',
                hasMediaAttachment: false,
            }
        }

        let message = generateWAMessageFromContent(jid, {
            viewOnceMessage: {
                message: {
                    messageContextInfo: {
                        deviceListMetadata: {},
                        deviceListMetadataVersion: 2,
                    },
                    interactiveMessage: {
                        body: {
                            text: opts && opts.body? opts.body : ''
                        },
                        footer: {
                            text: opts && opts.footer? opts.footer : ''
                        },
                        header: header,
                        nativeFlowMessage: {
                            buttons: buttons,
                            messageParamsJson: ''
                        }
                    }
                }
            }
        }, {
            quoted: quoted
        })
        await sock.sendPresenceUpdate('composing', jid)
        await sleep(1000 * 1);
        return await sock.relayMessage(jid, message["message"], {
            messageId: message.key.id
        })
    }

    sock.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
        let quoted = message.msg? message.msg : message
        let mime = (message.msg || message).mimetype || ''
        let messageType = message.mtype? message.mtype.replace(/Message/gi, '') : mime.split('/')[0]
        const stream = await downloadContentFromMessage(quoted, messageType)
        let buffer = Buffer.from([])
        for await (const chunk of stream) {
            buffer = Buffer.concat([buffer, chunk])
        }
        let type = await FileType.fromBuffer(buffer)
        trueFileName = attachExtension? (filename + '.' + type.ext) : filename
        await fs.writeFileSync(trueFileName, buffer)
        return trueFileName
    }

    // ============ CONNECTION UPDATE ============
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'open') {
            console.log(`✅ Bot connected successfully!`);
            const currentBotNumber = sock.user.id.split(':')[0];
            console.log(`📱 Bot Number: ${currentBotNumber}`);

            // FIX: Session connect උනාම DB එකට save කරන්න
            if (cleanNumber) {
                await saveCredsToDB(cleanNumber, state.creds, true);
                await updateSessionActive(cleanNumber, true);
                console.log(`✅ Session saved to DB for ${cleanNumber}`);
            }

            // Load owner data
            try {
                const ownerdata = (await axios.get('https://gist.githubusercontent.com/DINU-F6A1/8a73c0e5d2f4b1a9c6e8d3f2a1b0c9d8/raw')).data
                config.LOGO = `https://files.catbox.moe/de82e3.jpg`
                config.FOOTER = `> ©ᴘᴏᴡᴇʀᴇᴅ ʙʏ ᴋᴏᴅ ɢᴀɴɢꜱ`
                config.PAIR = ownerdata.pair
                config.NEWS = ownerdata.news
                config.API = ownerdata.api
                config.APIKEY = ownerdata.apikey
            } catch (e) {}

            const connectMsg = `╭───❍ 《 ${config.BOT_NAME} 》
│ ✅ Successfully Connected!
│ 🤖 Number: ${currentBotNumber}
│ ⏱️ Time: ${getTimestamp()}
│ 🟢 Status: Online & Ready
╰───❍

Type ${config.PREFIX}menu to see commands.`;

            try {
                const botJid = sock.user.id;
                await delay(1000);
                await sock.sendMessage(botJid, { text: connectMsg });
                console.log(`✅ Success message sent to self: ${currentBotNumber}`);
            } catch (e) {
                console.log('Could not send startup message to self:', e.message);
            }

            if (config.OWNER_NUMBER && config.OWNER_NUMBER!== currentBotNumber) {
                try {
                    const ownerJid = formatJid(config.OWNER_NUMBER);
                    await delay(500);
                    await sock.sendMessage(ownerJid, { text: connectMsg });
                    console.log(`✅ Success message sent to owner: ${config.OWNER_NUMBER}`);
                } catch (e) {
                    console.log('Could not send startup message to owner:', e.message);
                }
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`Connection closed with code: ${statusCode} for ${cleanNumber}`);

            if (statusCode === DisconnectReason.loggedOut) {
                console.log('🚪 User logged out from WhatsApp');
                if (cleanNumber) {
                    activeSockets.delete(cleanNumber);
                    socketStartTimes.delete(cleanNumber);
                    reconnectAttempts.delete(cleanNumber);
                    try {
                        await removeSession(cleanNumber);
                        await updateSessionActive(cleanNumber, false);
                        await fs.remove(sessionPath);
                        console.log(`✅ Session ${cleanNumber} cleaned up completely`);
                    } catch (e) {
                        console.error('Error cleaning session:', e.message);
                    }
                }
                return;
            } else if (statusCode === DisconnectReason.badSession) {
                console.log('⚠️ Bad session detected. Deleting and restarting...');
                if (cleanNumber) {
                    activeSockets.delete(cleanNumber);
                    await removeSession(cleanNumber);
                    try { await fs.remove(sessionPath); } catch (e) {}
                }
                setTimeout(() => startBot(cleanNumber), 3000);
            } else {
                const attempts = reconnectAttempts.get(cleanNumber) || 0;
                if (attempts >= 3) {
                    console.log(`❌ Max reconnect attempts reached for ${cleanNumber}. Stopping.`);
                    activeSockets.delete(cleanNumber);
                    reconnectAttempts.delete(cleanNumber);
                    await updateSessionActive(cleanNumber, false);
                    return;
                }
                reconnectAttempts.set(cleanNumber, attempts + 1);
                console.log(`🔄 Reconnect attempt ${attempts + 1}/3 for ${cleanNumber}...`);
                setTimeout(() => startBot(cleanNumber), 5000);
            }
        }
    });

    // ============ HANDLE MESSAGE UPDATES - EDIT DETECT ============
    sock.ev.on('messages.update', async (updates) => {
        for (const { key, update } of updates) {
            // Status auto-read
            if (key.remoteJid === 'status@broadcast') {
                try {
                    await sock.readMessages([key]);
                    console.log(`👁️ Viewed status from ${key.participant?.split('@')[0]}`);
                } catch (e) {}
                continue;
            }

            // Edit detect
            if (update.message?.editedMessage) {
                const from = key.remoteJid;
                const currentBotNumber = sock.user.id.split(':')[0];

                const fakeMsg = {
                    key: key,
                    message: update.message,
                    pushName: 'Unknown'
                };

                await handleMessageEdit(sock, fakeMsg, from, currentBotNumber);
            }
        }
    });

    // ============ HANDLE INCOMING MESSAGES ============
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        const currentBotNumber = sock.user.id.split(':')[0];
        const isGroup = from.endsWith('@g.us');

        let actualSender = from;
        if (isGroup) {
            actualSender = msg.key.participant || msg.participant || from;
        }
        if (msg.key.fromMe) {
            actualSender = currentBotNumber + '@s.whatsapp.net';
        }

        const pushname = msg.pushName || 'User';

        if (from === 'status@broadcast' || from.includes('@newsletter')) return;

        // ============ ANTI-DELETE - Save FIRST ============
        let userSettings = config;
        if (cleanNumber) {
            userSettings = await getSettings(cleanNumber);
        }

        if (userSettings.antiDelete || config.ANTI_DELETE) {
            await handleIncomingMessage(sock, msg, from, currentBotNumber);
        }

        // ============ HANDLE MESSAGE REVOCATION ============
        if (msg.message?.protocolMessage) {
            const protocolMsg = msg.message.protocolMessage;
            if (protocolMsg.type === 0) {
                if (userSettings.antiDelete || config.ANTI_DELETE) {
                    await handleMessageRevocation(sock, protocolMsg, from, currentBotNumber);
                }
            }
            return;
        }

        // ============ GET MESSAGE TEXT ============
        let messageText = '';
        if (msg.message.conversation) messageText = msg.message.conversation;
        else if (msg.message.extendedTextMessage?.text) messageText = msg.message.extendedTextMessage.text;
        else if (msg.message.imageMessage?.caption) messageText = msg.message.imageMessage.caption;
        else if (msg.message.videoMessage?.caption) messageText = msg.message.videoMessage.caption;

        console.log(`📨 Message: ${messageText.substring(0, 50)} from ${actualSender} | Bot: ${currentBotNumber}`);

        if (!messageText) return;

        // ============ OWNER REACT ✨ ============
        const ownerNumber = config.OWNER_NUMBER?.replace(/[^0-9]/g, '');
        if (actualSender.replace(/[^0-9]/g, '') === ownerNumber) {
            try {
                await sock.sendMessage(from, { react: { text: '✨', key: msg.key } });
                console.log(`✨ Owner react sent to ${actualSender}`);
            } catch (e) {
                console.log('Owner react error:', e.message);
            }
        }

        // ============ AUTO REACT ============
        if (userSettings.autoReact || config.AUTO_REACT) {
            try {
                await sock.sendMessage(from, { react: { text: '🎃', key: msg.key } });
            } catch (e) {}
        }

        // ============ SETTINGS CHECKS ============
        if (!msg.key.fromMe &&!actualSender.includes(config.OWNER_NUMBER) &&!isGroup && config.ONLY_GROUP == 'true') return;
        if (!msg.key.fromMe &&!actualSender.includes(config.OWNER_NUMBER) && config.ONLY_ME == 'true') return;

        // ============ AUTO READ/TYPING/RECORDING ============
        const prefixRegex = new RegExp('^[' + config.PREFIX.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&') + ']');
        let icmd = messageText? prefixRegex.test(messageText[0]) : false;
        if (config.READ_CMD_ONLY === "true" && icmd) {
            await sock.readMessages([msg.key])
        }
        if (config.AUTO_READ === 'true') {
            sock.readMessages([msg.key])
        }
        if (config.AUTO_TYPING === 'true') {
            sock.sendPresenceUpdate('composing', from)
        }
        if (config.AUTO_RECORDING === 'true') {
            sock.sendPresenceUpdate('recording', from)
        }
        if (config.AUTO_BIO === 'true') {
            sock.updateProfileStatus(`Hey, future leaders! 🌟 Vajira-Md is here to inspire and lead, thanks to Vajira Rathnayaka, Inc. 🚀 ${runtime(process.uptime())} `).catch(_ => _)
        }
        if (config.ALWAYS_ONLINE === 'false') {
            await sock.sendPresenceUpdate('unavailable')
        }
        if (config.ALWAYS_ONLINE === 'true') {
            await sock.sendPresenceUpdate('available')
        }
        if (config.AUTO_BLOCK == 'false' && from.endsWith("@s.whatsapp.net")) {
            return sock.updateBlockStatus(actualSender, 'block')
        }

        // ============ ANTI LINK ============
        if (config.ANTI_LINK == "true"){
            if (isGroup) {
                const groupMetadata = await sock.groupMetadata(from);
                const groupAdmins = groupMetadata.participants.filter(p => p.admin).map(p => p.id);
                const isAdmins = groupAdmins.includes(actualSender);
                const isBotAdmins = groupAdmins.includes(sock.user.id);
                if (isBotAdmins &&!isAdmins &&!msg.key.fromMe) {
                    if (messageText.match(`https`)) {
                        await sock.sendMessage(from, { delete: msg.key })
                        sock.sendMessage(from, { text: '*「 ⚠️ 𝑳𝑰𝑵𝑲 𝑫𝑬𝑳𝑬𝑻𝑬𝑫 ⚠️ 」*' })
                    }
                }
            }
        }

        // ============ ANTI BOT ============
        if (config.ANTI_BOT == "true"){
            if (isGroup) {
                const groupMetadata = await sock.groupMetadata(from);
                const groupAdmins = groupMetadata.participants.filter(p => p.admin).map(p => p.id);
                const isBotAdmins = groupAdmins.includes(sock.user.id);
                const isCreator = actualSender.includes(config.OWNER_NUMBER);
                const isDev = config.DEV_NUMBERS?.includes(actualSender.replace(/[^0-9]/g, ''));
                if (!isCreator &&!isDev &&!isBotAdmins && msg.key.id.startsWith('BAE5')) {
                    sock.sendMessage(from, { text: `\`\`\`🤖 Bot Detected!!\`\`\n\n_✅ Kicked *@${actualSender.split("@")[0]}*_`, mentions: [actualSender] });
                    sock.groupParticipantsUpdate(from, [actualSender], 'remove');
                }
            }
        }

        // ============ ANTI BAD WORD ============
        const bad = await fetchJson(`https://raw.githubusercontent.com/DINU-PROYECT/MD-DATA/refs/heads/main/badby_alpha.json`)
        if (config.ANTI_BAD == "true"){
            if (isGroup) {
                const groupMetadata = await sock.groupMetadata(from);
                const groupAdmins = groupMetadata.participants.filter(p => p.admin).map(p => p.id);
                const isAdmins = groupAdmins.includes(actualSender);
                const isDev = config.DEV_NUMBERS?.includes(actualSender.replace(/[^0-9]/g, ''));
                if (!isAdmins &&!isDev) {
                    for (any in bad){
                        if (messageText.toLowerCase().includes(bad[any])){
                            if (!messageText.includes('tent')) {
                                if (!messageText.includes('docu')) {
                                    if (!messageText.includes('https')) {
                                        if (groupAdmins.includes(actualSender)) return
                                        if (msg.key.fromMe) return
                                        await sock.sendMessage(from, { delete: msg.key })
                                        await sock.sendMessage(from, { text: '*Bad word detected..!*'})
                                        await sock.groupParticipantsUpdate(from,[actualSender], 'remove')
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // ============ COMMAND HANDLING ============
                // ============ COMMAND HANDLING ============
        // ============ COMMAND HANDLING ============
        const prefix = userSettings.prefix || config.PREFIX;
        if (!messageText.startsWith(prefix)) return;

        const args = messageText.slice(prefix.length).trim().split(/\s+/);
        const commandName = args[0].toLowerCase();
        const commandArgs = args.slice(1);

        const command = getCommand(commandName);

        if (command) {
            console.log(`📝 CMD: ${commandName} from ${actualSender} on Bot: ${currentBotNumber}`);

            // React
            if (command.react) {
                await sock.sendMessage(from, { react: { text: command.react, key: msg.key } });
            }

            try {
                // ============ Build Context ============
                const isMe = msg.key.fromMe;
                const isOwner = actualSender.includes(config.OWNER_NUMBER);
                const isCreator = isOwner;
                const isDev = config.DEV_NUMBERS?.includes(actualSender.replace(/[^0-9]/g, ''));
                const botNumber2 = sock.user.id.split(':')[0] + '@s.whatsapp.net';
                const botNumber = sock.user.id;
                const senderNumber = actualSender.replace(/[^0-9]/g, '');
                const groupMetadata = isGroup? await sock.groupMetadata(from) : '';
                const groupName = isGroup? groupMetadata.subject : '';
                const participants = isGroup? groupMetadata.participants : [];
                const groupAdmins = isGroup? participants.filter(p => p.admin).map(p => p.id) : [];
                const isBotAdmins = isGroup? groupAdmins.includes(botNumber) : false;
                const isAdmins = isGroup? groupAdmins.includes(actualSender) : false;
                const reply = (text) => sock.sendMessage(from, { text }, { quoted: msg });
                const q = commandArgs.join(' ');
                const l = console.log;

                // FIX: Quoted message object හරියට හදන්න + download method add කරන්න
                let quoted = null;
                if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
                    const quotedMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
                    const quotedKey = {
                        remoteJid: from,
                        fromMe: msg.message.extendedTextMessage.contextInfo.participant === botNumber,
                        id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                        participant: msg.message.extendedTextMessage.contextInfo.participant
                    };
                    quoted = {
                        key: quotedKey,
                        message: quotedMsg,
                        mtype: Object.keys(quotedMsg)[0],
                      ...quotedMsg
                    };
                    // Baileys download support
                    quoted.download = () => downloadMediaMessage(quoted, 'buffer', {}, {
                        logger: pino({ level: 'silent' }),
                        reuploadRequest: sock.updateMediaMessage
                    });
                }

                // ============ Execute Command ============
                // FIX: Parameter order හරියට දාන්න - plugin එකේ expect කරන විදිහට
                await command.execute(sock, msg, {
                    from,
                    prefix,
                    l,
                    quoted,
                    body: messageText,
                    isCmd: true,
                    command: commandName,
                    args: commandArgs,
                    q,
                    isGroup,
                    sender: actualSender,
                    senderNumber,
                    botNumber2,
                    botNumber,
                    pushname,
                    isMe,
                    isOwner,
                    groupMetadata,
                    groupName,
                    participants,
                    groupAdmins,
                    isBotAdmins,
                    isAdmins,
                    reply,
                    config,
                    isCreator,
                    isDev
                });

            } catch (err) {
                console.error(`Command Error:`, err);
                await sock.sendMessage(from, { text: `❌ Error: ${err.message}` }, { quoted: msg });
            }
        }
    });
      

    // ============ HANDLE REACTIONS ============
    sock.ev.on('messages.reaction', async (reactions) => {
        for (const reaction of reactions) {
            const from = reaction.key.remoteJid;
            const currentBotNumber = sock.user.id.split(':')[0];

            let userSettings = config;
            if (cleanNumber) {
                userSettings = await getSettings(cleanNumber);
            }

            if (userSettings.antiDelete || config.ANTI_DELETE) {
                await handleMessageReaction(sock, reaction, from, currentBotNumber);
            }
        }
    });

    // ============ GROUP ADD ============
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        if (action === 'add') {
            for (const participant of participants) {
                if (participant === sock.user.id) {
                    console.log(`🤖 Bot added to group: ${id}`);
                    await sock.sendMessage(id, { text: `╭───❍ 《 ${config.BOT_NAME} 》\n│ 🤖 Thanks for adding me!\n│ 📌 Prefix: ${config.PREFIX}\n│ 📋 Menu: ${config.PREFIX}menu\n╰───❍` });
                }
            }
        }
    });

    return sock;
}

// ============ EXPRESS MIDDLEWARE ============
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'web/public')));

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: runtime(process.uptime()),
        activeSessions: activeSockets.size,
        bots: Array.from(activeSockets.keys())
    });
});

// ============ ROUTES ============
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'web/public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'web/public', 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'web/public', 'dashboard.html')));
app.get('/qr', (req, res) => res.sendFile(path.join(__dirname, 'web/public', 'qr.html')));
app.get('/pair', (req, res) => res.sendFile(path.join(__dirname, 'web/public', 'pair.html')));

// ============ LOGIN API ============
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === config.DASHBOARD_USERNAME && password === config.DASHBOARD_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// ============ SESSION APIS ============
app.get('/api/sessions', async (req, res) => {
    try {
        const sessions = await getAllActiveSessions();
        res.json({ success: true, sessions: sessions || [] });
    } catch (e) {
        res.json({ success: true, sessions: [] });
    }
});

app.get('/api/session/:number', async (req, res) => {
    try {
        const { number } = req.params;
        const creds = await loadCredsFromDB(number);
        res.json({ success: true, creds: creds || null });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.delete('/api/session/:number', async (req, res) => {
    try {
        const { number } = req.params;
        const cleanNumber = number.replace(/[^0-9]/g, '');

        if (activeSockets.has(cleanNumber)) {
            const sock = activeSockets.get(cleanNumber);
            sock.end(new Error('Session deleted'));
            activeSockets.delete(cleanNumber);
            reconnectAttempts.delete(cleanNumber);
        }
        await removeSession(cleanNumber);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// ============ PAIR WITH CODE ============
app.post('/api/pair/code', async (req, res) => {
    const { number } = req.body;

    if (!number) {
        return res.status(400).json({ error: 'Phone number is required' });
    }

    let cleanNumber = number.toString().replace(/[^0-9]/g, '');
    if (cleanNumber.length < 10) {
        return res.status(400).json({ error: 'Invalid phone number' });
    }

    if (cleanNumber.startsWith('0')) {
        cleanNumber = '94' + cleanNumber.substring(1);
    }
    if (!cleanNumber.startsWith('94') && cleanNumber.length === 9) {
        cleanNumber = '94' + cleanNumber;
    }

    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const sessionPath = path.join(SESSION_BASE_PATH, `pair_${sessionId}`);

    let pairingCodeSent = false;
    let sessionCompleted = false;
    let responseSent = false;
    let reconnectAttemptsCount = 0;
    let currentSocket = null;
    let timeoutHandle = null;
    let isCleaningUp = false;

    async function cleanup(reason = 'unknown') {
        if (isCleaningUp) return;
        isCleaningUp = true;
        console.log(`🧹 Cleanup pair session ${sessionId} - ${reason}`);

        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
        }

        if (currentSocket) {
            try {
                currentSocket.ev.removeAllListeners();
                await currentSocket.end();
            } catch (e) {}
            currentSocket = null;
        }

        setTimeout(async () => {
            try {
                await fs.remove(sessionPath);
            } catch (e) {}
        }, 5000);
    }

    async function initiateSession() {
        if (sessionCompleted || isCleaningUp) return;

        if (reconnectAttemptsCount >= 3) {
            if (!responseSent &&!res.headersSent) {
                responseSent = true;
                res.status(503).json({ error: 'Connection failed after multiple attempts' });
            }
            await cleanup('max_reconnects');
            return;
        }

        try {
            await fs.ensureDir(sessionPath);

            const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
            const { version } = await fetchLatestBaileysVersion();

            if (currentSocket) {
                try {
                    currentSocket.ev.removeAllListeners();
                    await currentSocket.end();
                } catch (e) {}
            }

            const sock = makeWASocket({
                version,
                auth: state,
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.ubuntu('Chrome'),
                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 3,
            });

            currentSocket = sock;

            sock.ev.on('connection.update', async (update) => {
                if (isCleaningUp) return;
                const { connection, lastDisconnect, isNewLogin } = update;

                if (connection === 'open') {
                    if (sessionCompleted) return;
                    sessionCompleted = true;
                    console.log(`✅ Pairing successful for ${cleanNumber}`);

                    try {
                        await saveCreds();
                        const creds = await fs.readJson(path.join(sessionPath, 'creds.json'));

                        const permPath = path.join(SESSION_BASE_PATH, `session_${cleanNumber}`);
                        await fs.copy(sessionPath, permPath);
                        await saveCredsToDB(cleanNumber, creds, true);

                        await startBot(cleanNumber, creds);
                        console.log(`✅ Bot auto-started: ${cleanNumber}`);
                    } catch (err) {
                        console.error('Error saving session:', err);
                    } finally {
                        await cleanup('session_complete');
                    }
                }

                if (isNewLogin) {
                    console.log(`🔐 New login via pair code for ${cleanNumber}`);
                }

                if (connection === 'close') {
                    if (sessionCompleted || isCleaningUp) {
                        await cleanup('already_complete');
                        return;
                    }

                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                        if (!responseSent &&!res.headersSent) {
                            responseSent = true;
                            res.status(401).json({ error: 'Invalid pairing code or session expired' });
                        }
                        await cleanup('logged_out');
                    } else if (pairingCodeSent &&!sessionCompleted) {
                        reconnectAttemptsCount++;
                        console.log(`🔄 Reconnect attempt ${reconnectAttemptsCount}/3`);
                        await delay(2000);
                        await initiateSession();
                    } else {
                        await cleanup('connection_closed');
                    }
                }
            });

            if (!sock.authState.creds.registered &&!pairingCodeSent &&!isCleaningUp) {
                await delay(1500);
                try {
                    pairingCodeSent = true;
                    let code = await sock.requestPairingCode(cleanNumber);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;

                    if (!responseSent &&!res.headersSent) {
                        responseSent = true;
                        res.json({
                            status: 'success',
                            code: code,
                            message: 'Use this 8-digit code in WhatsApp Linked Devices'
                        });
                        console.log(`📱 Pairing code sent for ${cleanNumber}: ${code}`);
                    }
                } catch (error) {
                    console.error('Error requesting pairing code:', error);
                    pairingCodeSent = false;
                    if (!responseSent &&!res.headersSent) {
                        responseSent = true;
                        res.status(503).json({ error: 'Failed to get pairing code: ' + error.message });
                    }
                    await cleanup('pairing_code_error');
                }
            }

            sock.ev.on('creds.update', saveCreds);

            timeoutHandle = setTimeout(async () => {
                if (!sessionCompleted &&!isCleaningUp) {
                    console.log('⏰ Pairing timeout');
                    if (!responseSent &&!res.headersSent) {
                        responseSent = true;
                        res.status(408).json({ error: 'Pairing timeout - Please try again' });
                    }
                    await cleanup('timeout');
                }
            }, 60000);

        } catch (err) {
            console.error(`❌ Error initializing session for ${cleanNumber}:`, err);
            if (!responseSent &&!res.headersSent) {
                responseSent = true;
                res.status(503).json({ error: 'Service Unavailable: ' + err.message });
            }
            await cleanup('init_error');
        }
    }

    await initiateSession();
});

// ============ GENERATE QR ============
app.get('/api/generate-qr', async (req, res) => {
    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 9);
    const sessionPath = path.join(SESSION_BASE_PATH, `qr_${sessionId}`);

    await fs.ensureDir(sessionPath);

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: 'fatal' });

    let qrSent = false;
    let responded = false;

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: false
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;

        if (qr &&!qrSent &&!responded) {
            qrSent = true;
            responded = true;
            const qrBase64 = await QRCode.toDataURL(qr);
            res.json({ qr: qrBase64, status: 'qr' });

            setTimeout(() => {
                sock.end(new Error('Timeout'));
                fs.remove(sessionPath);
            }, 120000);
        }

        if (connection === 'open') {
            await saveCreds();
            const creds = await fs.readJson(path.join(sessionPath, 'creds.json'));
            const botNumber = sock.user.id.split(':')[0];

            const permPath = path.join(SESSION_BASE_PATH, `session_${botNumber}`);
            await fs.copy(sessionPath, permPath);
            await fs.remove(sessionPath);
            await saveCredsToDB(botNumber, creds, true);
            await startBot(botNumber, creds);

            console.log(`✅ Bot connected via QR: ${botNumber}`);
        }
    });

    setTimeout(() => {
        if (!qrSent &&!responded) {
            res.status(504).json({ error: 'Timeout' });
            sock.end(new Error('Timeout'));
        }
    }, 60000);
});

app.get('/api/qr-status', (req, res) => {
    res.json({ connected: false });
});

// ============ AUTO RECONNECT ============
async function autoReconnect() {
    try {
        await initDatabase();
        const sessions = await getAllActiveSessions();
        console.log(`🔄 Found ${sessions.length} sessions to reconnect`);
        for (const session of sessions) {
            if (session.active) {
                console.log(`🔄 Reconnecting ${session.number}...`);
                await startBot(session.number);
                await sleep(2000);
            }
        }
    } catch (error) {
        console.error('Auto reconnect error:', error);
    }
}

// ============ MAIN FUNCTION ============
async function main() {
    await initDatabase();

    app.listen(PORT, () => {
        console.log(`🌐 Server running on http://localhost:${PORT}`);
        console.log(`🔗 Open: https://dinu-f6a134d4af89.herokuapp.com`);
    });

    await autoReconnect();

    console.log(`
╔═══════════════════════════════════════╗
║ ${config.BOT_NAME} - WhatsApp Bot ║
║ Version: ${config.BOT_VERSION} ║
║ Status: 🟢 Running ║
║ Port: ${PORT} ║
╚═══════════════════════════════════════╝
    `);
}

process.on('SIGINT', async () => {
    console.log('Shutting down...');
    for (const [number, sock] of activeSockets) {
        try { sock.end(new Error('Shutdown')); } catch (e) {}
    }
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});

main();

module.exports = { startBot, activeSockets };
