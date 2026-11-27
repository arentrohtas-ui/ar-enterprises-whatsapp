const { sendMainMenu, sendLiveQueueStatus, formatIstYmd } = require("./menu");
const {
  initiatePaymentOrBooking,
  handleAwaitPaymentStep,
} = require("./paymentAndToken");

function toNumberClean(val, fallback = 0) {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  const cleaned = String(val ?? "").replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && cleaned !== "" ? n : fallback;
}

function getNowIstMinutes() {
  const ist = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function parseSlotEndMinutes(slotStr = "") {
  const s = String(slotStr || "").trim();
  const rangeMatch = s.match(
    /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?\s*[-–—to]+\s*(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i
  );
  if (rangeMatch) {
    const endPeriod = String(rangeMatch[6] || "").toUpperCase();
    const startPeriod = String(rangeMatch[3] || endPeriod).toUpperCase();
    let endHour = parseInt(rangeMatch[4], 10);
    const endMin = parseInt(rangeMatch[5] || "0", 10);

    if (endPeriod === "PM" && endHour < 12) endHour += 12;
    if (endPeriod === "AM" && endHour === 12) endHour = 0;

    let startHour = parseInt(rangeMatch[1], 10);
    if (startPeriod === "PM" && startHour < 12) startHour += 12;
    if (startPeriod === "AM" && startHour === 12) startHour = 0;

    let endTotal = endHour * 60 + endMin;
    const startTotal = startHour * 60;
    if (endTotal <= startTotal) {
      endTotal += 12 * 60;
    }
    return endTotal;
  }

  if (/morning|सुबह/i.test(s)) return 13 * 60;
  if (/evening|शाम/i.test(s)) return 21 * 60;
  if (/afternoon|दोपहर/i.test(s)) return 17 * 60;
  return null;
}

function getUpcomingDays(lang = "hi") {
  const now = new Date();
  const labelsHi = ["आज", "कल", "परसों"];
  const labelsEn = ["Today", "Tomorrow", "Day after"];
  const labels = lang === "en" ? labelsEn : labelsHi;

  return [0, 1, 2].map((offset) => {
    const dt = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    const ymd = formatIstYmd(dt);
    return {
      key: offset === 0 ? "today" : offset === 1 ? "next" : "plus2",
      shortLabel: labels[offset],
      ymd,
    };
  });
}

function normalizeDoctorObj(raw = {}) {
  return {
    id: String(raw.id || raw.Doctor_ID || raw.doctorId || "").trim(),
    name: String(
      raw.name || raw.Doctor_Name || raw.doctorName || "Doctor"
    ).trim(),
    specialty: String(
      raw.specialty || raw.Specialization || "General Physician"
    ).trim(),
    opdFee: toNumberClean(raw.opdFee ?? raw.OPD_Fee ?? raw.fee ?? 0, 0),
    advanceAmount: toNumberClean(
      raw.advanceAmount ?? raw.Advance_Amount ?? 0,
      0
    ),
    morningSlot: String(
      raw.morningSlot || raw.Morning_Slot || raw.morning_slot || ""
    ).trim(),
    eveningSlot: String(
      raw.eveningSlot || raw.Evening_Slot || raw.evening_slot || ""
    ).trim(),
    todayAvail: String(
      raw.todayAvail || raw.Today_Avail || raw.today_avail || "P"
    )
      .trim()
      .toUpperCase(),
    nextDayAvail: String(
      raw.nextDayAvail || raw.Next_Day_Avail || raw.next_day_avail || "P"
    )
      .trim()
      .toUpperCase(),
    plus2DayAvail: String(
      raw.plus2DayAvail || raw.Plus2_Day_Avail || raw.plus2_day_avail || "P"
    )
      .trim()
      .toUpperCase(),
  };
}

function isDoctorAvailableOnDay(doc, dayKey) {
  const raw =
    dayKey === "today"
      ? doc.todayAvail
      : dayKey === "next"
      ? doc.nextDayAvail
      : doc.plus2DayAvail;
  const st = String(raw || "P").trim().toUpperCase();
  return st !== "A" && st !== "ABSENT" && st !== "OFF";
}

function getDoctorSlots(doc, lang = "hi", dayKey = "next") {
  const slots = [];
  if (doc.morningSlot) {
    slots.push({
      id: "MORNING",
      label:
        lang === "en"
          ? `Morning (${doc.morningSlot})`
          : `सुबह (${doc.morningSlot})`,
      value: doc.morningSlot,
    });
  }
  if (doc.eveningSlot) {
    slots.push({
      id: "EVENING",
      label:
        lang === "en"
          ? `Evening (${doc.eveningSlot})`
          : `शाम (${doc.eveningSlot})`,
      value: doc.eveningSlot,
    });
  }
  if (!slots.length) {
    slots.push({
      id: "MORNING",
      label:
        lang === "en"
          ? "Morning (09:00 AM - 01:00 PM)"
          : "सुबह (09:00 AM - 01:00 PM)",
      value: "09:00 AM - 01:00 PM",
    });
    slots.push({
      id: "EVENING",
      label:
        lang === "en"
          ? "Evening (04:00 PM - 08:00 PM)"
          : "शाम (04:00 PM - 08:00 PM)",
      value: "04:00 PM - 08:00 PM",
    });
  }

  if (dayKey === "today") {
    const nowMins = getNowIstMinutes();
    return slots.filter((s) => {
      const endMins = parseSlotEndMinutes(`${s.value} ${s.label}`);
      if (endMins === null) return true;
      return endMins > nowMins;
    });
  }

  return slots;
}

async function fetchClinicDoctors(ctx) {
  try {
    const res = await ctx.getSheet({ action: "get_dashboard_data" });
    if (Array.isArray(res?.doctors) && res.doctors.length) {
      return res.doctors.map(normalizeDoctorObj);
    }
  } catch (_) {}

  try {
    const res2 = await ctx.getSheet({ action: "get_doctors" });
    const arr = Array.isArray(res2?.doctors)
      ? res2.doctors
      : Array.isArray(res2?.data)
      ? res2.data
      : [];
    if (arr.length) return arr.map(normalizeDoctorObj);
  } catch (_) {}

  return [];
}

function extractTenDigitFromSender(fromVal = "") {
  const digits = String(fromVal || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length >= 10) return digits.slice(-10);
  return "";
}

async function sendPhonePromptWithSelfOption(ctx, lang = "hi") {
  const selfTen = extractTenDigitFromSender(ctx.from);
  const promptText =
    lang === "en"
      ? `📱 Type *10-digit Mobile Number* manually${
          selfTen ? ` or tap *Self* button (${selfTen})` : ""
        }:`
      : `📱 *10 अंकों का मोबाइल नंबर* लिखें${
          selfTen ? ` या *Self* बटन दबाएं (${selfTen})` : ""
        }:`;

  if (selfTen && typeof ctx.sendWA === "function") {
    const waRes = await ctx.sendWA({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: promptText },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: "SELF_MOBILE",
                title: lang === "en" ? "Self Number" : "Self नंबर",
              },
            },
          ],
        },
      },
    });
    if (waRes && !waRes.error && !waRes.errors) return;
  }

  await ctx.sendText(promptText);
}

