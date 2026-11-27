async function handleMessage(ctx, text = "", btnId = "") {
  const session = typeof ctx.getSession === "function" ? ctx.getSession() : {};
  const lang = session?.lang === "en" ? "en" : "hi";
  const businessName = ctx.business?.name || "School";

  const msg =
    lang === "en"
      ? `🏫 *${businessName}*\nSchool automation module is coming soon. Please contact the school office for admissions, attendance, and fees.`
      : `🏫 *${businessName}*\nस्कूल ऑटोमेशन मॉड्यूल जल्द ही शुरू होगा। एडमिशन, उपस्थिति और फ़ीस की जानकारी के लिए कृपया स्कूल कार्यालय से संपर्क करें।`;

  if (typeof ctx.sendText === "function") {
    await ctx.sendText(msg);
  }
}

module.exports = {
  handleMessage,
};
