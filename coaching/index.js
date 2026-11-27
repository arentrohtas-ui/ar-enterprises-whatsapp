async function handleMessage(ctx, text = "", btnId = "") {
  const session = typeof ctx.getSession === "function" ? ctx.getSession() : {};
  const lang = session?.lang === "en" ? "en" : "hi";
  const businessName = ctx.business?.name || "Coaching Institute";

  const msg =
    lang === "en"
      ? `📚 *${businessName}*\nCoaching automation module is coming soon. Please contact the office for batch timings and enrollment.`
      : `📚 *${businessName}*\nकोचिंग ऑटोमेशन मॉड्यूल जल्द ही शुरू होगा। बैच समय और एडमिशन की जानकारी के लिए कृपया कार्यालय से संपर्क करें।`;

  if (typeof ctx.sendText === "function") {
    await ctx.sendText(msg);
  }
}

module.exports = {
  handleMessage,
};
