const MSG = {
  hi: {
    menuTitle: "OPD सेवा मेनू",
    bookBtn: "टोकन बुक करें",
    statusBtn: "लाइव कतार देखें",
    timingBtn: "डॉक्टर टाइमिंग व फ़ीस",
    pickDoc: "कृपया डॉक्टर चुनें:",
    pickAvailDoc: "उपलब्धता व टाइमिंग देखने के लिए कृपया डॉक्टर चुनें:",
    pickDate: "कृपया विज़िट की तारीख़ चुनें:",
    pickAvailDate: "उपलब्धता देखने के लिए कृपया तारीख़ चुनें:",
    pickBatch: "कृपया समय का बैच चुनें:",
    askName: "कृपया मरीज़ का पूरा नाम लिखें:",
    askAge: "कृपया मरीज़ की उम्र (साल में) लिखें (जैसे 25):",
    invalidAge: "कृपया 1 से 120 के बीच सही उम्र लिखें।",
    askPhone:
      "कृपया मरीज़ का 10 अंकों का मोबाइल नंबर लिखें (या अपना ही नंबर रखने के लिए *SELF* लिखें):",
    invalidPhone: "कृपया सही 10 अंकों का मोबाइल नंबर लिखें या *SELF* भेजें।",
    statusPrompt:
      "लाइव कतार देखने के लिए अपना *Token ID* या *मरीज़ का नाम* लिखें (या सिर्फ़ *ALL* भेजें):",
    noDoctors: "अभी कोई डॉक्टर उपलब्ध नहीं है। कृपया क्लिनिक शीट में डॉक्टर जोड़ें।",
    docUnavailableOnDate:
      "माफ़ करें, *${docName}* (${visitDate}) को उपलब्ध नहीं हैं। कृपया डॉक्टर की टाइमिंग देखें और दूसरी तारीख़ चुनें।",
  },
  en: {
    menuTitle: "OPD Service Menu",
    bookBtn: "Book Token",
    statusBtn: "Live Queue Status",
    timingBtn: "Doctor Timing & Fee",
    pickDoc: "Please select a doctor:",
    pickAvailDoc: "Please select a doctor to check availability & timing:",
    pickDate: "Please select a visit date:",
    pickAvailDate: "Please select a date to check availability:",
    pickBatch: "Please select a time batch:",
    askName: "Please enter the patient's full name:",
    askAge: "Please enter the patient's age in years (e.g. 25):",
    invalidAge: "Please enter a valid age between 1 and 120.",
    askPhone:
      "Please enter the patient's 10-digit mobile number (or type *SELF* to use your current number):",
    invalidPhone: "Please enter a valid 10-digit mobile number or type *SELF*.",
    statusPrompt:
      "Enter your *Token ID* or *Patient Name* to check live queue status (or type *ALL*):",
    noDoctors: "No doctors available right now. Please add doctors in the clinic sheet.",
    docUnavailableOnDate:
      "Sorry, *${docName}* is not available on *${visitDate}*. Please check doctor timing and choose another date.",
  },
};

