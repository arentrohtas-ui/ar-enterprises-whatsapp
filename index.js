const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ar_enterprises_verify_123";
const DEFAULT_ACCESS_TOKEN = process.env.ACCESS_TOKEN || "";
const DEFAULT_PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
const WEBHOOK_SINK_URL = process.env.WEBHOOK_SINK_URL || "";
const TIMEZONE = process.env.TZ_OFFSET || "Asia/Kolkata";

const TENANTS = {
  ...(DEFAULT_PHONE_NUMBER_ID
    ? {
        [DEFAULT_PHONE_NUMBER_ID]: {
          clientId: "city_care_opd",
          brandName: "City Care OPD & Polyclinic",
          sector: "opd",
          accessToken: DEFAULT_ACCESS_TOKEN,
          upiOrPayBaseUrl: "https://ar-enterprises-whatsapp.onrender.com/pay-demo",
        },
      }
    : {}),
};

const processedMessageIds = new Set();
const userSessions = new Map();

function markProcessed(msgId) {
  if (!msgId) return false;
  if (processedMessageIds.has(msgId)) return true;
  processedMessageIds.add(msgId);
  if (processedMessageIds.size > 5000) {
    const firstKey = processedMessageIds.values().next().value;
    processedMessageIds.delete(firstKey);
  }
  return false;
}

function resolveTenant(incomingPhoneNumberId) {
  const id = incomingPhoneNumberId || DEFAULT_PHONE_NUMBER_ID;
  if (id && TENANTS[id]) {
    return { phoneNumberId: id, ...TENANTS[id] };
  }
  return {
    phoneNumberId: id,
    clientId: id || "default_client",
    brandName: "AR Enterprises",
    sector: "opd",
    accessToken: DEFAULT_ACCESS_TOKEN,
    upiOrPayBaseUrl: "",
  };
}

function getSession(clientId, from) {
  const key = `${clientId}:${from}`;
  const existing = userSessions.get(key);
  if (existing && Date.now() - existing.updatedAt > 60 * 60 * 1000) {
    userSessions.delete(key);
    return { lang: "hi", step: null, data: {}, updatedAt: Date.now() };
  }
  return existing || { lang: "hi", step: null, data: {}, updatedAt: Date.now() };
}

function updateSession(clientId, from, patch) {
  const prev = getSession(clientId, from);
  userSessions.set(`${clientId}:${from}`, {
    ...prev,
    ...patch,
    updatedAt: Date.now(),
  });
}

function makeId(prefix) {
  return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
}

// IST समय निकालने के लिए हेल्पर
function getNowParts() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const hour = Number(map.hour || 0);
  const minute = Number(map.minute || 0);
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute,
    currentMinutes: hour * 60 + minute,
  };
}

function formatDateISO(offsetDays) {
  const now = new Date();
  const base = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(base);
}

// यदि आज के सभी बैच (या शाम 8 बजे / 20:00 के बाद) बीत चुके हैं तो कल, परसों, तरसों दिखाएँ
function getBookingDayOptions(doc, lang) {
  const isEn = lang === "en";
  const { currentMinutes } = getNowParts();
  const batches = Array.isArray(doc.batches) && doc.batches.length
    ? doc.batches
    : ["08:00-10:00", "10:00-12:00", "12:00-14:00", "16:00-18:00", "18:00-20:00"];

  const todayValidBatches = getValidBatchesForDay(batches, true, currentMinutes);
  const todayClosed = todayValidBatches.length === 0 || currentMinutes >= 20 * 60;

  if (!todayClosed) {
    return [
      {
        key: "day_0",
        offset: 0,
        dateStr: formatDateISO(0),
        label: isEn ? `Today (${formatDateISO(0)})` : `आज (${formatDateISO(0)})`,
        isToday: true,
      },
      {
        key: "day_1",
        offset: 1,
        dateStr: formatDateISO(1),
        label: isEn ? `Tomorrow (${formatDateISO(1)})` : `कल (${formatDateISO(1)})`,
        isToday: false,
      },
      {
        key: "day_2",
        offset: 2,
        dateStr: formatDateISO(2),
        label: isEn ? `Day after Tmrw (${formatDateISO(2)})` : `परसों (${formatDateISO(2)})`,
        isToday: false,
      },
    ];
  }

  // आज का समय बीत जाने पर: कल, परसों, तरसों
  return [
    {
      key: "day_1",
      offset: 1,
      dateStr: formatDateISO(1),
      label: isEn ? `Tomorrow (${formatDateISO(1)})` : `कल (${formatDateISO(1)})`,
      isToday: false,
    },
    {
      key: "day_2",
      offset: 2,
      dateStr: formatDateISO(2),
      label: isEn ? `Day after Tmrw (${formatDateISO(2)})` : `परसों (${formatDateISO(2)})`,
      isToday: false,
    },
    {
      key: "day_3",
      offset: 3,
      dateStr: formatDateISO(3),
      label: isEn ? `3rd Day (${formatDateISO(3)})` : `तरसों (${formatDateISO(3)})`,
      isToday: false,
    },
  ];
}

