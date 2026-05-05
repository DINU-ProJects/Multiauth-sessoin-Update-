// lib/functions.js
const moment = require('moment-timezone');
const crypto = require('crypto');
const os = require('os');

function getTimestamp() {
    return moment().tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss');
}

function runtime(seconds) {
    seconds = Number(seconds);
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    
    const dDisplay = d > 0 ? d + (d === 1 ? " day, " : " days, ") : "";
    const hDisplay = h > 0 ? h + (h === 1 ? " hour, " : " hours, ") : "";
    const mDisplay = m > 0 ? m + (m === 1 ? " minute, " : " minutes, ") : "";
    const sDisplay = s > 0 ? s + (s === 1 ? " second" : " seconds") : "";
    
    return dDisplay + hDisplay + mDisplay + sDisplay;
}

function generateSerial(size = 10) {
    return crypto.randomBytes(size).toString('hex').slice(0, size);
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getSystemInfo() {
    return {
        hostname: os.hostname(),
        platform: os.platform(),
        totalMemory: formatBytes(os.totalmem()),
        freeMemory: formatBytes(os.freemem()),
        cpuModel: os.cpus()[0].model,
        cpuCores: os.cpus().length,
        uptime: runtime(os.uptime())
    };
}

function capitalize(string) {
    if (!string) return '';
    return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
}

function isValidNumber(number) {
    const num = number.toString().replace(/[^0-9]/g, '');
    return num.length >= 10 && num.length <= 15;
}

function formatJid(number) {
    return `${number.toString().replace(/[^0-9]/g, '')}@s.whatsapp.net`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function extractUrl(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = text.match(urlRegex);
    return matches ? matches[0] : null;
}

function extractYouTubeId(url) {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

module.exports = {
    getTimestamp,
    runtime,
    generateSerial,
    formatBytes,
    getSystemInfo,
    capitalize,
    isValidNumber,
    formatJid,
    sleep,
    extractUrl,
    extractYouTubeId
};
