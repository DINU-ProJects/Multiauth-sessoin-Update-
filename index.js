// index.js - උඩින්ම, baileys import කරන්න කලින්
const { File } = require('node:buffer');
if (typeof globalThis.File === 'undefined') {
  globalThis.File = File;
}

//const express = require('express');
// ...rest of code
// index.js - Fixed Complete Version
const botJid = sock.user.id;
await sock.sendMessage(botJid, { text: 'Connected!' });

const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const {
    makeWASocket,
    useMultiFileAuthState,
    Browsers,
    DisconnectReason,
    fetchLatestBaileysVersion, // FIX: Added this
    makeCacheableSignalKeyStore // FIX: Added this
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode'); // FIX: Changed from qrcode to QRCode
const config = require('./config');
const { initDatabase, getSettings } = require('./lib/database');
const { saveCredsToDB, loadCredsFromDB, SESSION_BASE_PATH, updateSessionActive, removeSession, getAllActiveSessions } = require('./lib/credsManager');
const { getTimestamp, sleep, formatJid, runtime } = require('./lib/functions');
const { handleIncomingMessage, handleMessageRevocation } = require('./lib/antiDelete');
const { getCommand } = require('./plugins/command');

// Load plugins
require('./plugins/main');
require('./plugins/download');

const app = express();
const PORT = process.env.PORT || 10000;

// Active sockets storage
const activeSockets = new Map();
const socketStartTimes = new Map();
let botNumber = null;
global.pairingRequests = new Map();

// Helper function
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============ START BOT FUNCTION ============
async function startBot(number, credsData = null) {
    const cleanNumber = number ? number.replace(/[^0-9]/g, '') : null;
    
    // FIX: Already running නම් ආපහු start කරන්න එපා
    if (cleanNumber && activeSockets.has(cleanNumber)) {
        console.log(`⚠️ Bot already running for ${cleanNumber}`);
        return activeSockets.get(cleanNumber);
    }
    
    
    const sessionPath = path.join(SESSION_BASE_PATH, cleanNumber? `session_${cleanNumber}` : 'session_default');

    await fs.ensureDir(sessionPath);

    let creds = credsData;
    if (cleanNumber &&!creds) {
        creds = await loadCredsFromDB(cleanNumber);
    }

    if (creds) {
        await fs.writeFile(path.join(sessionPath, 'creds.json'), JSON.stringify(creds, null, 2));
        console.log(`📁 Loaded existing session for ${cleanNumber || 'default'}`);
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: 'fatal' });

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: Browsers.macOS('Safari'),
        getMessage: async (key) => {
            return { conversation: "Hello" };
        }
    });

    if (cleanNumber) {
        activeSockets.set(cleanNumber, sock);
    }
    socketStartTimes.set(cleanNumber || 'default', Date.now());

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

       
       /* if (connection === 'open') {
    console.log(`✅ Bot connected successfully!`);
    botNumber = sock.user.id.split(':')[0];
    console.log(`📱 Bot Number: ${botNumber}`);

    await saveCreds();
    const savedCreds = await fs.readJson(path.join(sessionPath, 'creds.json'));

    if (cleanNumber) {
        await saveCredsToDB(cleanNumber, savedCreds, true);
        await updateSessionActive(cleanNumber, true);
    }

    // ✅ ADD THIS: Send success message to bot's own number
    try {
        const botJid = sock.user.id; // botගේ JID එක: 94778321651@s.whatsapp.net
        await sock.sendMessage(botJid, {
            text: `╭───❍ 《 ${config.BOT_NAME} 》
│ ✅ Successfully Connected!
│ 🤖 Number: ${botNumber}
│ ⏱️ Time: ${getTimestamp()}
│ 🟢 Status: Online & Ready
╰───❍

Type ${config.PREFIX}menu to see commands.`
        });
        console.log(`✅ Success message sent to ${botNumber}`);
    } catch (e) {
        console.log('Could not send startup message to self:', e.message);
    }

    // Ownerට යවන එක තියෙනවා නම් ඒකත් තියන්න
    const ownerJid = formatJid(config.OWNER_NUMBER);
    try {
        await sock.sendMessage(ownerJid, {
            text: `╭───❍ 《 ${config.BOT_NAME} ONLINE 》
│ 🤖 Status: Connected
│ 📱 Number: ${botNumber}
│ ⏱️ Time: ${getTimestamp()}
╰───❍`
        });
    } catch (e) {
        console.log('Could not send startup message to owner');
    }
}*/
        
        
         
           if (connection === 'open') {
            console.log(`✅ Bot connected successfully!`);
            botNumber = sock.user.id.split(':')[0];
            console.log(`📱 Bot Number: ${botNumber}`);

            await saveCreds();
            const savedCreds = await fs.readJson(path.join(sessionPath, 'creds.json'));

            if (cleanNumber) {
                await saveCredsToDB(cleanNumber, savedCreds, true);
                await updateSessionActive(cleanNumber, true);
            }

            const ownerJid = formatJid(config.OWNER_NUMBER);
            try {
                await sock.sendMessage(ownerJid, {
                    text: `╭───❍ 《 ${config.BOT_NAME} ONLINE 》
│ 🤖 Status: Connected
│ 📱 Number: ${botNumber}
│ ⏱️ Time: ${getTimestamp()}
╰───❍`
                });
            } catch (e) {
                console.log('Could not send startup message to owner');
            }
        }

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            console.log(`Connection closed with code: ${statusCode}`);

            if (statusCode!== DisconnectReason.loggedOut) {
                console.log('Reconnecting...');
                setTimeout(() => {
                    startBot(cleanNumber);
                }, 5000);
            } else {
                console.log('Logged out, cleaning up session');
                if (cleanNumber) {
                    await updateSessionActive(cleanNumber, false);
                    activeSockets.delete(cleanNumber);
                }
            }
        }
    });

    sock.ev.on('creds.update', async () => {
        await saveCreds();
        const updatedCreds = await fs.readJson(path.join(sessionPath, 'creds.json'));
        if (cleanNumber) {
            await saveCredsToDB(cleanNumber, updatedCreds, true);
        }
        console.log('📝 Credentials updated and saved');
    });

    // Handle incoming messages
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const from = msg.key.remoteJid;
        const isGroup = from.includes('@g.us');
        const senderNumber = (msg.key.participant || from).split('@')[0];

        let userSettings = config;
        if (cleanNumber) {
            userSettings = await getSettings(cleanNumber);
        }

        if (userSettings.antiDelete || config.ANTI_DELETE) {
            await handleIncomingMessage(sock, msg, from, botNumber);
        }

        if (msg.message?.protocolMessage) {
            const protocolMsg = msg.message.protocolMessage;
            if (protocolMsg.type === 0) {
                if (userSettings.antiDelete || config.ANTI_DELETE) {
                    await handleMessageRevocation(sock, protocolMsg, from, botNumber);
                }
            }
            return;
        }

        let messageText = '';
        if (msg.message.conversation) messageText = msg.message.conversation;
        else if (msg.message.extendedTextMessage?.text) messageText = msg.message.extendedTextMessage.text;
        else if (msg.message.imageMessage?.caption) messageText = msg.message.imageMessage.caption;
        else if (msg.message.videoMessage?.caption) messageText = msg.message.videoMessage.caption;

        if (!messageText) return;

        const prefix = userSettings.prefix || config.PREFIX;
        if (!messageText.startsWith(prefix)) return;

        const args = messageText.slice(prefix.length).trim().split(/\s+/);
        const commandName = args[0].toLowerCase();
        const commandArgs = args.slice(1);
        let pushname = msg.pushName || 'User';
        const command = getCommand(commandName);

        if (command) {
            console.log(`📝 Command: ${commandName} from ${senderNumber}`);
            if (command.react) {
                await sock.sendMessage(from, { react: { text: command.react, key: msg.key } });
            }
            try {
                await command.execute(sock, msg, from, commandArgs, pushname, isGroup, botNumber,
                    async (text) => await sock.sendMessage(from, { text }, { quoted: msg }));
            } catch (err) {
                console.error(`Error:`, err);
                await sock.sendMessage(from, { text: `❌ Error: ${err.message}` }, { quoted: msg });
            }
        }
    });

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
    res.json({ status: 'ok', uptime: runtime(process.uptime()), activeSessions: activeSockets.size, botNumber: botNumber });
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
    let reconnectAttempts = 0;
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

        if (reconnectAttempts >= 3) {
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
            const { version } = await fetchLatestBaileysVersion(); // FIX: Now imported

            if (currentSocket) {
                try {
                    currentSocket.ev.removeAllListeners();
                    await currentSocket.end();
                } catch (e) {}
            }

            const sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" }))
                },
                printQRInTerminal: false,
                logger: pino({ level: "silent" }),
                browser: Browsers.macOS('Chrome'),
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
                       // await startBot(cleanNumber, creds);

                        console.log(`✅ Bot connected: ${cleanNumber}`);
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
                        reconnectAttempts++;
                        console.log(`🔄 Reconnect attempt ${reconnectAttempts}/3`);
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
        browser: Browsers.macOS('Chrome'),
        markOnlineOnConnect: false
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;

        if (qr &&!qrSent &&!responded) {
            qrSent = true;
            responded = true;
            const qrBase64 = await QRCode.toDataURL(qr); // FIX: QRCode now imported
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
    res.json({ connected: false }); // qrConnected variable එක define වෙලා නෑ, ඒ නිසා false දානවා
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

process.on('SIGINT', asy-nc () => {
    console.log('Shutting down...');
    for (const [number, sock] of activeSockets) {
        try { sock.end(new Error('Shutdown')); } catch (e) {}
    }
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

main();

module.exports = { startBot, activeSockets };
