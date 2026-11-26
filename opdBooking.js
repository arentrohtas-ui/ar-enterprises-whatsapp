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

function getDayOptions(lang = "hi") {
  const nowIst = getIstNow();
  const labels = [
    { key: "today", hi: "आज", en: "Today", col: "Today_Avail" },
    { key: "next", hi: "कल", en: "Tomorrow", col: "Next_Day_Avail" },
    { key: "plus2", hi: "परसों", en: "Day After Tomorrow", col: "Plus_2_Day_Avail" },
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

function parseBatches(rawBatch) {
  if (!rawBatch) return ["Morning (09:00 AM - 01:00 PM)", "Evening (04:00 PM - 08:00 PM)"];
  if (Array.isArray(rawBatch)) return rawBatch.map((x) => String(x).trim()).filter(Boolean);
  const parts = String(rawBatch)
    .split(/[|,\n;]/)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length ? parts : ["Morning (09:00 AM - 01:00 PM)"];
}

async function loadDoctors(ctx) {
  const res = await ctx.getSheet({ action: "get_doctors" });
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
      name: String(d.name || d.Doctor_Name || d.doctorName || `Doctor ${idx + 1}`).trim(),
      specialty: String(d.specialty || d.Specialization || d.dept || "General OPD").trim(),
      opdFee: Number(d.opdFee ?? d.OPD_Fee ?? d.fee ?? 0),
      advanceAmount: Number(
        d.advanceAmount ?? d.Advance_Amount ?? d.advance ?? ctx.business?.advanceAmount ?? 0
      ),
      batches: parseBatches(d.batches || d.Batch_Slot || d.batchesRaw || d.timing),
      todayAvail: d.todayAvail ?? d.Today_Avail ?? "P",
      nextDayAvail: d.nextDayAvail ?? d.Next_Day_Avail ?? "P",
      plus2DayAvail: d.plus2DayAvail ?? d.Plus_2_Day_Avail ?? "P",
    }));
}

async function sendMainMenu(ctx, lang) {
  const bizName = ctx.business?.name || "OPD Clinic";
  const text =
    lang === "en"
      ? `🏥 *${bizName}*\nHow can we help you today?\n\n1️⃣ *Book OPD Token*\n2️⃣ *Live Queue Status*\n3️⃣ *Change Language (हिंदी / English)*`
      : `🏥 *${bizName}*\nआज हम आपकी क्या सेवा कर सकते हैं?\n\n1️⃣ *OPD टोकन बुक करें*\n2️⃣ *लाइव कतार देखें*\n3️⃣ *भाषा बदलें (हिंदी / English)*`;

  await ctx.sendText(text);
}

async function sendDoctorList(ctx, lang, doctors) {
  if (!doctors.length) {
    await ctx.sendText(
      lang === "en"
        ? "⚠️ No doctors are currently active in the clinic schedule."
        : "⚠️ अभी क्लिनिक शेड्यूल में कोई डॉक्टर उपलब्ध नहीं है।"
    );
    return;
  }

  let msg =
    lang === "en"
      ? "👨‍⚕️ *Select a Doctor (Reply with number):*\n\n"
      : "👨‍⚕️ *डॉक्टर चुनें (नंबर लिखकर भेजें):*\n\n";

  doctors.forEach((doc, i) => {
    msg +=
      lang === "en"
        ? `${i + 1}. *${doc.name}* (${doc.specialty}) — Fee: ₹${doc.opdFee}\n`
        : `${i + 1}. *${doc.name}* (${doc.specialty}) — फ़ीस: ₹${doc.opdFee}\n`;
  });

  msg += lang === "en" ? "\nReply *0* for Main Menu." : "\nमुख्य मेनू के लिए *0* लिखें।";
  await ctx.sendText(msg);
}

async function sendDayList(ctx, lang, doc) {
  const days = getDayOptions(lang);
  let msg =
    lang === "en"
      ? `📅 *${doc.name}* — Select Day:\n\n`
      : `📅 *${doc.name}* — दिन चुनें:\n\n`;

  days.forEach((d) => {
    const avail = isDoctorAvailableOnDay(doc, d);
    const statusBadge = avail
      ? lang === "en"
        ? "✅ Available"
        : "✅ उपलब्ध"
      : lang === "en"
      ? "❌ Unavailable"
      : "❌ अनुपलब्ध";
    msg += `${d.index}. *${d.display}* — ${statusBadge}\n`;
  });

  msg += lang === "en" ? "\nReply *0* for Main Menu." : "\nमुख्य मेनू के लिए *0* लिखें।";
  await ctx.sendText(msg);
}

async function sendBatchList(ctx, lang, doc, dayOpt, batches) {
  let msg =
    lang === "en"
      ? `⏰ *${doc.name}* (${dayOpt.display})\nSelect Time Batch:\n\n`
      : `⏰ *${doc.name}* (${dayOpt.display})\nसमय बैच चुनें:\n\n`;

  batches.forEach((b, i) => {
    msg += `${i + 1}. ${b}\n`;
  });

  msg += lang === "en" ? "\nReply *0* for Main Menu." : "\nमुख्य मेनू के लिए *0* लिखें।";
  await ctx.sendText(msg);
}

