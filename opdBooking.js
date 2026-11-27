const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toNumberClean(val, fallback = 0) {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  const cleaned = String(val ?? "").replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && cleaned !== "" ? n : fallback;
}

function formatIstYmd(dateObj) {
  const ist = new Date(dateObj.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
    name: String(raw.name || raw.Doctor_Name || raw.doctorName || "Doctor").trim(),
    specialty: String(
      raw.specialty || raw.Specialty || "General Physician"
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

function getDoctorSlots(doc, lang = "hi") {
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
      label: lang === "en" ? "Morning (09:00 AM - 01:00 PM)" : "सुबह (09:00 AM - 01:00 PM)",
      value: "09:00 AM - 01:00 PM",
    });
    slots.push({
      id: "EVENING",
      label: lang === "en" ? "Evening (04:00 PM - 08:00 PM)" : "शाम (04:00 PM - 08:00 PM)",
      value: "04:00 PM - 08:00 PM",
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

async function fetchBookingsList(ctx) {
  try {
    const res = await ctx.getSheet({
      action: "get_live_status",
      tokenId: "",
      phone: "",
    });
    if (Array.isArray(res?.allBookings)) return res.allBookings;
    if (Array.isArray(res?.bookings)) return res.bookings;
    if (Array.isArray(res?.data)) return res.data;
  } catch (_) {}

  try {
    const res2 = await ctx.getSheet({ action: "get_dashboard_data" });
    if (Array.isArray(res2?.bookings)) return res2.bookings;
  } catch (_) {}

  return [];
}

async function sendMainMenu(ctx, lang = "hi") {
  const clinicName = ctx.business?.name || "City Care OPD";

  if (typeof ctx.sendWA === "function") {
    const bodyText =
      lang === "en"
        ? `🏥 *${clinicName}*\nWelcome! How can we help you today?`
        : `🏥 *${clinicName}*\nनमस्ते! आज हम आपकी क्या मदद कर सकते हैं?`;

    const waRes = await ctx.sendWA({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: "MENU_BOOK",
                title: lang === "en" ? "Book Token" : "टोकन बुक करें",
              },
            },
            {
              type: "reply",
              reply: {
                id: "MENU_STATUS",
                title: lang === "en" ? "Live Status" : "लाइव स्टेटस",
              },
            },
            {
              type: "reply",
              reply: {
                id: "MENU_LANG",
                title: lang === "en" ? "हिंदी में बदलें" : "Switch to English",
              },
            },
          ],
        },
      },
    });
    if (waRes && !waRes.error) return;
  }

  const fallbackMsg =
    lang === "en"
      ? `🏥 *${clinicName}*\n\n1️⃣ Reply *1* to *Book OPD Token*\n2️⃣ Reply *2* to check *Live Queue Status*\n3️⃣ Reply *3* to switch to *हिंदी*`
      : `🏥 *${clinicName}*\n\n1️⃣ *OPD टोकन बुक* करने के लिए *1* भेजें\n2️⃣ *लाइव कतार स्टेटस* देखने के लिए *2* भेजें\n3️⃣ *English* में बदलने के लिए *3* भेजें`;

  await ctx.sendText(fallbackMsg);
}

async function sendLiveQueueStatus(ctx, lang = "hi") {
  const bookings = await fetchBookingsList(ctx);
  const today = formatIstYmd(new Date());
  const todayList = bookings.filter(
    (b) => String(b.Visit_Date || "").slice(0, 10) === today
  );
  const activeList = todayList.length ? todayList : bookings;

  const running = activeList.find(
    (b) =>
      String(b.Queue_Status || "").trim().toLowerCase() === "in consultation"
  );
  const waitingCount = activeList.filter(
    (b) =>
      String(b.Queue_Status || "Waiting").trim().toLowerCase() === "waiting"
  ).length;

  const msg =
    lang === "en"
      ? `📊 *Live OPD Queue Status*\n\n` +
        `• Current Running Token: *${
          running ? `${running.Token_ID} (${running.Patient_Name})` : "None"
        }*\n` +
        `• Waiting Patients: *${waitingCount}*\n` +
        `• Total Bookings: *${activeList.length}*`
      : `📊 *लाइव OPD कतार स्टेटस*\n\n` +
        `• अभी चल रहा टोकन: *${
          running ? `${running.Token_ID} (${running.Patient_Name})` : "कोई नहीं"
        }*\n` +
        `• प्रतीक्षा में मरीज़: *${waitingCount}*\n` +
        `• कुल बुकिंग: *${activeList.length}*`;

  await ctx.sendText(msg);
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
        ? `👨‍⚕️ *Choose Doctor* (tap a button or reply number):\n\n${lines.join(
            "\n"
          )}`
        : `👨‍⚕️ *डॉक्टर चुनें* (बटन दबाएं या नंबर लिखें):\n\n${lines.join("\n")}`;

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
    if (waRes && !waRes.error) return;
  }

  if (doctors
