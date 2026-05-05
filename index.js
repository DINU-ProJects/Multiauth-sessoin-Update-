// index.js - Complete Working Version
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { makeWASocket, useMultiFileAuthState, Browsers, DisconnectReason } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
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

// ============ START BOT FUNCTION ============
async function startBot(number, credsData = null) {
    const cleanNumber = number ? number.replace(/[^0-9]/g, '') : null;
    const sessionPath = path.join(SESSION_BASE_PATH, cleanNumber ? `session_${cleanNumber}` : 'session_default');
    
    await fs.ensureDir(sessionPath);
    
    let creds = credsData;
    if (cleanNumber && !creds) {
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
            
            if (statusCode !== DisconnectReason.loggedOut) {
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

// ============ SERVE STATIC FILES ============
app.use(express.static(path.join(__dirname, 'web/public')));

// ============ HEALTH CHECK ============
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: runtime(process.uptime()), activeSessions: activeSockets.size, botNumber: botNumber });
});

// ============ ROOT ROUTE ============
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'web/public', 'index.html'));
});

// ============ LOGIN PAGE ============
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'web/public', 'login.html'));
});

// ============ DASHBOARD PAGE ============
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'web/public', 'dashboard.html'));
});

// ============ QR PAGE (NO NUMBER NEEDED) ============
app.get('/qr', (req, res) => {
    res.sendFile(path.join(__dirname, 'web/public', 'qr.html'));
});

// ============ PAIR PAGE ============
app.get('/pair', (req, res) => {
    res.sendFile(path.join(__dirname, 'web/public', 'pair.html'));
});

// ============ LOGIN API ============
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === config.DASHBOARD_USERNAME && password === config.DASHBOARD_PASSWORD) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// ============ GET ALL SESSIONS ============
app.get('/api/sessions', async (req, res) => {
    try {
        const sessions = await getAllActiveSessions();
        res.json({ success: true, sessions: sessions || [] });
    } catch (e) {
        res.json({ success: true, sessions: [] });
    }
});

// ============ GET SINGLE SESSION ============
app.get('/api/session/:number', async (req, res) => {
    try {
        const { number } = req.params;
        const creds = await loadCredsFromDB(number);
        res.json({ success: true, creds: creds || null });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// ============ DELETE SESSION ============
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

// ============ PAIR WITH CODE (8-DIGIT) ============
app.post('/api/pair/code', async (req, res) => {
    const { number } = req.body;
    if (!number) return res.status(400).json({ error: 'Number required' });
    
    const cleanNumber = number.replace(/[^0-9]/g, '');
    const existing = activeSockets.has(cleanNumber);
    if (existing) return res.json({ status: 'already_paired', message: 'Already connected' });
    
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${cleanNumber}`);
    await fs.ensureDir(sessionPath);
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: 'fatal' });
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: Browsers.macOS('Safari')
    });
    
    let responded = false;
    
    sock.ev.on('connection.update', async (update) => {
        const { connection } = update;
        if (connection === 'open' && !responded) {
            responded = true;
            await saveCreds();
            const creds = await fs.readJson(path.join(sessionPath, 'creds.json'));
            await saveCredsToDB(cleanNumber, creds, true);
            await startBot(cleanNumber, creds);
        }
    });
    
    setTimeout(async () => {
        try {
            const code = await sock.requestPairingCode(cleanNumber);
            if (!responded) {
                responded = true;
                res.json({ code: code, status: 'success' });
            }
        } catch (error) {
            if (!responded) {
                responded = true;
                res.status(500).json({ error: error.message });
            }
        }
        setTimeout(() => { if (!responded) sock.end(new Error('Timeout')); }, 60000);
    }, 2000);
});

// ============ GENERATE QR (NO NUMBER NEEDED) ============
let currentQRSock = null;
let qrConnected = false;

app.get('/api/generate-qr', async (req, res) => {
    const sessionPath = path.join(SESSION_BASE_PATH, `qr_${Date.now()}`);
    await fs.ensureDir(sessionPath);
    
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const logger = pino({ level: 'fatal' });
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: Browsers.macOS('Safari')
    });
    
    currentQRSock = sock;
    qrConnected = false;
    
    sock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;
        
        if (qr) {
            const qrBase64 = await qrcode.toDataURL(qr);
            if (!res.headersSent) {
                res.json({ qr: qrBase64, status: 'qr' });
            }
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
            qrConnected = true;
        }
    });
    
    setTimeout(() => {
        if (!qrConnected && !res.headersSent) {
            res.status(504).json({ error: 'Timeout' });
        }
    }, 60000);
});

app.get('/api/qr-status', (req, res) => {
    res.json({ connected: qrConnected });
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
║     ${config.BOT_NAME} - WhatsApp Bot       ║
║     Version: ${config.BOT_VERSION}                    ║
║     Status: 🟢 Running                  ║
║     Port: ${PORT}                        ║
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

main();

module.exports = { startBot, activeSockets };
