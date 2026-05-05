// index.js
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { makeWASocket, useMultiFileAuthState, Browsers, DisconnectReason, jidNormalizedUser, delay } = require('@whiskeysockets/baileys');
const pino = require('pino');
const config = require('./config');
const { initDatabase, getSettings, getAdmins, updateSettings } = require('./lib/database');
const { saveCredsToDB, loadCredsFromDB, SESSION_BASE_PATH, updateSessionActive } = require('./lib/credsManager');
const { getTimestamp, sleep, formatJid, runtime } = require('./lib/functions');
const { handleIncomingMessage, handleMessageRevocation } = require('./lib/antiDelete');
const { getCommand, getAllCommands, getAllCategories } = require('./plugins/command');

// Load plugins
require('./plugins/main');
require('./plugins/download');

const app = express();
const PORT = process.env.PORT || 8080;

// Active sockets storage
const activeSockets = new Map();
const socketStartTimes = new Map();

// Bot instance
let currentBot = null;
let botNumber = null;

async function startBot(number, credsData = null) {
    const cleanNumber = number ? number.replace(/[^0-9]/g, '') : null;
    const sessionPath = path.join(SESSION_BASE_PATH, cleanNumber ? `session_${cleanNumber}` : 'session_default');
    
    // Ensure session directory exists
    await fs.ensureDir(sessionPath);
    
    // Load or use provided creds
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
    
    // Store socket
    if (cleanNumber) {
        activeSockets.set(cleanNumber, sock);
    }
    currentBot = sock;
    socketStartTimes.set(cleanNumber || 'default', Date.now());
    
    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('QR Code received (you can display this in web dashboard)');
            // Emit QR for web dashboard if needed
            if (global.io) {
                global.io.emit('qr', qr);
            }
        }
        
        if (connection === 'open') {
            console.log(`✅ Bot connected successfully!`);
            botNumber = sock.user.id.split(':')[0];
            console.log(`📱 Bot Number: ${botNumber}`);
            
            // Save credentials
            await saveCreds();
            const savedCreds = await fs.readJson(path.join(sessionPath, 'creds.json'));
            
            if (cleanNumber) {
                await saveCredsToDB(cleanNumber, savedCreds, true);
                await updateSessionActive(cleanNumber, true);
            }
            
            // Send startup message to owner
            const ownerJid = formatJid(config.OWNER_NUMBER);
            try {
                await sock.sendMessage(ownerJid, {
                    text: `╭───❍ 《 ${config.BOT_NAME} ONLINE 》
│ 🤖 *Status:* Connected
│ 📱 *Number:* ${botNumber}
│ ⏱️ *Time:* ${getTimestamp()}
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
    
    // Handle credentials update
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
        const sender = msg.key.participant || from;
        const senderNumber = sender.split('@')[0];
        
        // Get user settings
        let userSettings = config;
        if (cleanNumber) {
            userSettings = await getSettings(cleanNumber);
        }
        
        // Handle anti-delete - save incoming messages
        if (userSettings.antiDelete || config.ANTI_DELETE) {
            await handleIncomingMessage(sock, msg, from, botNumber);
        }
        
        // Handle protocol messages (message revocations)
        if (msg.message?.protocolMessage) {
            const protocolMsg = msg.message.protocolMessage;
            if (protocolMsg.type === 0) { // REVOKE
                if (userSettings.antiDelete || config.ANTI_DELETE) {
                    await handleMessageRevocation(sock, protocolMsg, from, botNumber);
                }
            }
            return;
        }
        
        // Extract message text
        let messageText = '';
        if (msg.message.conversation) {
            messageText = msg.message.conversation;
        } else if (msg.message.extendedTextMessage?.text) {
            messageText = msg.message.extendedTextMessage.text;
        } else if (msg.message.imageMessage?.caption) {
            messageText = msg.message.imageMessage.caption;
        } else if (msg.message.videoMessage?.caption) {
            messageText = msg.message.videoMessage.caption;
        }
        
        if (!messageText) return;
        
        // Get prefix from settings or config
        const prefix = userSettings.prefix || config.PREFIX;
        
        if (!messageText.startsWith(prefix)) return;
        
        // Parse command
        const args = messageText.slice(prefix.length).trim().split(/\s+/);
        const commandName = args[0].toLowerCase();
        const commandArgs = args.slice(1);
        
        // Get pushname
        let pushname = msg.pushName || 'User';
        
        // Get command
        const command = getCommand(commandName);
        
        if (command) {
            console.log(`📝 Command: ${commandName} from ${senderNumber}`);
            
            // React to command
            if (command.react) {
                await sock.sendMessage(from, { react: { text: command.react, key: msg.key } });
            }
            
            // Execute command
            try {
                await command.execute(
                    sock, 
                    msg, 
                    from, 
                    commandArgs, 
                    pushname, 
                    isGroup, 
                    botNumber,
                    async (text) => {
                        return await sock.sendMessage(from, { text }, { quoted: msg });
                    }
                );
            } catch (err) {
                console.error(`Error executing command ${commandName}:`, err);
                await sock.sendMessage(from, { 
                    text: `❌ Error: ${err.message}` 
                }, { quoted: msg });
            }
        }
    });
    
    // Handle group participants update
    sock.ev.on('group-participants.update', async (update) => {
        const { id, participants, action } = update;
        
        if (action === 'add') {
            for (const participant of participants) {
                if (participant === sock.user.id) {
                    // Bot was added to group
                    console.log(`🤖 Bot added to group: ${id}`);
                    await sock.sendMessage(id, {
                        text: `╭───❍ 《 ${config.BOT_NAME} 》
│ 🤖 Thanks for adding me!
│ 📌 *Prefix:* ${config.PREFIX}
│ 📋 *Menu:* ${config.PREFIX}menu
╰───❍`
                    });
                }
            }
        }
    });
    
    return sock;
}

// Initialize web dashboard
async function initWebDashboard() {
    const webServer = require('./web/server');
    return webServer;
}

// Auto reconnect on startup
async function autoReconnect() {
    try {
        await initDatabase();
        const { getAllActiveSessions } = require('./lib/credsManager');
        const sessions = await getAllActiveSessions();
        
        console.log(`🔄 Found ${sessions.length} sessions to reconnect`);
        
        for (const session of sessions) {
            if (session.active) {
                console.log(`🔄 Reconnecting ${session.number}...`);
                await startBot(session.number);
                await sleep(2000);
            }
        }
        
        // If no sessions, start bot with default number for pairing
        if (sessions.length === 0 && config.OWNER_NUMBER) {
            console.log('📱 No sessions found. Bot will wait for pairing via web dashboard.');
        }
        
    } catch (error) {
        console.error('Auto reconnect error:', error);
    }
}

// Express routes for pairing
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: runtime(process.uptime()),
        activeSessions: activeSockets.size,
        botNumber: botNumber
    });
});

// Pair with QR
app.post('/pair/qr', async (req, res) => {
    const { number } = req.body;
    
    if (!number) {
        return res.status(400).json({ error: 'Number is required' });
    }
    
    const cleanNumber = number.replace(/[^0-9]/g, '');
    
    // Check if session already exists
    const existing = activeSockets.has(cleanNumber);
    if (existing) {
        return res.json({ status: 'already_paired', message: 'Session already active' });
    }
    
    // Start pairing process
    let qrSent = false;
    let timeoutId;
    
    const tempSessionPath = path.join(SESSION_BASE_PATH, `temp_${cleanNumber}`);
    await fs.ensureDir(tempSessionPath);
    
    const { state, saveCreds } = await useMultiFileAuthState(tempSessionPath);
    const logger = pino({ level: 'fatal' });
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger,
        browser: Browsers.macOS('Safari')
    });
    
    sock.ev.on('connection.update', async (update) => {
        const { connection, qr } = update;
        
        if (qr && !qrSent) {
            qrSent = true;
            const qrcode = require('qrcode');
            const qrBase64 = await qrcode.toDataURL(qr);
            
            res.json({
                status: 'qr',
                qr: qrBase64,
                message: 'Scan QR code with WhatsApp'
            });
            
            timeoutId = setTimeout(() => {
                sock.end(new Error('Timeout'));
                fs.removeSync(tempSessionPath);
            }, 120000);
        }
        
        if (connection === 'open') {
            clearTimeout(timeoutId);
            await saveCreds();
            const creds = await fs.readJson(path.join(tempSessionPath, 'creds.json'));
            
            // Save to permanent location
            const permPath = path.join(SESSION_BASE_PATH, `session_${cleanNumber}`);
            await fs.copy(tempSessionPath, permPath);
            await fs.remove(tempSessionPath);
            
            await saveCredsToDB(cleanNumber, creds, true);
            await startBot(cleanNumber, creds);
            
            res.json({
                status: 'success',
                message: 'Successfully paired!',
                number: cleanNumber
            });
        }
    });
});

// Pair with code (8-digit code)
app.post('/pair/code', async (req, res) => {
    const { number } = req.body;
    
    if (!number) {
        return res.status(400).json({ error: 'Number is required' });
    }
    
    const cleanNumber = number.replace(/[^0-9]/g, '');
    
    // Check if session already exists
    const existing = activeSockets.has(cleanNumber);
    if (existing) {
        return res.json({ status: 'already_paired', message: 'Session already active' });
    }
    
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
    
    let pairingCode = null;
    
    sock.ev.on('connection.update', async (update) => {
        const { connection } = update;
        
        if (connection === 'open') {
            await saveCreds();
            const creds = await fs.readJson(path.join(sessionPath, 'creds.json'));
            await saveCredsToDB(cleanNumber, creds, true);
            await startBot(cleanNumber, creds);
            
            res.json({
                status: 'success',
                message: 'Successfully paired!',
                number: cleanNumber
            });
        }
    });
    
    // Request pairing code
    setTimeout(async () => {
        try {
            pairingCode = await sock.requestPairingCode(cleanNumber);
            res.json({
                status: 'code',
                code: pairingCode,
                message: 'Use this code in WhatsApp Linked Devices'
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
        
        setTimeout(() => {
            if (!pairingCode) {
                sock.end(new Error('Timeout'));
            }
        }, 60000);
    }, 2000);
});

// Get active sessions
app.get('/sessions', async (req, res) => {
    const { getAllActiveSessions } = require('./lib/credsManager');
    const sessions = await getAllActiveSessions();
    res.json({
        sessions: sessions.map(s => ({
            number: s.number,
            active: s.active,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt
        }))
    });
});

// Delete session
app.delete('/session/:number', async (req, res) => {
    const { number } = req.params;
    const cleanNumber = number.replace(/[^0-9]/g, '');
    
    // Close socket if active
    if (activeSockets.has(cleanNumber)) {
        const sock = activeSockets.get(cleanNumber);
        sock.end(new Error('Session deleted'));
        activeSockets.delete(cleanNumber);
        socketStartTimes.delete(cleanNumber);
    }
    
    // Remove from database
    const { removeSession } = require('./lib/credsManager');
    await removeSession(cleanNumber);
    
    res.json({ success: true, message: 'Session deleted' });
});

// Start the server
async function main() {
    // Initialize database
    await initDatabase();
    
    // Start web dashboard
    await initWebDashboard();
    
    // Start express server
    app.listen(PORT, () => {
        console.log(`🌐 Web server running on http://localhost:${PORT}`);
        console.log(`🔐 Login: ${config.DASHBOARD_USERNAME} / ${config.DASHBOARD_PASSWORD}`);
    });
    
    // Auto reconnect existing sessions
    await autoReconnect();
    
    console.log(`
╔═══════════════════════════════════════╗
║     ${config.BOT_NAME} - WhatsApp Bot       ║
║     Version: ${config.BOT_VERSION}                    ║
║     Status: 🟢 Running                  ║
╚═══════════════════════════════════════╝
    `);
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down...');
    for (const [number, sock] of activeSockets) {
        try {
            sock.end(new Error('Shutdown'));
        } catch (e) {}
    }
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

main();

module.exports = { startBot, activeSockets };