async function finalizeBooking(ctx, lang, sessionData) {
  const tokenId = `OPD-${Date.now().toString().slice(-6)}`;
  const doc = sessionData.selectedDoctor || {};
  const opdFee = Number(doc.opdFee || 0);
  const rawAdvance = Number(
    doc.advanceAmount ?? ctx.business?.advanceAmount ?? 0
  );

  // क्लाइंट के पास अपनी Cashfree API key है या नहीं
  const hasClientGateway = Boolean(
    String(ctx.business?.cashfreeAppId || "").trim() &&
      String(ctx.business?.cashfreeSecretKey || "").trim()
  );

  // अपनी API key न होने पर ऑनलाइन एडवांस 0 और पूरा भुगतान काउंटर पर
  const advanceFee = hasClientGateway ? rawAdvance : 0;

  const patientName = sessionData.patientName;
  const patientAge = sessionData.patientAge;
  const patientPhone = sessionData.patientPhone;
  const visitDate = String(sessionData.visitDate || "").slice(0, 10);
  const dayLabel = sessionData.dayInfo?.shortLabel || "";
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
    paymentLinkId: payLink?.id || "",
  });

  ctx.clearSession(true);

  const greetingText =
    lang === "en"
      ? `🙏 Welcome to *${bizName}*! Wishing you good health.`
      : `🙏 *${bizName}* में आपका स्वागत है! आपके उत्तम स्वास्थ्य की कामना करते हैं।`;

  const dayText = dayLabel ? `${dayLabel} (${visitDate})` : visitDate;

  let confirmText =
    `${greetingText}\n\n` +
    (lang === "en"
      ? `✅ *OPD Token Confirmed*\n` +
        `• Token ID: *${tokenId}*\n` +
        `• Patient: *${patientName}* (${patientAge} yrs)\n` +
        `• Doctor: *${doc.name}*\n` +
        `• Day & Batch: *${dayText}* | *${batchSlot}*\n` +
        `• OPD Fee: ₹${opdFee} | Online Advance: ₹${advanceFee}`
      : `✅ *OPD टोकन कन्फ़र्म*\n` +
        `• टोकन ID: *${tokenId}*\n` +
        `• मरीज़: *${patientName}* (${patientAge} वर्ष)\n` +
        `• डॉक्टर: *${doc.name}*\n` +
        `• दिन व बैच: *${dayText}* | *${batchSlot}*\n` +
        `• OPD फ़ीस: ₹${opdFee} | ऑनलाइन एडवांस: ₹${advanceFee}`);

  if (payLink?.shortUrl) {
    confirmText +=
      lang === "en"
        ? `\n\n💳 *Pay Advance Online:* ${payLink.shortUrl}`
        : `\n\n💳 *ऑनलाइन एडवांस पेमेंट लिंक:* ${payLink.shortUrl}`;
  } else if (!hasClientGateway) {
    confirmText +=
      lang === "en"
        ? `\n\n🏥 *Full payment (₹${opdFee}) to be paid at the clinic counter.*`
        : `\n\n🏥 *पूरी फ़ीस (₹${opdFee}) क्लिनिक काउंटर पर देनी होगी।*`;
  } else if (advanceFee > 0) {
    confirmText +=
      lang === "en"
        ? `\n\n💳 Advance ₹${advanceFee} can be paid at the clinic counter.`
        : `\n\n💳 एडवांस ₹${advanceFee} क्लिनिक काउंटर पर भी दिया जा सकता है।`;
  }

  await ctx.sendText(confirmText);
}

async function handleLiveQueue(ctx, lang, queryText) {
  const cleanQuery = String(queryText || "").trim();
  const res = await ctx.getSheet({
    action: "get_live_status",
    tokenId: cleanQuery.toUpperCase() === "ALL" ? "" : cleanQuery,
    phone: ctx.from || "",
  });

  const rows = Array.isArray(res?.bookings)
    ? res.bookings
    : Array.isArray(res?.data)
    ? res.data
    : [];

  if (!rows.length) {
    await ctx.sendText(
      lang === "en"
        ? "ℹ️ No active token found for this query."
        : "ℹ️ इस विवरण के लिए कोई सक्रिय टोकन नहीं मिला।"
    );
    return;
  }

  let out = lang === "en" ? "📋 *Live OPD Queue Status:*\n\n" : "📋 *लाइव OPD कतार स्टेटस:*\n\n";
  rows.slice(0, 8).forEach((r) => {
    const tId = r.Token_ID || r.tokenId || "-";
    const pName = r.Patient_Name || r.patientName || "-";
    const dName = r.Doctor_Name || r.doctorName || "-";
    const qSt = r.Queue_Status || r.queueStatus || "Waiting";
    const paySt = r.Payment_Status || r.paymentStatus || "Pay at Counter";
    out += `• *${tId}* | ${pName} (${dName})\n  Status: *${qSt}* | Payment: *${paySt}*\n\n`;
  });

  await ctx.sendText(out.trim());
}

