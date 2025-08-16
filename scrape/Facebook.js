const axios = require('axios');

module.exports = async (url, sendMedia, reply) => {
  try {
    const apiUrl = `https://fbdown.vercel.app/api/get?url=${encodeURIComponent(url.trim())}`;
    const response = await axios.get(apiUrl);

    // Log the entire response for debugging
    console.log("[FACEBOOK RESPONSE FULL]", JSON.stringify(response.data, null, 2));

    if (response.data.error) {
      throw new Error(response.data.error);
    }

    // CORRECTED: Access hd/sd directly from response.data
    const hdUrl = response.data.hd || null;
    const sdUrl = response.data.sd || null;

    console.log("HD URL:", hdUrl);
    console.log("SD URL:", sdUrl);

    if (hdUrl) {
      await sendMedia(hdUrl, "✅ HD Facebook Video");
    } else if (sdUrl) {
      await sendMedia(sdUrl, "✅ SD Facebook Video");
    } else {
      await reply("❌ No video found for this Facebook URL.");
    }

    return {
      success: true,
      hd: hdUrl,
      sd: sdUrl
    };
  } catch (error) {
    console.error('Facebook Download Error:', error.message);
    await reply("❌ Failed to fetch Facebook video.");
    return {
      success: false,
      message: error.response?.data?.error || error.message
    };
  }
};