async function sendDoctorSelectionPrompt(ctx, doctors, lang = "hi") {
  const lines = doctors.map(
    (d, idx) =>
      `*${idx + 1}. ${d.name}* (${d.specialty || "OPD"}) — ₹${Number(
        d.opdFee || 0
      )}`
  );

  if (doctors.length <= 3 && typeof ctx.sendWA === "function") {
    const bodyText =
      lang === "en"
        ? `👨‍⚕️ *Choose Doctor*:\n\n${lines.join("\n")}`
        : `👨‍⚕️ *डॉक्टर चुनें*:\n\n${lines.join("\n")}`;

    const buttons = doctors.map((d, idx) => ({
      type: "reply",
      reply: {
        id: `DOC_${idx}`,
        title: String(d.name || `Doctor ${idx + 1}`).slice(0, 20),
      },
    }));

    const waRes = await ctx.sendWA({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: { buttons },
      },
    });
    if (waRes && !waRes.error && !waRes.errors) return;
  }

  if (doctors.length > 3 && typeof ctx.sendWA === "function") {
    const rows = doctors.slice(0, 10).map((d, idx) => ({
      id: `DOC_${idx}`,
      title: String(d.name || `Doctor ${idx + 1}`).slice(0, 24),
      description: `${d.specialty || "OPD"} — ₹${Number(d.opdFee || 0)}`.slice(
        0,
        72
      ),
    }));

    const waRes = await ctx.sendWA({
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text:
            lang === "en"
              ? "👨‍⚕️ *Choose Doctor* from the list below:"
              : "👨‍⚕️ नीचे दिए गए विकल्प में से *डॉक्टर चुनें*:",
        },
        action: {
          button: lang === "en" ? "Choose Doctor" : "डॉक्टर चुनें",
          sections: [
            {
              title: lang === "en" ? "Available Doctors" : "उपलब्ध डॉक्टर",
              rows,
            },
          ],
        },
      },
    });
    if (waRes && !waRes.error && !waRes.errors) return;
  }

  await ctx.sendText(
    lang === "en"
      ? `👨‍⚕️ *Choose Doctor* (reply with number):\n\n${lines.join("\n")}`
      : `👨‍⚕️ *डॉक्टर चुनें* (नंबर लिखकर भेजें):\n\n${lines.join("\n")}`
  );
}

