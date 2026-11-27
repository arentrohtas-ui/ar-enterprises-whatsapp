async function sendWelcomeAndLanguage(ctx) {
  const bizName = ctx.business?.name || "City Care OPD";
  const msg =
    `🏥✨ *${bizName} — डिजिटल OPD सेवा में आपका हार्दिक स्वागत है!* ✨🏥\n` +
    `✨ *Warm Welcome to ${bizName} Digital OPD Care!* ✨\n\n` +
    `आपका स्वास्थ्य और समय हमारे लिए सबसे महत्वपूर्ण है। अब आप बिना लंबी लाइन में लगे घर बैठे आसानी से:\n` +
    `• 👨‍⚕️ *डॉक्टर व उपलब्धता देख सकते हैं*\n` +
    `• 🎫 *अपना OPD टोकन बुक व पेमेंट कर सकते हैं*\n` +
    `• 📍 *अपना लाइव टोकन स्टेटस ट्रैक कर सकते हैं*\n\n` +
    `Your health and time matter most to us. Here you can easily check doctor availability, book & pay for your OPD token, and track live queue status.\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🌐 *कृपया अपनी पसंदीदा भाषा चुनें / Please select your language:*\n\n` +
    `1️⃣ *हिंदी*\n` +
    `2️⃣ *English*`;

  await ctx.sendText(msg);
}