function normalizeDateIso(rawVal) {
  if (!rawVal) return "";
  if (rawVal instanceof Date && !isNaN(rawVal.getTime())) {
    const ist = new Date(rawVal.getTime() + 5.5 * 60 * 60 * 1000);
    const yyyy = String(ist.getUTCFullYear());
    const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(ist.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  const str = String(rawVal).trim();
  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}`;
  }
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, "0")}-${dmyMatch[1].padStart(2, "0")}`;
  }
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const ist = new Date(parsed.getTime() + 5.5 * 60 * 60 * 1000);
    const yyyy = String(ist.getUTCFullYear());
    const mm = String(ist.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(ist.getUTCDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return str;
}

function getIstDateParts(offsetDays = 0) {
  const utcNow = Date.now() + offsetDays * 24 * 60 * 60 * 1000;
  const istDate = new Date(utcNow + 5.5 * 60 * 60 * 1000);
  const yyyy = String(istDate.getUTCFullYear());
  const mm = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(istDate.getUTCDate()).padStart(2, "0");
  return { yyyy, mm, dd, iso: `${yyyy}-${mm}-${dd}` };
}

function getNextThreeDays() {
  const days = [];
  for (let i = 0; i < 3; i++) {
    const { dd, mm, yyyy, iso } = getIstDateParts(i);
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

function getDoctorDateAvailability(doctor, dateIso, allowedDays) {
  const targetIso = normalizeDateIso(dateIso);
  const isAllowedDate = Array.isArray(allowedDays)
    ? allowedDays.some((d) => normalizeDateIso(d.iso) === targetIso)
    : true;
  if (!isAllowedDate) {
    return { isAvailable: false, code: "A", label: "Not in allowed 3-day window" };
  }

  const slots = Array.isArray(doctor?.dayAvailability) ? doctor.dayAvailability : [];
  const matchedSlot = slots.find((s) => normalizeDateIso(s.date) === targetIso);

  if (matchedSlot && String(matchedSlot.status || "").trim()) {
    const code = String(matchedSlot.status || "").trim().toUpperCase();
    if (["A", "ABSENT", "OFF", "NO", "UNAVAILABLE", "0"].includes(code)) {
      return { isAvailable: false, code: "A", label: "Absent (A)" };
    }
    if (["P", "PRESENT", "ON", "YES", "AVAILABLE", "1"].includes(code)) {
      return { isAvailable: true, code: "P", label: "Present (P)" };
    }
  }

  return { isAvailable: true, code: "P", label: "Present (P)" };
}

function isDoctorAvailableOnDate(doctor, dateIso, allowedDays) {
  return getDoctorDateAvailability(doctor, dateIso, allowedDays).isAvailable;
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
      dayAvailability: Array.isArray(d.dayAvailability) ? d.dayAvailability : [],
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

async function startDoctorSelection(ctx, lang, purpose = "booking") {
  const m = MSG[lang] || MSG.hi;
  const doctors = await loadDoctors(ctx);
  if (!doctors.length) return ctx.sendText(m.noDoctors);

  const stepName = purpose === "availability" ? "pick_avail_doctor" : "pick_doctor";
  ctx.setSession({
    lang,
    step: stepName,
    data: { doctors, purpose },
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
      body: { text: purpose === "availability" ? m.pickAvailDoc : m.pickDoc },
      action: {
        button: lang === "en" ? "Select Doctor" : "डॉक्टर चुनें",
        sections: [{ title: lang === "en" ? "Available Doctors" : "उपलब्ध डॉक्टर", rows }],
      },
    },
  });
}

async function startDateSelection(ctx, lang, selectedDoctor = null, purpose = "booking") {
  const m = MSG[lang] || MSG.hi;
  const days = getNextThreeDays();
  const stepName = purpose === "availability" ? "pick_avail_date" : "pick_date";

  ctx.setSession({
    lang,
    step: stepName,
    data: {
      days,
      purpose,
      selectedDoctor: selectedDoctor || ctx.getSession()?.data?.selectedDoctor,
    },
  });

  await ctx.sendWA({
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: purpose === "availability" ? m.pickAvailDate : m.pickDate },
      action: {
        buttons: days.map((d) => ({
          type: "reply",
          reply: { id: `date_${d.iso}`, title: d.label.slice(0, 20) },
        })),
      },
    },
  });
}

async function startBatchSelection(ctx, lang, doctor, visitDate = "") {
  const m = MSG[lang] || MSG.hi;
  const batches = parseBatches(doctor?.batches);
  ctx.setSession({
    lang,
    step: "pick_batch",
    data: { batches, selectedDoctor: doctor, visitDate },
  });

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

function formatDoctorTimingForDate(doctor, dateIso, allowedDays) {
  const targetIso = normalizeDateIso(dateIso);
  const avail = getDoctorDateAvailability(doctor, targetIso, allowedDays);
  const statusLine = avail.isAvailable
    ? `✅ *Available (${avail.code})*`
    : `❌ *Not Available (${avail.code})*`;

  return (
    `🩺 *${doctor.name}* (${doctor.specialization})\n` +
    `• Date: *${targetIso}*\n` +
    `• Availability: ${statusLine}\n` +
    `• Days: ${doctor.days}\n` +
    `• Batches: ${parseBatches(doctor.batches).join(", ")}\n` +
    `• OPD Fee: ₹${doctor.opdFee} | Advance: ₹${doctor.advanceAmount}`
  );
}

async function sendDoctorAvailabilityReport(ctx, lang, doctor, dateIso, allowedDays) {
  const targetIso = normalizeDateIso(dateIso);
  const avail = getDoctorDateAvailability(doctor, targetIso, allowedDays);
  const availText =
    lang === "en"
      ? avail.isAvailable
        ? "✅ *Available (P)*"
        : "❌ *Not Available (A)*"
      : avail.isAvailable
        ? "✅ *उपलब्ध (P)*"
        : "❌ *अनुपलब्ध (A)*";

  const msg =
    lang === "en"
      ? `🩺 *Doctor Timing & Availability*\n\n` +
        `• Doctor: *${doctor.name}* (${doctor.specialization})\n` +
        `• Date: *${targetIso}*\n` +
        `• Status: ${availText}\n` +
        `• Days: ${doctor.days}\n` +
        `• Batches: ${parseBatches(doctor.batches).join(", ")}\n` +
        `• OPD Fee: ₹${doctor.opdFee} | Advance: ₹${doctor.advanceAmount}`
      : `🩺 *डॉक्टर टाइमिंग व उपलब्धता*\n\n` +
        `• डॉक्टर: *${doctor.name}* (${doctor.specialization})\n` +
        `• तारीख़: *${targetIso}*\n` +
        `• उपलब्धता: ${availText}\n` +
        `• दिन: ${doctor.days}\n` +
        `• बैच: ${parseBatches(doctor.batches).join(", ")}\n` +
        `• OPD फ़ीस: ₹${doctor.opdFee} | एडवांस: ₹${doctor.advanceAmount}`;

  await ctx.sendText(msg);
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
  const patientAge = sessionData.patientAge;
  const patientPhone = sessionData.patientPhone;
  const visitDate = normalizeDateIso(sessionData.visitDate);
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
        `• Patient: *${patientName}* (${patientAge} yrs)\n` +
        `• Doctor: *${doc.name}*\n` +
        `• Date & Batch: *${visitDate}* | *${batchSlot}*\n` +
        `• OPD Fee: ₹${opdFee} | Advance Due: ₹${advanceFee}`
      : `✅ *OPD टोकन कन्फ़र्म*\n` +
        `• टोकन ID: *${tokenId}*\n` +
        `• मरीज़: *${patientName}* (${patientAge} वर्ष)\n` +
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
    return startDoctorSelection(ctx, lang, "booking");
  }

  if (btnId === "opd_status" || ["status", "live", "कतार", "स्टेटस"].includes(low)) {
    ctx.setSession({ lang, step: "ask_status_query" });
    return ctx.sendText(m.statusPrompt);
  }

  if (btnId === "opd_timing" || ["timing", "timings", "fee", "टाइमिंग", "फ़ीस"].includes(low)) {
    return startDoctorSelection(ctx, lang, "availability");
  }

  if (session.step === "pick_avail_doctor") {
    const doctors = session.data?.doctors || (await loadDoctors(ctx));
    let selected = null;
    if (btnId.startsWith("doc_")) {
      const idx = Number(btnId.replace("doc_", ""));
      selected = doctors[idx];
    } else {
      selected = doctors.find((d) => d.name.toLowerCase().includes(low));
    }
    if (!selected) return startDoctorSelection(ctx, lang, "availability");

    return startDateSelection(ctx, lang, selected, "availability");
  }

  if (session.step === "pick_avail_date") {
    const days = session.data?.days || getNextThreeDays();
    const selectedDoctor = session.data?.selectedDoctor;
    let chosenDate = "";
    if (btnId.startsWith("date_")) {
      chosenDate = normalizeDateIso(btnId.replace("date_", ""));
    } else {
      const match = days.find(
        (d) => d.iso === low || d.label.toLowerCase().includes(low)
      );
      chosenDate = match ? match.iso : days[0].iso;
    }

    ctx.setSession({ lang, step: null });
    return sendDoctorAvailabilityReport(ctx, lang, selectedDoctor, chosenDate, days);
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
    if (!selected) return startDoctorSelection(ctx, lang, "booking");

    return startDateSelection(ctx, lang, selected, "booking");
  }

  if (session.step === "pick_date") {
    const days = session.data?.days || getNextThreeDays();
    const selectedDoctor = session.data?.selectedDoctor;
    let chosenDate = "";
    if (btnId.startsWith("date_")) {
      chosenDate = normalizeDateIso(btnId.replace("date_", ""));
    } else {
      const match = days.find(
        (d) => d.iso === low || d.label.toLowerCase().includes(low)
      );
      chosenDate = match ? match.iso : days[0].iso;
    }

    if (!isDoctorAvailableOnDate(selectedDoctor, chosenDate, days)) {
      const warnMsg = m.docUnavailableOnDate
        .replace("${docName}", selectedDoctor?.name || "Doctor")
        .replace("${visitDate}", chosenDate);
      const timingBlock = formatDoctorTimingForDate(selectedDoctor, chosenDate, days);
      await ctx.sendText(`${warnMsg}\n\n${timingBlock}`);
      return startDateSelection(ctx, lang, selectedDoctor, "booking");
    }

    return startBatchSelection(ctx, lang, selectedDoctor, chosenDate);
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
      data: {
        selectedDoctor: session.data?.selectedDoctor,
        visitDate: session.data?.visitDate,
        batchSlot,
      },
    });
    return ctx.sendText(m.askName);
  }

  if (session.step === "ask_name") {
    const patientName = (text || "").trim();
    if (!patientName) return ctx.sendText(m.askName);

    ctx.setSession({
      lang,
      step: "ask_age",
      data: {
        ...session.data,
        patientName,
      },
    });
    return ctx.sendText(m.askAge);
  }

  if (session.step === "ask_age") {
    const digits = String(text || "").replace(/\D/g, "");
    const ageNum = Number(digits);
    if (!digits || isNaN(ageNum) || ageNum < 1 || ageNum > 120) {
      return ctx.sendText(m.invalidAge);
    }

    ctx.setSession({
      lang,
      step: "ask_phone",
      data: {
        ...session.data,
        patientAge: ageNum,
      },
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