async function sendDaySelectionPrompt(ctx, doctor, days, lang = "hi") {
  const lines = days.map(
    (d, idx) => `*${idx + 1}. ${d.shortLabel}* (${d.ymd})`
  );

  if (days.length <= 3 && typeof ctx.sendWA === "function") {
    const bodyText =
      lang === "en"
        ? `📅 *${doctor.name}* — Choose Day:\n\n${lines.join("\n")}`
        : `📅 *${doctor.name}* — दिन चुनें:\n\n${lines.join("\n")}`;

    const buttons = days.map((d, idx) => ({
      type: "reply",
      reply: {
        id: `DAY_${idx}`,
        title: `${d.shortLabel} (${d.ymd.slice(5)})`.slice(0, 20),
      },
    }));

    const waRes = await ctx.sendWA({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: { buttons },
      },
    });
    if (waRes && !waRes.error && !waRes.errors) return;
  }

  await ctx.sendText(
    lang === "en"
      ? `📅 *${doctor.name}* — Choose Day (reply with number):\n\n${lines.join(
          "\n"
        )}`
      : `📅 *${doctor.name}* — दिन चुनें (नंबर लिखकर भेजें):\n\n${lines.join(
          "\n"
        )}`
  );
}

async function sendSlotSelectionPrompt(ctx, slots, lang = "hi") {
  const lines = slots.map((s, idx) => `*${idx + 1}. ${s.label}*`);

  if (slots.length <= 3 && typeof ctx.sendWA === "function") {
    const bodyText =
      lang === "en"
        ? `⏰ Choose Time Slot:\n\n${lines.join("\n")}`
        : `⏰ समय स्लॉट चुनें:\n\n${lines.join("\n")}`;

    const buttons = slots.map((s, idx) => ({
      type: "reply",
      reply: {
        id: `SLOT_${idx}`,
        title: String(s.label).slice(0, 20),
      },
    }));

    const waRes = await ctx.sendWA({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: { buttons },
      },
    });
    if (waRes && !waRes.error && !waRes.errors) return;
  }

  await ctx.sendText(
    lang === "en"
      ? `⏰ Choose Time Slot (reply with number):\n\n${lines.join("\n")}`
      : `⏰ समय स्लॉट चुनें (नंबर लिखकर भेजें):\n\n${lines.join("\n")}`
  );
}

async function startBookingFlow(ctx, lang = "hi") {
  const doctors = await fetchClinicDoctors(ctx);
  if (!doctors.length) {
    await ctx.sendText(
      lang === "en"
        ? "Sorry, no doctor schedule is available right now. Please contact reception."
        : "क्षमा करें, अभी डॉक्टर की उपलब्धता सूची उपलब्ध नहीं है। कृपया रिसेप्शन से संपर्क करें।"
    );
    return;
  }

  ctx.setSession({
    lang,
    step: "SELECT_DOCTOR",
    data: { doctors },
  });

  await sendDoctorSelectionPrompt(ctx, doctors, lang);
}

