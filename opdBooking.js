const MSG = {
  hi: {
    menuTitle: "OPD सेवा मेनू",
    bookBtn: "टोकन बुक करें",
    statusBtn: "लाइव कतार देखें",
    timingBtn: "डॉक्टर टाइमिंग व फ़ीस",
    pickDoc: "कृपया डॉक्टर चुनें:",
    pickDate: "कृपया विज़िट की तारीख़ चुनें:",
    pickBatch: "कृपया समय का बैच चुनें:",
    askName: "कृपया मरीज़ का पूरा नाम लिखें:",
    askPhone:
      "कृपया मरीज़ का 10 अंकों का मोबाइल नंबर लिखें (या अपना ही नंबर रखने के लिए *SELF* लिखें):",
    invalidPhone: "कृपया सही 10 अंकों का मोबाइल नंबर लिखें या *SELF* भेजें।",
    statusPrompt:
      "लाइव कतार देखने के लिए अपना *Token ID* या *मरीज़ का नाम* लिखें (या सिर्फ़ *ALL* भेजें):",
    noDoctors: "अभी कोई डॉक्टर उपलब्ध नहीं है। कृपया क्लिनिक शीट में डॉक्टर जोड़ें।",
  },
  en: {
    menuTitle: "OPD Service Menu",
    bookBtn: "Book Token",
    statusBtn: "Live Queue Status",
    timingBtn: "Doctor Timing & Fee",
    pickDoc: "Please select a doctor:",
    pickDate: "Please select a visit date:",
    pickBatch: "Please select a time batch:",
    askName: "Please enter the patient's full name:",
    askPhone:
      "Please enter the patient's 10-digit mobile number (or type *SELF* to use your current number):",
    invalidPhone: "Please enter a valid 10-digit mobile number or type *SELF*.",
    statusPrompt:
      "Enter your *Token ID* or *Patient Name* to check live queue status (or type *ALL*):",
    noDoctors: "No doctors available right now. Please add doctors in the clinic sheet.",
  },
};

function getNextThreeDays() {
  const days = [];
  const now = new Date();
  for (let i = 0; i < 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const iso = `${yyyy}-${mm}-${dd}`;
    const label =
      i === 0 ? `Today (${dd}-${mm})` : i === 1 ? `Tomorrow (${dd}-${mm})` : `${dd}-${mm}-${yyyy}`;
    days.push({ iso, label });
  }
  return days;
}

function parseBatches(rawBatches) {
  if (Array.isArray(rawBatches) && rawBatches.length > 0) return rawBatches;
  const parts = String(rawBatches || "")
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : ["10:00 AM - 12:00 PM", "05:00 PM - 07:00 PM"];
}

async function loadDoctors(ctx) {
  const res = await ctx.getSheet({ action: "get_doctors" });
  if (res?.ok && Array.isArray(res.doctors) && res.doctors.length > 0) {
    return res.doctors.map((d, idx) => ({
      id: d.id || `DOC_${idx + 1}`,
      name: d.name,
      specialization: d.specialization || "General OPD",
      days: d.days || "Mon-Sat",
      batches: parseBatches(d.batches),
      opdFee: Number(d.opdFee || 0),
      advanceAmount:
        Number(d.advanceAmount || 0) > 0
          ? Number(d.advanceAmount)
          : Number(ctx.business?.advanceAmount || 0),
    }));
  }
  return [];
}

async function sendHomeMenu(ctx, lang = "hi") {
  const m = MSG[lang] || MSG.hi;
  const bizName = ctx.business?.name || "OPD Clinic";

  await ctx.sendWA({
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text:
          lang === "en"
            ? `🏥 *${bizName} — ${m.menuTitle}*\nHow can we help you today?`
            : `🏥 *${bizName} — ${m.menuTitle}*\nआज हम आपकी क्या सेवा कर सकते हैं?`,
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "opd_book", title: m.bookBtn.slice(0, 20) } },
          { type: "reply", reply: { id: "opd_status", title: m.statusBtn.slice(0, 20) } },
          { type: "reply", reply: { id: "opd_timing", title: m.timingBtn.slice(0, 20) } },
        ],
      },
    },
  });
}