// "10:00-12:00" या "16:00-18:00" को मिनटों में बदलकर बीता हुआ स्लॉट हटाना
function parseSlotEndMinutes(slotStr) {
  const parts = String(slotStr || "").split("-");
  if (parts.length < 2) return 24 * 60;
  const endPart = parts[1].trim();
  const [hStr, mStr] = endPart.split(":");
  const h = Number(hStr);
  const m = Number(mStr || 0);
  if (Number.isNaN(h) || Number.isNaN(m)) return 24 * 60;
  return h * 60 + m;
}

function getValidBatchesForDay(batches, isToday, currentMinutes) {
  const list = Array.isArray(batches) && batches.length
    ? batches
    : ["08:00-10:00", "10:00-12:00", "12:00-14:00", "16:00-18:00", "18:00-20:00"];

  if (!isToday) return list;
  return list.filter((slot) => currentMinutes < parseSlotEndMinutes(slot));
}

async function fetchDoctorsForTenant(phoneNumberId) {
  if (!WEBHOOK_SINK_URL) return [];
  try {
    const url = `${WEBHOOK_SINK_URL}?action=get_doctors&phone_number_id=${encodeURIComponent(
      phoneNumberId
    )}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.ok && Array.isArray(json.doctors)) return json.doctors;
  } catch (err) {
    console.error("Error fetching doctors:", err.message || err);
  }
  return [];
}

async function fetchLiveStatus(phoneNumberId, query = "") {
  if (!WEBHOOK_SINK_URL) return null;
  try {
    const url = `${WEBHOOK_SINK_URL}?action=get_live_status&phone_number_id=${encodeURIComponent(
      phoneNumberId
    )}&query=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    const json = await res.json();
    return json.ok ? json : null;
  } catch (err) {
    console.error("Error fetching live status:", err.message || err);
    return null;
  }
}

