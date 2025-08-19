const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  proto
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const chalk = require("chalk");
const qrcode = require("qrcode-terminal");
const express = require("express");
const axios = require("axios");
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
const CATEGORIES = ["seed", "gear", "egg", "honey", "cosmetics", "travelingmerchant"];
const USER_DATA_PATH = path.join(__dirname, "userdata.json");

let userPreferences = {};
let lastStockData = null;

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

async function fetchStockData() {
  try {
    const res = await axios.get("https://gagstock.gleeze.com/grow-a-garden");
    return res.data?.status === "success" ? res.data : null;
  } catch (e) {
    logger.error("Error fetching stock data:", e.message);
    return null;
  }
}

const BLOCKQUOTE_ITEMS = [
  'grandmaster sprinkler', 'levelup lollipop', 'master sprinkler', 'godly sprinkler',
  'bug egg', 'paradise egg', 'romanesco', 'elder strawberry', 'giant pinecone',
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

// --- Cache & Hash ---
function getHash(obj) {
  const crypto = require("crypto");
  return crypto.createHash("md5").update(JSON.stringify(obj)).digest("hex");
}

const lastHashPerCategory = {};
const lastUpdatePerCategory = {
  seed: 0, gear: 0, egg: 0, honey: 0, cosmetics: 0, travelingmerchant: 0
};

function shouldCheck(category) {
  const now = Date.now();
  const intervals = {
    seed: 5 * 60 * 1000,
    gear: 5 * 60 * 1000,
    egg: 30 * 60 * 1000,
    honey: 5 * 60 * 1000,
    cosmetics: 2 * 60 * 60 * 1000,
    travelingmerchant: 4 * 60 * 60 * 1000
  };
  return now - lastUpdatePerCategory[category] >= intervals[category];
}

// --- Notify Users ---
async function notifyUsers(sazara, newData) {
  const now = new Date();
  const timestamp = now.toLocaleTimeString();

  for (const [jid, prefs] of Object.entries(userPreferences)) {
    if (!prefs?.length) continue;

    const categoryMessages = {};
    let totalItems = 0;

    for (const category of CATEGORIES) {
      const categoryData = newData.data[category];
      if (!categoryData?.items) {
        lastHashPerCategory[category] = null;
        lastUpdatePerCategory[category] = Date.now();
        continue;
      }

      if (category === 'travelingmerchant' && categoryData.status === 'leaved') {
        lastHashPerCategory[category] = null;
        lastUpdatePerCategory[category] = Date.now();
        continue;
      }

      if (!shouldCheck(category)) continue;

      const items = categoryData.items.map(i => ({ ...i, name: i.name.toLowerCase() }));
      const hash = getHash(items);

      if (lastHashPerCategory[category] === hash) {
        lastUpdatePerCategory[category] = Date.now();
        continue;
      }

      lastHashPerCategory[category] = hash;
      lastUpdatePerCategory[category] = Date.now();

      const hasCategoryAll = prefs.includes(`${category}:all`);
      const categoryItems = [];

      for (const item of items) {
        const itemKey = item.name.toLowerCase();
        if (hasCategoryAll || prefs.includes(itemKey)) {
          categoryItems.push(item);
        }
      }

      if (categoryItems.length > 0) {
        totalItems += categoryItems.length;

        let categoryName;
        switch(category) {
          case 'seed': categoryName = '🌱 Seeds Stock'; break;
          case 'gear': categoryName = '⚙️ Gear Stock'; break;
          case 'egg': categoryName = '🥚 Egg Stock'; break;
          case 'honey': categoryName = '🍯 Honey Stock'; break;
          case 'cosmetics': categoryName = '🎨 Cosmetic Items'; break;
          case 'travelingmerchant': categoryName = '🧳 Traveling Merchant'; break;
          default: categoryName = category.toUpperCase();
        }

        const itemsText = categoryItems.map(item => {
          const itemName = item.name.toLowerCase();
          const displayName = item.name.charAt(0).toUpperCase() + item.name.slice(1);
          const emoji = DECORATION_EMOJIS[itemName] || item.emoji || "📦";

          return BLOCKQUOTE_ITEMS.includes(itemName)
            ? `> ${emoji} \`\`\`*${displayName} x${item.quantity}*\`\`\``
            : `- ${emoji} *${displayName} x${item.quantity}*`;
        }).join("\n");

        categoryMessages[category] = `*${categoryName}*\n${itemsText}`;
      }
    }

    if (totalItems > 0) {
      const message = `🔔 *STOCK UPDATE!*\n\n` +
        Object.values(categoryMessages).join("\n\n") +
        `\n\n_Pesan otomatis • ${timestamp}_`;

      logger.info(`[NOTIF] ${totalItems} item(s) => ${jid}`);
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

// --- Stock Monitor Scheduler ---
async function startStockMonitor(sazara) {
  userPreferences = loadUserData();

  const scheduleNextCheck = async () => {
    try {
      const now = new Date();
      const nextCheck = new Date(now);
      nextCheck.setMinutes(Math.floor(now.getMinutes() / 5) * 5 + 5);
      nextCheck.setSeconds(5);
      nextCheck.setMilliseconds(0);

      if (nextCheck < now) {
        nextCheck.setMinutes(nextCheck.getMinutes() + 5);
      }

      const delayMs = nextCheck - now;
      logger.info(`[STOCK] Next check at ${nextCheck.toLocaleTimeString()} (in ${Math.round(delayMs / 1000)}s)`);

      setTimeout(async () => {
        try {
          logger.info("[STOCK] Checking stock update...");
          const newData = await fetchStockData();
          if (newData) {
            logger.info("[STOCK] Sending stock notifications...");
            await notifyUsers(sazara, newData);
            lastStockData = newData;
          }
        } catch (e) {
          logger.error("[STOCK] Check error:", e.message);
        }
        scheduleNextCheck();
      }, delayMs);
    } catch (e) {
      logger.error("[STOCK] Scheduler error:", e.message);
      setTimeout(scheduleNextCheck, 5 * 60 * 1000);
    }
  };

  lastStockData = await fetchStockData();
  scheduleNextCheck();
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