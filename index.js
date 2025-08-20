const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  proto
} = require("@whiskeysockets/baileys");
const WebSocket = require('ws');
const pino = require("pino");
const chalk = require("chalk");
const qrcode = require("qrcode-terminal");
const express = require("express");
const fs = require("fs");
const path = require("path");

require("./settings");

const logger = pino({
  level: "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "HH:MM:ss",
      ignore: "pid,hostname"
    }
  }
});

// --- Auto-ping server ---
const app = express();
app.get("/", (_, res) => res.send("Bot is alive!"));
app.listen(3000, () => logger.info("[PING] Auto-ping server ready on port 3000"));

// --- Stock Monitor System ---
const CATEGORIES = ["seed", "gear", "egg", "cosmetics", "travelingmerchant"];
const USER_DATA_PATH = path.join(__dirname, "userdata.json");

let userPreferences = {};
let lastStockData = null;
let ws = null;

function loadUserData() {
  try {
    if (fs.existsSync(USER_DATA_PATH)) {
      return JSON.parse(fs.readFileSync(USER_DATA_PATH, "utf8"));
    }
  } catch (e) {
    logger.error("Error loading user data:", e.message);
  }
  return {};
}

function saveUserData() {
  try {
    fs.writeFileSync(USER_DATA_PATH, JSON.stringify(userPreferences, null, 2));
  } catch (e) {
    logger.error("Error saving user data:", e.message);
  }
}

global.reloadUserData = () => {
  userPreferences = loadUserData();
  logger.info("[STOCK] User preferences reloaded from disk.");
};

// --- WebSocket Connection ---
function connectWebSocket(sazara) {
  if (ws) {
    try {
      ws.close();
    } catch (e) {
      // Ignore errors when closing
    }
  }

  ws = new WebSocket('wss://gagstock.gleeze.com');

  ws.on('open', function open() {
    logger.info('[WEBSOCKET] Terhubung ke server Grow A Garden');
  });

  ws.on('message', async function message(data) {
    try {
      const newData = JSON.parse(data);
      
      if (newData?.status === "success") {
        const newUpdatedAt = new Date(newData.updated_at).getTime();
        const lastUpdatedAt = lastStockData ? new Date(lastStockData.updated_at).getTime() : 0;
        
        // Only notify if data is newer
        if (newUpdatedAt > lastUpdatedAt) {
          logger.info('[WEBSOCKET] Data stok baru diterima');
          await notifyUsers(sazara, newData);
          lastStockData = newData;
        } else {
          logger.info('[WEBSOCKET] Data diterima tetapi tidak lebih baru, mengabaikan');
        }
      }
    } catch (error) {
      logger.error('[WEBSOCKET] Error parsing data:', error.message);
    }
  });

  ws.on('close', function close() {
    logger.info('[WEBSOCKET] Koneksi ditutup, mencoba menyambung ulang dalam 5 detik...');
    setTimeout(() => connectWebSocket(sazara), 5000);
  });

  ws.on('error', function error(err) {
    logger.error('[WEBSOCKET] Error:', err.message);
  });
}

// --- Notification Logic ---
const BLOCKQUOTE_ITEMS = [
  'grandmaster sprinkler', 'levelup lollipop', 'master sprinkler', 'godly sprinkler',
  'bug egg', 'paradise egg', 'romanesco', 'cacao', 'elder strawberry', 'giant pinecone',
  'burning bud', 'sugar apple', 'ember lily', 'beanstalk', 'grape', 'mushroom', 'pepper'
].map(item => item.toLowerCase());

const DECORATION_EMOJIS = {
  "beach crate": "🏖️","sign crate": "📋","red tractor": "🚜","green tractor": "🚜","compost bin": "♻️",
  "torch": "🔥","light on ground": "💡","mini tv": "📺","small stone table": "🪨","medium stone table": "🪨",
  "rock pile": "🪨","log bench": "🪑","medium wood flooring": "🧱","frog fountain": "⛲","wood pile": "🪵",
  "night staff": "🌙","crate": "📦","sign": "📝","compost": "🗑️","light": "💡",
  "tv": "📺","table": "🪑","stone": "🪨","bench": "🪑","flooring": "🧱",
  "fountain": "⛲","summer fun crate": "🏝️","log": "🪵","brown bench": "🪑","rake": "🍂",
  "bird bath": "🐦","large wood flooring": "🧱","stone lantern": "🏮","mutation spray wet": "💧","mutation spray windstruck": "🌪️",
  "staff": "🌙"
};

