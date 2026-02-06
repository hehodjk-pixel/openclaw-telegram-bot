// OpenClaw Telegram Bot - UPGRADED VERSION
// Features: Persistent Memory, Quota Tracking, User Preferences
// Powered by Google Gemini AI

const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const fs = require('fs').promises;
const path = require('path');

// Environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;
const DATA_DIR = '/tmp/openclaw-data';

// Validate environment variables
if (!TELEGRAM_TOKEN || !GEMINI_KEY) {
    console.error('Missing required environment variables!');
    process.exit(1);
}

// Initialize Telegram Bot
const bot = new TelegramBot(TELEGRAM_TOKEN, {
    polling: true,
    request: {
        agentOptions: {
            keepAlive: true,
            family: 4
        }
    }
});

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(GEMINI_KEY);
const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-lite',
    generationConfig: {
        temperature: 0.9,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 2048,
    },
    systemInstruction: `You are OpenClaw, an AI assistant running on Railway.
You are powered by Google Gemini 2.5 Flash-Lite model.
You have a daily quota of 1,000 requests on the free tier.
You remember conversations and user preferences.
Be helpful, friendly, and concise.`
});

// In-memory storage
let conversations = new Map();
let userPreferences = new Map();
let dailyStats = {
    date: new Date().toDateString(),
    requestCount: 0,
    uniqueUsers: new Set()
};
const startTime = Date.now();

// Ensure data directory exists
async function ensureDataDir() {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (err) {
        console.error('Error creating data directory:', err);
    }
}

// Save data to disk
async function saveData() {
    try {
        await ensureDataDir();
        const data = {
            conversations: Array.from(conversations.entries()),
            userPreferences: Array.from(userPreferences.entries()),
            dailyStats: {
                ...dailyStats,
                uniqueUsers: Array.from(dailyStats.uniqueUsers)
            }
        };
        await fs.writeFile(
            path.join(DATA_DIR, 'data.json'),
            JSON.stringify(data, null, 2)
        );
    } catch (err) {
        console.error('Error saving data:', err);
    }
}

// Load data from disk
async function loadData() {
    try {
        const dataPath = path.join(DATA_DIR, 'data.json');
        const data = JSON.parse(await fs.readFile(dataPath, 'utf8'));
        conversations = new Map(data.conversations || []);
        userPreferences = new Map(data.userPreferences || []);
        dailyStats = {
            ...data.dailyStats,
            uniqueUsers: new Set(data.dailyStats?.uniqueUsers || [])
        };
        if (dailyStats.date !== new Date().toDateString()) {
            dailyStats = {
                date: new Date().toDateString(),
                requestCount: 0,
                uniqueUsers: new Set()
            };
        }
        console.log('Data loaded successfully');
    } catch (err) {
        console.log('No previous data found, starting fresh');
    }
}

// Auto-save every 30 seconds
setInterval(saveData, 30000);

// Helper functions
function getHistory(chatId) {
    if (!conversations.has(chatId)) {
        conversations.set(chatId, []);
    }
    return conversations.get(chatId);
}

function addToHistory(chatId, role, text) {
    const history = getHistory(chatId);
    history.push({
        role: role,
        parts: [{ text: text }],
        timestamp: new Date().toISOString()
    });
    if (history.length > 50) {
        conversations.set(chatId, history.slice(-50));
    }
}

function clearHistory(chatId) {
    conversations.set(chatId, []);
}

function getUserPref(userId, key, defaultValue = null) {
    const prefs = userPreferences.get(userId) || {};
    return prefs[key] !== undefined ? prefs[key] : defaultValue;
}

function setUserPref(userId, key, value) {
    const prefs = userPreferences.get(userId) || {};
    prefs[key] = value;
    userPreferences.set(userId, prefs);
}

function updateStats(userId) {
    dailyStats.requestCount++;
    dailyStats.uniqueUsers.add(userId);
    if (dailyStats.requestCount >= 900) {
        console.warn(`Approaching daily quota: ${dailyStats.requestCount}/1000`);
    }
}

function getQuotaStatus() {
    const used = dailyStats.requestCount;
    const limit = 1000;
    const remaining = Math.max(0, limit - used);
    const percentage = Math.round((used / limit) * 100);
    return {
        used,
        limit,
        remaining,
        percentage,
        status: remaining > 200 ? '✅' : remaining > 50 ? '⚠️' : '🔴'
    };
}

