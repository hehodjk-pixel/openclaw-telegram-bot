// OpenClaw Cloud - Gemini Flash Lite Edition
// Everything runs in cloud, no PC needed

const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const axios = require('axios');

// ==================== CONFIG ====================
const CONFIG = {
    TELEGRAM_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    GEMINI_KEY: process.env.GEMINI_API_KEY,
    MAKE_WEBHOOK_URL: process.env.MAKE_WEBHOOK_URL,
    PORT: process.env.PORT || 3000
};

// Validate
if (!CONFIG.TELEGRAM_TOKEN || !CONFIG.GEMINI_KEY) {
    console.error('Missing required variables');
    process.exit(1);
}

// ==================== GEMINI FLASH LITE ====================
const genAI = new GoogleGenerativeAI(CONFIG.GEMINI_KEY);
const model = genAI.getGenerativeModel({ 
    model: 'gemini-2.0-flash-lite',  // FREE TIER
    generationConfig: {
        temperature: 0.9,
        maxOutputTokens: 2048
    }
});

// ==================== MEMORY (Simple JSON) ====================
let memory = {
    conversations: {},
    users: {},
    queue: []
};

// Load memory from environment (Railway persists this)
try {
    if (process.env.BOT_MEMORY) {
        memory = JSON.parse(process.env.BOT_MEMORY);
    }
} catch(e) {
    console.log('Starting fresh memory');
}

// Save memory function
async function saveMemory() {
    // In real implementation, we'd use Railway volumes or external DB
    // For now, memory persists during runtime
    console.log('Memory saved (runtime only)');
}

// ==================== TELEGRAM BOT ====================
const bot = new TelegramBot(CONFIG.TELEGRAM_TOKEN, { polling: true });

// AI Chat with memory
async function chatWithAI(userId, message) {
    // Get user history
    if (!memory.conversations[userId]) {
        memory.conversations[userId] = [];
    }
    const history = memory.conversations[userId];
    
    // Build context
    let context = '';
    if (history.length > 0) {
        context = 'Previous messages:\n' + 
            history.slice(-5).map(h => `${h.role}: ${h.text}`).join('\n') + 
            '\n\n';
    }
    
    const prompt = context + `User: ${message}\nAssistant:`;
    
    try {
        const result = await model.generateContent(prompt);
        const response = result.response.text();
        
        // Save to memory
        history.push({ role: 'user', text: message, time: Date.now() });
        history.push({ role: 'assistant', text: response, time: Date.now() });
        
        // Keep last 20 messages
        if (history.length > 40) {
            memory.conversations[userId] = history.slice(-40);
        }
        
        await saveMemory();
        return response;
        
    } catch (err) {
        console.error('AI Error:', err.message);
        return 'Sorry, I had trouble thinking. Try again!';
    }
}

