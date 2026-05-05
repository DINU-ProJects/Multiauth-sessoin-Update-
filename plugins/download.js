// plugins/download.js
const { cmd } = require('./command');
const axios = require('axios');
const yts = require('yt-search');
//onst ddownr = require('denethdev-ytmp3');
const config = require('../config');
const { extractYouTubeId, extractUrl } = require('../lib/functions');

//-----------------------------------------------SONG-----------------------------------------------
cmd({
    pattern: "song",
    desc: "Download song from YouTube.",
    category: "download",
    react: "🎵",
    filename: __filename
}, async (conn, msg, from, args, pushname, isGroup, botNumber, reply) => {
    const query = args.join(' ');
    
    if (!query) {
        return reply(`🎵 *Usage:* ${config.PREFIX}song <song_name_or_link>
        
*Example:*
${config.PREFIX}song Shape of You
${config.PREFIX}song https://youtu.be/...`);
    }
    
    await conn.sendMessage(from, { react: { text: "⬇️", key: msg.key } });
    
    try {
        // Convert YouTube link if needed
        let searchQuery = query;
        if (extractYouTubeId(query)) {
            searchQuery = query;
        }
        
        const search = await yts(searchQuery);
        const data = search.videos[0];
        
        if (!data) {
            return reply('❌ *No results found*');
        }
        
        const desc = `🎵 *${data.title}*
⏱️ Duration: ${data.timestamp}
👁️ Views: ${data.views}
📅 Released: ${data.ago}
🔗 Link: ${data.url}

> *© ${config.BOT_NAME}*`;

        await conn.sendMessage(from, {
            image: { url: data.thumbnail },
            caption: desc
        }, { quoted: msg });
        
        const result = await ddownr.download(data.url, 'mp3');
        const downloadLink = result.downloadUrl;
        
        await conn.sendMessage(from, {
            audio: { url: downloadLink },
            mimetype: "audio/mpeg",
            ptt: false
        }, { quoted: msg });
        
        await conn.sendMessage(from, { react: { text: "✅", key: msg.key } });
        
    } catch (err) {
        console.error(err);
        reply('❌ *Error occurred while downloading. Please try again.*');
    }
});

//-----------------------------------------------VIDEO-----------------------------------------------
cmd({
    pattern: "video",
    desc: "Download video from YouTube.",
    category: "download",
    react: "🎥",
    filename: __filename
}, async (conn, msg, from, args, pushname, isGroup, botNumber, reply) => {
    const query = args.join(' ');
    
    if (!query) {
        return reply(`🎥 *Usage:* ${config.PREFIX}video <video_name_or_link>
        
*Example:*
${config.PREFIX}video Gangnam Style
${config.PREFIX}video https://youtu.be/...`);
    }
    
    await conn.sendMessage(from, { react: { text: "⬇️", key: msg.key } });
    
    try {
        let searchQuery = query;
        if (extractYouTubeId(query)) {
            searchQuery = query;
        }
        
        const search = await yts(searchQuery);
        const data = search.videos[0];
        
        if (!data) {
            return reply('❌ *No results found*');
        }
        
        const desc = `🎥 *${data.title}*
⏱️ Duration: ${data.timestamp}
👁️ Views: ${data.views}
📅 Released: ${data.ago}
🔗 Link: ${data.url}

> *© ${config.BOT_NAME}*`;

        await conn.sendMessage(from, {
            image: { url: data.thumbnail },
            caption: desc
        }, { quoted: msg });
        
        const result = await ddownr.download(data.url, 'mp4');
        const downloadLink = result.downloadUrl;
        
        await conn.sendMessage(from, {
            video: { url: downloadLink },
            mimetype: "video/mp4",
            caption: `🎥 *${data.title}*\n> *© ${config.BOT_NAME}*`
        }, { quoted: msg });
        
        await conn.sendMessage(from, { react: { text: "✅", key: msg.key } });
        
    } catch (err) {
        console.error(err);
        reply('❌ *Error occurred while downloading. Please try again.*');
    }
});

//-----------------------------------------------FB-----------------------------------------------
cmd({
    pattern: "fb",
    desc: "Download Facebook video.",
    category: "download",
    react: "📘",
    filename: __filename
}, async (conn, msg, from, args, pushname, isGroup, botNumber, reply) => {
    const url = args.join(' ');
    
    if (!url || !url.includes('facebook.com')) {
        return reply(`📘 *Usage:* ${config.PREFIX}fb <facebook_video_url>
        
*Example:*
${config.PREFIX}fb https://facebook.com/watch?v=...`);
    }
    
    await conn.sendMessage(from, { react: { text: "⬇️", key: msg.key } });
    
    try {
        const response = await axios.get(`https://suhas-bro-api.vercel.app/download/fbdown?url=${encodeURIComponent(url)}`);
        const result = response.data.result;
        
        await conn.sendMessage(from, {
            video: { url: result.sd },
            mimetype: 'video/mp4',
            caption: `📘 *Facebook Video Downloaded*
🔗 Source: ${url}

> *© ${config.BOT_NAME}*`
        }, { quoted: msg });
        
        await conn.sendMessage(from, { react: { text: "✅", key: msg.key } });
        
    } catch (err) {
        console.error(err);
        reply('❌ *Error downloading Facebook video.*');
    }
});

//-----------------------------------------------IG-----------------------------------------------
cmd({
    pattern: "ig",
    desc: "Download Instagram media.",
    category: "download",
    react: "📸",
    filename: __filename
}, async (conn, msg, from, args, pushname, isGroup, botNumber, reply) => {
    const url = args.join(' ');
    
    if (!url || !url.includes('instagram.com')) {
        return reply(`📸 *Usage:* ${config.PREFIX}ig <instagram_url>
        
*Example:*
${config.PREFIX}ig https://instagram.com/p/...`);
    }
    
    await conn.sendMessage(from, { react: { text: "⬇️", key: msg.key } });
    
    try {
        // Using a public Instagram download API
        const response = await axios.get(`https://api.downloadgram.com/v2?url=${encodeURIComponent(url)}`);
        
        if (response.data && response.data.data) {
            const media = response.data.data;
            
            if (media.type === 'video') {
                await conn.sendMessage(from, {
                    video: { url: media.url },
                    mimetype: 'video/mp4',
                    caption: `📸 *Instagram Video Downloaded*
🔗 Source: ${url}

> *© ${config.BOT_NAME}*`
                }, { quoted: msg });
            } else {
                await conn.sendMessage(from, {
                    image: { url: media.url },
                    caption: `📸 *Instagram Image Downloaded*
🔗 Source: ${url}

> *© ${config.BOT_NAME}*`
                }, { quoted: msg });
            }
            
            await conn.sendMessage(from, { react: { text: "✅", key: msg.key } });
        } else {
            throw new Error('No media found');
        }
        
    } catch (err) {
        console.error(err);
        reply('❌ *Error downloading Instagram media.*');
    }
});
