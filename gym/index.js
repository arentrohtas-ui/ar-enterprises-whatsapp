async function handleMessage(ctx, text = "", btnId = "") {
  const session = typeof ctx.getSession === "function" ? ctx.getSession() : {};
  const lang = session?.lang === "en" ? "en" : "hi";
  const businessName = ctx.business?.name || "Gym";

  const msg =
    lang === "en"
      ? `🏋️ *${businessName}*\nGym automation module is coming soon. Please contact reception for memberships and batches.`
      : `🏋️ *${businessName}*\nजिम ऑटोमेशन मॉड्यूल जल्द ही शुरू होगा। मेंबरशिप और बैच की जानकारी के लिए कृपया संपर्क करें।`;

  if (typeof ctx.sendText === "function") {
    await ctx.sendText(msg);
  }
}

module.exports = {
  handleMessage,
};
