const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const TOKEN_PREFIX = "OPD_";
const TOKEN_START_NUMBER = 101;

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

function extractNextOpdToken(existingRows = []) {
  let maxNum = TOKEN_START_NUMBER - 1;
  for (const r of existingRows) {
    const rawId = String(r?.Token_ID || r?.tokenId || "").trim();
    const match = rawId.match(/^OPD_(\d+)$/i);
    if (match) {
      const n = Number(match[1]);
      if (!Number.isNaN(n) && n > maxNum) {
        maxNum = n;
      }
    }
  }
  const nextNum = Math.max(TOKEN_START_NUMBER, maxNum + 1);
  return `${TOKEN_PREFIX}${nextNum}`;
}

async function generateNextOpdToken(ctx, spreadsheetId) {
  try {
    const res = await ctx.getSheet({
      action: "get_live_status",
      spreadsheetId,
      spreadsheet_id: spreadsheetId,
      tokenId: "",
      phone: "",
    });
    const rows = Array.isArray(res?.bookings)
      ? res.bookings
      : Array.isArray(res?.allBookings)
      ? res.allBookings
      : Array.isArray(res?.data)
      ? res.data
      : [];
    return extractNextOpdToken(rows);
  } catch (_) {
    return `${TOKEN_PREFIX}${TOKEN_START_NUMBER}`;
  }
}

