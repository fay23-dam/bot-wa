require("./settings");
const tiktok2 = require("./scrape/Tiktok");
const facebook = require("./scrape/Facebook");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const USER_DATA_PATH = path.join(__dirname, "userdata.json");
const userStates = new Map();
let userPreferences = {};

// Define constant categories based on API structure
const CATEGORIES = ["seed", "gear", "egg", "honey", "cosmetics", "travelingmerchant"];

// ✅ Fungsi untuk parse countdown string ke milliseconds
function parseCountdownToMs(countdownStr) {
  if (!countdownStr) return 0;
  
  const parts = countdownStr.split(' ');
  let totalMs = 0;
  
  for (const part of parts) {
    if (part.endsWith('h')) {
      totalMs += parseInt(part) * 60 * 60 * 1000;
    } else if (part.endsWith('m')) {
      totalMs += parseInt(part) * 60 * 1000;
    } else if (part.endsWith('s')) {
      totalMs += parseInt(part) * 1000;
    }
  }
  
  return totalMs;
}

function loadUserData() {
  try {
    if (fs.existsSync(USER_DATA_PATH)) {
      const rawData = JSON.parse(fs.readFileSync(USER_DATA_PATH, "utf8"));
      const cleanedData = {};
      
      // Normalize all preferences to lowercase
      for (const [jid, prefs] of Object.entries(rawData)) {
        if (Array.isArray(prefs)) {
          cleanedData[jid] = prefs.map(item => item.toLowerCase());
        }
      }
      
      return cleanedData;
    }
  } catch (e) {
    console.error("Error loading user data:", e.message);
  }
  return {};
}

function saveUserData() {
  try {
    fs.writeFileSync(USER_DATA_PATH, JSON.stringify(userPreferences, null, 2));
    console.log("User data saved successfully");
  } catch (e) {
    console.error("Error saving user data:", e.message);
  }
}

userPreferences = loadUserData();

const STOCK_API_URL = "https://gagstock.gleeze.com/grow-a-garden";
let lastStockData = null;

async function fetchStockData() {
  try {
    const res = await axios.get(STOCK_API_URL);
    return res.data?.status === "success" ? res.data : null;
  } catch (e) {
    console.error("Error fetching stock data:", e.message);
    return null;
  }
}

async function notifyUsers(sazara, categoryData, categoryName, timestamp) {
  for (const [jid, prefs] of Object.entries(userPreferences)) {
    if (!prefs?.length) continue;
    
    const notifications = [];
    
    // Check all defined categories
    const items = categoryData[categoryName]?.items || [];
    for (const item of items) {
      const itemKey = item.name.toLowerCase();
      const categoryAllKey = `${categoryName}:all`;
      
      // Check if user wants this specific item or all items in category
      if (prefs.includes(itemKey) || prefs.includes(categoryAllKey)) {
        notifications.push(`▸ ${item.emoji || "📦"} ${item.name} (${item.quantity}x)`);
      }
    }
    
    if (notifications.length > 0) {
      const message = 
        `🔔 *STOCK UPDATE!*\n` +
        `*${categoryName.toUpperCase()}*\n\n` +
        `${notifications.join("\n")}\n\n` +
        `_Pesan otomatis • ${timestamp}_`;
      
      try {
        await sazara.sendMessage(jid, { text: message });
        console.log(`[NOTIF] ${notifications.length} item(s) => ${jid}`);
      } catch (error) {
        console.error(`[NOTIF ERROR] ${jid}:`, error.message);
      }
    }
  }
}