async function startDoctorSelection(ctx, lang) {
  const m = MSG[lang] || MSG.hi;
  const doctors = await loadDoctors(ctx);
  if (!doctors.length) return ctx.sendText(m.noDoctors);

  ctx.setSession({
    lang,
    step: "pick_doctor",
    data: { doctors },
  });

  const rows = doctors.slice(0, 10).map((doc, idx) => ({
    id: `doc_${idx}`,
    title: doc.name.slice(0, 24),
    description: `${doc.specialization} | Fee ₹${doc.opdFee}`.slice(0, 72),
  }));

  await ctx.sendWA({
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: m.pickDoc },
      action: {
        button: lang === "en" ? "Select Doctor" : "डॉक्टर चुनें",
        sections: [{ title: lang === "en" ? "Available Doctors" : "उपलब्ध डॉक्टर", rows }],
      },
    },
  });
}

async function startDateSelection(ctx, lang) {
  const m = MSG[lang] || MSG.hi;
  const days = getNextThreeDays();
  ctx.setSession({ lang, step: "pick_date", data: { days } });

  await ctx.sendWA({
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: m.pickDate },
      action: {
        buttons: days.map((d) => ({
          type: "reply",
          reply: { id: `date_${d.iso}`, title: d.label.slice(0, 20) },
        })),
      },
    },
  });
}

async function startBatchSelection(ctx, lang, doctor) {
  const m = MSG[lang] || MSG.hi;
  const batches = parseBatches(doctor?.batches);
  ctx.setSession({ lang, step: "pick_batch", data: { batches } });

  await ctx.sendWA({
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: m.pickBatch },
      action: {
        buttons: batches.slice(0, 3).map((b, i) => ({
          type: "reply",
          reply: { id: `batch_${i}`, title: b.slice(0, 20) },
        })),
      },
    },
  });
}

async function sendDoctorTimings(ctx, lang) {
  const doctors = await loadDoctors(ctx);
  if (!doctors.length) {
    return ctx.sendText(MSG[lang]?.noDoctors || MSG.hi.noDoctors);
  }

  const lines = doctors.map(
    (d, i) =>
      `${i + 1}. *${d.name}* (${d.specialization})\n` +
      `   • Days: ${d.days}\n` +
      `   • Batches: ${parseBatches(d.batches).join(", ")}\n` +
      `   • OPD Fee: ₹${d.opdFee} | Advance: ₹${d.advanceAmount}`
  );

  await ctx.sendText(
    (lang === "en" ? "🩺 *Doctor Timings & Fee*\n\n" : "🩺 *डॉक्टर टाइमिंग व फ़ीस*\n\n") +
      lines.join("\n\n")
  );
  await sendHomeMenu(ctx, lang);
}

async function sendLiveQueueStatus(ctx, lang, queryText = "") {
  const cleanQuery = ["all", "sab", "सभी"].includes(queryText.trim().toLowerCase())
    ? ""
    : queryText.trim();

  const res = await ctx.getSheet({
    action: "get_live_status",
    query: cleanQuery,
  });

  if (!res?.ok) {
    await ctx.sendText(
      lang === "en"
        ? "Unable to fetch live status right now."
        : "अभी लाइव कतार की जानकारी नहीं मिल पाई है।"
    );
    return sendHomeMenu(ctx, lang);
  }

  let msg =
    lang === "en"
      ? `📊 *Live OPD Queue*\n• Serving Token: *${res.currentToken || "-"}*\n• Waiting Count: *${res.waitingCount ?? 0}*`
      : `📊 *लाइव OPD कतार*\n• अभी चल रहा टोकन: *${res.currentToken || "-"}*\n• इंतज़ार में मरीज़: *${res.waitingCount ?? 0}*`;

  if (Array.isArray(res.matched) && res.matched.length > 0) {
    const items = res.matched.slice(0, 5).map(
      (m) =>
        `• *${m.tokenId}* — ${m.patientName} (${m.doctorName}, ${m.visitDate} | ${m.batchSlot})\n  Status: *${m.queueStatus}* | Payment: *${m.paymentStatus}*`
    );
    msg += `\n\n` + items.join("\n");
  } else if (cleanQuery) {
    msg +=
      lang === "en"
        ? `\n\nNo booking found for "${cleanQuery}".`
        : `\n\n"${cleanQuery}" के लिए कोई बुकिंग नहीं मिली।`;
  }

  await ctx.sendText(msg);
  await sendHomeMenu(ctx, lang);
}

