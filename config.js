// config.js
const dotenv = require('dotenv');
dotenv.config();

module.exports = {
    // Bot Configuration
    BOT_NAME: 'ZEUS-MINI',
    OWNER_NAME: '@kelumXz',
    OWNER_NUMBER: '94720244981',
    BOT_VERSION: '2.0.0',
    PREFIX: '.',
    BOT_FOOTER: '> © Zeus Bot',
    
    // API Keys
    MONGODB_URI: process.env.MONGODB_URI || 'mongodb+srv://mrshrii404:JLtbz0CEOC1u6CwS@shri.gkhohrr.mongodb.net/',
  // config.js
module.exports = {
    //... අනිත් config
    GITHUB_REPO: 'DINU-ProJects/viewonce-backup', // ඔයාගේ repo
    GHP_TOKEN: process.env.GHP_TOKEN || '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', // Heroku Config Vars වල දාන්න
    ANTI_EDIT: true,
 // GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
 //   GITHUB_GIST_ID: process.env.GITHUB_GIST_ID || '',
    
    // Features
    AUTO_REACT: 'on',     // on/off
    AUTO_VIEW_STATUS: true,
    AUTO_LIKE_STATUS: true,
    ANTI_DELETE: true,
    ANTI_DELETE_LOGS: "any", // "an
   // ANTI_DELETE_LOGS: '94720244981@s.whatsapp.net',  // Where to send delete logs
    
    // Images
    BUTTON_IMAGES: {
        ALIVE: 'https://files.catbox.moe/9uuvfz.jpg',
        MENU: 'https://files.catbox.moe/kus7ix.jpg',
        OWNER: 'https://files.catbox.moe/fkw8ac.jpg'
    },
    
    // Newsletter
    NEWSLETTER_JID: '120363420985544024@newsletter',
    NEWSLETTER_MESSAGE_ID: '428',
    
    // Group
    GROUP_INVITE_LINK: 'https://chat.whatsapp.com/DiefTmkDKSXCrHgXxAKHAd',
    
    // Auto Like Emojis
    AUTO_LIKE_EMOJI: ['🧩', '🍉', '💜', '🌸', '🪴', '💊', '💫', '🍂', '🌟', '🎋', '😶‍🌫️', '🫀', '🧿', '👀', '🤖', '🚩', '🥰', '🗿', '💜', '💙', '🌝', '🖤', '💚'],
    
    // Web Dashboard
    WEB_PORT: 3000,
    DASHBOARD_USERNAME: 'admin',
    DASHBOARD_PASSWORD: 'admin123',
    SESSION_SECRET: 'your-session-secret-key-change-this',
    
    // Download Settings
    MAX_SIZE_MB: 50,
    
    // Retry Settings
    MAX_RETRIES: 3
};
