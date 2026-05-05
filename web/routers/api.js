// web/routes/api.js
const express = require('express');
const router = express.Router();
const { getAllActiveSessions, getSession, removeSession } = require('../../lib/credsManager');
const { getAdmins, addAdmin, removeAdmin } = require('../../lib/database');
const config = require('../../config');

// ============ GET ALL SESSIONS ============
router.get('/sessions', async (req, res) => {
    try {
        const sessions = await getAllActiveSessions();
        res.json({ 
            success: true, 
            sessions: sessions.map(s => ({
                number: s.number,
                active: s.active,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ GET SINGLE SESSION ============
router.get('/session/:number', async (req, res) => {
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

// ============ DELETE SESSION ============
router.delete('/session/:number', async (req, res) => {
    try {
        const { number } = req.params;
        const cleanNumber = number.replace(/[^0-9]/g, '');
        await removeSession(cleanNumber);
        res.json({ success: true, message: 'Session deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ PAIR WITH CODE ============
router.post('/session/pair', async (req, res) => {
    const { number } = req.body;
    
    if (!number) {
        return res.status(400).json({ success: false, message: 'Number is required' });
    }
    
    const cleanNumber = number.replace(/[^0-9]/g, '');
    
    // Check if session already exists
    const sessions = await getAllActiveSessions();
    const existing = sessions.find(s => s.number === cleanNumber);
    
    if (existing) {
        return res.json({ success: false, message: 'Session already exists for this number' });
    }
    
    try {
        // This would need a reference to the global socket
        // For now, return a mock response
        res.json({ 
            success: true, 
            code: '12345678',
            message: 'Pairing code generated'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ PAIR WITH QR ============
router.post('/session/qr', async (req, res) => {
    try {
        // This would need a reference to the global socket
        res.json({ 
            success: true, 
            qr: 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=whatsapp://',
            message: 'QR code generated'
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ GET ALL ADMINS ============
router.get('/admins', async (req, res) => {
    try {
        const admins = await getAdmins();
        res.json({ success: true, admins });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ ADD ADMIN ============
router.post('/admin', async (req, res) => {
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

// ============ REMOVE ADMIN ============
router.delete('/admin/:number', async (req, res) => {
    try {
        const { number } = req.params;
        await removeAdmin(number);
        res.json({ success: true, message: 'Admin removed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============ GET STATS ============
router.get('/stats', async (req, res) => {
    try {
        const sessions = await getAllActiveSessions();
        const admins = await getAdmins();
        
        res.json({
            success: true,
            stats: {
                totalSessions: sessions.length,
                activeSessions: sessions.filter(s => s.active).length,
                totalAdmins: admins.length,
                botName: config.BOT_NAME,
                botVersion: config.BOT_VERSION,
                ownerNumber: config.OWNER_NUMBER,
                prefix: config.PREFIX,
                botStatus: '🟢 Online'
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
