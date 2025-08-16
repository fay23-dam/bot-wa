/* index.js */
const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const chalk = require("chalk");
const qrcode = require("qrcode-terminal");
const express = require("express");

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

// --- Auto-ping server agar tidak sleep ---
const app = express();
app.get("/", (_, res) => res.send("Bot is alive!"));
app.listen(3000, () => logger.info("[PING] Auto-ping server ready on port 3000"));
// ---------------------------------------

/* cache untuk anti-duplikat */
const seen = new Set();

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./sesi");
  const { version, isLatest } = await fetchLatestBaileysVersion();
  logger.info(`WA v${version.join(".")} | latest: ${isLatest}`);

  const sazara = makeWASocket({
    logger: pino({ level: "silent" }),
    auth: state,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    version,
    syncFullHistory: false
  });

  sazara.ev.on("creds.update", saveCreds);

  sazara.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      logger.info("Scan QR:");
      qrcode.generate(qr, { small: true });
    }
    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== 401;
      if (shouldReconnect) {
        logger.warn("Reconnecting…");
        connectToWhatsApp();
      } else {
        logger.error("Unauthorized, please scan QR again.");
      }
    } else if (connection === "open") {
      logger.info("✅ Bot ready");
    }
  });

  sazara.ev.on("messages.upsert", async (m) => {
    for (const msg of m.messages) {
      if (!msg.message || msg.key.fromMe) continue;

      const id = msg.key.id;
      if (seen.has(id)) continue;
      seen.add(id);

      const sender = msg.key.remoteJid;

      const isBroadcast = sender.endsWith("@broadcast");
      const isStatus = sender === "status@broadcast";

      const body =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        "";

      // 🔒 Blokir pesan dari saluran/status yang mengandung copyright
      if (body.includes("Copyright © growagarden.info")) continue;

      if (isBroadcast || isStatus) continue;

      const push = msg.pushName || "Unknown";
      const dir = sender.endsWith("@g.us") ? "GROUP" : "PRIVATE";
      const who = msg.key.participant
        ? `${push} (via group ${sender.split("@")[0]})`
        : push;

      console.log(
        chalk.gray(`[${new Date().toLocaleTimeString()}]`),
        chalk.green(`[${dir}]`),
        who,
        `: ${body}`
      );

      require("./Sazara")(sazara, { messages: [msg] });
    }
  });
}

connectToWhatsApp();