async function finalizeBooking(ctx, lang, sessionData) {
  const tokenId = `OPD-${Date.now().toString().slice(-6)}`;
  const doc = sessionData.selectedDoctor || {};
  const advanceFee = Number(doc.advanceAmount ?? ctx.business?.advanceAmount ?? 0);
  const opdFee = Number(doc.opdFee || 0);
  const patientName = sessionData.patientName;
  const patientPhone = sessionData.patientPhone;
  const visitDate = sessionData.visitDate;
  const batchSlot = sessionData.batchSlot;
  const bizName = ctx.business?.name || "OPD Clinic";

  let payLink = null;
  if (advanceFee > 0 && typeof ctx.createRazorpayLink === "function") {
    payLink = await ctx.createRazorpayLink({
      amountInRupees: advanceFee,
      tokenId,
      patientName,
      phone: patientPhone,
      description: `${bizName} - Advance for ${patientName} (${tokenId})`,
    });
  }

  await ctx.postSheet({
    action: "create_booking",
    tokenId,
    patientName,
    patientPhone,
    doctorId: doc.id || "",
    doctorName: doc.name || "",
    visitDate,
    batchSlot,
    opdFee,
    advanceFee,
    paidAmount: 0,
    queueStatus: "Waiting",
    greetingSent: "Yes",
    paymentLinkId: payLink?.id || "",
  });

  ctx.clearSession(true);

  const greetingText =
    lang === "en"
      ? `🙏 Welcome to *${bizName}*! Wishing you good health.`
      : `🙏 *${bizName}* में आपका स्वागत है! आपके उत्तम स्वास्थ्य की कामना करते हैं।`;

  let confirmText =
    `${greetingText}\n\n` +
    (lang === "en"
      ? `✅ *OPD Token Confirmed*\n` +
        `• Token ID: *${tokenId}*\n` +
        `• Patient: *${patientName}*\n` +
        `• Doctor: *${doc.name}*\n` +
        `• Date & Batch: *${visitDate}* | *${batchSlot}*\n` +
        `• OPD Fee: ₹${opdFee} | Advance Due: ₹${advanceFee}`
      : `✅ *OPD टोकन कन्फ़र्म*\n` +
        `• टोकन ID: *${tokenId}*\n` +
        `• मरीज़: *${patientName}*\n` +
        `• डॉक्टर: *${doc.name}*\n` +
        `• तारीख़ व बैच: *${visitDate}* | *${batchSlot}*\n` +
        `• OPD फ़ीस: ₹${opdFee} | एडवांस राशि: ₹${advanceFee}`);

  if (payLink?.shortUrl) {
    confirmText +=
      lang === "en"
        ? `\n\n💳 *Pay Advance Online:* ${payLink.shortUrl}`
        : `\n\n💳 *ऑनलाइन एडवांस पेमेंट लिंक:* ${payLink.shortUrl}`;
  } else if (advanceFee > 0) {
    confirmText +=
      lang === "en"
        ? `\n\n💳 Advance ₹${advanceFee} can be paid at the clinic counter.`
        : `\n\n💳 एडवांस ₹${advanceFee} क्लिनिक काउंटर पर भी दिया जा सकता है।`;
  }

  await ctx.sendText(confirmText);
}