async function handleBookingStep(ctx, text, btnId) {
  const session = ctx.getSession();
  const lang = session.lang === "en" ? "en" : "hi";
  const step = session.step;
  const data = session.data || {};
  const cleanText = String(text || "").trim();
  const cleanId = String(btnId || "").trim();

  if (step === "SELECT_DOCTOR") {
    const doctors = Array.isArray(data.doctors) ? data.doctors : [];
    const num = parseInt(cleanText, 10);
    let picked = null;

    if (cleanId.startsWith("DOC_")) {
      const idx = parseInt(cleanId.replace("DOC_", ""), 10);
      if (!Number.isNaN(idx) && idx >= 0 && idx < doctors.length) {
        picked = doctors[idx];
      }
    }
    if (!picked && !Number.isNaN(num) && num >= 1 && num <= doctors.length) {
      picked = doctors[num - 1];
    }
    if (!picked && cleanText) {
      picked = doctors.find(
        (d) =>
          String(d.name || "").trim().toLowerCase() === cleanText.toLowerCase()
      );
    }

    if (!picked) {
      await sendDoctorSelectionPrompt(ctx, doctors, lang);
      return;
    }

    const days = getUpcomingDays(lang).filter((day) => {
      if (!isDoctorAvailableOnDay(picked, day.key)) return false;
      if (day.key === "today") {
        return getDoctorSlots(picked, lang, "today").length > 0;
      }
      return true;
    });

    if (!days.length) {
      await ctx.sendText(
        lang === "en"
          ? `${picked.name} has no available slots right now. Please choose another doctor.`
          : `${picked.name} के अभी कोई उपलब्ध समय स्लॉट नहीं बचे हैं। कृपया दूसरा डॉक्टर चुनें।`
      );
      return;
    }

    ctx.setSession({
      lang,
      step: "SELECT_DAY",
      data: { ...data, selectedDoctor: picked, days },
    });
    await sendDaySelectionPrompt(ctx, picked, days, lang);
    return;
  }

  if (step === "SELECT_DAY") {
    const days = Array.isArray(data.days) ? data.days : [];
    const num = parseInt(cleanText, 10);
    let dayInfo = null;

    if (cleanId.startsWith("DAY_")) {
      const idx = parseInt(cleanId.replace("DAY_", ""), 10);
      if (!Number.isNaN(idx) && idx >= 0 && idx < days.length) {
        dayInfo = days[idx];
      }
    }
    if (!dayInfo && !Number.isNaN(num) && num >= 1 && num <= days.length) {
      dayInfo = days[num - 1];
    }
    if (!dayInfo && cleanText) {
      dayInfo = days.find(
        (d) =>
          String(d.ymd) === cleanText ||
          String(d.shortLabel).toLowerCase() === cleanText.toLowerCase()
      );
    }

    if (!dayInfo) {
      await sendDaySelectionPrompt(ctx, data.selectedDoctor, days, lang);
      return;
    }

    const slots = getDoctorSlots(data.selectedDoctor, lang, dayInfo.key);
    if (!slots.length) {
      await ctx.sendText(
        lang === "en"
          ? `No slots remain for ${dayInfo.shortLabel}. Please choose another day.`
          : `${dayInfo.shortLabel} के लिए अब कोई समय स्लॉट नहीं बचा है। कृपया दूसरा दिन चुनें।`
      );
      return;
    }

    ctx.setSession({
      lang,
      step: "SELECT_SLOT",
      data: { ...data, dayInfo, visitDate: dayInfo.ymd, slots },
    });
    await sendSlotSelectionPrompt(ctx, slots, lang);
    return;
  }

  if (step === "SELECT_SLOT") {
    const slots = Array.isArray(data.slots) ? data.slots : [];
    const num = parseInt(cleanText, 10);
    let slotObj = null;

    if (cleanId.startsWith("SLOT_")) {
      const idx = parseInt(cleanId.replace("SLOT_", ""), 10);
      if (!Number.isNaN(idx) && idx >= 0 && idx < slots.length) {
        slotObj = slots[idx];
      }
    }
    if (!slotObj && !Number.isNaN(num) && num >= 1 && num <= slots.length) {
      slotObj = slots[num - 1];
    }
    if (!slotObj && cleanText) {
      slotObj = slots.find(
        (s) =>
          String(s.label).toLowerCase().includes(cleanText.toLowerCase()) ||
          String(s.value).toLowerCase().includes(cleanText.toLowerCase())
      );
    }

    if (!slotObj) {
      await sendSlotSelectionPrompt(ctx, slots, lang);
      return;
    }

    ctx.setSession({
      lang,
      step: "ENTER_NAME",
      data: { ...data, batchSlot: slotObj.label },
    });
    await ctx.sendText(
      lang === "en"
        ? "👤 Please enter *Patient Full Name*:"
        : "👤 कृपया *मरीज़ का पूरा नाम* लिखें:"
    );
    return;
  }

  if (step === "ENTER_NAME") {
    if (cleanText.length < 2) {
      await ctx.sendText(
        lang === "en"
          ? "Please enter a valid patient name."
          : "कृपया मरीज़ का सही नाम लिखें।"
      );
      return;
    }
    ctx.setSession({
      lang,
      step: "ENTER_AGE",
      data: { ...data, patientName: cleanText },
    });
    await ctx.sendText(
      lang === "en"
        ? "🎂 Please enter *Patient Age* (in years):"
        : "🎂 कृपया *मरीज़ की उम्र* (साल में) लिखें:"
    );
    return;
  }

  if (step === "ENTER_AGE") {
    const ageNum = parseInt(cleanText, 10);
    if (Number.isNaN(ageNum) || ageNum < 0 || ageNum > 125) {
      await ctx.sendText(
        lang === "en"
          ? "Please enter a valid age (1 to 125)."
          : "कृपया सही उम्र (1 से 125 के बीच) लिखें।"
      );
      return;
    }
    ctx.setSession({
      lang,
      step: "ENTER_PHONE",
      data: { ...data, patientAge: String(ageNum) },
    });
    await sendPhonePromptWithSelfOption(ctx, lang);
    return;
  }

  if (step === "ENTER_PHONE") {
    const isSelfBtn =
      cleanId === "SELF_MOBILE" || /^self\b/i.test(cleanText);
    const digits = isSelfBtn
      ? String(ctx.from || "").replace(/\D/g, "")
      : cleanText.replace(/\D/g, "");
    const tenDigit =
      digits.length >= 10 ? digits.slice(-10) : digits;

    if (tenDigit.length !== 10) {
      await sendPhonePromptWithSelfOption(ctx, lang);
      return;
    }

    const normalizedDoc = normalizeDoctorObj(data.selectedDoctor || {});
    await initiatePaymentOrBooking(
      ctx,
      { ...data, selectedDoctor: normalizedDoc },
      tenDigit,
      lang
    );
    return;
  }

  if (step === "AWAIT_PAYMENT") {
    await handleAwaitPaymentStep(ctx, data, lang, cleanText, cleanId);
  }
}

