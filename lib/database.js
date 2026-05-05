// lib/database.js
const { MongoClient } = require('mongodb');
const config = require('../config');

let db = null;
let client = null;

async function initDatabase() {
    if (db) return db;
    
    try {
        client = new MongoClient(config.MONGODB_URI);
        await client.connect();
        db = client.db('whatsapp_bot');
        
        // Create collections if not exist
        await createCollections();
        
        console.log('✅ MongoDB connected successfully');
        return db;
    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        throw error;
    }
}

async function createCollections() {
    // Sessions collection
    if (!await db.listCollections({ name: 'sessions' }).hasNext()) {
        await db.createCollection('sessions');
        await db.collection('sessions').createIndex({ number: 1 }, { unique: true });
        await db.collection('sessions').createIndex({ active: 1 });
    }
    
    // Settings collection
    if (!await db.listCollections({ name: 'settings' }).hasNext()) {
        await db.createCollection('settings');
        await db.collection('settings').createIndex({ number: 1 }, { unique: true });
    }
    
    // Admins collection
    if (!await db.listCollections({ name: 'admins' }).hasNext()) {
        await db.createCollection('admins');
    }
    
    // Credentials backup collection
    if (!await db.listCollections({ name: 'creds_backup' }).hasNext()) {
        await db.createCollection('creds_backup');
        await db.collection('creds_backup').createIndex({ number: 1 });
        await db.collection('creds_backup').createIndex({ createdAt: 1 });
    }
}

// Session Management
async function saveSession(number, creds, active = true) {
    const db = await initDatabase();
    const collection = db.collection('sessions');
    
    return await collection.updateOne(
        { number },
        {
            $set: {
                number,
                creds: JSON.stringify(creds),
                active,
                updatedAt: new Date()
            },
            $setOnInsert: {
                createdAt: new Date()
            }
        },
        { upsert: true }
    );
}

async function getSession(number) {
    const db = await initDatabase();
    const collection = db.collection('sessions');
    const doc = await collection.findOne({ number });
    
    if (doc && doc.creds) {
        return JSON.parse(doc.creds);
    }
    return null;
}

async function getAllSessions() {
    const db = await initDatabase();
    const collection = db.collection('sessions');
    return await collection.find({ active: true }).toArray();
}

async function deleteSession(number) {
    const db = await initDatabase();
    const collection = db.collection('sessions');
    return await collection.deleteOne({ number });
}

async function updateSessionStatus(number, active) {
    const db = await initDatabase();
    const collection = db.collection('sessions');
    return await collection.updateOne(
        { number },
        { $set: { active, updatedAt: new Date() } }
    );
}

// Settings Management
async function getSettings(number) {
    const db = await initDatabase();
    const collection = db.collection('settings');
    const doc = await collection.findOne({ number });
    
    if (doc) return doc.settings;
    
    // Return default settings
    return {
        prefix: config.PREFIX,
        autoReact: config.AUTO_REACT,
        antiDelete: config.ANTI_DELETE,
        autoViewStatus: config.AUTO_VIEW_STATUS,
        autoLikeStatus: config.AUTO_LIKE_STATUS,
        welcomeMessage: '',
        goodbyeMessage: '',
        antiLink: false,
        antiBadWords: false,
        onlyAdmin: false
    };
}

async function updateSettings(number, settings) {
    const db = await initDatabase();
    const collection = db.collection('settings');
    
    return await collection.updateOne(
        { number },
        {
            $set: {
                number,
                settings,
                updatedAt: new Date()
            },
            $setOnInsert: {
                createdAt: new Date()
            }
        },
        { upsert: true }
    );
}

// Admin Management
async function getAdmins() {
    const db = await initDatabase();
    const collection = db.collection('admins');
    const admins = await collection.find({}).toArray();
    return admins.map(a => a.number);
}

async function addAdmin(number) {
    const db = await initDatabase();
    const collection = db.collection('admins');
    return await collection.updateOne(
        { number },
        { $set: { number, addedAt: new Date() } },
        { upsert: true }
    );
}

async function removeAdmin(number) {
    const db = await initDatabase();
    const collection = db.collection('admins');
    return await collection.deleteOne({ number });
}

// Credentials Backup to GitHub Gist
async function backupToGitHub(number, creds) {
    if (!config.GITHUB_TOKEN || !config.GITHUB_GIST_ID) {
        console.log('⚠️ GitHub backup not configured');
        return false;
    }
    
    try {
        const axios = require('axios');
        const gistApi = `https://api.github.com/gists/${config.GITHUB_GIST_ID}`;
        
        const response = await axios.get(gistApi, {
            headers: {
                Authorization: `token ${config.GITHUB_TOKEN}`,
                Accept: 'application/vnd.github.v3+json'
            }
        });
        
        const files = response.data.files;
        files[`${number}_creds.json`] = {
            content: JSON.stringify(creds, null, 2)
        };
        
        await axios.patch(gistApi, {
            files: files
        }, {
            headers: {
                Authorization: `token ${config.GITHUB_TOKEN}`,
                Accept: 'application/vnd.github.v3+json'
            }
        });
        
        console.log(`✅ Backed up ${number} creds to GitHub`);
        return true;
    } catch (error) {
        console.error('❌ GitHub backup failed:', error.message);
        return false;
    }
}

module.exports = {
    initDatabase,
    saveSession,
    getSession,
    getAllSessions,
    deleteSession,
    updateSessionStatus,
    getSettings,
    updateSettings,
    getAdmins,
    addAdmin,
    removeAdmin,
    backupToGitHub
};
