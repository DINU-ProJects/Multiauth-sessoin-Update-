// lib/githubBackup.js
const axios = require('axios');
const config = require('../config');

const GITHUB_API = 'https://api.github.com';
const REPO = config.GITHUB_REPO; // "DINU-ProJects/viewonce-backup"
const TOKEN = config.GHP_TOKEN;
const BRANCH = 'main';

async function uploadToGitHub(filePath, content, message = 'Upload file') {
    if (!REPO ||!TOKEN) {
        console.log('⚠️ GitHub backup not configured');
        return null;
    }

    try {
        const url = `${GITHUB_API}/repos/${REPO}/contents/${filePath}`;
        const data = {
            message,
            content: Buffer.from(content).toString('base64'),
            branch: BRANCH
        };

        // Check if file exists
        try {
            const { data: existing } = await axios.get(url, {
                headers: { Authorization: `token ${TOKEN}` }
            });
            data.sha = existing.sha;
        } catch (e) {
            // File doesn't exist, create new
        }

        await axios.put(url, data, {
            headers: { Authorization: `token ${TOKEN}` }
        });

        console.log(`✅ Uploaded to GitHub: ${filePath}`);
        return `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${filePath}`;
    } catch (e) {
        console.error('GitHub upload error:', e.message);
        return null;
    }
}

async function getFromGitHub(filePath) {
    if (!REPO ||!TOKEN) return null;

    try {
        const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${filePath}`;
        const { data } = await axios.get(url, {
            headers: { Authorization: `token ${TOKEN}` },
            responseType: 'arraybuffer'
        });
        return Buffer.from(data);
    } catch (e) {
        console.error('GitHub download error:', e.message);
        return null;
    }
}

module.exports = { uploadToGitHub, getFromGitHub };
