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
const CATEGORIES = ["seed", "gear", "egg", "honey", "cosmetics", "travelingmerchant"];

// Daftar item langka
const RARE_ITEMS = [
  "grandmaster sprinkler",
  "levelup lollipop",
  "master sprinkler",
  "godly sprinkler",
  "bug egg",
  "paradise egg",
  "romanesco",
  "elder strawberry",
  "giant pinecone",
  "burning bud",
  "sugar apple",
  "ember lily",
  "beanstalk",
  "grape",
  "mushroom",
  "pepper"
].map(item => item.toLowerCase());

// ─────────────────────────────────────────────
// 1. load / save userdata
// ─────────────────────────────────────────────
function loadUserData() {
  try {
    if (fs.existsSync(USER_DATA_PATH)) {
      const rawData = JSON.parse(fs.readFileSync(USER_DATA_PATH, "utf8"));
      const cleanedData = {};
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
    global.reloadUserData?.(); // 🔁 reload ke RAM
  } catch (e) {
    console.error("Error saving user data:", e.message);
  }
}

// Load user preferences at start
userPreferences = loadUserData();

// ─────────────────────────────────────────────
// 2. export handler
// ─────────────────────────────────────────────
module.exports = async (sazara, m) => {
  try {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const messageType = Object.keys(msg.message)[0];
    let body = "";
    if (messageType === "conversation") body = msg.message.conversation;
    else if (messageType === "extendedTextMessage") body = msg.message.extendedTextMessage.text;
    else return;

    const sender = msg.key.remoteJid;
    const isGroup = sender.endsWith("@g.us");

    // Periksa apakah ini perintah cancel
    if (body.startsWith(global.prefix + "cancel")) {
      if (userStates.has(sender)) {
        userStates.delete(sender);
        await sazara.sendMessage(sender, { text: "❌ Proses dibatalkan." }, { quoted: msg });
      } else {
        await sazara.sendMessage(sender, { text: "❌ Tidak ada proses yang sedang berjalan." }, { quoted: msg });
      }
      return;
    }

    if (userStates.has(sender)) {
      const state = userStates.get(sender);
      if (state.state === "SET_ITEMS_GAG") {
        // Jika pengguna mengirim perintah lain selama setup
        if (body.startsWith(global.prefix)) {
          userStates.delete(sender);
          // Lanjutkan untuk memproses perintah baru
        } else {
          // Proses input item
          const items = body
            .split(",")
            .map(i => i.trim().toLowerCase())
            .filter(Boolean);

          // Validasi input kosong
          if (items.length === 0) {
            await sazara.sendMessage(
              sender, 
              { text: "⚠️ Input tidak valid. Silakan masukkan item yang valid." }, 
              { quoted: msg }
            );
            return;
          }

          // Proses rareitems
          let finalItems = [];
          for (const item of items) {
            if (item === "rareitems") {
              finalItems = [...finalItems, ...RARE_ITEMS];
            } else {
              // Validasi kategori
              const category = item.split(':')[0];
              if (item.endsWith(':all') && !CATEGORIES.includes(category)) {
                await sazara.sendMessage(
                  sender, 
                  { text: `⚠️ Kategori "${category}" tidak valid. Gunakan salah satu dari: ${CATEGORIES.join(', ')}` }, 
                  { quoted: msg }
                );
                return;
              }
              finalItems.push(item);
            }
          }

          // Hapus duplikat dan simpan
          userPreferences[sender] = [...new Set(finalItems)];
          saveUserData();
          userStates.delete(sender);

          await sazara.sendMessage(
            sender, 
            { 
              text: `✅ *Berhasil disimpan!*\n\n` +
                    `Item yang dipantau:\n${userPreferences[sender].map(i => `> ${i}`).join("\n")}\n\n` +
                    `Bot akan memberi notifikasi saat item tersedia di stock!`
            }, 
            { quoted: msg }
          );
          return;
        }
      }
    }

    if (!body.startsWith(global.prefix)) return;

    const args = body.slice(global.prefix.length).trim().split(" ");
    const cmd = args.shift().toLowerCase();
    const q = args.join(" ");

    const reply = (txt) =>
      delay(300).then(() =>
        sazara.sendMessage(sender, { text: txt }, { quoted: msg })
      );
      
    const sendMedia = (url, caption) =>
      sazara.sendMessage(sender, { video: { url }, caption }, { quoted: msg });

    switch (cmd) {
      case "menu":
        let menuText = "📋 *Menu Bot Sazara*\n\n";
        menuText += "- !fb <link> - Download Facebook video\n";
        menuText += "- !ttdl <link> - Download TikTok video\n";
        menuText += "- !setitems - Atur notifikasi items\n";
        menuText += "- !myitems - Lihat items yang dipantau\n";
        menuText += "- !clearitems - Hapus semua preferensi\n";
        menuText += "- !stock - Cek stok terkini\n";
        
        if (isGroup) {
          menuText += "- !tagall <pesan> - Tag semua member grup\n\n";
        }
        
        menuText += "\n> _Bot Grow-a-Garden Stock Notifier_";
        
        await reply(menuText);
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
        
        let categoriesInfo = "*Kategori Tersedia:*\n";
        CATEGORIES.forEach(cat => {
          categoriesInfo += `- ${cat}: Gunakan \`${cat}:all\` untuk semua item\n`;
        });
        
        await reply(
          "🌱 *ATUR NOTIFIKASI ITEM*\n\n" +
          "Kirim nama item yang ingin dipantau, pisahkan dengan koma:\n" +
          "Contoh: `blueberry, seed:all, advanced sprinkler, rareitems`\n\n" +
          "`rareitems` untuk menambahkan semua item langka" +
          categoriesInfo + "\n\n" +
          `Ketik *${global.prefix}cancel* untuk membatalkan setup`
        );
        break;

      case "myitems":
        const items = userPreferences[sender] || [];
        if (items.length) {
          let responseText = "📋 *Items yang Dipantau:*\n\n";
          
          items.forEach(item => {
            if (item.endsWith(":all")) {
              const category = item.split(':')[0];
              responseText += `▸ ${category}:all ⭐ (semua item)\n`;
            } else if (RARE_ITEMS.includes(item)) {
              responseText += `▸ ${item}\n`;
            } else {
              responseText += `▸ ${item}\n`;
            }
          });
          
          await reply(responseText);
        } else {
          await reply("❌ Belum ada item yang dipantau.");
        }
        break;

      case "clearitems":
        delete userPreferences[sender];
        userStates.delete(sender);
        saveUserData();
        await reply("✅ Semua preferensi item berhasil dihapus.");
        break;

      case "stock":
  const data = await axios.get("https://gagstock.gleeze.com/grow-a-garden")
    .then(res => res.data)
    .catch(() => null);

  if (!data || data.status !== "success") return reply("❌ Gagal mengambil data stock.");

  const DECORATION_EMOJIS = {
    "beach crate":"🏖️","sign crate":"📋","red tractor":"🚜","green tractor":"🚜","compost bin":"♻️",
    "torch":"🔥","light on ground":"💡","mini tv":"📺","small stone table":"🪨","medium stone table":"🪨",
    "rock pile":"🪨","log bench":"🪑","medium wood flooring":"🧱","frog fountain":"⛲","wood pile":"🪵",
    "night staff":"🌙","crate":"📦","sign":"📝","compost":"🗑️","light":"💡",
    "tv":"📺","table":"🪑","stone":"🪨","bench":"🪑","flooring":"🧱",
    "fountain":"⛲","summer fun crate":"🏝️","log":"🪵","brown bench":"🪑","rake":"🍂",
    "bird bath":"🐦","large wood flooring":"🧱","stone lantern":"🏮","mutation spray wet":"💧",
    "mutation spray windstruck":"🌪️","staff":"🌙"
  };

  let output = "📊 *STOK TERKINI*\n";
  output += `_Update: ${new Date(data.updated_at).toLocaleTimeString()}_\n\n`;

  for (const cat of CATEGORIES) {
    const categoryData = data.data[cat];
    if (!categoryData || !categoryData.items || categoryData.items.length === 0) continue;

    if (cat === 'travelingmerchant' && categoryData.status === 'leaved') {
      continue;
    }

    let categoryName;
    switch (cat) {
      case 'seed': categoryName = '🌱 Seeds Stock'; break;
      case 'gear': categoryName = '⚙ Gear Stock'; break;
      case 'egg': categoryName = '🥚 Egg Stock'; break;
      case 'honey': categoryName = '🍯 Honey Stock'; break;
      case 'cosmetics': categoryName = '🎨 Cosmetic Items'; break;
      case 'travelingmerchant': categoryName = '🧳 Traveling Merchant'; break;
      default: categoryName = cat.toUpperCase();
    }

    output += `*${categoryName}*\n`;

    categoryData.items.forEach(item => {
      const key = item.name.toLowerCase();
      const emoji = cat === 'cosmetics' ? (DECORATION_EMOJIS[key] || item.emoji || "📦") : (item.emoji || "📦");
      const isRare = RARE_ITEMS.includes(key);
      output += `- ${emoji} ${item.name} x${item.quantity}${isRare ? " 💎" : ""}\n`;
    });
    output += "\n";
  }

  await reply(output);
  break;

      case "tagall":
        if (!isGroup) return reply("⚠️ Perintah ini hanya bisa digunakan di grup!");
        
        const meta = await sazara.groupMetadata(sender);
        const participants = meta.participants
          .filter(p => !p.id.endsWith('@s.whatsapp.net'))
          .map(p => p.id);
        
        const text = q || "Halo semua 👋";
        let tagText = text + "\n\n";
        
        participants.forEach((id) => {
          const username = id.split("@")[0];
          tagText += `@${username} `;
        });
        
        await sazara.sendMessage(sender, { 
          text: tagText, 
          mentions: participants 
        }, { quoted: msg });
        break;

      default:
        await reply(global.mess.default);
    }
  } catch (e) {
    console.log("[SAZARA ERR]", e.message);
  }
};