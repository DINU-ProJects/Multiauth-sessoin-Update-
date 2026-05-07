// plugins/main.js
const { cmd, commands } = require('./command');
const { getSettings, getAdmins } = require('../lib/database');
const { getSystemInfo, runtime, getTimestamp, capitalize, formatBytes } = require('../lib/functions');
const config = require('../config');
const os = require('os');
const process = require('process');

//-----------------------------------------------ALIVE-----------------------------------------------
const axios = require('axios');
//const config = require('../settings');
//const { cmd, commands } = require('../lib/command');

const fs = require("fs");

cmd({
    pattern: "vv",
    react: "🧐",
    alias: ["retrive", "viewonce"],
    desc: "Fetch and resend a ViewOnce message content (image/video/voice).",
    category: "misc",
    use: "<query>",
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    try {
        if (!m.quoted) return reply("Please reply to a ViewOnce message.");

        const mime = m.quoted.type;
        let ext, mediaType;
        
        if (mime === "imageMessage") {
            ext = "jpg";
            mediaType = "image";
        } else if (mime === "videoMessage") {
            ext = "mp4";
            mediaType = "video";
        } else if (mime === "audioMessage") {
            ext = "mp3";
            mediaType = "audio";
        } else {
            return reply("Unsupported media type. Please reply to an image, video, or audio message.");
        }

        var buffer = await m.quoted.download();
        var filePath = `${Date.now()}.${ext}`;

        fs.writeFileSync(filePath, buffer); 

        let mediaObj = {};
        mediaObj[mediaType] = fs.readFileSync(filePath);

        await conn.sendMessage(m.chat, mediaObj);

        fs.unlinkSync(filePath);

    } catch (e) {
        console.log("Error:", e);
        reply("An error occurred while fetching the ViewOnce message.", e);
    }
});


cmd({
    pattern: "alive",
    desc: "Check bot online or not.",
    category: "main",
    react: "👾",
    filename: __filename
}, async (conn, msg, from, args, pushname, isGroup, botNumber, reply) => {
    try {
        const systemInfo = getSystemInfo();
        const uptime = runtime(process.uptime());
        
        const aliveText = `╭───❍ 《 ${config.BOT_NAME} 》
│ 🤖 *Status:* 🟢 Active
│ 👤 *User:* ${pushname}
│ ⏱️ *Uptime:* ${uptime}
│ 💾 *Memory:* ${systemInfo.freeMemory} / ${systemInfo.totalMemory}
│ 🖥️ *Platform:* ${capitalize(systemInfo.platform)}
│ 📟 *Version:* ${config.BOT_VERSION}
╰───❍\n\n> *© ${config.BOT_NAME}*`;

        await conn.sendMessage(from, {
            image: { url: config.BUTTON_IMAGES.ALIVE },
            caption: aliveText,
            buttons: [
                { buttonId: `${config.PREFIX}menu`, buttonText: { displayText: '📋 MENU' }, type: 1 },
                { buttonId: `${config.PREFIX}owner`, buttonText: { displayText: '👤 OWNER' }, type: 1 },
                { buttonId: `${config.PREFIX}ping`, buttonText: { displayText: '🏓 PING' }, type: 1 }
            ]
        }, { quoted: msg });
    } catch (err) {
        console.error(err);
        reply('❌ An error occurred.');
    }
});