// Command: /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const firstName = msg.from.first_name || 'there';
    
    clearHistory(chatId);
    setUserPref(userId, 'language', 'en');
    setUserPref(userId, 'firstSeen', new Date().toISOString());
    
    const quota = getQuotaStatus();
    
    await bot.sendMessage(chatId,
        `*Welcome to OpenClaw AI Bot!*\n\n` +
        `Hi ${firstName}! I'm powered by Google Gemini AI.\n\n` +
        `*Current Status:*\n` +
        `Model: Gemini 2.5 Flash-Lite\n` +
        `Quota: ${quota.remaining}/${quota.limit} requests left ${quota.status}\n` +
        `Memory: Persistent\n\n` +
        `*Commands:*\n` +
        `/start - Fresh start\n` +
        `/reset - Clear chat\n` +
        `/history - View history\n` +
        `/stats - Statistics\n` +
        `/quota - Check quota\n` +
        `/help - Show help\n\n` +
        `Send any message to begin!`,
        { parse_mode: 'Markdown' }
    );
    await saveData();
});

// Command: /help
bot.onText(/\/help/, async (msg) => {
    await bot.sendMessage(msg.chat.id,
        `*OpenClaw Bot Help*\n\n` +
        `*Commands:*\n` +
        `/start - New conversation\n` +
        `/reset - Clear history\n` +
        `/history - View summary\n` +
        `/stats - Bot statistics\n` +
        `/quota - Check API quota\n` +
        `/export - Export chat\n` +
        `/help - This message\n\n` +
        `*Features:*\n` +
        `Persistent memory\n` +
        `History tracking\n` +
        `Quota monitoring\n` +
        `User preferences`,
        { parse_mode: 'Markdown' }
    );
});

// Command: /reset
bot.onText(/\/reset/, async (msg) => {
    const chatId = msg.chat.id;
    clearHistory(chatId);
    await saveData();
    await bot.sendMessage(chatId,
        '*Conversation reset!*\nPrevious context cleared.',
        { parse_mode: 'Markdown' }
    );
});

// Command: /history
bot.onText(/\/history/, async (msg) => {
    const chatId = msg.chat.id;
    const history = getHistory(chatId);
    
    if (history.length === 0) {
        await bot.sendMessage(chatId, 'No history yet. Start chatting!');
        return;
    }
    
    const summary = `*Conversation History*\n\n` +
        `Total: ${history.length} messages\n` +
        `First: ${new Date(history[0].timestamp).toLocaleString()}\n` +
        `Last: ${new Date(history[history.length-1].timestamp).toLocaleString()}\n\n` +
        `Recent:\n` +
        history.slice(-4).map((m, i) => 
            `${i%2===0?'👤':'🤖'} ${m.parts[0].text.substring(0,40)}...`
        ).join('\n');
    
    await bot.sendMessage(chatId, summary, { parse_mode: 'Markdown' });
});

// Command: /stats
bot.onText(/\/stats/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const history = getHistory(chatId);
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const quota = getQuotaStatus();
    const firstSeen = getUserPref(userId, 'firstSeen');
    
    const stats = `*Statistics*\n\n` +
        `*Your Session:*\n` +
        `Messages: ${history.length}\n` +
        `Member since: ${firstSeen ? new Date(firstSeen).toLocaleDateString() : 'Today'}\n\n` +
        `*Today:*\n` +
        `Requests: ${quota.used}/${quota.limit} ${quota.status}\n` +
        `Remaining: ${quota.remaining}\n` +
        `Active users: ${dailyStats.uniqueUsers.size}\n\n` +
        `*Bot:*\n` +
        `Uptime: ${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m\n` +
        `Total users: ${userPreferences.size}\n` +
        `Conversations: ${conversations.size}`;
    
    await bot.sendMessage(chatId, stats, { parse_mode: 'Markdown' });
});

// Command: /quota
bot.onText(/\/quota/, async (msg) => {
    const chatId = msg.chat.id;
    const quota = getQuotaStatus();
    const filled = Math.floor(quota.percentage / 5);
    const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
    
    await bot.sendMessage(chatId,
        `*API Quota Status*\n\n` +
        `${quota.status} ${bar}\n\n` +
        `Used: ${quota.used} requests\n` +
        `Remaining: ${quota.remaining} requests\n` +
        `Limit: ${quota.limit}/day\n` +
        `Reset: Midnight UTC\n` +
        `Model: Gemini 2.5 Flash-Lite`,
        { parse_mode: 'Markdown' }
    );
});