async function postToSheet(payload) {
  if (!WEBHOOK_SINK_URL) return null;
  try {
    const res = await fetch(WEBHOOK_SINK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await res.text();
  } catch (err) {
    console.error("Sheet POST error:", err.message || err);
    return null;
  }
}

async function postToWhatsApp(tenant, payload) {
  if (!tenant.accessToken || !tenant.phoneNumberId) return;
  try {
    const res = await fetch(
      `https://graph.facebook.com/v27.0/${tenant.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tenant.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      console.error("WhatsApp API error:", JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error("WhatsApp fetch error:", err.message || err);
  }
}

async function sendText(tenant, to, body) {
  await postToWhatsApp(tenant, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { preview_url: false, body },
  });
}

async function sendLanguageMenu(tenant, to) {
  await postToWhatsApp(tenant, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text:
          `नमस्ते / Hello! *${tenant.brandName}* में आपका स्वागत है।\n` +
          `कृपया अपनी भाषा चुनें / Please choose your language:`,
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "lang_hi", title: "हिंदी (Hindi)" } },
          { type: "reply", reply: { id: "lang_en", title: "English" } },
        ],
      },
    },
  });
}

async function sendOpdMainMenu(tenant, to, lang) {
  const isEn = lang === "en";
  const bodyText = isEn
    ? `Welcome to *${tenant.brandName}*.\nPlease choose an option:\n\n` +
      `• *OPD Booking* — 3-day window & 2-hr batch slots\n` +
      `• *Live Status* — Live queue & token tracking\n` +
      `• *Dr Timing* — Doctor fees, batches & 7-day schedule`
    : `स्वागत है *${tenant.brandName}* में।\nकृपया नीचे से विकल्प चुनें:\n\n` +
      `• *OPD Booking* — 3 दिन की बुकिंग व 2-घंटे के बैच\n` +
      `• *Live Status* — लाइव टोकन स्टेटस व कतार\n` +
      `• *Dr Timing* — डॉक्टरों की फ़ीस, बैच व 7-दिन शेड्यूल`;

  await postToWhatsApp(tenant, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: [
          { type: "reply", reply: { id: "menu_opd_booking", title: "OPD Booking" } },
          { type: "reply", reply: { id: "menu_live_status", title: "Live Status" } },
          { type: "reply", reply: { id: "menu_dr_timing", title: "Dr Timing" } },
        ],
      },
    },
  });
}

function formatWeekSchedule(doc, lang) {
  const w = doc.weekSchedule || {};
  const noteLabel = lang === "en" ? "Note" : "नोट";
  const batchStr = (doc.batches || []).join(", ");
  return (
    `2-Hr Batches: ${batchStr}\n` +
    `Mon: ${w.Mon || "-"} | Tue: ${w.Tue || "-"} | Wed: ${w.Wed || "-"}\n` +
    `Thu: ${w.Thu || "-"} | Fri: ${w.Fri || "-"} | Sat: ${w.Sat || "-"}\n` +
    `Sun: ${w.Sun || "Holiday"}` +
    (doc.holidayNote ? `\n${noteLabel}: ${doc.holidayNote}` : "")
  );
}

async function sendDoctorList(tenant, to, doctors, lang) {
  const isEn = lang === "en";
  if (!doctors.length) {
    await sendText(
      tenant,
      to,
      isEn ? `No active doctors found.` : `अभी कोई डॉक्टर उपलब्ध नहीं है।`
    );
    return;
  }

  const rows = doctors.slice(0, 10).map((doc) => ({
    id: `pick_doc_${doc.doctorId}`,
    title: doc.doctorName.slice(0, 24),
    description: `Fee ₹${doc.opdFee} | Adv ₹${doc.advanceFee} | 2Hr Slots`.slice(0, 72),
  }));

  await postToWhatsApp(tenant, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: isEn ? "Select Doctor" : "डॉक्टर चुनें" },
      body: {
        text: isEn
          ? `Select a doctor for 3-day OPD booking:`
          : `3-दिन की OPD बुकिंग के लिए डॉक्टर चुनें:`,
      },
      action: {
        button: isEn ? "Choose Doctor" : "डॉक्टर चुनें",
        sections: [{ title: isEn ? "Doctors" : "उपलब्ध डॉक्टर", rows }],
      },
    },
  });
}

async function sendDaySelectionMenu(tenant, to, doc, lang) {
  const isEn = lang === "en";
  const dayOptions = getBookingDayOptions(doc, lang);

  await postToWhatsApp(tenant, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: isEn
          ? `*${doc.doctorName}* (${doc.specialty})\nFee: ₹${doc.opdFee} | Adv: ₹${doc.advanceFee}\nSelect booking day:`
          : `*${doc.doctorName}* (${doc.specialty})\nफ़ीस: ₹${doc.opdFee} | एडवांस: ₹${doc.advanceFee}\nबुकिंग का दिन चुनें:`,
      },
      action: {
        buttons: dayOptions.slice(0, 3).map((d) => ({
          type: "reply",
          reply: { id: d.key, title: d.label.slice(0, 20) },
        })),
      },
    },
  });
}

async function sendBatchList(tenant, to, doc, dayObj, validBatches, lang) {
  const isEn = lang === "en";
  const rows = validBatches.slice(0, 10).map((slot, idx) => ({
    id: `pick_batch_${idx}`,
    title: `Batch: ${slot}`.slice(0, 24),
    description: `${dayObj.label} | 2-Hr Slot`.slice(0, 72),
  }));

  await postToWhatsApp(tenant, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: isEn ? "2-Hr Batch Slot" : "2-घंटे का बैच चुनें" },
      body: {
        text: isEn
          ? `Doctor: *${doc.doctorName}*\nDay: *${dayObj.label}*\nChoose an available 2-hour batch:`
          : `डॉक्टर: *${doc.doctorName}*\nदिन: *${dayObj.label}*\nउपलब्ध 2-घंटे का बैच चुनें:`,
      },
      action: {
        button: isEn ? "Select Batch" : "बैच चुनें",
        sections: [{ title: isEn ? "2-Hour Batches" : "2-घंटे के बैच", rows }],
      },
    },
  });
}

async function sendDoctorsTimingAndSchedule(tenant, to, doctors, lang) {
  const isEn = lang === "en";
  if (!doctors.length) {
    await sendText(tenant, to, isEn ? `No schedule available.` : `शेड्यूल उपलब्ध नहीं है।`);
    return;
  }

  const blocks = doctors.map((d, i) =>
    isEn
      ? `*${i + 1}. ${d.doctorName}* (${d.specialty})\n` +
        `• Fee: *₹${d.opdFee}* | Advance: *₹${d.advanceFee}* | Timing: *${d.timing}*\n` +
        `${formatWeekSchedule(d, "en")}`
      : `*${i + 1}. ${d.doctorName}* (${d.specialty})\n` +
        `• फ़ीस: *₹${d.opdFee}* | एडवांस: *₹${d.advanceFee}* | समय: *${d.timing}*\n` +
        `${formatWeekSchedule(d, "hi")}`
  );

  await sendText(
    tenant,
    to,
    blocks.join("\n\n") +
      (isEn ? `\n\nType *BOOK* or *MENU*.` : `\n\nबुकिंग के लिए *BOOK* या *MENU* लिखें।`)
  );
}

async function sendLiveStatusSummary(tenant, to, lang) {
  const isEn = lang === "en";
  const statusData = await fetchLiveStatus(tenant.phoneNumberId, "");

  if (!statusData) {
    await sendText(
      tenant,
      to,
      isEn ? `Could not fetch live status.` : `अभी लाइव स्टेटस नहीं मिल पाया।`
    );
    return;
  }

  const recentLines = (statusData.recentTokens || [])
    .map(
      (t) =>
        `• *${t.tokenId}* — ${t.patientName} (${t.doctorName}, ${t.batchSlot || "-"}) → *${
          t.queueStatus
        }* [Reminder: ${t.reminderStatus}]`
    )
    .join("\n");

  const msg = isEn
    ? `*${tenant.brandName} — Live Token Status*\n` +
      `• Current Token: *${statusData.currentToken}*\n` +
      `• Waiting: *${statusData.waitingCount}* | Total: *${statusData.totalTokens}*\n` +
      (recentLines ? `\n*Recent Tokens:*\n${recentLines}\n` : "") +
      `\nSend a *Token ID* or *Patient Name* to check exact status, or type *MENU*.`
    : `*${tenant.brandName} — लाइव टोकन स्टेटस*\n` +
      `• चालू टोकन: *${statusData.currentToken}*\n` +
      `• प्रतीक्षा में: *${statusData.waitingCount}* | कुल: *${statusData.totalTokens}*\n` +
      (recentLines ? `\n*हाल के टोकन:*\n${recentLines}\n` : "") +
      `\nअपना *Token ID* या *नाम* लिखें, या *MENU* लिखें।`;

  updateSession(tenant.clientId, to, { step: "AWAITING_STATUS_QUERY" });
  await sendText(tenant, to, msg);
}

// सभी Scheduled रिमाइंडर भेजने का फंक्शन (Cron / Scheduler / Admin trigger से कॉल हो सकता है)
async function dispatchScheduledReminders(targetPhoneNumberId = "") {
  const phoneId = targetPhoneNumberId || DEFAULT_PHONE_NUMBER_ID;
  if (!WEBHOOK_SINK_URL || !phoneId) return { sentCount: 0 };

  const url = `${WEBHOOK_SINK_URL}?action=get_due_reminders&phone_number_id=${encodeURIComponent(
    phoneId
  )}`;
  const res = await fetch(url);
  const data = await res.json();
  const reminders = (data && data.reminders) || [];
  let sentCount = 0;

  for (const r of reminders) {
    const tenant = resolveTenant(r.phoneNumberId || phoneId);
    if (!r.patientPhone) continue;

    await sendText(
      tenant,
      r.patientPhone,
      `*OPD अपॉइंटमेंट रिमाइंडर*\n` +
        `संस्था: *${tenant.brandName}*\n` +
        `टोकन नंबर: *${r.tokenId}*\n` +
        `मरीज़: *${r.patientName}*\n` +
        `डॉक्टर: *${r.doctorName}*\n` +
        `तारीख: *${r.visitDate}* | बैच: *${r.batchSlot}*\n\n` +
        `कृपया समय से पहले क्लिनिक पहुँचें। लाइव स्टेटस के लिए *STATUS* लिखें।`
    );

    await postToSheet({
      action: "mark_reminder_sent",
      tokenId: r.tokenId,
    });
    sentCount += 1;
  }

  return { sentCount };
}

async function handleInbound(tenant, from, text, buttonId) {
  const cleanText = (text || "").trim();
  const lower = cleanText.toLowerCase();
  const session = getSession(tenant.clientId, from);

  if (["hi", "hlw", "hello", "namaste", "start", "language", "lang"].includes(lower)) {
    updateSession(tenant.clientId, from, { step: null, data: {} });
    await sendLanguageMenu(tenant, from);
    return;
  }

  if (buttonId === "lang_hi" || lower === "hindi") {
    updateSession(tenant.clientId, from, { lang: "hi", step: null, data: {} });
    await sendOpdMainMenu(tenant, from, "hi");
    return;
  }

  if (buttonId === "lang_en" || lower === "english" || lower === "en") {
    updateSession(tenant.clientId, from, { lang: "en", step: null, data: {} });
    await sendOpdMainMenu(tenant, from, "en");
    return;
  }

  const lang = session.lang || "hi";
  const isEn = lang === "en";

  if (lower === "menu") {
    updateSession(tenant.clientId, from, { step: null, data: {} });
    await sendOpdMainMenu(tenant, from, lang);
    return;
  }

  // तुरंत रिमाइंडर डिस्पैच टेस्ट करने के लिए "REMIND" कमांड
  if (lower === "remind" || lower === "reminder") {
    const out = await dispatchScheduledReminders(tenant.phoneNumberId);
    await sendText(
      tenant,
      from,
      isEn
        ? `Reminders processed: *${out.sentCount}* sent.`
        : `रिमाइंडर प्रोसेस पूरा: *${out.sentCount}* रिमाइंडर भेजे गए।`
    );
    return;
  }

  // Live Status क्वेरी
  if (session.step === "AWAITING_STATUS_QUERY") {
    updateSession(tenant.clientId, from, { step: null, data: {} });
    const resData = await fetchLiveStatus(tenant.phoneNumberId, cleanText);
    const matches = (resData && resData.matched) || [];
    if (!matches.length) {
      await sendText(
        tenant,
        from,
        isEn
          ? `No token found for "*${cleanText}*". Type *MENU*.`
          : `"*${cleanText}*" के लिए कोई टोकन नहीं मिला। *MENU* लिखें।`
      );
      return;
    }

    const lines = matches
      .slice(-5)
      .map(
        (m) =>
          `• Token: *${m.tokenId}* | Name: *${m.patientName}*\n` +
          `  Doctor: *${m.doctorName}* | Date: ${m.visitDate} | Batch: *${m.batchSlot || "-"}*\n` +
          `  Queue: *${m.queueStatus}* | Payment: *${m.paymentStatus}* | Reminder: *${m.reminderStatus}*`
      )
      .join("\n\n");

    await sendText(
      tenant,
      from,
      (isEn ? `*Token Status:*\n\n` : `*टोकन स्टेटस:*\n\n`) +
        lines +
        (isEn ? `\n\nType *MENU*.` : `\n\nमुख्य मेनू के लिए *MENU* लिखें।`)
    );
    return;
  }

  // दिन चुनने के बाद 2-घंटे के बैच दिखाना
  if (session.step === "AWAITING_DAY" && session.data?.doctor) {
    const doc = session.data.doctor;
    const dayOptions = getBookingDayOptions(doc, lang);
    const chosenDay = dayOptions.find(
      (d) => d.key === buttonId || d.label.toLowerCase().includes(lower)
    );

    if (!chosenDay) {
      await sendDaySelectionMenu(tenant, from, doc, lang);
      return;
    }

    const { currentMinutes } = getNowParts();
    const validBatches = getValidBatchesForDay(doc.batches, chosenDay.isToday, currentMinutes);

    if (!validBatches.length) {
      await sendText(
        tenant,
        from,
        isEn
          ? `No remaining batches for *${chosenDay.label}*. Please type *BOOK* and pick another day.`
          : `*${chosenDay.label}* के लिए कोई बैच बाकी नहीं है। कृपया *BOOK* लिखकर अगला दिन चुनें।`
      );
      return;
    }

    updateSession(tenant.clientId, from, {
      step: "AWAITING_BATCH",
      data: { doctor: doc, day: chosenDay, validBatches },
    });
    await sendBatchList(tenant, from, doc, chosenDay, validBatches, lang);
    return;
  }

  // 2-घंटे का बैच चुनने के बाद मरीज़ का नाम पूछना
  if (session.step === "AWAITING_BATCH" && session.data?.doctor && session.data?.day) {
    const validBatches = session.data.validBatches || [];
    let selectedSlot = "";

    if (buttonId && buttonId.startsWith("pick_batch_")) {
      const idx = Number(buttonId.replace("pick_batch_", ""));
      selectedSlot = validBatches[idx] || "";
    } else {
      selectedSlot =
        validBatches.find((b) => b.toLowerCase().includes(lower)) || cleanText;
    }

    if (!selectedSlot) {
      await sendBatchList(tenant, from, session.data.doctor, session.data.day, validBatches, lang);
      return;
    }

    updateSession(tenant.clientId, from, {
      step: "AWAITING_PATIENT_NAME",
      data: { ...session.data, batchSlot: selectedSlot },
    });

    await sendText(
      tenant,
      from,
      isEn
        ? `Selected Batch: *${selectedSlot}* (${session.data.day.label})\nPlease enter *Patient Full Name*:`
        : `चुना गया बैच: *${selectedSlot}* (${session.data.day.label})\nकृपया *मरीज़ का पूरा नाम* लिखकर भेजें:`
    );
    return;
  }

  // मरीज़ का नाम मिलते ही टोकन + शीट एंट्री
  if (session.step === "AWAITING_PATIENT_NAME" && session.data?.doctor) {
    const doc = session.data.doctor;
    const dayObj = session.data.day || { dateStr: formatDateISO(0), label: "Today" };
    const batchSlot = session.data.batchSlot || "General Slot";
    const tokenId = makeId("OPD");
    const paymentId = makeId("PAY");

    updateSession(tenant.clientId, from, { step: null, data: {} });

    await postToSheet({
      action: "create_opd_booking",
      createdAt: new Date().toISOString(),
      phoneNumberId: tenant.phoneNumberId,
      clientName: tenant.brandName,
      tokenId,
      paymentId,
      patientName: cleanText,
      patientPhone: from,
      doctorId: doc.doctorId,
      doctorName: doc.doctorName,
      visitDate: dayObj.dateStr,
      batchSlot,
      opdFee: doc.opdFee,
      advanceFee: doc.advanceFee,
      paidAmount: 0,
      paymentMode: doc.advanceFee > 0 ? "Online Advance" : "Counter Cash",
    });

    const msg = isEn
      ? `*OPD Token Confirmed*\n` +
        `Token: *${tokenId}* | Patient: *${cleanText}*\n` +
        `Doctor: *${doc.doctorName}* (${doc.specialty})\n` +
        `Date: *${dayObj.label}* | Batch: *${batchSlot}*\n` +
        `Fee: *₹${doc.opdFee}* | Advance: *₹${doc.advanceFee}*\n` +
        `Reminder: *Scheduled*\n\nType *MENU*.`
      : `*OPD टोकन जारी*\n` +
        `टोकन नंबर: *${tokenId}* | मरीज़: *${cleanText}*\n` +
        `डॉक्टर: *${doc.doctorName}* (${doc.specialty})\n` +
        `दिन/तारीख: *${dayObj.label}* | बैच: *${batchSlot}*\n` +
        `फ़ीस: *₹${doc.opdFee}* | एडवांस: *₹${doc.advanceFee}*\n` +
        `रिमाइंडर: *Scheduled*\n\nमुख्य मेनू के लिए *MENU* लिखें।`;

    await sendText(tenant, from, msg);
    return;
  }

  // डॉक्टर लिस्ट से चुनाव
  if (buttonId && buttonId.startsWith("pick_doc_")) {
    const chosenDocId = buttonId.replace("pick_doc_", "");
    const doctors = await fetchDoctorsForTenant(tenant.phoneNumberId);
    const doc = doctors.find((d) => d.doctorId === chosenDocId);

    if (!doc) {
      await sendText(
        tenant,
        from,
        isEn ? `Doctor not found. Type *BOOK*.` : `डॉक्टर नहीं मिला। *BOOK* लिखें।`
      );
      return;
    }

    updateSession(tenant.clientId, from, {
      step: "AWAITING_DAY",
      data: { doctor: doc },
    });
    await sendDaySelectionMenu(tenant, from, doc, lang);
    return;
  }

  // 1. OPD Booking
  if (
    buttonId === "menu_opd_booking" ||
    lower === "1" ||
    lower.includes("book") ||
    lower.includes("token")
  ) {
    const doctors = await fetchDoctorsForTenant(tenant.phoneNumberId);
    await sendDoctorList(tenant, from, doctors, lang);
    return;
  }

  // 2. Live Status
  if (
    buttonId === "menu_live_status" ||
    lower === "2" ||
    lower.includes("status") ||
    lower.includes("live")
  ) {
    await sendLiveStatusSummary(tenant, from, lang);
    return;
  }

  // 3. Dr Timing
  if (
    buttonId === "menu_dr_timing" ||
    lower === "3" ||
    lower.includes("timing") ||
    lower.includes("dr") ||
    lower.includes("doctor") ||
    lower.includes("fee")
  ) {
    const doctors = await fetchDoctorsForTenant(tenant.phoneNumberId);
    await sendDoctorsTimingAndSchedule(tenant, from, doctors, lang);
    return;
  }

  await sendLanguageMenu(tenant, from);
}

// Cron / Scheduler के लिए रिमाइंडर एंडपॉइंट
app.post("/send-reminders", async (req, res) => {
  try {
    const out = await dispatchScheduledReminders(req.body?.phoneNumberId || "");
    res.status(200).json({ ok: true, ...out });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/", (req, res) => {
  res.status(200).send("AR Enterprises OPD Engine (3-Day Rolling + 2-Hr Batches + Reminder + Live Status) running.");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.object !== "whatsapp_business_account") return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const tenant = resolveTenant(value.metadata?.phone_number_id);

        for (const msg of value.messages || []) {
          if (markProcessed(msg.id)) continue;

          const from = msg.from;
          let incomingText = "";
          let buttonId = "";

          if (msg.type === "text") {
            incomingText = msg.text?.body || "";
          } else if (msg.type === "interactive") {
            const reply = msg.interactive?.button_reply || msg.interactive?.list_reply;
            buttonId = reply?.id || "";
            incomingText = reply?.title || "";
          } else {
            await sendText(tenant, from, "कृपया टेक्स्ट या बटन चुनें। / Please choose a button or text.");
            continue;
          }

          console.log(`[${tenant.brandName}] From ${from}: ${incomingText || buttonId}`);
          await handleInbound(tenant, from, incomingText, buttonId);
        }
      }
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }
});

app.listen(PORT, () => {
  console.log(`AR Enterprises OPD Engine running on port ${PORT}`);
});