async function handleOpdMessage(ctx, text = "", btnId = "") {
  const session = ctx.getSession();
  let lang = session.lang === "en" ? "en" : "hi";
  const cleanText = String(text || "").trim();
  const cleanId = String(btnId || "").trim();
  const lower = cleanText.toLowerCase();

  if (
    !session.step &&
    (cleanId === "MENU_LANG" ||
      cleanText === "3" ||
      lower === "english" ||
      lower === "hindi" ||
      lower === "हिंदी")
  ) {
    if (lower === "hindi" || lower === "हिंदी") {
      lang = "hi";
    } else if (lower === "english") {
      lang = "en";
    } else {
      lang = lang === "hi" ? "en" : "hi";
    }
    ctx.setSession({ lang, step: null, data: {} });
    await sendMainMenu(ctx, lang);
    return;
  }

  if (
    !session.step &&
    ["hi", "hello", "hey", "नमस्ते", "namaste", "start", "menu", "0"].includes(
      lower
    )
  ) {
    ctx.setSession({ lang, step: null, data: {} });
    await sendMainMenu(ctx, lang);
    return;
  }

  if (
    !session.step &&
    (cleanId === "MENU_BOOK" ||
      cleanText === "1" ||
      lower.includes("book") ||
      lower.includes("टोकन"))
  ) {
    await startBookingFlow(ctx, lang);
    return;
  }

  if (
    !session.step &&
    (cleanId === "MENU_STATUS" ||
      cleanText === "2" ||
      lower.includes("status") ||
      lower.includes("स्टेटस"))
  ) {
    await sendLiveQueueStatus(ctx, lang);
    return;
  }

  if (session.step) {
    await handleBookingStep(ctx, cleanText, cleanId);
    return;
  }

  await sendMainMenu(ctx, lang);
}

module.exports = {
  startBookingFlow,
  handleBookingStep,
  handleOpdMessage,
};