async function handleMessage(ctx, rawText = "", btnId = "") {
  const session = ctx.getSession();
  let lang = session.lang || "hi";
  const step = session.step || null;
  const data = { ...(session.data || {}) };
  const text = String(rawText || "").trim();
  const id = String(btnId || "").trim();

  if (text === "0" || text.toLowerCase() === "menu" || text === "मेनू") {
    ctx.clearSession(true);
    await sendMainMenu(ctx, lang);
    return;
  }

  if (step === "SELECT_LANG") {
    if (text === "2" || text.toLowerCase().includes("en") || id === "lang_en") {
      lang = "en";
    } else {
      lang = "hi";
    }
    ctx.setSession({ lang, step: null, data: {} });
    await ctx.sendText(
      lang === "en" ? "✅ Language set to *English*." : "✅ भाषा *हिंदी* चुनी गई है।"
    );
    await sendMainMenu(ctx, lang);
    return;
  }

  if (step === "LIVE_QUEUE_QUERY") {
    await handleLiveQueue(ctx, lang, text);
    ctx.clearSession(true);
    return;
  }

  if (!step) {
    if (text === "3" || id === "change_lang") {
      ctx.setSession({ lang, step: "SELECT_LANG", data: {} });
      await ctx.sendText("🌐 भाषा चुनें / Select Language:\n1. हिंदी\n2. English");
      return;
    }

    if (text === "2" || id === "live_queue") {
      ctx.setSession({ lang, step: "LIVE_QUEUE_QUERY", data: {} });
      await ctx.sendText(
        lang === "en"
          ? "🔍 Enter *Token ID* (e.g. OPD-123456) or type *ALL*:"
          : "🔍 *टोकन ID* (जैसे OPD-123456) लिखें या *ALL* भेजें:"
      );
      return;
    }

    if (text === "1" || id === "book_opd" || ["hi", "hello", "namaste", "नमस्ते", "book", "opd"].some((w) => text.toLowerCase().includes(w))) {
      const doctors = await loadDoctors(ctx);
      ctx.setSession({
        lang,
        step: "SELECT_DOCTOR",
        data: { doctors },
      });
      await sendDoctorList(ctx, lang, doctors);
      return;
    }

    await sendMainMenu(ctx, lang);
    return;
  }

  if (step === "SELECT_DOCTOR") {
    const doctors = Array.isArray(data.doctors) ? data.doctors : await loadDoctors(ctx);
    const idx = Number(text) - 1;
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
    const idx = Number(text) - 1;
    const doc = data.selectedDoctor;

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
    const idx = Number(text) - 1;
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
      lang === "en" ? "👤 Enter *Patient Full Name*:" : "👤 *मरीज़ का पूरा नाम* लिखें:"
    );
    return;
  }

  if (step === "ENTER_NAME") {
    if (text.length < 2) {
      await ctx.sendText(
        lang === "en" ? "⚠️ Please enter a valid name." : "⚠️ कृपया सही नाम लिखें।"
      );
      return;
    }
    ctx.setSession({
      lang,
      step: "ENTER_AGE",
      data: { ...data, patientName: text },
    });
    await ctx.sendText(
      lang === "en" ? "🎂 Enter *Patient Age* (in years):" : "🎂 *मरीज़ की उम्र* (साल में) लिखें:"
    );
    return;
  }

  if (step === "ENTER_AGE") {
    const age = Number(text.replace(/\D/g, ""));
    if (!age || age < 1 || age > 120) {
      await ctx.sendText(
        lang === "en" ? "⚠️ Enter a valid age (1–120)." : "⚠️ कृपया सही उम्र (1 से 120 के बीच) लिखें।"
      );
      return;
    }
    ctx.setSession({
      lang,
      step: "ENTER_PHONE",
      data: { ...data, patientAge: age },
    });
    await ctx.sendText(
      lang === "en"
        ? "📱 Enter *10-digit Mobile Number* (or reply *SAME* to use this WhatsApp number):"
        : "📱 *10 अंकों का मोबाइल नंबर* लिखें (या इसी WhatsApp नंबर के लिए *SAME* लिखें):"
    );
    return;
  }

  if (step === "ENTER_PHONE") {
    const useSame = text.toUpperCase() === "SAME" || text === "यही";
    const digits = useSame
      ? String(ctx.from || "").replace(/\D/g, "").slice(-10)
      : text.replace(/\D/g, "").slice(-10);

    if (digits.length !== 10) {
      await ctx.sendText(
        lang === "en"
          ? "⚠️ Please enter a valid 10-digit mobile number or type *SAME*."
          : "⚠️ कृपया 10 अंकों का सही मोबाइल नंबर लिखें या *SAME* भेजें।"
      );
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
