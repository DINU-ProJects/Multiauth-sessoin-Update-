// config.js
const dotenv = require('dotenv');
dotenv.config();

module.exports = {
    // Bot Configuration
    BOT_NAME: 'oni httk dgnin',
    OWNER_NAME: 'Itz-Dinu',
    OWNER_NUMBER: '94720244981',
    BOT_VERSION: '2.0.0.00009900099999',
    PREFIX: '.',
    BOT_FOOTER: '> fuck',
    
    // API Keys
    MONGODB_URI: process.env.MONGODB_URI || 'your mongo url /',
  // config.j
    //... අනිත් config

    //extra 👇
    GITHUB_REPO: 'username/reponame', // ඔයාගේ repo
    GHP_TOKEN: process.env.GHP_TOKEN || 'ghp token', // Heroku Config Vars වල දාන්න
    ANTI_EDIT: true, // anti edit not work (you can fix it)
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
    NEWSLETTER_JID: 'chnnel jid',
    NEWSLETTER_MESSAGE_ID: '428',
    
    // Group
    GROUP_INVITE_LINK: 'support wp group link',
    
    // Auto Like Emojis
    AUTO_LIKE_EMOJI: ['🧩', '🍉', '💜', '🌸', '🪴', '💊', '💫', '🍂', '🌟', '🎋', '😶‍🌫️', '🫀', '🧿', '👀', '🤖', '🚩', '🥰', '🗿', '💜', '💙', '🌝', '🖤', '💚'],
    
    // Web admin Dashboard
    WEB_PORT: 3000,
    DASHBOARD_USERNAME: 'admin',
    DASHBOARD_PASSWORD: 'admin123',
    SESSION_SECRET: 'your-session-secret-key-change-this',
    
    // Download Settings
    MAX_SIZE_MB: 50,
    
    // Retry Settings
    MAX_RETRIES: 3
};