async function sendButtonsMessage(
  ctx,
  { headerText, bodyText, footerText, buttons }
) {
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
      interactive.header = {
        type: "text",
        text: truncateText(headerText, 60),
      };
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

async function sendListMessage(
  ctx,
  { headerText, bodyText, footerText, buttonLabel, rows }
) {
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
      interactive.header = {
        type: "text",
        text: truncateText(headerText, 60),
      };
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
      batches: parseBatches(
        d.batches || d.Batch_Slot || d.batchesRaw || d.timing
      ),
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
    `• 💳 *पहले पेमेंट कर अपना OPD टोकन बुक कर सकते हैं*\n` +
    `• 📍 *अपना लाइव टोकन स्टेटस ट्रैक कर सकते हैं*\n\n` +
    `Your health and time matter most to us. Check doctor availability, complete payment first to book your OPD token, and track live queue status effortlessly.\n\n` +
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
        `• *Book OPD* — Select date, doctor & pay first\n` +
        `• *Track Token* — Check live queue & status\n` +
        `• *Doctor Avail* — View doctor schedule & availability`
      : `🏥 *${bizName}*\nआज हम आपकी क्या मदद कर सकते हैं?\n\n` +
        `• *Book OPD* — तारीख व डॉक्टर चुनें और पेमेंट करें\n` +
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

async function sendDayList(ctx, lang) {
  const days = getDayOptions(lang);
  const bodyText =
    lang === "en"
      ? `📅 *Select Appointment Date First:*\n\n` +
        days.map((d) => `${d.index}. *${d.display}*`).join("\n")
      : `📅 *सबसे पहले अपॉइंटमेंट की तारीख चुनें:*\n\n` +
        days.map((d) => `${d.index}. *${d.display}*`).join("\n");

  await sendButtonsMessage(ctx, {
    headerText: lang === "en" ? "Select Date" : "तारीख चुनें",
    bodyText,
    buttons: days.map((d, i) => ({
      id: `day_${i}`,
      title: lang === "en" ? d.shortLabel : `${d.shortLabel} ${d.ymd.slice(5)}`,
    })),
  });
}

async function sendDoctorListForDay(ctx, lang, dayInfo, doctors) {
  const availableDoctors = (doctors || []).filter((doc) =>
    isDoctorAvailableOnDay(doc, dayInfo)
  );

  if (!availableDoctors.length) {
    await sendButtonsMessage(ctx, {
      bodyText:
        lang === "en"
          ? `❌ No doctors are available on *${dayInfo.display}*. Please select another date.`
          : `❌ *${dayInfo.display}* को कोई डॉक्टर उपलब्ध नहीं है। कृपया दूसरी तारीख चुनें।`,
      buttons: [
        { id: "book_opd", title: lang === "en" ? "Change Date" : "तारीख बदलें" },
        {
          id: "back_menu",
          title: lang === "en" ? "Main Menu" : "मुख्य मेनू",
        },
      ],
    });
    return { availableDoctors: [] };
  }

  const bodyText =
    lang === "en"
      ? `👨‍⚕️ *Select Doctor for ${dayInfo.display}:*\n\n` +
        availableDoctors
          .map(
            (d, i) =>
              `${i + 1}. *${d.name}* (${d.specialty}) — ₹${d.opdFee}\n   _Batches: ${d.batches.join(", ")}_`
          )
          .join("\n")
      : `👨‍⚕️ *${dayInfo.display} के लिए डॉक्टर चुनें:*\n\n` +
        availableDoctors
          .map(
            (d, i) =>
              `${i + 1}. *${d.name}* (${d.specialty}) — ₹${d.opdFee}\n   _बैच: ${d.batches.join(", ")}_`
          )
          .join("\n");

  if (availableDoctors.length <= 3) {
    await sendButtonsMessage(ctx, {
      headerText: lang === "en" ? "Select Doctor" : "डॉक्टर चुनें",
      bodyText,
      buttons: availableDoctors.map((d, i) => ({
        id: `doc_${i}`,
        title: `${d.name} ₹${d.opdFee}`,
      })),
    });
    return { availableDoctors };
  }

  await sendListMessage(ctx, {
    headerText: lang === "en" ? "Select Doctor" : "डॉक्टर चुनें",
    bodyText,
    buttonLabel: lang === "en" ? "Choose Doctor" : "डॉक्टर चुनें",
    rows: availableDoctors.map((d, i) => ({
      id: `doc_${i}`,
      title: `${d.name} (₹${d.opdFee})`,
      description: `${d.specialty} | ${dayInfo.shortLabel}`,
    })),
  });

  return { availableDoctors };
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

async function initiatePaymentBeforeToken(ctx, lang, sessionData) {
  const doc = sessionData.selectedDoctor || {};
  const opdFee = Number(doc.opdFee || 0);
  const rawAdvance = Number(
    doc.advanceAmount ?? ctx.business?.advanceAmount ?? 0
  );
  const payableAmount = rawAdvance > 0 ? rawAdvance : opdFee;

  const cashfreeAppId = String(
    ctx.business?.cashfreeAppId || ctx.business?.Cashfree_App_ID || ""
  ).trim();
  const cashfreeSecretKey = String(
    ctx.business?.cashfreeSecretKey || ctx.business?.Cashfree_Secret_Key || ""
  ).trim();

  const patientName = sessionData.patientName;
  const patientAge = sessionData.patientAge;
  const patientPhone = sessionData.patientPhone;
  const visitDate = String(sessionData.visitDate || "").slice(0, 10);
  const dayLabel = sessionData.dayInfo?.shortLabel || "";
  const batchSlot = sessionData.batchSlot;
  const bizName = ctx.business?.name || "City Care OPD";
  const pendingRef = `PAY-${Date.now().toString().slice(-6)}`;

  let payLink = null;
  if (payableAmount > 0) {
    const linkPayload = {
      amountInRupees: payableAmount,
      tokenId: pendingRef,
      patientName,
      phone: patientPhone,
      description: `${bizName} - ${patientName} (${visitDate})`,
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

  const paymentUrl =
    payLink?.shortUrl ||
    payLink?.short_url ||
    payLink?.link_url ||
    payLink?.linkUrl ||
    payLink?.payment_link ||
    payLink?.url ||
    "";

  const paymentOrderId =
    payLink?.id || payLink?.link_id || payLink?.order_id || pendingRef;

  const pendingPayload = {
    ...sessionData,
    opdFee,
    payableAmount,
    paymentOrderId,
    paymentUrl,
  };

  ctx.setSession({
    lang,
    step: "WAIT_PAYMENT",
    data: pendingPayload,
  });

  if (typeof ctx.registerPendingPayment === "function") {
    ctx.registerPendingPayment(paymentOrderId, {
      ...pendingPayload,
      lang,
      businessName: bizName,
      sheetId: getClientSheetId(ctx),
    });
  }

  const dayText = dayLabel ? `${dayLabel} (${visitDate})` : visitDate;

  let msg =
    lang === "en"
      ? `💳 *Payment Required Before Token Issue*\n\n` +
        `• Patient: *${patientName}* (${patientAge} yrs)\n` +
        `• Mobile: *${patientPhone}*\n` +
        `• Date: *${dayText}*\n` +
        `• Doctor: *${doc.name}*\n` +
        `• Time Slot: *${batchSlot}*\n` +
        `• Amount to Pay: *₹${payableAmount}* (OPD Fee: ₹${opdFee})\n\n`
      : `💳 *टोकन जारी होने से पहले पेमेंट आवश्यक है*\n\n` +
        `• मरीज़: *${patientName}* (${patientAge} वर्ष)\n` +
        `• मोबाइल: *${patientPhone}*\n` +
        `• तारीख: *${dayText}*\n` +
        `• डॉक्टर: *${doc.name}*\n` +
        `• समय स्लॉट: *${batchSlot}*\n` +
        `• देय राशि: *₹${payableAmount}* (OPD फ़ीस: ₹${opdFee})\n\n`;

  if (paymentUrl) {
    msg +=
      lang === "en"
        ? `🔗 *Cashfree Payment Link:*\n${paymentUrl}\n\n` +
          `_Complete the payment first, then tap *Paid - Get Token* below._`
        : `🔗 *Cashfree पेमेंट लिंक:*\n${paymentUrl}\n\n` +
          `_पहले पेमेंट पूरा करें, फिर नीचे *Paid - Get Token* बटन दबाएं।_`;
  } else {
    msg +=
      lang === "en"
        ? `⚠️ Cashfree link could not be generated automatically. Please verify gateway credentials or tap *Paid - Get Token* after payment.`
        : `⚠️ Cashfree लिंक अपने आप नहीं बन सका। पेमेंट सेटिंग जांचें या पेमेंट के बाद *Paid - Get Token* दबाएं।`;
  }

  await sendButtonsMessage(ctx, {
    headerText: lang === "en" ? "Complete Payment" : "पेमेंट करें",
    bodyText: msg,
    buttons: [
      { id: "confirm_paid_token", title: "Paid - Get Token" },
      {
        id: "back_menu",
        title: lang === "en" ? "Cancel / Menu" : "रद्द करें / मेनू",
      },
    ],
  });
}

async function issueConfirmedTokenAfterPayment(ctx, lang, pendingData) {
  const spreadsheetId = getClientSheetId(ctx);
  const doc = pendingData.selectedDoctor || {};
  const opdFee = Number(doc.opdFee ?? pendingData.opdFee ?? 0);
  const payableAmount = Number(pendingData.payableAmount ?? opdFee);
  const patientName = pendingData.patientName;
  const patientAge = pendingData.patientAge;
  const patientPhone = pendingData.patientPhone;
  const visitDate = String(pendingData.visitDate || "").slice(0, 10);
  const dayLabel = pendingData.dayInfo?.shortLabel || "";
  const batchSlot = pendingData.batchSlot;
  const bizName = ctx.business?.name || "City Care OPD";
  const paymentOrderId = pendingData.paymentOrderId || "";

  let tokenId = pendingData.confirmedTokenId || "";

  if (!tokenId) {
    tokenId = await generateNextOpdToken(ctx, spreadsheetId);
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
      advanceFee: payableAmount,
      paidAmount: payableAmount,
      queueStatus: "Waiting",
      paymentStatus: "Paid",
      greetingSent: "Yes",
      paymentLinkId: paymentOrderId,
      paymentRefId: paymentOrderId,
    });
  }

  ctx.clearSession(true);

  const greetingText =
    lang === "en"
      ? `🙏 Welcome to *${bizName}*! Payment received & your token is confirmed.`
      : `🙏 *${bizName}* में आपका स्वागत है! पेमेंट प्राप्त हो गया है और आपका टोकन कन्फ़र्म है।`;

  const dayText = dayLabel ? `${dayLabel} (${visitDate})` : visitDate;

  const msg =
    `${greetingText}\n\n` +
    (lang === "en"
      ? `🎫 *OPD Token Confirmed*\n` +
        `• Token No.: *${tokenId}*\n` +
        `• Patient: *${patientName}* (${patientAge} yrs)\n` +
        `• Mobile: *${patientPhone}*\n` +
        `• Date: *${dayText}*\n` +
        `• Doctor: *${doc.name}*\n` +
        `• Time Slot: *${batchSlot}*\n` +
        `• Paid Amount: *₹${payableAmount}* (OPD Fee: ₹${opdFee})\n` +
        `• Payment Status: *Paid*`
      : `🎫 *OPD टोकन कन्फ़र्म*\n` +
        `• टोकन नंबर: *${tokenId}*\n` +
        `• मरीज़: *${patientName}* (${patientAge} वर्ष)\n` +
        `• मोबाइल: *${patientPhone}*\n` +
        `• तारीख: *${dayText}*\n` +
        `• डॉक्टर: *${doc.name}*\n` +
        `• समय स्लॉट: *${batchSlot}*\n` +
        `• भुगतान राशि: *₹${payableAmount}* (OPD फ़ीस: ₹${opdFee})\n` +
        `• पेमेंट स्टेटस: *Paid*`);

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
    const paySt = r.Payment_Status || r.paymentStatus || "Paid";
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
      lang === "en"
        ? "✅ Language set to *English*."
        : "✅ भाषा *हिंदी* चुनी गई है।"
    );
    await sendMainMenu(ctx, lang);
    return;
  }

  if (step === "WAIT_PAYMENT") {
    const paidConfirmed =
      id === "confirm_paid_token" ||
      ["paid", "done", "payment done", "pay done", "ho gaya", "हो गया"].includes(
        text.toLowerCase()
      );

    if (paidConfirmed) {
      await issueConfirmedTokenAfterPayment(ctx, lang, data);
      return;
    }

    const payUrlText = data.paymentUrl
      ? `\n🔗 ${data.paymentUrl}\n\n`
      : "\n\n";

    await sendButtonsMessage(ctx, {
      headerText: lang === "en" ? "Payment Pending" : "पेमेंट बाकी है",
      bodyText:
        lang === "en"
          ? `⏳ Token *OPD_101+* is issued only after payment.${payUrlText}Tap *Paid - Get Token* once your payment is done.`
          : `⏳ पेमेंट पूरा होने के बाद ही *OPD_101+* टोकन जारी होगा।${payUrlText}पेमेंट होने के बाद *Paid - Get Token* बटन दबाएं।`,
      buttons: [
        { id: "confirm_paid_token", title: "Paid - Get Token" },
        {
          id: "back_menu",
          title: lang === "en" ? "Main Menu" : "मुख्य मेनू",
        },
      ],
    });
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
      ctx.setSession({
        lang,
        step: "SELECT_DAY",
        data: {},
      });
      await sendDayList(ctx, lang);
      return;
    }

    if (id === "live_queue") {
      ctx.setSession({ lang, step: "LIVE_QUEUE_QUERY", data: {} });
      await sendButtonsMessage(ctx, {
        headerText: lang === "en" ? "Track Token" : "टोकन ट्रैक करें",
        bodyText:
          lang === "en"
            ? "🔍 Tap *My Tokens* below or enter your *Token ID* (e.g. OPD_101):"
            : "🔍 नीचे *My Tokens* दबाएं या अपनी *टोकन ID* (जैसे OPD_101) लिखें:",
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

  if (step === "SELECT_DAY") {
    const days = getDayOptions(lang);

    let idx = -1;
    if (id.startsWith("day_")) {
      idx = Number(id.replace("day_", ""));
    } else if (/^\d+$/.test(text)) {
      idx = Number(text) - 1;
    }

    if (Number.isNaN(idx) || idx < 0 || idx >= days.length) {
      await sendDayList(ctx, lang);
      return;
    }

    const dayInfo = days[idx];
    const allDoctors = await loadDoctors(ctx);
    const availableDoctors = allDoctors.filter((doc) =>
      isDoctorAvailableOnDay(doc, dayInfo)
    );

    if (!availableDoctors.length) {
      await sendDoctorListForDay(ctx, lang, dayInfo, allDoctors);
      return;
    }

    ctx.setSession({
      lang,
      step: "SELECT_DOCTOR",
      data: {
        ...data,
        dayInfo,
        visitDate: dayInfo.ymd,
        doctors: availableDoctors,
      },
    });

    await sendDoctorListForDay(ctx, lang, dayInfo, availableDoctors);
    return;
  }

  if (step === "SELECT_DOCTOR") {
    const doctors = Array.isArray(data.doctors) ? data.doctors : [];
    const dayInfo = data.dayInfo;

    let idx = -1;
    if (id.startsWith("doc_")) {
      idx = Number(id.replace("doc_", ""));
    } else if (/^\d+$/.test(text)) {
      idx = Number(text) - 1;
    }

    if (Number.isNaN(idx) || idx < 0 || idx >= doctors.length) {
      await sendDoctorListForDay(ctx, lang, dayInfo, doctors);
      return;
    }

    const selectedDoctor = doctors[idx];
    const batches = selectedDoctor.batches || [];

    ctx.setSession({
      lang,
      step: "SELECT_BATCH",
      data: {
        ...data,
        selectedDoctor,
        batches,
      },
    });
    await sendBatchList(ctx, lang, selectedDoctor, dayInfo, batches);
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

    await initiatePaymentBeforeToken(ctx, lang, {
      ...data,
      patientPhone: digits,
    });
  }
}

module.exports = {
  handleMessage,
};