// Command: /export
bot.onText(/\/export/, async (msg) => {
    const chatId = msg.chat.id;
    const history = getHistory(chatId);
    
    if (history.length === 0) {
        await bot.sendMessage(chatId, 'No conversation to export!');
        return;
    }
    
    const export_text = history.map((m) => {
        const role = m.role === 'user' ? 'You' : 'OpenClaw';
        const time = new Date(m.timestamp).toLocaleString();
        return `[${time}] ${role}: ${m.parts[0].text}`;
    }).join('\n\n');
    
    const filename = `chat_${chatId}_${Date.now()}.txt`;
    
    await bot.sendDocument(chatId, Buffer.from(export_text), {}, {
        filename: filename,
        contentType: 'text/plain'
    });
});

// Handle messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    if (!text || text.startsWith('/')) return;

    const quota = getQuotaStatus();
    if (quota.remaining <= 0) {
        await bot.sendMessage(chatId,
            '*Daily quota exceeded!* Try again tomorrow.',
            { parse_mode: 'Markdown' }
        );
        return;
    }

    bot.sendChatAction(chatId, 'typing');

    try {
        updateStats(userId);
        const history = getHistory(chatId);
        const chat = model.startChat({ history });
        const result = await chat.sendMessage(text);
        const response = result.response.text();
        
        addToHistory(chatId, 'user', text);
        addToHistory(chatId, 'model', response);
        await saveData();
        
        if (response.length > 4000) {
            const chunks = response.match(/[\s\S]{1,4000}/g) || [];
            for (const chunk of chunks) {
                await bot.sendMessage(chatId, chunk);
            }
        } else {
            await bot.sendMessage(chatId, response);
        }
    } catch (error) {
        console.error('Error:', error);
        let errMsg = 'Sorry, error occurred.\n';
        if (error.message?.includes('quota')) errMsg += 'API quota exceeded.';
        else if (error.message?.includes('safety')) errMsg += 'Blocked by safety filters.';
        else errMsg += 'Try /reset or rephrase.';
        await bot.sendMessage(chatId, errMsg);
    }
});

// Error handling
bot.on('polling_error', (error) => {
    console.error('Polling error:', error.code, error.message);
});

// Express server
const app = express();

app.get('/', (req, res) => {
    const quota = getQuotaStatus();
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>OpenClaw Bot</title>
    <meta http-equiv="refresh" content="30">
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #f5f5f5; }
        .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); margin: 20px 0; }
        h1 { color: #0088cc; }
        .status { color: #00aa00; font-size: 20px; font-weight: bold; }
        .bar { background: #e0e0e0; height: 20px; border-radius: 10px; overflow: hidden; }
        .fill { background: ${quota.percentage > 80 ? '#ff4444' : '#00aa00'}; height: 100%; width: ${quota.percentage}%; }
        .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
    </style>
</head>
<body>
    <div class="card">
        <h1>🤖 OpenClaw Bot</h1>
        <div class="status">● Online</div>
    </div>
    <div class="card">
        <h2>Quota</h2>
        <div class="bar"><div class="fill"></div></div>
        <div class="row"><span>Used:</span><span>${quota.used}</span></div>
        <div class="row"><span>Remaining:</span><span>${quota.remaining}</span></div>
    </div>
    <div class="card">
        <h2>Stats</h2>
        <div class="row"><span>Uptime:</span><span>${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m</span></div>
        <div class="row"><span>Users:</span><span>${userPreferences.size}</span></div>
        <div class="row"><span>Active:</span><span>${dailyStats.uniqueUsers.size}</span></div>
    </div>
</body>
</html>`);
});

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        quota: getQuotaStatus(),
        users: userPreferences.size,
        timestamp: new Date().toISOString()
    });
});

// Initialize
(async () => {
    await loadData();
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log('OpenClaw Bot ready!');
    });
})();

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await saveData();
    bot.stopPolling();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await saveData();
    bot.stopPolling();
    process.exit(0);
});