//-----------------------------------------------MENU-----------------------------------------------
cmd({
    pattern: "menu",
    desc: "Show bot commands menu.",
    category: "main",
    react: "📋",
    filename: __filename
}, async (conn, msg, from, args, pushname, isGroup, botNumber, reply) => {
    try {
        const menuText = `╭───❍ 《 ${config.BOT_NAME} 》
│
│ 🎀 *MAIN COMMANDS*
│ ├─ ${config.PREFIX}alive - Check bot status
│ ├─ ${config.PREFIX}menu - Show this menu
│ ├─ ${config.PREFIX}ping - Check bot latency
│ ├─ ${config.PREFIX}system - System info
│ ├─ ${config.PREFIX}owner - Contact owner
│
│ 📥 *DOWNLOAD COMMANDS*
│ ├─ ${config.PREFIX}song <song_name/link>
│ ├─ ${config.PREFIX}video <video_name/link>
│ ├─ ${config.PREFIX}fb <facebook_url>
│ ├─ ${config.PREFIX}ig <instagram_url>
│ ├─ ${config.PREFIX}tiktok <tiktok_url>
│
│ ⚙️ *ADMIN COMMANDS*
│ ├─ ${config.PREFIX}setprefix
│ ├─ ${config.PREFIX}antidelete on/off
│ ├─ ${config.PREFIX}autoreact on/off
│ ├─ ${config.PREFIX}addadmin
│ ├─ ${config.PREFIX}removeadmin
│
╰───❍\n\n> *© ${config.BOT_NAME}*`;

        await conn.sendMessage(from, {
            image: { url: config.BUTTON_IMAGES.MENU },
            caption: menuText
        }, { quoted: msg });
    } catch (err) {
        console.error(err);
        reply('❌ An error occurred.');
    }
});

//-----------------------------------------------PING-----------------------------------------------
cmd({
    pattern: "ping",
    desc: "Check bot latency.",
    category: "main",
    react: "🏓",
    filename: __filename
}, async (conn, msg, from, args, pushname, isGroup, botNumber, reply) => {
    const start = Date.now();
    const sent = await reply('🏓 *Pinging...*');
    const end = Date.now();
    const latency = end - start;
    
    await conn.sendMessage(from, {
        text: `🏓 *PONG!*\n\n📡 *Latency:* ${latency}ms\n⏱️ *Timestamp:* ${getTimestamp()}`,
        edit: sent.key
    });
});

//-----------------------------------------------SYSTEM-----------------------------------------------
cmd({
    pattern: "system",
    desc: "Show system information.",
    category: "main",
    react: "💻",
    filename: __filename
}, async (conn, msg, from, args, pushname, isGroup, botNumber, reply) => {
    const systemInfo = getSystemInfo();
    const processUptime = runtime(process.uptime());
    const botUptime = runtime(process.uptime());
    
    const sysText = `╭───❍ 《 SYSTEM INFO 》
│ 🖥️ *Hostname:* ${systemInfo.hostname}
│ 💿 *Platform:* ${capitalize(systemInfo.platform)}
│ 🧠 *CPU:* ${systemInfo.cpuModel.substring(0, 40)}...
│ 🔢 *Cores:* ${systemInfo.cpuCores}
│ 💾 *RAM:* ${systemInfo.freeMemory} / ${systemInfo.totalMemory}
│ ⏱️ *System Uptime:* ${systemInfo.uptime}
│ 🤖 *Bot Uptime:* ${botUptime}
╰───❍`;

    await conn.sendMessage(from, { 
        image: { url: config.BUTTON_IMAGES.MENU },
        caption: sysText 
    }, { quoted: msg });
});

//-----------------------------------------------OWNER-----------------------------------------------
cmd({
    pattern: "owner",
    desc: "Contact bot owner.",
    category: "main",
    react: "👤",
    filename: __filename
}, async (conn, msg, from, args, pushname, isGroup, botNumber, reply) => {
    const vcard = `BEGIN:VCARD
VERSION:3.0
FN:${config.OWNER_NAME}
TEL;type=CELL;type=VOICE;waid=${config.OWNER_NUMBER}:+${config.OWNER_NUMBER}
END:VCARD`;

    await conn.sendMessage(from, {
        contacts: {
            displayName: config.OWNER_NAME,
            contacts: [{ vcard }]
        }
    }, { quoted: msg });
});