// ✅ Fungsi monitor berbasis countdown API
function startDynamicStockMonitor(sazara) {
  const scheduledTimers = {};

  // Category specific refresh intervals in milliseconds
  const refreshIntervals = {
    "seed": 5 * 60 * 1000,          // 5 minutes
    "gear": 5 * 60 * 1000,          // 5 minutes
    "egg": 15 * 60 * 1000,          // 15 minutes
    "honey": 15 * 60 * 1000,        // 15 minutes
    "cosmetics": 3 * 60 * 60 * 1000, // 3 hours
    "travelingmerchant": 4 * 60 * 60 * 1000 // 4 hours
  };

  async function scheduleCategoryRefresh(category) {
    // Clear existing timer
    if (scheduledTimers[category]) {
      clearTimeout(scheduledTimers[category]);
    }

    const data = await fetchStockData();
    if (!data || !data.data || !data.data[category]) return;

    const categoryData = data.data[category];
    let refreshInMs = refreshIntervals[category];  // Get predefined interval
    const timestamp = new Date(data.updated_at).toLocaleTimeString(); // Use API's timestamp

    // Special handling for traveling merchant
    if (category === 'travelingmerchant') {
      if (categoryData.status === 'leaved') {
        refreshInMs = parseCountdownToMs(categoryData.appearIn);
      } else {
        refreshInMs = parseCountdownToMs(categoryData.countdown);
      }
    }

    // Add 5s buffer to ensure data is updated
    refreshInMs += 5000;

    if (refreshInMs > 1000) { // Minimum 1 second
      console.log(`[SCHEDULE] ${category} refresh in ${Math.round(refreshInMs / 1000)}s`);

      scheduledTimers[category] = setTimeout(async () => {
        const newData = await fetchStockData();
        if (newData && newData.data && newData.data[category]) {
          await notifyUsers(sazara, newData.data, category, timestamp);
        }
        scheduleCategoryRefresh(category); // Reschedule
      }, refreshInMs);
    }
  }
  
  // Start initial scheduling for all categories
  CATEGORIES.forEach(category => {
    scheduleCategoryRefresh(category);
  });
  
  console.log("[MONITOR] Dynamic stock monitor started");
}