// Generate caption for videos
async function generateCaption(videoName) {
    const prompt = `Create a viral Instagram/TikTok caption for video: "${videoName}"

Requirements:
- Hook in first 3 words
- 2-3 sentences
- 8-12 hashtags
- 2-3 emojis
- Call to action

Format: [Hook] [Text] [CTA] [Hashtags]`;

    try {
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (err) {
        return `Check this out! 🔥\n\n#viral #trending #fyp`;
    }
}

// ==================== COMMANDS ====================

// /start
bot.onText(/\/start/, async (msg) => {
    const userId = msg.chat.id;
    const name = msg.from.first_name || 'there';
    
    if (!memory.users[userId]) {
        memory.users[userId] = {
            joined: new Date().toISOString(),
            posts: 0,
            videos: 0
        };
    }
    
    await bot.sendMessage(userId, 
        `🤖 Hi ${name}! I'm OpenClaw Cloud\n\n` +
        `Powered by Gemini Flash Lite (Free)\n` +
        `Everything runs in cloud - no PC needed!\n\n` +
        `📱 COMMANDS:\n` +
        `/chat [message] - Talk with AI\n` +
        `/caption [video name] - Generate caption\n` +
        `/upload - Send video for posting\n` +
        `/queue - See pending posts\n` +
        `/status - Check your stats\n\n` +
        `Just send me any message to start!`
    );
});

// /chat
bot.onText(/\/chat (.+)/, async (msg, match) => {
    const userId = msg.chat.id;
    const text = match[1];
    
    await bot.sendChatAction(userId, 'typing');
    const response = await chatWithAI(userId, text);
    
    // Split if too long
    if (response.length > 4000) {
        const parts = response.match(/[\s\S]{1,4000}/g);
        for (const part of parts) {
            await bot.sendMessage(userId, part);
        }
    } else {
        await bot.sendMessage(userId, response);
    }
});

// /caption
bot.onText(/\/caption (.+)/, async (msg, match) => {
    const userId = msg.chat.id;
    const videoName = match[1];
    
    await bot.sendChatAction(userId, 'typing');
    const caption = await generateCaption(videoName);
    
    await bot.sendMessage(userId, `📝 Generated Caption:\n\n${caption}`);
});

// /upload instructions
bot.onText(/\/upload/, async (msg) => {
    const userId = msg.chat.id;
    
    await bot.sendMessage(userId,
        `📤 UPLOAD VIDEO\n\n` +
        `1. Send video to me here\n` +
        `2. I'll generate AI caption\n` +
        `3. Video goes to queue\n` +
        `4. Posted to Instagram + TikTok automatically\n\n` +
        `Just send a video now!`
    );
});

// /queue
bot.onText(/\/queue/, async (msg) => {
    const userId = msg.chat.id;
    const userQueue = memory.queue.filter(q => q.userId === userId);
    
    if (userQueue.length === 0) {
        await bot.sendMessage(userId, '📭 Your queue is empty');
        return;
    }
    
    let text = `📋 YOUR QUEUE (${userQueue.length} videos)\n\n`;
    userQueue.slice(0, 5).forEach((item, i) => {
        text += `${i+1}. ${item.status} - ${item.platforms.join(',')}\n`;
        text += `   ${item.caption.substring(0, 50)}...\n\n`;
    });
    
    await bot.sendMessage(userId, text);
});

// /status
bot.onText(/\/status/, async (msg) => {
    const userId = msg.chat.id;
    const user = memory.users[userId] || {};
    const conv = memory.conversations[userId] || [];
    
    await bot.sendMessage(userId,
        `📊 YOUR STATS\n\n` +
        `Messages: ${conv.length}\n` +
        `Videos: ${user.videos || 0}\n` +
        `Posts: ${user.posts || 0}\n` +
        `Joined: ${user.joined ? new Date(user.joined).toLocaleDateString() : 'Today'}`
    );
});

// Handle videos
bot.on('video', async (msg) => {
    const userId = msg.chat.id;
    const video = msg.video;
    
    // Get file link
    const file = await bot.getFile(video.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${CONFIG.TELEGRAM_TOKEN}/${file.file_path}`;
    
    await bot.sendMessage(userId, 
        `🎥 Video received (${video.duration}s)\n` +
        `Generating caption...`
    );
    
    // Generate caption
    const caption = await generateCaption(`video_${Date.now()}`);
    
    // Add to queue
    const queueItem = {
        id: Date.now().toString(),
        userId: userId,
        videoUrl: fileUrl,
        caption: caption,
        platforms: ['instagram', 'tiktok'],
        status: 'pending',
        createdAt: new Date().toISOString()
    };
    
    memory.queue.push(queueItem);
    
    // Update user stats
    if (!memory.users[userId]) memory.users[userId] = {};
    memory.users[userId].videos = (memory.users[userId].videos || 0) + 1;
    
    await saveMemory();
    
    // Send to Make.com
    if (CONFIG.MAKE_WEBHOOK_URL) {
        try {
            await axios.post(CONFIG.MAKE_WEBHOOK_URL, {
                action: 'new_video',
                videoUrl: fileUrl,
                caption: caption,
                userId: userId.toString(),
                queueId: queueItem.id
            });
            
            await bot.sendMessage(userId,
                `✅ ADDED TO QUEUE!\n\n` +
                `Caption:\n${caption}\n\n` +
                `Posting to Instagram + TikTok soon...`
            );
            
        } catch (err) {
            await bot.sendMessage(userId,
                `⚠️ Video saved but posting failed\n` +
                `Error: ${err.message}`
            );
        }
    } else {
        await bot.sendMessage(userId,
            `✅ Video queued\n` +
            `⚠️ Make.com not connected yet\n` +
            `Add MAKE_WEBHOOK_URL to Railway variables`
        );
    }
});

// Handle regular messages
bot.on('message', async (msg) => {
    if (msg.text && !msg.text.startsWith('/') && !msg.video) {
        const userId = msg.chat.id;
        await bot.sendChatAction(userId, 'typing');
        const response = await chatWithAI(userId, msg.text);
        await bot.sendMessage(userId, response);
    }
});

// ==================== EXPRESS SERVER ====================
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
    res.json({
        status: 'online',
        memory: {
            users: Object.keys(memory.users).length,
            conversations: Object.keys(memory.conversations).length,
            queue: memory.queue.length
        },
        ai: 'Gemini Flash Lite',
        uptime: process.uptime()
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', time: new Date().toISOString() });
});

// Webhook for Make.com updates
app.post('/webhook', (req, res) => {
    const { action, queueId, status, url } = req.body;
    
    if (action === 'update_status' && queueId) {
        const item = memory.queue.find(q => q.id === queueId);
        if (item) {
            item.status = status;
            item.postUrl = url;
            saveMemory();
            
            // Notify user
            bot.sendMessage(item.userId, 
                `✅ POSTED!\n\n` +
                `Platform: ${status}\n` +
                `Link: ${url || 'Check your profile'}`
            );
        }
    }
    
    res.json({ received: true });
});

app.listen(CONFIG.PORT, () => {
    console.log(`🚀 OpenClaw Cloud running on port ${CONFIG.PORT}`);
    console.log(`🤖 Using Gemini Flash Lite (Free)`);
    console.log(`☁️ 100% Cloud - No PC needed`);
});

// Keep alive
setInterval(() => {
    console.log('💓 Heartbeat:', new Date().toISOString());
}, 30000);