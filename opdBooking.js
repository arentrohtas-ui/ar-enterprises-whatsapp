const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getIstNow() {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function formatDateYmd(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function truncateText(str, maxLen) {
  const s = String(str || "").trim();
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1)).trim()}…`;
}

function getDayOptions(lang = "hi") {
  const nowIst = getIstNow();
  const labels = [
    { key: "today", hi: "आज", en: "Today", col: "Today_Avail" },
    { key: "next", hi: "कल", en: "Tomorrow", col: "Next_Day_Avail" },
    {
      key: "plus2",
      hi: "परसों",
      en: "Day After Tomorrow",
      col: "Plus_2_Day_Avail",
    },
  ];

  return labels.map((item, idx) => {
    const dt = new Date(nowIst.getTime() + idx * 24 * 60 * 60 * 1000);
    const ymd = formatDateYmd(dt);
    const shortLabel = lang === "en" ? item.en : item.hi;
    return {
      index: idx + 1,
      key: item.key,
      col: item.col,
      ymd,
      shortLabel,
      display: `${shortLabel} (${ymd})`,
    };
  });
}

function normalizeAvailStatus(val) {
  const s = String(val || "").trim().toUpperCase();
  if (["A", "ABSENT", "LEAVE", "OFF", "NO", "UNAVAILABLE", "0"].includes(s)) {
    return "A";
  }
  return "P";
}

function isDoctorAvailableOnDay(doc, dayOpt) {
  const raw =
    dayOpt.key === "today"
      ? doc.todayAvail
      : dayOpt.key === "next"
      ? doc.nextDayAvail
      : doc.plus2DayAvail;
  return normalizeAvailStatus(raw) === "P";
}

function getDoctorAvailSummary(doc, lang = "hi") {
  const days = getDayOptions(lang);
  return days
    .map((d) => {
      const ok = isDoctorAvailableOnDay(doc, d);
      const badge = ok
        ? lang === "en"
          ? "Avail"
          : "उपलब्ध"
        : lang === "en"
        ? "Off"
        : "छुट्टी";
      return `${d.shortLabel}: ${badge}`;
    })
    .join(" | ");
}

function parseBatches(rawBatch) {
  if (!rawBatch) {
    return ["Morning (09:00 AM - 01:00 PM)", "Evening (04:00 PM - 08:00 PM)"];
  }
  if (Array.isArray(rawBatch)) {
    return rawBatch.map((x) => String(x).trim()).filter(Boolean);
  }
  const parts = String(rawBatch)
    .split(/[|,\n;]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length ? parts : ["Morning (09:00 AM - 01:00 PM)"];
}

function getClientSheetId(ctx) {
  return String(
    ctx.business?.sheetId ||
      ctx.business?.clientSheetId ||
      ctx.business?.Client_Sheet_ID ||
      ctx.business?.spreadsheetId ||
      ""
  ).trim();
}

async function sendButtonsMessage(ctx, { headerText, bodyText, footerText, buttons }) {
  const safeButtons = (buttons || []).slice(0, 3).map((b, i) => ({
    type: "reply",
    reply: {
      id: truncateText(b.id || `btn_${i + 1}`, 256),
      title: truncateText(b.title, 20),
    },
  }));

  if (typeof ctx.sendWA === "function" && safeButtons.length > 0) {
    const interactive = {
      type: "button",
      body: { text: truncateText(bodyText, 1024) },
      action: { buttons: safeButtons },
    };
    if (headerText) {
      interactive.header = { type: "text", text: truncateText(headerText, 60) };
    }
    if (footerText) {
      interactive.footer = { text: truncateText(footerText, 60) };
    }
    await ctx.sendWA({
      type: "interactive",
      interactive,
    });
    return;
  }

  await ctx.sendText(bodyText);
}

async function sendListMessage(ctx, { headerText, bodyText, footerText, buttonLabel, rows }) {
  const safeRows = (rows || []).slice(0, 10).map((r, i) => ({
    id: truncateText(r.id || `row_${i + 1}`, 200),
    title: truncateText(r.title, 24),
    description: r.description ? truncateText(r.description, 72) : undefined,
  }));

  if (typeof ctx.sendWA === "function" && safeRows.length > 0) {
    const interactive = {
      type: "list",
      body: { text: truncateText(bodyText, 1024) },
      action: {
        button: truncateText(buttonLabel || "Select", 20),
        sections: [
          {
            title: truncateText(headerText || "Options", 24),
            rows: safeRows,
          },
        ],
      },
    };
    if (headerText) {
      interactive.header = { type: "text", text: truncateText(headerText, 60) };
    }
    if (footerText) {
      interactive.footer = { text: truncateText(footerText, 60) };
    }
    await ctx.sendWA({
      type: "interactive",
      interactive,
    });
    return;
  }

  await ctx.sendText(bodyText);
}

async function loadDoctors(ctx) {
  const spreadsheetId = getClientSheetId(ctx);
  const res = await ctx.getSheet({
    action: "get_doctors",
    spreadsheetId,
    spreadsheet_id: spreadsheetId,
  });

  const rawList = Array.isArray(res?.doctors)
    ? res.doctors
    : Array.isArray(res?.data)
    ? res.data
    : [];

  return rawList
    .filter((d) => {
      const st = String(d.status || d.Status || "ACTIVE").trim().toUpperCase();
      return st !== "INACTIVE" && st !== "DISABLED";
    })
    .map((d, idx) => ({
      id: String(d.id || d.Doctor_ID || d.doctorId || `DOC_${idx + 1}`).trim(),
      name: String(
        d.name || d.Doctor_Name || d.doctorName || `Doctor ${idx + 1}`
      ).trim(),
      specialty: String(
        d.specialty || d.Specialization || d.dept || "General OPD"
      ).trim(),
      opdFee: Number(d.opdFee ?? d.OPD_Fee ?? d.fee ?? 0),
      advanceAmount: Number(
        d.advanceAmount ??
          d.Advance_Amount ??
          d.advance ??
          ctx.business?.advanceAmount ??
          0
      ),
      batches: parseBatches(d.batches || d.Batch_Slot || d.batchesRaw || d.timing),
      todayAvail: d.todayAvail ?? d.Today_Avail ?? "P",
      nextDayAvail: d.nextDayAvail ?? d.Next_Day_Avail ?? "P",
      plus2DayAvail: d.plus2DayAvail ?? d.Plus_2_Day_Avail ?? "P",
    }));
}

async function sendWelcomeAndLanguage(ctx) {
  const bizName = ctx.business?.name || "City Care OPD";
  const bodyText =
    `🏥✨ *${bizName} — डिजिटल OPD सेवा में आपका हार्दिक स्वागत है!* ✨🏥\n` +
    `✨ *Warm Welcome to ${bizName} Digital OPD Care!* ✨\n\n` +
    `आपका स्वास्थ्य और समय हमारे लिए सबसे महत्वपूर्ण है। यहाँ से आप आसानी से:\n` +
    `• 👨‍⚕️ *डॉक्टर व उपलब्धता देख सकते हैं*\n` +
    `• 🎫 *अपना OPD टोकन बुक व पेमेंट कर सकते हैं*\n` +
    `• 📍 *अपना लाइव टोकन स्टेटस ट्रैक कर सकते हैं*\n\n` +
    `Your health and time matter most to us. Check doctor availability, book & pay for your OPD token, and track live queue status effortlessly.\n\n` +
    `नीचे बटन दबाकर भाषा चुनें / Tap a button to select language:`;

  await sendButtonsMessage(ctx, {
    headerText: bizName,
    bodyText,
    footerText: "AR Enterprises OPD Automation",
    buttons: [
      { id: "lang_hi", title: "हिंदी" },
      { id: "lang_en", title: "English" },
    ],
  });
}

async function sendMainMenu(ctx, lang = "hi") {
  const bizName = ctx.business?.name || "City Care OPD";
  const text =
    lang === "en"
      ? `🏥 *${bizName}*\nHow can we help you today?\n\n` +
        `• *Book OPD* — Book consultation & get token\n` +
        `• *Track Token* — Check live queue & status\n` +
        `• *Doctor Avail* — View doctor schedule & availability`
      : `🏥 *${bizName}*\nआज हम आपकी क्या मदद कर सकते हैं?\n\n` +
        `• *Book OPD* — परामर्श व टोकन बुक करें\n` +
        `• *Track Token* — लाइव कतार व स्टेटस देखें\n` +
        `• *Doctor Avail* — डॉक्टर शेड्यूल व उपलब्धता देखें`;

  await sendButtonsMessage(ctx, {
    headerText: bizName,
    bodyText: text,
    footerText: "AR Enterprises OPD Automation",
    buttons: [
      { id: "book_opd", title: "Book OPD" },
      { id: "live_queue", title: "Track Token" },
      { id: "doctor_avail", title: "Doctor Avail" },
    ],
  });
}

async function sendDoctorList(ctx, lang, doctors) {
  if (!doctors.length) {
    await sendButtonsMessage(ctx, {
      bodyText:
        lang === "en"
          ? "⚠️ No doctors are currently active in the clinic schedule."
          : "⚠️ अभी क्लिनिक शेड्यूल में कोई डॉक्टर उपलब्ध नहीं है।",
      buttons: [
        {
          id: "back_menu",
          title: lang === "en" ? "Main Menu" : "मुख्य मेनू",
        },
      ],
    });
    return;
  }

  const bodyText =
    lang === "en"
      ? "👨‍⚕️ *Select a Doctor:*\n\n" +
        doctors
          .map(
            (d, i) =>
              `${i + 1}. *${d.name}* (${d.specialty}) — ₹${d.opdFee}\n   _${getDoctorAvailSummary(d, lang)}_`
          )
          .join("\n")
      : "👨‍⚕️ *डॉक्टर चुनें:*\n\n" +
        doctors
          .map(
            (d, i) =>
              `${i + 1}. *${d.name}* (${d.specialty}) — ₹${d.opdFee}\n   _${getDoctorAvailSummary(d, lang)}_`
          )
          .join("\n");

  if (doctors.length <= 3) {
    await sendButtonsMessage(ctx, {
      headerText: lang === "en" ? "Select Doctor" : "डॉक्टर चुनें",
      bodyText,
      buttons: doctors.map((d, i) => ({
        id: `doc_${i}`,
        title: `${d.name} ₹${d.opdFee}`,
      })),
    });
    return;
  }

  await sendListMessage(ctx, {
    headerText: lang === "en" ? "Select Doctor" : "डॉक्टर चुनें",
    bodyText,
    buttonLabel: lang === "en" ? "Choose Doctor" : "डॉक्टर चुनें",
    rows: doctors.map((d, i) => ({
      id: `doc_${i}`,
      title: `${d.name} (₹${d.opdFee})`,
      description: `${d.specialty} | ${getDoctorAvailSummary(d, lang)}`,
    })),
  });
}

async function sendDoctorAvailability(ctx, lang, doctors) {
  if (!doctors.length) {
    await sendButtonsMessage(ctx, {
      bodyText:
        lang === "en"
          ? "⚠️ No active doctors found right now."
          : "⚠️ अभी कोई सक्रिय डॉक्टर उपलब्ध नहीं है।",
      buttons: [
        {
          id: "back_menu",
          title: lang === "en" ? "Main Menu" : "मुख्य मेनू",
        },
      ],
    });
    return;
  }

  let msg =
    lang === "en"
      ? "🩺 *Doctor Availability Schedule:*\n\n"
      : "🩺 *डॉक्टर उपलब्धता शेड्यूल:*\n\n";

  doctors.forEach((doc, i) => {
    const days = getDayOptions(lang);
    msg += `*${i + 1}. ${doc.name}* (${doc.specialty}) — ₹${doc.opdFee}\n`;
    days.forEach((d) => {
      const ok = isDoctorAvailableOnDay(doc, d);
      const statusTxt = ok
        ? lang === "en"
          ? "✅ Available"
          : "✅ उपलब्ध"
        : lang === "en"
        ? "❌ Not Available"
        : "❌ अनुपलब्ध";
      msg += `   • ${d.display}: ${statusTxt}\n`;
    });
    msg += `   • Batches: ${doc.batches.join(", ")}\n\n`;
  });

  await sendButtonsMessage(ctx, {
    headerText: lang === "en" ? "Doctor Availability" : "डॉक्टर उपलब्धता",
    bodyText: msg.trim(),
    buttons: [
      { id: "book_opd", title: "Book OPD" },
      {
        id: "back_menu",
        title: lang === "en" ? "Main Menu" : "मुख्य मेनू",
      },
    ],
  });
}

async function sendDayList(ctx, lang, doc) {
  const days = getDayOptions(lang);
  const bodyText =
    lang === "en"
      ? `📅 *${doc.name}* (${doc.specialty} — ₹${doc.opdFee})\nSelect appointment date:\n\n` +
        days
          .map((d) => {
            const avail = isDoctorAvailableOnDay(doc, d);
            const badge = avail ? "✅ Available" : "❌ Unavailable";
            return `• *${d.display}* — ${badge}`;
          })
          .join("\n")
      : `📅 *${doc.name}* (${doc.specialty} — ₹${doc.opdFee})\nअपॉइंटमेंट की तारीख चुनें:\n\n` +
        days
          .map((d) => {
            const avail = isDoctorAvailableOnDay(doc, d);
            const badge = avail ? "✅ उपलब्ध" : "❌ अनुपलब्ध";
            return `• *${d.display}* — ${badge}`;
          })
          .join("\n");

  await sendButtonsMessage(ctx, {
    headerText: lang === "en" ? "Select Date" : "तारीख चुनें",
    bodyText,
    buttons: days.map((d, i) => ({
      id: `day_${i}`,
      title: lang === "en" ? d.shortLabel : `${d.shortLabel} ${d.ymd.slice(5)}`,
    })),
  });
}

async function sendBatchList(ctx, lang, doc, dayOpt, batches) {
  const bodyText =
    lang === "en"
      ? `⏰ *${doc.name}* — *${dayOpt.display}*\nSelect time slot:\n\n` +
        batches.map((b, i) => `${i + 1}. ${b}`).join("\n")
      : `⏰ *${doc.name}* — *${dayOpt.display}*\nसमय स्लॉट चुनें:\n\n` +
        batches.map((b, i) => `${i + 1}. ${b}`).join("\n");

  if (batches.length <= 3) {
    await sendButtonsMessage(ctx, {
      headerText: lang === "en" ? "Select Time Slot" : "समय स्लॉट चुनें",
      bodyText,
      buttons: batches.map((b, i) => ({
        id: `batch_${i}`,
        title: b,
      })),
    });
    return;
  }

  await sendListMessage(ctx, {
    headerText: lang === "en" ? "Select Time Slot" : "समय स्लॉट चुनें",
    bodyText,
    buttonLabel: lang === "en" ? "Choose Slot" : "स्लॉट चुनें",
    rows: batches.map((b, i) => ({
      id: `batch_${i}`,
      title: b,
      description: `${doc.name} | ${dayOpt.display}`,
    })),
  });
}

async function sendMobilePrompt(ctx, lang) {
  const bodyText =
    lang === "en"
      ? "📱 Tap *Use WhatsApp No.* below or type your *10-digit Mobile Number*:"
      : "📱 नीचे *Use WhatsApp No.* बटन दबाएं या अपना *10 अंकों का मोबाइल नंबर* लिखें:";

  await sendButtonsMessage(ctx, {
    headerText: lang === "en" ? "Patient Mobile" : "मरीज़ का मोबाइल",
    bodyText,
    buttons: [{ id: "use_same_phone", title: "Use WhatsApp No." }],
  });
}

async function finalizeBooking(ctx, lang, sessionData) {
  const tokenId = `OPD-${Date.now().toString().slice(-6)}`;
  const doc = sessionData.selectedDoctor || {};
  const opdFee = Number(doc.opdFee || 0);
  const rawAdvance = Number(
    doc.advanceAmount ?? ctx.business?.advanceAmount ?? 0
  );

  const cashfreeAppId = String(
    ctx.business?.cashfreeAppId || ctx.business?.Cashfree_App_ID || ""
  ).trim();
  const cashfreeSecretKey = String(
    ctx.business?.cashfreeSecretKey || ctx.business?.Cashfree_Secret_Key || ""
  ).trim();
  const hasClientGateway = Boolean(cashfreeAppId && cashfreeSecretKey);

  const advanceFee = hasClientGateway && rawAdvance > 0 ? rawAdvance : 0;

  const patientName = sessionData.patientName;
  const patientAge = sessionData.patientAge;
  const patientPhone = sessionData.patientPhone;
  const visitDate = String(sessionData.visitDate || "").slice(0, 10);
  const dayLabel = sessionData.dayInfo?.shortLabel || "";
  const batchSlot = sessionData.batchSlot;
  const bizName = ctx.business?.name || "City Care OPD";
  const spreadsheetId = getClientSheetId(ctx);

  let payLink = null;
  if (advanceFee > 0) {
    const linkPayload = {
      amountInRupees: advanceFee,
      tokenId,
      patientName,
      phone: patientPhone,
      description: `${bizName} - Advance for ${patientName} (${tokenId})`,
      cashfreeAppId,
      cashfreeSecretKey,
    };

    if (typeof ctx.createCashfreeLink === "function") {
      payLink = await ctx.createCashfreeLink(linkPayload);
    } else if (typeof ctx.createPaymentLink === "function") {
      payLink = await ctx.createPaymentLink(linkPayload);
    } else if (typeof ctx.createRazorpayLink === "function") {
      payLink = await ctx.createRazorpayLink(linkPayload);
    }
  }

  await ctx.postSheet({
    action: "create_booking",
    spreadsheetId,
    spreadsheet_id: spreadsheetId,
    tokenId,
    patientName,
    patientAge,
    patientPhone,
    doctorId: doc.id || "",
    doctorName: doc.name || "",
    visitDate,
    batchSlot,
    opdFee,
    advanceFee,
    paidAmount: 0,
    queueStatus: "Waiting",
    paymentStatus: advanceFee > 0 ? "Pending Advance" : "Pay at Counter",
    greetingSent: "Yes",
    paymentLinkId: payLink?.id || payLink?.link_id || "",
  });

  ctx.clearSession(true);

  const greetingText =
    lang === "en"
      ? `🙏 Welcome to *${bizName}*! Wishing you good health.`
      : `🙏 *${bizName}* में आपका स्वागत है! आपके उत्तम स्वास्थ्य की कामना करते हैं।`;

  const dayText = dayLabel ? `${dayLabel} (${visitDate})` : visitDate;
  const paymentUrl =
    payLink?.shortUrl ||
    payLink?.short_url ||
    payLink?.link_url ||
    payLink?.linkUrl ||
    payLink?.payment_link ||
    payLink?.url ||
    "";

  let msg =
    `${greetingText}\n\n` +
    (lang === "en"
      ? `🎫 *OPD Token Issued*\n` +
        `• Token ID: *${tokenId}*\n` +
        `• Patient: *${patientName}* (${patientAge} yrs)\n` +
        `• Mobile: *${patientPhone}*\n` +
        `• Doctor: *${doc.name}*\n` +
        `• Date: *${dayText}*\n` +
        `• Time Slot: *${batchSlot}*\n` +
        `• OPD Fee: ₹${opdFee} | Advance: ₹${advanceFee}`
      : `🎫 *OPD टोकन जारी*\n` +
        `• टोकन ID: *${tokenId}*\n` +
        `• मरीज़: *${patientName}* (${patientAge} वर्ष)\n` +
        `• मोबाइल: *${patientPhone}*\n` +
        `• डॉक्टर: *${doc.name}*\n` +
        `• तारीख: *${dayText}*\n` +
        `• समय स्लॉट: *${batchSlot}*\n` +
        `• OPD फ़ीस: ₹${opdFee} | एडवांस: ₹${advanceFee}`);

  if (paymentUrl) {
    msg +=
      lang === "en"
        ? `\n\n💳 *Complete Advance Payment Here:*\n${paymentUrl}\n\n_Once paid, your token status will update automatically._`
        : `\n\n💳 *एडवांस पेमेंट लिंक:*\n${paymentUrl}\n\n_पेमेंट के बाद आपका टोकन स्टेटस अपडेट हो जाएगा।_`;
  } else if (advanceFee > 0) {
    msg +=
      lang === "en"
        ? `\n\n⚠️ Advance ₹${advanceFee} could not generate online link; you can pay ₹${opdFee} at the clinic counter.`
        : `\n\n⚠️ ऑनलाइन एडवांस लिंक नहीं बन सका; आप क्लिनिक काउंटर पर ₹${opdFee} भुगतान कर सकते हैं।`;
  } else {
    msg +=
      lang === "en"
        ? `\n\n🏥 *Pay ₹${opdFee} at the clinic counter.*`
        : `\n\n🏥 *क्लिनिक काउंटर पर ₹${opdFee} भुगतान करें।*`;
  }

  await sendButtonsMessage(ctx, {
    headerText: lang === "en" ? "Token Confirmed" : "टोकन कन्फ़र्म",
    bodyText: msg,
    buttons: [
      { id: "live_queue", title: "Track Token" },
      { id: "book_opd", title: "Book OPD" },
      {
        id: "back_menu",
        title: lang === "en" ? "Main Menu" : "मुख्य मेनू",
      },
    ],
  });
}

async function handleLiveQueue(ctx, lang, queryText) {
  const cleanQuery = String(queryText || "").trim();
  const spreadsheetId = getClientSheetId(ctx);
  const res = await ctx.getSheet({
    action: "get_live_status",
    spreadsheetId,
    spreadsheet_id: spreadsheetId,
    tokenId: cleanQuery.toUpperCase() === "ALL" ? "" : cleanQuery,
    phone: ctx.from || "",
  });

  const rows = Array.isArray(res?.bookings)
    ? res.bookings
    : Array.isArray(res?.data)
    ? res.data
    : [];

  if (!rows.length) {
    await sendButtonsMessage(ctx, {
      bodyText:
        lang === "en"
          ? "ℹ️ No token found for this Token ID / mobile number."
          : "ℹ️ इस टोकन ID या मोबाइल नंबर के लिए कोई टोकन नहीं मिला।",
      buttons: [
        {
          id: "back_menu",
          title: lang === "en" ? "Main Menu" : "मुख्य मेनू",
        },
      ],
    });
    return;
  }

  let out =
    lang === "en"
      ? "📋 *Live Token & Queue Status:*\n\n"
      : "📋 *लाइव टोकन व कतार स्टेटस:*\n\n";

  rows.slice(0, 8).forEach((r) => {
    const tId = r.Token_ID || r.tokenId || "-";
    const pName = r.Patient_Name || r.patientName || "-";
    const dName = r.Doctor_Name || r.doctorName || "-";
    const vDate = String(r.Visit_Date || r.visitDate || "").slice(0, 10) || "-";
    const bSlot = r.Batch_Slot || r.batchSlot || "-";
    const qSt = r.Queue_Status || r.queueStatus || "Waiting";
    const paySt = r.Payment_Status || r.paymentStatus || "Pay at Counter";
    out +=
      `• *${tId}* — ${pName}\n` +
      `  Dr: *${dName}* | ${vDate} (${bSlot})\n` +
      `  Queue: *${qSt}* | Payment: *${paySt}*\n\n`;
  });

  await sendButtonsMessage(ctx, {
    headerText: lang === "en" ? "Live Queue" : "लाइव कतार",
    bodyText: out.trim(),
    buttons: [
      { id: "book_opd", title: "Book OPD" },
      {
        id: "back_menu",
        title: lang === "en" ? "Main Menu" : "मुख्य मेनू",
      },
    ],
  });
}

async function handleMessage(ctx, rawText = "", btnId = "") {
  const session = ctx.getSession();
  let lang = session.lang || "hi";
  const step = session.step || null;
  const data = { ...(session.data || {}) };
  const text = String(rawText || "").trim();
  const id = String(btnId || "").trim();

  if (
    id === "back_menu" ||
    text === "0" ||
    text.toLowerCase() === "menu" ||
    text === "मेनू"
  ) {
    ctx.setSession({ lang, step: null, data: {} });
    await sendMainMenu(ctx, lang);
    return;
  }

  const isGreeting = [
    "hi",
    "hii",
    "hello",
    "hey",
    "namaste",
    "नमस्ते",
    "start",
  ].includes(text.toLowerCase());

  if (isGreeting) {
    ctx.setSession({ lang, step: "SELECT_LANG", data: {} });
    await sendWelcomeAndLanguage(ctx);
    return;
  }

  if (step === "SELECT_LANG") {
    const lowerText = text.toLowerCase();
    const isEnglish =
      id === "lang_en" ||
      lowerText === "english" ||
      lowerText === "eng" ||
      lowerText === "en";
    const isHindi =
      id === "lang_hi" ||
      text === "हिंदी" ||
      text === "हिन्दी" ||
      lowerText === "hindi" ||
      lowerText === "hi";

    if (!isEnglish && !isHindi) {
      await sendWelcomeAndLanguage(ctx);
      return;
    }

    lang = isEnglish ? "en" : "hi";
    ctx.setSession({ lang, step: null, data: {} });
    await ctx.sendText(
      lang === "en" ? "✅ Language set to *English*." : "✅ भाषा *हिंदी* चुनी गई है।"
    );
    await sendMainMenu(ctx, lang);
    return;
  }

  if (step === "LIVE_QUEUE_QUERY") {
    const queryVal = id === "track_all" ? "ALL" : text;
    await handleLiveQueue(ctx, lang, queryVal);
    ctx.setSession({ lang, step: null, data: {} });
    return;
  }

  if (!step) {
    if (id === "book_opd") {
      const doctors = await loadDoctors(ctx);
      ctx.setSession({
        lang,
        step: "SELECT_DOCTOR",
        data: { doctors },
      });
      await sendDoctorList(ctx, lang, doctors);
      return;
    }

    if (id === "live_queue") {
      ctx.setSession({ lang, step: "LIVE_QUEUE_QUERY", data: {} });
      await sendButtonsMessage(ctx, {
        headerText: lang === "en" ? "Track Token" : "टोकन ट्रैक करें",
        bodyText:
          lang === "en"
            ? "🔍 Tap *My Tokens* below or enter your *Token ID* (e.g. OPD-123456):"
            : "🔍 नीचे *My Tokens* दबाएं या अपनी *टोकन ID* (जैसे OPD-123456) लिखें:",
        buttons: [{ id: "track_all", title: "My Tokens" }],
      });
      return;
    }

    if (id === "doctor_avail") {
      const doctors = await loadDoctors(ctx);
      await sendDoctorAvailability(ctx, lang, doctors);
      return;
    }

    if (id === "change_lang") {
      ctx.setSession({ lang, step: "SELECT_LANG", data: {} });
      await sendWelcomeAndLanguage(ctx);
      return;
    }

    await sendMainMenu(ctx, lang);
    return;
  }

  if (step === "SELECT_DOCTOR") {
    const doctors = Array.isArray(data.doctors)
      ? data.doctors
      : await loadDoctors(ctx);

    let idx = -1;
    if (id.startsWith("doc_")) {
      idx = Number(id.replace("doc_", ""));
    } else if (/^\d+$/.test(text)) {
      idx = Number(text) - 1;
    }

    if (Number.isNaN(idx) || idx < 0 || idx >= doctors.length) {
      await sendDoctorList(ctx, lang, doctors);
      return;
    }

    const selectedDoctor = doctors[idx];
    ctx.setSession({
      lang,
      step: "SELECT_DAY",
      data: { ...data, doctors, selectedDoctor },
    });
    await sendDayList(ctx, lang, selectedDoctor);
    return;
  }

  if (step === "SELECT_DAY") {
    const days = getDayOptions(lang);
    const doc = data.selectedDoctor;

    let idx = -1;
    if (id.startsWith("day_")) {
      idx = Number(id.replace("day_", ""));
    } else if (/^\d+$/.test(text)) {
      idx = Number(text) - 1;
    }

    if (Number.isNaN(idx) || idx < 0 || idx >= days.length) {
      await sendDayList(ctx, lang, doc);
      return;
    }

    const dayInfo = days[idx];
    if (!isDoctorAvailableOnDay(doc, dayInfo)) {
      await ctx.sendText(
        lang === "en"
          ? `❌ *${doc.name}* is not available on *${dayInfo.display}*. Please select another day.`
          : `❌ *${doc.name}* *${dayInfo.display}* को उपलब्ध नहीं हैं। कृपया कोई अन्य दिन चुनें।`
      );
      await sendDayList(ctx, lang, doc);
      return;
    }

    const batches = doc.batches || [];
    ctx.setSession({
      lang,
      step: "SELECT_BATCH",
      data: {
        ...data,
        dayInfo,
        visitDate: dayInfo.ymd,
        batches,
      },
    });
    await sendBatchList(ctx, lang, doc, dayInfo, batches);
    return;
  }

  if (step === "SELECT_BATCH") {
    const batches = Array.isArray(data.batches) ? data.batches : [];

    let idx = -1;
    if (id.startsWith("batch_")) {
      idx = Number(id.replace("batch_", ""));
    } else if (/^\d+$/.test(text)) {
      idx = Number(text) - 1;
    }

    if (Number.isNaN(idx) || idx < 0 || idx >= batches.length) {
      await sendBatchList(ctx, lang, data.selectedDoctor, data.dayInfo, batches);
      return;
    }

    ctx.setSession({
      lang,
      step: "ENTER_NAME",
      data: { ...data, batchSlot: batches[idx] },
    });
    await ctx.sendText(
      lang === "en"
        ? "👤 Enter *Patient Full Name*:"
        : "👤 *मरीज़ का पूरा नाम* लिखें:"
    );
    return;
  }

  if (step === "ENTER_NAME") {
    if (text.length < 2) {
      await ctx.sendText(
        lang === "en"
          ? "⚠️ Please enter a valid name."
          : "⚠️ कृपया सही नाम लिखें।"
      );
      return;
    }
    ctx.setSession({
      lang,
      step: "ENTER_AGE",
      data: { ...data, patientName: text },
    });
    await ctx.sendText(
      lang === "en"
        ? "🎂 Enter *Patient Age* (in years):"
        : "🎂 *मरीज़ की उम्र* (साल में) लिखें:"
    );
    return;
  }

  if (step === "ENTER_AGE") {
    const age = Number(text.replace(/\D/g, ""));
    if (!age || age < 1 || age > 120) {
      await ctx.sendText(
        lang === "en"
          ? "⚠️ Enter a valid age (1–120)."
          : "⚠️ कृपया सही उम्र (1 से 120 के बीच) लिखें।"
      );
      return;
    }
    ctx.setSession({
      lang,
      step: "ENTER_PHONE",
      data: { ...data, patientAge: age },
    });
    await sendMobilePrompt(ctx, lang);
    return;
  }

  if (step === "ENTER_PHONE") {
    const useSame =
      id === "use_same_phone" ||
      text.toUpperCase() === "SAME" ||
      text === "यही";
    const digits = useSame
      ? String(ctx.from || "").replace(/\D/g, "").slice(-10)
      : text.replace(/\D/g, "").slice(-10);

    if (digits.length !== 10) {
      await sendMobilePrompt(ctx, lang);
      return;
    }

    await finalizeBooking(ctx, lang, {
      ...data,
      patientPhone: digits,
    });
  }
}

module.exports = {
  handleMessage,
};
