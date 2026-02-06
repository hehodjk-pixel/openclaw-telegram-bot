// OpenClaw Telegram Bot
// Powered by Google Gemini AI
// Deployed on Railway

const TelegramBot = require('node-telegram-bot-api');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');

// Environment variables
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const PORT = process.env.PORT || 3000;

// Validate environment variables
if (!TELEGRAM_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN is required!');
  process.exit(1);
}

if (!GEMINI_KEY) {
  console.error('❌ GEMINI_API_KEY is required!');
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
  }
});

// Store conversation history per user (in-memory)
const conversations = new Map();

// Request counter for monitoring
let requestCount = 0;
const startTime = Date.now();

// Helper: Get conversation history
function getHistory(chatId) {
  if (!conversations.has(chatId)) {
    conversations.set(chatId, []);
  }
  return conversations.get(chatId);
}

// Helper: Add to history
function addToHistory(chatId, role, text) {
  const history = getHistory(chatId);
  history.push({
    role: role,
    parts: [{ text: text }]
  });
  
  // Keep only last 20 exchanges (40 messages)
  if (history.length > 40) {
    conversations.set(chatId, history.slice(-40));
  }
}

// Helper: Clear history
function clearHistory(chatId) {
  conversations.set(chatId, []);
}

// Command: /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'there';
  
  clearHistory(chatId);
  
  bot.sendMessage(chatId, 
    `🤖 *Welcome to OpenClaw AI Bot!*\n\n` +
    `Hi ${firstName}! I'm powered by Google Gemini AI.\n\n` +
    `*What I can do:*\n` +
    `• Answer questions\n` +
    `• Help with coding\n` +
    `• Write content\n` +
    `• Solve problems\n` +
    `• Have conversations\n\n` +
    `*Commands:*\n` +
    `/start - Start fresh conversation\n` +
    `/reset - Clear chat history\n` +
    `/help - Show this message\n` +
    `/stats - Usage statistics\n\n` +
    `Just send me any message to begin! 💬`,
    { parse_mode: 'Markdown' }
  );
});

// Command: /help
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `📚 *OpenClaw Bot Help*\n\n` +
    `*Commands:*\n` +
    `/start - Start new conversation\n` +
    `/reset - Clear chat history\n` +
    `/help - Show this help message\n` +
    `/stats - View usage statistics\n\n` +
    `*Tips:*\n` +
    `• I remember our conversation context\n` +
    `• Ask me anything - questions, coding help, writing\n` +
    `• Use /reset if I seem confused\n` +
    `• I'm available 24/7!\n\n` +
    `*Powered by:*\n` +
    `🧠 Google Gemini 2.5 Flash-Lite\n` +
    `☁️ Deployed on Railway\n` +
    `🤖 Built with OpenClaw`,
    { parse_mode: 'Markdown' }
  );
});

// Command: /reset
bot.onText(/\/reset/, (msg) => {
  const chatId = msg.chat.id;
  clearHistory(chatId);
  bot.sendMessage(chatId, 
    `🔄 *Conversation reset!*\n\n` +
    `Previous context cleared. Let's start fresh!`,
    { parse_mode: 'Markdown' }
  );
});

// Command: /stats
bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  const history = getHistory(chatId);
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  
  bot.sendMessage(chatId,
    `📊 *Statistics*\n\n` +
    `*Your Session:*\n` +
    `Messages in history: ${history.length}\n\n` +
    `*Bot Stats:*\n` +
    `Total requests processed: ${requestCount}\n` +
    `Uptime: ${hours}h ${minutes}m\n` +
    `Active users: ${conversations.size}\n\n` +
    `*System:*\n` +
    `Model: Gemini 2.5 Flash-Lite\n` +
    `Free quota: 1,000 requests/day\n` +
    `Status: ✅ Online`,
    { parse_mode: 'Markdown' }
  );
});

// Handle all text messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  
  // Ignore commands (already handled)
  if (!text || text.startsWith('/')) return;
  
  // Show typing indicator
  bot.sendChatAction(chatId, 'typing');
  
  try {
    // Increment counter
    requestCount++;
    
    // Get conversation history
    const history = getHistory(chatId);
    
    // Create chat with history
    const chat = model.startChat({ history });
    
    // Send message to Gemini
    const result = await chat.sendMessage(text);
    const response = result.response.text();
    
    // Add to history
    addToHistory(chatId, 'user', text);
    addToHistory(chatId, 'model', response);
    
    // Send response (split if too long)
    if (response.length > 4000) {
      // Split into chunks
      const chunks = response.match(/[\s\S]{1,4000}/g) || [];
      for (const chunk of chunks) {
        await bot.sendMessage(chatId, chunk);
      }
    } else {
      await bot.sendMessage(chatId, response);
    }
    
  } catch (error) {
    console.error('Error processing message:', error);
    
    let errorMessage = '❌ Sorry, I encountered an error.\n\n';
    
    if (error.message?.includes('quota')) {
      errorMessage += '⚠️ Daily quota exceeded. Please try again tomorrow or contact admin.';
    } else if (error.message?.includes('safety')) {
      errorMessage += '⚠️ Message blocked by safety filters. Please rephrase your question.';
    } else {
      errorMessage += 'Please try:\n• /reset to clear history\n• Rephrasing your message\n• /help for assistance';
    }
    
    bot.sendMessage(chatId, errorMessage);
  }
});

// Handle errors
bot.on('polling_error', (error) => {
  console.error('Polling error:', error.code, error.message);
});

// Express server for Railway health checks
const app = express();

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>OpenClaw Telegram Bot</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          max-width: 600px;
          margin: 50px auto;
          padding: 20px;
          text-align: center;
        }
        h1 { color: #0088cc; }
        .status { color: #00aa00; font-size: 24px; }
        .info { background: #f0f0f0; padding: 15px; border-radius: 8px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <h1>🤖 OpenClaw Telegram Bot</h1>
      <div class="status">✅ Status: Online</div>
      <div class="info">
        <p><strong>Model:</strong> Google Gemini 2.5 Flash-Lite</p>
        <p><strong>Uptime:</strong> ${Math.floor((Date.now() - startTime) / 1000 / 60)} minutes</p>
        <p><strong>Requests:</strong> ${requestCount}</p>
        <p><strong>Active Users:</strong> ${conversations.size}</p>
      </div>
      <p>Open Telegram and search for your bot to start chatting!</p>
    </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    requests: requestCount,
    activeUsers: conversations.size,
    timestamp: new Date().toISOString()
  });
});

app.listen(PORT, () => {
  console.log(`✅ Express server running on port ${PORT}`);
  console.log(`✅ Telegram bot initialized`);
  console.log(`🤖 OpenClaw ready to receive messages!`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down gracefully...');
  bot.stopPolling();
  process.exit(0);
});