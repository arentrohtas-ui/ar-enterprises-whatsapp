const GYM_PLANS = [
  { id: "g1", name: "Monthly Plan", duration: "1 Month", fee: "₹1,000" },
  { id: "g2", name: "Quarterly Plan", duration: "3 Months", fee: "₹2,500" },
  { id: "g3", name: "Annual Plan", duration: "12 Months", fee: "₹8,000" },
];

const GYM_BATCHES = [
  { id: "gb1", title: "Morning (6-10 AM)" },
  { id: "gb2", title: "Evening (5-9 PM)" },
];

async function sendHomeMenu(ctx, lang) {
  const isEn = lang === "en";
  return ctx.sendWA({
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: isEn
          ? `💪 *${ctx.tenant.name}*\nChoose an option:`
          : `💪 *${ctx.tenant.name}*\nकृपया विकल्प चुनें:`,
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "gym_join", title: isEn ? "Join Membership" : "मेंबरशिप लें" } },
          { type: "reply", reply: { id: "gym_trial", title: isEn ? "Free Trial" : "फ़्री ट्रायल" } },
          { type: "reply", reply: { id: "gym_plans", title: isEn ? "Plans & Timing" : "प्लान व समय" } },
        ],
      },
    },
  });
}

async function sendPlanList(ctx, lang, mode) {
  const isEn = lang === "en";
  return ctx.sendWA({
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: isEn ? "Select Plan" : "प्लान चुनें" },
      body: {
        text:
          mode === "trial"
            ? isEn
              ? "Select preferred plan for free trial:"
              : "फ़्री ट्रायल के लिए प्लान चुनें:"
            : isEn
            ? "Choose your gym membership plan:"
            : "अपना जिम प्लान चुनें:",
      },
      action: {
        button: isEn ? "View Plans" : "प्लान देखें",
        sections: [
          {
            title: isEn ? "Membership Plans" : "उपलब्ध प्लान",
            rows: GYM_PLANS.map((p) => ({
              id: `${mode}_${p.id}`,
              title: p.name.slice(0, 24),
              description: `${p.duration} | ${p.fee}`.slice(0, 72),
            })),
          },
        ],
      },
    },
  });
}

async function sendShiftButtons(ctx, lang) {
  const isEn = lang === "en";
  return ctx.sendWA({
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: isEn ? "Select workout shift:" : "वर्कआउट शिफ़्ट चुनें:",
      },
      action: {
        buttons: GYM_BATCHES.map((b) => ({
          type: "reply",
          reply: { id: `shift_${b.id}`, title: b.title.slice(0, 20) },
        })),
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

  // प्लान व टाइमिंग
  if (btnId === "gym_plans" || low.includes("plan") || low.includes("fee") || low.includes("timing")) {
    const plansText = GYM_PLANS.map(
      (p, i) => `${i + 1}. *${p.name}* (${p.duration}) — *${p.fee}*`
    ).join("\n");
    return ctx.sendText(
      `💪 *${ctx.tenant.name}*\n\n${plansText}\n\n` +
        `🕒 Shifts: Morning 6:00 AM - 10:00 AM | Evening 5:00 PM - 9:00 PM` +
        (isEn ? "\n\nType *MENU* for options." : "\n\nमेनू के लिए *MENU* लिखें।")
    );
  }

  // Join या Free Trial शुरू करना
  if (btnId === "gym_join" || low.includes("join") || low.includes("member")) {
    ctx.setSession({ lang, step: "GYM_PICK_PLAN", data: { mode: "membership" } });
    return sendPlanList(ctx, lang, "membership");
  }

  if (btnId === "gym_trial" || low.includes("trial")) {
    ctx.setSession({ lang, step: "GYM_PICK_PLAN", data: { mode: "trial" } });
    return sendPlanList(ctx, lang, "trial");
  }

  // प्लान चुनने के बाद शिफ़्ट चुनना
  if (
    s.step === "GYM_PICK_PLAN" ||
    btnId.startsWith("membership_") ||
    btnId.startsWith("trial_")
  ) {
    const mode = s.data?.mode || (btnId.startsWith("trial_") ? "trial" : "membership");
    const planId = btnId.replace(/^(membership_|trial_)/, "");
    const plan = GYM_PLANS.find((p) => p.id === planId) || GYM_PLANS[0];

    ctx.setSession({ lang, step: "GYM_PICK_SHIFT", data: { mode, plan } });
    return sendShiftButtons(ctx, lang);
  }

  // शिफ़्ट चुनने के बाद मेंबर का नाम पूछना
  if (s.step === "GYM_PICK_SHIFT" || btnId.startsWith("shift_")) {
    const shiftId = btnId.replace("shift_", "");
    const shift = GYM_BATCHES.find((b) => b.id === shiftId) || GYM_BATCHES[0];

    ctx.setSession({ lang, step: "GYM_ASK_NAME", data: { ...s.data, shift: shift.title } });
    return ctx.sendText(
      isEn
        ? `🕒 Shift: *${shift.title}*\nEnter *Member Full Name*:`
        : `🕒 शिफ़्ट: *${shift.title}*\nकृपया *मेंबर का पूरा नाम* लिखें:`
    );
  }

  // नाम मिलते ही जिम की अलग शीट में सेव करना
  if (s.step === "GYM_ASK_NAME") {
    const plan = s.data?.plan || GYM_PLANS[0];
    const mode = s.data?.mode || "membership";
    const shift = s.data?.shift || "Morning";
    const refId = `${mode === "trial" ? "TRL" : "GYM"}-${Math.floor(1000 + Math.random() * 9000)}`;

    ctx.setSession({ lang, step: null, data: {} });

    await ctx.postSheet({
      sheetTab: "Gym_Members",
      action: "create_gym_entry",
      createdAt: new Date().toISOString(),
      refId,
      type: mode,
      memberName: text,
      phone: ctx.from,
      planName: plan.name,
      duration: plan.duration,
      shift,
      fee: plan.fee,
      status: mode === "trial" ? "Trial Booked" : "Registration Pending",
    });

    return ctx.sendText(
      isEn
        ? `✅ *${mode === "trial" ? "Free Trial Booked" : "Gym Membership Registered"}*\n` +
            `• ID: *${refId}*\n• Name: *${text}*\n• Plan: *${plan.name}* (${plan.fee})\n• Shift: *${shift}*\n\nType *MENU*.`
        : `✅ *${mode === "trial" ? "फ़्री ट्रायल बुक" : "जिम मेंबरशिप दर्ज"}*\n` +
            `• ID: *${refId}*\n• नाम: *${text}*\n• प्लान: *${plan.name}* (${plan.fee})\n• शिफ़्ट: *${shift}*\n\nमेनू के लिए *MENU* लिखें।`
    );
  }

  return sendHomeMenu(ctx, lang);
}

module.exports = { sendHomeMenu, handleMessage };