async function notifyUsers(sazara, newData) {
  const timestamp = new Date().toLocaleTimeString("id-ID", {
    timeZone: "Asia/Jakarta",
    hour12: false
  });

  for (const [jid, prefs] of Object.entries(userPreferences)) {
    if (!prefs?.length) continue;

    const categoryMessages = {};
    let totalItems = 0;

    for (const category of CATEGORIES) {
      const categoryData = newData.data[category];
      if (!categoryData?.items) continue;
      if (category === 'travelingmerchant' && categoryData.status === 'leaved') continue;

      const items = categoryData.items.map(i => ({ ...i, name: i.name.toLowerCase() }));
      const hasCategoryAll = prefs.includes(`${category}:all`);
      const categoryItems = items.filter(item =>
        hasCategoryAll || prefs.includes(item.name)
      );

      if (categoryItems.length === 0) continue;

      totalItems += categoryItems.length;

      const categoryNameMap = {
        seed: '🌱 Seeds Stock',
        gear: '⚙️ Gear Stock',
        egg: '🥚 Egg Stock',
        cosmetics: '🎨 Cosmetic Items',
        travelingmerchant: '🧳 Traveling Merchant'
      };

      const itemsText = categoryItems.map(item => {
        const itemName = item.name;
        const displayName = itemName.charAt(0).toUpperCase() + itemName.slice(1);
        const emoji = DECORATION_EMOJIS[itemName] || item.emoji || "📦";
        return BLOCKQUOTE_ITEMS.includes(itemName)
          ? `> ${emoji} \`\`\`*${displayName} x${item.quantity}*\`\`\``
          : `- ${emoji} *${displayName} x${item.quantity}*`;
      }).join("\n");

      categoryMessages[category] = `*${categoryNameMap[category]}*\n${itemsText}`;
    }

    if (totalItems > 0) {
      const message = `🔔 *STOCK UPDATE!*\n\n` +
        Object.values(categoryMessages).join("\n\n") +
        `\n\n_Pesan otomatis • ${timestamp}_`;

      try {
        if (jid.endsWith('@newsletter')) {
          const msg = { conversation: message };
          const plaintext = proto.Message.encode(msg).finish();
          await sazara.query({
            tag: 'message',
            attrs: { to: jid, type: 'text' },
            content: [{ tag: 'plaintext', attrs: {}, content: plaintext }]
          });
        } else {
          await sazara.sendMessage(jid, { text: message });
        }
      } catch (error) {
        logger.error(`[NOTIF ERROR] ${jid}:`, error.message);
      }
    }
  }
}

// --- Monitor Scheduler (WebSocket Version) ---
async function startStockMonitor(sazara) {
  userPreferences = loadUserData();
  connectWebSocket(sazara);
}

// --- WhatsApp Connection ---
async function connectToWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("./sesi");
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.info(`WA v${version.join(".")} | latest: ${isLatest}`);

    const sazara = makeWASocket({
      logger: pino({ level: "silent" }),
      auth: state,
      browser: ["Ubuntu", "Chrome", "20.0.04"],
      version,
      syncFullHistory: false,
    });

    sazara.ev.on("creds.update", saveCreds);

    sazara.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        logger.info("Scan QR:");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "close") {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
        if (shouldReconnect) {
          logger.warn("Reconnecting…");
          await connectToWhatsApp();
        } else {
          logger.error("Unauthorized, please scan QR again.");
        }
      } else if (connection === "open") {
        logger.info("✅ Bot ready");
        startStockMonitor(sazara);
      }
    });

    const seen = new Set();
    sazara.ev.on("messages.upsert", async (m) => {
      for (const msg of m.messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const id = msg.key.id;
        if (seen.has(id)) continue;
        seen.add(id);

        const sender = msg.key.remoteJid;
        const isBroadcast = sender.endsWith("@broadcast");
        const isStatus = sender === "status@broadcast";
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        if (body.includes("Copyright © growagarden.info")) continue;
        if (isBroadcast || isStatus) continue;

        const push = msg.pushName || "Unknown";
        const who = msg.key.participant
          ? `${push} (via group ${sender.split("@")[0]})`
          : push;

        logger.info(`Received message from ${sender} ${who}: ${body}`);
        require("./Sazara")(sazara, { messages: [msg] });
      }
    });

  } catch (error) {
    logger.error("Error connecting to WhatsApp:", error);
  }
}

connectToWhatsApp();
