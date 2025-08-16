// scrape/Instagram.js
const { instagramdl } = require('instagram-scraper-api');

module.exports = async (url) => {
  try {
    const data = await instagramdl(url);
    // ambil kualitas tertinggi (format mp4 / jpg)
    const media = data[0]; // { url, type, quality }
    return {
      status: true,
      url: media.url,
      type: media.type, // 'image' | 'video'
    };
  } catch {
    return { status: false };
  }
};