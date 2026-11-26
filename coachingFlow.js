const DEFAULT_BATCHES = [
  { id: "b1", name: "Foundation Batch", timing: "07:00 AM - 09:00 AM", fee: "₹1,500/mo" },
  { id: "b2", name: "Board / Target Batch", timing: "09:30 AM - 11:30 AM", fee: "₹2,000/mo" },
  { id: "b3", name: "Evening Batch", timing: "04:00 PM - 06:00 PM", fee: "₹1,800/mo" },
];

async function sendHomeMenu(ctx, lang) {
  const isEn = lang === "en";
  return ctx.sendWA({
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: isEn
          ? `🎓 *${ctx.tenant.name}*\nChoose an option:`
          : `🎓 *${ctx.tenant.name}*\nकृपया विकल्प चुनें:`,
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "coa_adm", title: isEn ? "Admission" : "एडमिशन" } },
          { type: "reply", reply: { id: "coa_demo", title: isEn ? "Demo Class" : "डेमो क्लास" } },
          { type: "reply", reply: { id: "coa_info", title: isEn ? "Fee & Timing" : "फ़ीस व समय" } },
        ],
      },
    },
  });
}

async function sendBatchList(ctx, lang, mode) {
  const isEn = lang === "en";
  return ctx.sendWA({
    type: "interactive",
    interactive: {
      type: "list",
      header: {
        type: "text",
        text:
          mode === "demo"
            ? isEn
              ? "Book Demo"
              : "डेमो चुनें"
            : isEn
            ? "Select Batch"
            : "बैच चुनें",
      },
      body: {
        text:
          mode === "demo"
            ? isEn
              ? "Choose batch for free demo class:"
              : "फ़्री डेमो क्लास के लिए बैच चुनें:"
            : isEn
            ? "Choose your batch:"
            : "अपना बैच चुनें:",
      },
      action: {
        button: isEn ? "Batches" : "बैच सूची",
        sections: [
          {
            title: isEn ? "Coaching Batches" : "उपलब्ध बैच",
            rows: DEFAULT_BATCHES.map((b) => ({
              id: `${mode}_${b.id}`,
              title: b.name.slice(0, 24),
              description: `${b.timing} | ${b.fee}`.slice(0, 72),
            })),
          },
        ],
      },
    },
  });
}

async function handleMessage(ctx, text, btnId) {
  const s = ctx.getSession();
  const lang = s.lang || "hi";
  const isEn = lang === "en";
  const low = text.toLowerCase();

  if (low === "menu") {
    ctx.setSession({ lang, step: null, data: {} });
    return sendHomeMenu(ctx, lang);
  }

  // फ़ीस व समय
  if (btnId === "coa_info" || low.includes("fee") || low.includes("timing")) {
    const info = DEFAULT_BATCHES.map(
      (b, i) => `${i + 1}. *${b.name}*\n   Time: ${b.timing} | Fee: ${b.fee}`
    ).join("\n\n");
    return ctx.sendText(
      `🎓 *${ctx.tenant.name}*\n\n${info}` +
        (isEn ? "\n\nType *MENU* for options." : "\n\nमेनू के लिए *MENU* लिखें।")
    );
  }

  // एडमिशन या डेमो शुरू करना
  if (btnId === "coa_adm" || low.includes("admission")) {
    ctx.setSession({ lang, step: "PICK_COA_BATCH", data: { mode: "admission" } });
    return sendBatchList(ctx, lang, "admission");
  }

  if (btnId === "coa_demo" || low.includes("demo")) {
    ctx.setSession({ lang, step: "PICK_COA_BATCH", data: { mode: "demo" } });
    return sendBatchList(ctx, lang, "demo");
  }

  // बैच चुनने के बाद स्टूडेंट का नाम पूछना
  if (
    s.step === "PICK_COA_BATCH" ||
    btnId.startsWith("admission_") ||
    btnId.startsWith("demo_")
  ) {
    const mode = s.data?.mode || (btnId.startsWith("demo_") ? "demo" : "admission");
    const batchId = btnId.replace(/^(admission_|demo_)/, "");
    const batch = DEFAULT_BATCHES.find((b) => b.id === batchId) || DEFAULT_BATCHES[0];

    ctx.setSession({ lang, step: "ASK_STUDENT_NAME", data: { mode, batch } });
    return ctx.sendText(
      isEn
        ? `📚 Batch: *${batch.name}* (${batch.timing})\nEnter *Student Full Name*:`
        : `📚 बैच: *${batch.name}* (${batch.timing})\nकृपया *स्टूडेंट का पूरा नाम* लिखें:`
    );
  }

  // नाम मिलते ही कोचिंग शीट में सेव करना
  if (s.step === "ASK_STUDENT_NAME") {
    const batch = s.data?.batch || DEFAULT_BATCHES[0];
    const mode = s.data?.mode || "admission";
    const refId = `${mode === "demo" ? "DEMO" : "ADM"}-${Math.floor(1000 + Math.random() * 9000)}`;

    ctx.setSession({ lang, step: null, data: {} });

    await ctx.postSheet({
      sheetTab: "Coaching_Admissions",
      action: "create_coaching_entry",
      createdAt: new Date().toISOString(),
      refId,
      type: mode,
      studentName: text,
      phone: ctx.from,
      batchName: batch.name,
      timing: batch.timing,
      fee: batch.fee,
      status: mode === "demo" ? "Demo Scheduled" : "Admission Requested",
    });

    return ctx.sendText(
      isEn
        ? `✅ *${mode === "demo" ? "Demo Booked" : "Admission Request Saved"}*\n` +
            `• ID: *${refId}*\n• Student: *${text}*\n• Batch: *${batch.name}* (${batch.timing})\n• Fee: ${batch.fee}\n\nType *MENU*.`
        : `✅ *${mode === "demo" ? "डेमो क्लास बुक" : "एडमिशन अनुरोध दर्ज"}*\n` +
            `• ID: *${refId}*\n• स्टूडेंट: *${text}*\n• बैच: *${batch.name}* (${batch.timing})\n• फ़ीस: ${batch.fee}\n\nमेनू के लिए *MENU* लिखें।`
    );
  }

  return sendHomeMenu(ctx, lang);
}

module.exports = { sendHomeMenu, handleMessage };