//-----------------------------------------------SETTINGS-----------------------------------------------
cmd({
    pattern: "settings",
    desc: "View current bot settings.",
    category: "admin",
    react: "⚙️",
    filename: __filename
}, async (conn, msg, from, args, pushname, isGroup, botNumber, reply) => {
    const admins = await getAdmins();
    
    if (!admins.includes(botNumber) && from !== `${config.OWNER_NUMBER}@s.whatsapp.net`) {
        return reply('❌ *Only admins can use this command.*');
    }
    
    const settings = await getSettings(botNumber);
    
    const settingsText = `╭───❍ 《 BOT SETTINGS 》
│ 📌 *Prefix:* ${settings.prefix}
│ 🔄 *Auto React:* ${settings.autoReact || config.AUTO_REACT}
│ 🚫 *Anti Delete:* ${settings.antiDelete || config.ANTI_DELETE}
│ 👁️ *Auto View Status:* ${settings.autoViewStatus || config.AUTO_VIEW_STATUS}
│ ❤️ *Auto Like Status:* ${settings.autoLikeStatus || config.AUTO_LIKE_STATUS}
╰───❍

*📝 Commands to change:*
${settings.prefix}setprefix <new_prefix>
${settings.prefix}autoreact on/off
${settings.prefix}antidelete on/off`;

    await conn.sendMessage(from, { text: settingsText }, { quoted: msg });
});

//-----------------------------------------------SETPREFIX-----------------------------------------------
cmd({
    pattern: "setprefix",
    desc: "Change bot prefix.",
    category: "admin",
    react: "🔧",
    filename: __filename
}, async (conn, msg, from, args, pushname, isGroup, botNumber, reply) => {
    const admins = await getAdmins();
    
    if (!admins.includes(botNumber) && from !== `${config.OWNER_NUMBER}@s.whatsapp.net`) {
        return reply('❌ *Only admins can use this command.*');
    }
    
    if (!args[0]) {
        return reply(`❌ *Usage:* ${config.PREFIX}setprefix <new_prefix>`);
    }
    
    const newPrefix = args[0];
    const settings = await getSettings(botNumber);
    settings.prefix = newPrefix;
    await require('../lib/database').updateSettings(botNumber, settings);
    
    // Update global config
    config.PREFIX = newPrefix;
    
    await reply(`✅ *Prefix has been changed to:* ${newPrefix}`);
});

//-----------------------------------------------AUTOREACT-----------------------------------------------
cmd({
    pattern: "autoreact",
    desc: "Toggle auto react feature.",
    category: "admin",
    react: "🔄",
    filename: __filename
}, async (conn, msg, from, args, pushname, isGroup, botNumber, reply) => {
    const admins = await getAdmins();
    
    if (!admins.includes(botNumber) && from !== `${config.OWNER_NUMBER}@s.whatsapp.net`) {
        return reply('❌ *Only admins can use this command.*');
    }
    
    if (!args[0] || !['on', 'off'].includes(args[0].toLowerCase())) {
        return reply(`❌ *Usage:* ${config.PREFIX}autoreact on/off`);
    }
    
    const settings = await getSettings(botNumber);
    settings.autoReact = args[0].toLowerCase();
    await require('../lib/database').updateSettings(botNumber, settings);
    
    await reply(`✅ *Auto React has been turned ${args[0].toUpperCase()}*`);
});

//-----------------------------------------------ANTIDELETE-----------------------------------------------
cmd({
    pattern: "antidelete",
    desc: "Toggle anti delete feature.",
    category: "admin",
    react: "🚫",
    filename: __filename
}, async (conn, msg, from, args, pushname, isGroup, botNumber, reply) => {
    const admins = await getAdmins();
    
    if (!admins.includes(botNumber) && from !== `${config.OWNER_NUMBER}@s.whatsapp.net`) {
        return reply('❌ *Only admins can use this command.*');
    }
    
    if (!args[0] || !['on', 'off'].includes(args[0].toLowerCase())) {
        return reply(`❌ *Usage:* ${config.PREFIX}antidelete on/off`);
    }
    
    const settings = await getSettings(botNumber);
    settings.antiDelete = args[0].toLowerCase() === 'on';
    await require('../lib/database').updateSettings(botNumber, settings);
    
    // Update global config
    config.ANTI_DELETE = settings.antiDelete;
    
    await reply(`✅ *Anti Delete has been turned ${args[0].toUpperCase()}*`);
});

//-----------------------------------------------JID-----------------------------------------------
cmd({
    pattern: "jid",
    desc: "Get chat JID.",
    category: "utility",
    react: "🔢",
    filename: __filename
}, async (conn, msg, from, args, pushname, isGroup, botNumber, reply) => {
    await reply(`📌 *Chat JID:* ${from}`);
});