module.exports = async (sazara, m) => {
  try {
    // Initialize dynamic monitor
    if (!module.exports.monitorStarted) {
      startDynamicStockMonitor(sazara);
      module.exports.monitorStarted = true;
    }

    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const body =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";
    const sender = msg.key.remoteJid;

    // Handle interactive states (like setitems) before checking prefix
    if (userStates.has(sender)) {
      const state = userStates.get(sender);
      if (state.state === "SET_ITEMS_GAG") {
        // Handle cancel command
        if (body.toLowerCase().trim() === `${global.prefix}cancel`) {
          userStates.delete(sender);
          await sazara.sendMessage(sender, { text: "❌ Pengaturan dibatalkan." }, { quoted: msg });
          return;
        }

        // Process user input (without prefix)
        const items = body
          .split(",")
          .map(i => i.trim().toLowerCase())
          .filter(Boolean);
        
        userPreferences[sender] = items;
        saveUserData();
        userStates.delete(sender);
        
        await sazara.sendMessage(
          sender, 
          { 
            text: `✅ *Berhasil disimpan!*\n\n` +
                  `Item yang dipantau:\n${items.map(i => `▸ ${i}`).join("\n")}\n\n` +
                  `Bot akan memberi notifikasi saat item tersedia di stock!`
          }, 
          { quoted: msg }
        );
        return;
      }
    }

    // Ignore non-command messages
    if (!body.startsWith(global.prefix)) return;

    // Parse command
    const args = body.slice(global.prefix.length).trim().split(" ");
    const cmd = args.shift().toLowerCase();
    const q = args.join(" ");

    // Helper functions
    const reply = (txt) =>
      delay(300).then(() =>
        sazara.sendMessage(sender, { text: txt }, { quoted: msg })
      );
    const sendMedia = (url, caption) =>
      sazara.sendMessage(sender, { video: { url }, caption }, { quoted: msg });

    // Command handler
    switch (cmd) {
      case "menu":
        await reply(
          "📋 *Menu Bot Sazara*\n\n" +
          "• !fb <link> - Download Facebook video\n" +
          "• !ttdl <link> - Download TikTok video\n" +
          "• !tagall <pesan> - Tag semua member grup\n" +
          "• !setitems - Atur notifikasi items\n" +
          "• !myitems - Lihat items yang dipantau\n" +
          "• !clearitems - Hapus semua preferensi\n" +
          "• !stock - Cek stok terkini"
        );
        break;

      case "fb":
        if (!q) return reply("⚠️ Masukkan link Facebook.");
        await reply("🔄 Memproses...");
        try {
          const fbRes = await facebook(q, sendMedia, reply);
          if (!fbRes.success) await reply("❌ Gagal mengunduh.");
        } catch {
          await reply("❌ Gagal.");
        }
        break;

      case "ttdl":
        if (!q) return reply("⚠️ Masukkan link TikTok.");
        await reply("🔄 Memproses...");
        try {
          const res = await tiktok2(q);
          await sendMedia(res.no_watermark, "✅ Berhasil");
        } catch {
          await reply("❌ Gagal.");
        }
        break;

      case "setitems":
        userStates.set(sender, { state: "SET_ITEMS_GAG" });
        await reply(
          "🌱 *ATUR NOTIFIKASI ITEM*\n\n" +
          "Kirim nama item yang ingin dipantau, pisahkan dengan koma:\n" +
          "Contoh: `blueberry, seed:all, advanced sprinkler`\n\n" +
          "*Kategori Tersedia:*\n" +
          CATEGORIES.join(", ") + "\n\n" +
          "Gunakan `kategori:all` untuk memantau semua item dalam kategori\n\n" +
          `Ketik *${global.prefix}cancel* untuk batal`
        );
        break;

      case "myitems":
        const items = userPreferences[sender] || [];
        if (items.length) {
          await reply(
            "📋 *Item yang Dipantau:*\n\n" +
            items.map(i => `▸ ${i}`).join("\n")
          );
        } else {
          await reply("❌ Belum ada item yang dipantau.");
        }
        break;

      case "clearitems":
        delete userPreferences[sender];
        saveUserData();
        await reply("✅ Semua preferensi item berhasil dihapus.");
        break;

      case "stock":
        const data = await fetchStockData();
        if (!data) return reply("❌ Gagal mengambil data stock.");
        
        let output = "📊 *STOK TERKINI*\n";
        output += `_Update: ${new Date(data.updated_at).toLocaleTimeString()}_\n\n`;
        
        for (const cat of CATEGORIES) {
          const categoryData = data.data[cat];
          if (!categoryData || !categoryData.items || categoryData.items.length === 0) continue;
          
          output += `*${cat.toUpperCase()}*\n`;
          output += `⏱️ ${categoryData.countdown || categoryData.appearIn || "N/A"}\n`;
          
          categoryData.items.forEach(item => {
            output += `▸ ${item.emoji || "📦"} ${item.name} (${item.quantity}x)\n`;
          });
          output += "\n";
        }
        
        // Add merchant status
        if (data.data.travelingmerchant) {
          const tm = data.data.travelingmerchant;
          output += `*MERCHANT*: ${tm.merchantName || "Traveling Merchant"}\n`;
          output += `Status: ${tm.status === "leaved" ? "❌ Telah pergi" : "✅ Tersedia"}\n`;
          output += `Akan muncul: ${tm.appearIn || "N/A"}\n`;
        }
        
        await reply(output);
        break;

      case "tagall":
        if (!sender.endsWith("@g.us")) return reply("⚠️ Perintah ini hanya bisa digunakan di grup!");
        const meta = await sazara.groupMetadata(sender);
        const participants = meta.participants.map((p) => p.id);
        const text = q || "Halo semua 👋";
        let tagText = text + "\n\n";
        participants.forEach((id) => (tagText += `@${id.split("@")[0]} `));
        await sazara.sendMessage(sender, { text: tagText, mentions: participants }, { quoted: msg });
        break;

      default:
        await reply(global.mess.default);
    }
  } catch (e) {
    console.log("[SAZARA ERR]", e.message);
  }
};

module.exports.monitorStarted = false;
