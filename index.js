/*  index.js  */
const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  proto,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

require("./settings");

/* ---------- Logger ---------- */
const logger = pino({
  level: "info",
  transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } },
});

/* ---------- Auto-ping ---------- */
const app = express();
app.get("/", (_, res) => res.send("Bot is alive!"));
app.listen(3000, () => logger.info("[PING] Auto-ping server ready on port 3000"));

/* ---------- Config ---------- */
const CATEGORIES = ["seed", "gear", "egg", "cosmetics", "travelingmerchant"];
const USER_DATA_PATH = path.join(__dirname, "userdata.json");
let userPreferences = {};
let lastSentAt = 0;           // timestamp terakhir yang sudah kita broadcast

/* ---------- User data helper ---------- */
function loadUserData() {
  try { if (fs.existsSync(USER_DATA_PATH)) return JSON.parse(fs.readFileSync(USER_DATA_PATH, "utf8")); } catch {}
  return {};
}
function saveUserData() {
  try { fs.writeFileSync(USER_DATA_PATH, JSON.stringify(userPreferences, null, 2)); } catch {}
}
global.reloadUserData = () => { userPreferences = loadUserData(); logger.info("[STOCK] User preferences reloaded."); };

/* ---------- Fetch stock (tanpa retry) ---------- */
async function fetchStockOnce() {
  try {
    const { data } = await axios.get("https://gagstock.gleeze.com/grow-a-garden");
    if (data?.status === "success") return data;
  } catch (e) {
    logger.error("[STOCK] Fetch error:", e.message);
  }
  return null;
}

/* ---------- Notification ---------- */
async function notifyUsers(sock, payload) {
  const stamp = new Date(payload.updated_at).toLocaleTimeString("id-ID", { hour12: false });
  const lines = [];

  for (const cat of CATEGORIES) {
    const d = payload.data[cat];
    if (!d?.items) continue;
    if (cat === "travelingmerchant" && d.status === "leaved") continue;

    const items = d.items.map(i => ({ ...i, name: i.name.toLowerCase() }));
    if (!items.length) continue;

    const titleMap = {
      seed: "🌱 Seeds",
      gear: "⚙️ Gear",
      egg: "🥚 Eggs",
      cosmetics: "🎨 Cosmetics",
      travelingmerchant: "🧳 Traveling Merchant",
    };

    const list = items
      .map(it => `- ${it.emoji || "📦"} ${it.name.charAt(0).toUpperCase()}${it.name.slice(1)} x${it.quantity}`)
      .join("\n");

    lines.push(`*${titleMap[cat]}*\n${list}`);
  }

  if (!lines.length) return;

  const msg = `🔔 *STOCK UPDATE*\n\n${lines.join("\n\n")}\n\n_Auto • ${stamp}_`;

  for (const [jid, prefs] of Object.entries(userPreferences)) {
    if (!prefs?.length) continue;
    try {
      if (jid.endsWith("@newsletter")) {
        const plain = proto.Message.encode({ conversation: msg }).finish();
        await sock.query({ tag: "message", attrs: { to: jid, type: "text" }, content: [{ tag: "plaintext", attrs: {}, content: plain }] });
      } else {
        await sock.sendMessage(jid, { text: msg });
      }
    } catch (e) {
      logger.error("[NOTIF]", jid, e.message);
    }
  }
}

/* ---------- Scheduler ---------- */
async function startStockMonitor(sock) {
  userPreferences = loadUserData();

  const tick = async () => {
    try {
      logger.info("[STOCK] Checking API...");
      const data = await fetchStockOnce();
      if (!data) return;

      const currentUpdatedAt = new Date(data.updated_at).getTime();
      if (currentUpdatedAt > lastSentAt) {
        await notifyUsers(sock, data);
        lastSentAt = currentUpdatedAt;
        logger.info("[STOCK] Broadcasted.");
      } else {
        logger.info("[STOCK] No new data, skip.");
      }
    } catch (e) {
      logger.error("[STOCK] Tick error:", e.message);
    }
  };

  // jalan sekali lalu setiap 5 menit
  await tick();
  setInterval(tick, 5 * 60 * 1000);
}

/* ---------- WhatsApp ---------- */
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./sesi");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    logger: pino({ level: "silent" }),
    auth: state,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    version,
    syncFullHistory: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) require("qrcode-terminal").generate(qr, { small: true });
    if (connection === "close") {
      const reconnect = lastDisconnect?.error?.output?.statusCode !== 401;
      if (reconnect) connectToWhatsApp();
      else logger.error("Unauthorized, scan QR again.");
    } else if (connection === "open") {
      logger.info("✅ Bot ready");
      startStockMonitor(sock);
    }
  });

  // pesan handler (opsional)
  const seen = new Set();
  sock.ev.on("messages.upsert", async (m) => {
    for (const msg of m.messages) {
      if (!msg.message || msg.key.fromMe) continue;
      if (seen.has(msg.key.id)) continue;
      seen.add(msg.key.id);
      const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
      if (body.includes("Copyright © growagarden.info")) continue;
      /* require("./Sazara")(sock, { messages: [msg] }); */ // uncomment jika ada handler
    }
  });
}

connectToWhatsApp();
