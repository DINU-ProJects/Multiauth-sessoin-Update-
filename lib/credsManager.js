// lib/credsManager.js
const fs = require('fs-extra');
const path = require('path');
const { initDatabase, saveSession, getSession, getAllSessions, deleteSession, updateSessionStatus, backupToGitHub } = require('./database');

const SESSION_BASE_PATH = path.join(process.cwd(), 'session');

// Ensure session directory exists
if (!fs.existsSync(SESSION_BASE_PATH)) {
    fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });
}

async function saveCredsToDB(number, creds, active = true) {
    try {
        await saveSession(number, creds, active);
        
        // Backup to GitHub if token is configured
        await backupToGitHub(number, creds);
        
        console.log(`✅ Saved credentials for ${number}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to save credentials for ${number}:`, error);
        return false;
    }
}

async function loadCredsFromDB(number) {
    try {
        return await getSession(number);
    } catch (error) {
        console.error(`❌ Failed to load credentials for ${number}:`, error);
        return null;
    }
}

async function getAllActiveSessions() {
    try {
        return await getAllSessions();
    } catch (error) {
        console.error('❌ Failed to get all sessions:', error);
        return [];
    }
}

async function removeSession(number) {
    try {
        // Delete from database
        await deleteSession(number);
        
        // Delete local session folder
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${number}`);
        if (fs.existsSync(sessionPath)) {
            await fs.remove(sessionPath);
        }
        
        console.log(`✅ Removed session for ${number}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to remove session for ${number}:`, error);
        return false;
    }
}

async function updateSessionActive(number, active) {
    try {
        await updateSessionStatus(number, active);
        return true;
    } catch (error) {
        console.error(`❌ Failed to update session status for ${number}:`, error);
        return false;
    }
}

async function exportCreds(number) {
    const creds = await loadCredsFromDB(number);
    if (creds) {
        return {
            number,
            creds,
            exportDate: new Date().toISOString()
        };
    }
    return null;
}

async function importCreds(number, credsData) {
    try {
        const creds = typeof credsData === 'string' ? JSON.parse(credsData) : credsData;
        await saveCredsToDB(number, creds, true);
        
        // Create local session folder
        const sessionPath = path.join(SESSION_BASE_PATH, `session_${number}`);
        if (!fs.existsSync(sessionPath)) {
            await fs.mkdir(sessionPath, { recursive: true });
        }
        
        await fs.writeFile(path.join(sessionPath, 'creds.json'), JSON.stringify(creds, null, 2));
        
        return true;
    } catch (error) {
        console.error(`❌ Failed to import creds for ${number}:`, error);
        return false;
    }
}

async function getAllCredsList() {
    const sessions = await getAllActiveSessions();
    return sessions.map(session => ({
        number: session.number,
        active: session.active,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt
    }));
}

module.exports = {
    saveCredsToDB,
    loadCredsFromDB,
    getAllActiveSessions,
    removeSession,
    updateSessionActive,
    exportCreds,
    importCreds,
    getAllCredsList,
    SESSION_BASE_PATH
};
