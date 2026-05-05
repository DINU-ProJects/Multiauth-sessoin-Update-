// web/server.js
const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const fs = require('fs-extra');
const qrcode = require('qrcode');
const { makeWASocket, useMultiFileAuthState, Browsers, DisconnectReason } = require('@whiskeysockets/baileys');
const { initDatabase, saveSession, getSession, getAllSessions, deleteSession, addAdmin, removeAdmin, getAdmins } = require('../lib/database');
const { removeSession, SESSION_BASE_PATH } = require('../lib/credsManager');
const config = require('../config');

const app = express();
const PORT = config.WEB_PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session.authenticated) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Routes
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (username === config.DASHBOARD_USERNAME && password === config.DASHBOARD_PASSWORD) {
        req.session.authenticated = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// API Routes
app.get('/api/sessions', requireAuth, async (req, res) => {
    try {
        const sessions = await getAllSessions();
        res.json({ success: true, sessions });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/session/:number', requireAuth, async (req, res) => {
    try {
        const { number } = req.params;
        const creds = await getSession(number);
        
        if (creds) {
            res.json({ success: true, creds });
        } else {
            res.status(404).json({ success: false, message: 'Session not found' });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/session/:number', requireAuth, async (req, res) => {
    try {
        const { number } = req.params;
        await removeSession(number);
        res.json({ success: true, message: 'Session deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/session/pair', requireAuth, async (req, res) => {
    try {
        const { number } = req.body;
        
        if (!number) {
            return res.status(400).json({ success: false, message: 'Number is required' });
        }
        
        const cleanNumber = number.replace(/[^0-9]/g, '');
        
        // Check if session already exists
        const existing = await getSession(cleanNumber);
        if (existing) {
            return res.json({ success: false, message: 'Session already exists for this number' });
        }
        
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${cleanNumber}`);
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.macOS('Safari'),
            logger: require('pino')({ level: 'fatal' })
        });
        
        let pairCode = null;
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                // Generate QR code
                const qrBuffer = await qrcode.toBuffer(qr);
                sock.qr = `data:image/png;base64,${qrBuffer.toString('base64')}`;
            }
            
            if (connection === 'open') {
                await saveCreds();
                const creds = require('fs-extra').readJSONSync(path.join(sessionPath, 'creds.json'));
                await saveSession(cleanNumber, creds, true);
                sock.end(new Error('Session created'));
            }
            
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                if (statusCode !== DisconnectReason.loggedOut) {
                    // Connection closed
                }
            }
        });
        
        // Request pairing code
        setTimeout(async () => {
            try {
                pairCode = await sock.requestPairingCode(cleanNumber);
                
                res.json({
                    success: true,
                    message: 'Pairing initiated',
                    code: pairCode,
                    qr: sock.qr || null
                });
            } catch (error) {
                res.status(500).json({ success: false, error: error.message });
            }
            
            setTimeout(() => {
                sock.end(new Error('Timeout'));
            }, 60000);
        }, 2000);
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/session/qr', requireAuth, async (req, res) => {
    try {
        const sessionPath = path.join(SESSION_BASE_PATH, `temp_qr`);
        
        if (fs.existsSync(sessionPath)) {
            await fs.remove(sessionPath);
        }
        
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.macOS('Safari'),
            logger: require('pino')({ level: 'fatal' })
        });
        
        let qrSent = false;
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr && !qrSent) {
                qrSent = true;
                const qrBuffer = await qrcode.toBuffer(qr);
                const qrBase64 = `data:image/png;base64,${qrBuffer.toString('base64')}`;
                res.json({ success: true, qr: qrBase64 });
                
                setTimeout(() => {
                    sock.end(new Error('Timeout'));
                    fs.removeSync(sessionPath);
                }, 120000);
            }
            
            if (connection === 'open') {
                await saveCreds();
                const creds = fs.readJSONSync(path.join(sessionPath, 'creds.json'));
                // Need to get number from socket
                const number = sock.user.id.split(':')[0];
                await saveSession(number, creds, true);
                
                // Create permanent session folder
                const permPath = path.join(SESSION_BASE_PATH, `session_${number}`);
                await fs.copy(sessionPath, permPath);
                await fs.remove(sessionPath);
            }
        });
        
        // Timeout for QR generation
        setTimeout(() => {
            if (!qrSent) {
                res.status(500).json({ success: false, error: 'QR generation timeout' });
                sock.end(new Error('Timeout'));
            }
        }, 30000);
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admins', requireAuth, async (req, res) => {
    try {
        const admins = await getAdmins();
        res.json({ success: true, admins });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin', requireAuth, async (req, res) => {
    try {
        const { number } = req.body;
        
        if (!number) {
            return res.status(400).json({ success: false, message: 'Number is required' });
        }
        
        const cleanNumber = number.replace(/[^0-9]/g, '');
        await addAdmin(cleanNumber);
        res.json({ success: true, message: 'Admin added successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.delete('/api/admin/:number', requireAuth, async (req, res) => {
    try {
        const { number } = req.params;
        await removeAdmin(number);
        res.json({ success: true, message: 'Admin removed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const sessions = await getAllSessions();
        const admins = await getAdmins();
        
        res.json({
            success: true,
            stats: {
                totalSessions: sessions.length,
                activeSessions: sessions.filter(s => s.active).length,
                totalAdmins: admins.length,
                botName: config.BOT_NAME,
                botVersion: config.BOT_VERSION
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🌐 Web Dashboard running on http://localhost:${PORT}`);
    console.log(`🔐 Login: ${config.DASHBOARD_USERNAME} / ${config.DASHBOARD_PASSWORD}`);
});

module.exports = app;