async function handleMessage(ctx, text, btnId = "") {
  const session = ctx.getSession();
  const lang = session.lang || "hi";
  const m = MSG[lang] || MSG.hi;
  const low = (text || "").trim().toLowerCase();

  if (
    ["menu", "main menu", "home", "मेनू", "मदद"].includes(low) ||
    btnId === "act_menu"
  ) {
    ctx.clearSession(true);
    return sendHomeMenu(ctx, lang);
  }

  if (btnId === "opd_book" || ["book", "token", "बुक", "टोकन"].includes(low)) {
    return startDoctorSelection(ctx, lang);
  }

  if (btnId === "opd_status" || ["status", "live", "कतार", "स्टेटस"].includes(low)) {
    ctx.setSession({ lang, step: "ask_status_query" });
    return ctx.sendText(m.statusPrompt);
  }

  if (btnId === "opd_timing" || ["timing", "timings", "fee", "टाइमिंग", "फ़ीस"].includes(low)) {
    return sendDoctorTimings(ctx, lang);
  }

  if (session.step === "pick_doctor") {
    const doctors = session.data?.doctors || (await loadDoctors(ctx));
    let selected = null;
    if (btnId.startsWith("doc_")) {
      const idx = Number(btnId.replace("doc_", ""));
      selected = doctors[idx];
    } else {
      selected = doctors.find((d) => d.name.toLowerCase().includes(low));
    }
    if (!selected) return startDoctorSelection(ctx, lang);

    ctx.setSession({
      lang,
      step: "pick_date",
      data: { selectedDoctor: selected },
    });
    return startDateSelection(ctx, lang);
  }

  if (session.step === "pick_date") {
    const days = session.data?.days || getNextThreeDays();
    let chosenDate = "";
    if (btnId.startsWith("date_")) {
      chosenDate = btnId.replace("date_", "");
    } else {
      const match = days.find(
        (d) => d.iso === low || d.label.toLowerCase().includes(low)
      );
      chosenDate = match ? match.iso : days[0].iso;
    }

    ctx.setSession({
      lang,
      step: "pick_batch",
      data: { visitDate: chosenDate },
    });
    return startBatchSelection(ctx, lang, session.data?.selectedDoctor);
  }

  if (session.step === "pick_batch") {
    const batches =
      session.data?.batches || parseBatches(session.data?.selectedDoctor?.batches);
    let batchSlot = "";
    if (btnId.startsWith("batch_")) {
      const idx = Number(btnId.replace("batch_", ""));
      batchSlot = batches[idx] || batches[0];
    } else {
      batchSlot = batches.find((b) => b.toLowerCase().includes(low)) || text || batches[0];
    }

    ctx.setSession({
      lang,
      step: "ask_name",
      data: { batchSlot },
    });
    return ctx.sendText(m.askName);
  }

  if (session.step === "ask_name") {
    const patientName = (text || "").trim();
    if (!patientName) return ctx.sendText(m.askName);

    ctx.setSession({
      lang,
      step: "ask_phone",
      data: { patientName },
    });
    return ctx.sendText(m.askPhone);
  }

  if (session.step === "ask_phone") {
    const raw = (text || "").trim();
    let cleanPhone = "";

    if (["self", "mera", "मेरा", "यही"].includes(raw.toLowerCase())) {
      cleanPhone = String(ctx.from || "").replace(/\D/g, "").slice(-10);
    } else {
      const digits = raw.replace(/\D/g, "");
      if (digits.length >= 10) cleanPhone = digits.slice(-10);
    }

    if (cleanPhone.length !== 10) {
      return ctx.sendText(m.invalidPhone);
    }

    const updatedData = {
      ...session.data,
      patientPhone: cleanPhone,
    };
    return finalizeBooking(ctx, lang, updatedData);
  }

  if (session.step === "ask_status_query") {
    ctx.setSession({ lang, step: null });
    return sendLiveQueueStatus(ctx, lang, text);
  }

  return sendHomeMenu(ctx, lang);
}

async function sendDueReminders(ctx) {
  const res = await ctx.getSheet({ action: "get_due_15d_reminders" });
  const dueList = Array.isArray(res?.due) ? res.due : [];
  let sent = 0;

  for (const item of dueList) {
    const phone = String(item.patientPhone || "").replace(/\D/g, "");
    if (phone.length < 10) continue;
    const to = phone.length === 10 ? `91${phone}` : phone;
    const bizName = ctx.business?.name || "OPD Clinic";

    await ctx.sendText(
      `🔔 *15-Day Follow-Up Reminder — ${bizName}*\n\n` +
        `नमस्ते *${item.patientName}*, आपकी *${item.visitDate}* (${item.doctorName}) की OPD विज़िट को *${item.daysElapsed} दिन* पूरे हो गए हैं।\n` +
        `यदि आपको फ़ॉलो-अप चेकअप या नया टोकन चाहिए, तो *MENU* या *TOKEN* लिखें।`
    );

    await ctx.postSheet({
      action: "mark_15d_reminder_sent",
      rowIndex: item.rowIndex,
    });
    sent++;
  }

  return { sent };
}

module.exports = {
  sendHomeMenu,
  handleMessage,
  sendDueReminders,
};
