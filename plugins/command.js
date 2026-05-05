// plugins/command.js
const commands = new Map();
const categories = new Map();

function cmd(options, callback) {
    const { pattern, desc, category, react, filename } = options;
    
    commands.set(pattern.toLowerCase(), {
        pattern: pattern.toLowerCase(),
        desc: desc || 'No description',
        category: category || 'general',
        react: react || '🤖',
        filename: filename,
        execute: callback
    });
    
    if (!categories.has(category)) {
        categories.set(category, []);
    }
    categories.get(category).push(pattern.toLowerCase());
}

function getCommand(commandName) {
    return commands.get(commandName.toLowerCase());
}

function getAllCommands() {
    return Array.from(commands.values());
}

function getCommandsByCategory(category) {
    const cmdNames = categories.get(category) || [];
    return cmdNames.map(name => commands.get(name)).filter(cmd => cmd);
}

function getAllCategories() {
    return Array.from(categories.keys());
}

module.exports = {
    cmd,
    getCommand,
    getAllCommands,
    getCommandsByCategory,
    getAllCategories
};
