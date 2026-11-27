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
    name: String(
      raw.name || raw.Doctor_Name || raw.doctorName || "Doctor"
    ).trim(),
    specialty: String(
      raw.specialty || raw.Specialization || raw.Specialty || "General Physician"
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
              ? "👨‍⚕️ *Choose Doctor* from the option list below:"
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
    if (waRes && !waRes.error) return;
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
    if (waRes && !waRes.error) return;
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
    if (waRes && !waRes.error) return;
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

    const days = getUpcomingDays(lang).filter((day) =>
      isDoctorAvailableOnDay(picked, day.key)
    );

    if (!days.length) {
      await ctx.sendText(
        lang === "en"
          ? `${picked.name} is currently unavailable on upcoming days. Please choose another doctor.`
          : `${picked.name} आगामी दिनों में उपलब्ध नहीं हैं। कृपया दूसरा डॉक्टर चुनें।`
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

    const slots = getDoctorSlots(data.selectedDoctor, lang);
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

    await ctx.sendText(
      lang === "en"
        ? "📱 Please enter *10-digit Mobile Number*:"
        : "📱 कृपया *10 अंकों का मोबाइल नंबर* लिखें:"
    );
    return;
  }

  if (step === "ENTER_PHONE") {
    const digits = cleanText.replace(/\D/g, "");
    const tenDigit =
      digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;

    if (tenDigit.length !== 10) {
      await ctx.sendText(
        lang === "en"
          ? "Please enter a valid 10-digit mobile number."
          : "कृपया सही 10 अंकों का मोबाइल नंबर लिखें।"
      );
      return;
    }

    const doc = normalizeDoctorObj(data.selectedDoctor || {});
    const opdFee = toNumberClean(doc.opdFee, 0);
    const advCfg = toNumberClean(
      doc.advanceAmount || ctx.business?.advanceAmount || 0,
      0
    );
    const payableAmount =
      advCfg > 0 && advCfg < opdFee ? advCfg : opdFee > 0 ? opdFee : 0;

    const bookingPayload = {
      lang,
      selectedDoctor: doc,
      dayInfo: data.dayInfo,
      visitDate: data.visitDate,
      batchSlot: data.batchSlot,
      patientName: data.patientName,
      patientAge: data.patientAge,
      patientPhone: tenDigit,
      opdFee,
      payableAmount,
    };

    if (payableAmount > 0 && typeof ctx.createRazorpayLink === "function") {
      try {
        const sheetId = String(ctx.business?.sheetId || "").trim();
        const linkRes = await ctx.createRazorpayLink({
          amount: payableAmount,
          customerName: data.patientName,
          customerPhone: tenDigit,
          description: `${doc.name || "OPD"} - ${data.visitDate}`,
          spreadsheetId: sheetId,
          spreadsheet_id: sheetId,
          businessName: ctx.business?.name || "City Care OPD",
          cashfreeAppId: ctx.business?.cashfreeAppId || "",
          cashfreeSecretKey: ctx.business?.cashfreeSecretKey || "",
        });

        const orderId = String(
          linkRes?.orderId ||
            linkRes?.order_id ||
            linkRes?.linkId ||
            linkRes?.link_id ||
            linkRes?.id ||
            ""
        ).trim();
        const payUrl = String(
          linkRes?.paymentLink ||
            linkRes?.payment_url ||
            linkRes?.link_url ||
            linkRes?.url ||
            ""
        ).trim();

        if (orderId && typeof ctx.registerPendingPayment === "function") {
          ctx.registerPendingPayment(orderId, bookingPayload);
        }

        if (payUrl) {
          ctx.setSession({
            lang,
            step: "AWAIT_PAYMENT",
            data: { ...bookingPayload, orderId, payUrl },
          });

          await ctx.sendText(
            lang === "en"
              ? `💳 *Complete Payment to Confirm Token*\n\n` +
                `• Patient: *${data.patientName}* (${data.patientAge} yrs)\n` +
                `• Doctor: *${doc.name}*\n` +
                `• Date: *${data.visitDate}* | *${data.batchSlot}*\n` +
                `• Amount to Pay: *₹${payableAmount}*\n\n` +
                `Pay here: ${payUrl}\n\n` +
                `Once paid, your token will be sent automatically.`
              : `💳 *टोकन कन्फ़र्म करने के लिए पेमेंट करें*\n\n` +
                `• मरीज़: *${data.patientName}* (${data.patientAge} वर्ष)\n` +
                `• डॉक्टर: *${doc.name}*\n` +
                `• तारीख: *${data.visitDate}* | *${data.batchSlot}*\n` +
                `• देय राशि: *₹${payableAmount}*\n\n` +
                `पेमेंट लिंक: ${payUrl}\n\n` +
                `पेमेंट होते ही आपका टोकन अपने आप भेज दिया जाएगा।`
          );
          return;
        }

        await ctx.sendText(
          lang === "en"
            ? `⚠️ *Payment Link Error*\nAmount: ₹${payableAmount}\nCould not generate payment link right now. Please check Cashfree settings or contact reception.`
            : `⚠️ *पेमेंट लिंक बनाने में समस्या*\nराशि: ₹${payableAmount}\nअभी पेमेंट लिंक नहीं बन पाया। कृपया Cashfree सेटिंग देखें या रिसेप्शन से संपर्क करें।`
        );
        return;
      } catch (err) {
        console.error("Payment link creation error:", err);
        await ctx.sendText(
          lang === "en"
            ? `⚠️ Could not create payment link for ₹${payableAmount}. Please try again.`
            : `⚠️ ₹${payableAmount} का पेमेंट लिंक नहीं बन सका। कृपया दोबारा प्रयास करें।`
        );
        return;
      }
    }

    await ctx.sendText(
      lang === "en"
        ? "⚠️ Doctor OPD fee is ₹0, so online payment is not required. Please set OPD_Fee in sheet if payment is needed."
        : "⚠️ डॉक्टर की OPD फ़ीस ₹0 सेट है, इसलिए पेमेंट नहीं माँगा गया। पेमेंट माँगने के लिए शीट में OPD_Fee सेट करें।"
    );
    return;
  }

  if (step === "AWAIT_PAYMENT") {
    const orderId = String(data.orderId || "").trim();
    if (orderId && typeof ctx.checkCashfreePaymentStatus === "function") {
      const statusRes = await ctx.checkCashfreePaymentStatus({ orderId });
      if (statusRes?.status === "PAID") {
        await ctx.sendText(
          lang === "en"
            ? "✅ Payment verified! Confirming your token..."
            : "✅ पेमेंट कन्फ़र्म हो गया है! आपका टोकन भेजा जा रहा है..."
        );
        return;
      }
    }

    await ctx.sendText(
      lang === "en"
        ? `⏳ Payment is still pending${data.payUrl ? `:\n${data.payUrl}` : "."}`
        : `⏳ आपका पेमेंट अभी पेंडिंग है${data.payUrl ? `:\n${data.payUrl}` : "।"}`
    );
  }
}

async function handleMessage(ctx, text = "", btnId = "") {
  const session = ctx.getSession();
  let lang = session.lang === "en" ? "en" : "hi";
  const cleanText = String(text || "").trim();
  const cleanId = String(btnId || "").trim();
  const lower = cleanText.toLowerCase();

  if (
    cleanId === "MENU_LANG" ||
    (!session.step && cleanText === "3") ||
    lower === "english" ||
    lower === "hindi" ||
    lower === "हिंदी"
  ) {
    if (lower === "english" || cleanId === "MENU_LANG") {
      lang = lang === "hi" ? "en" : "hi";
    } else if (lower === "hindi" || lower === "हिंदी") {
      lang = "hi";
    } else {
      lang = lang === "hi" ? "en" : "hi";
    }
    ctx.setSession({ lang, step: null, data: {} });
    await sendMainMenu(ctx, lang);
    return;
  }

  if (
    ["hi", "hello", "hey", "नमस्ते", "namaste", "start", "menu", "0"].includes(
      lower
    )
  ) {
    ctx.setSession({ lang, step: null, data: {} });
    await sendMainMenu(ctx, lang);
    return;
  }

  if (
    cleanId === "MENU_BOOK" ||
    (!session.step && cleanText === "1") ||
    lower.includes("book") ||
    lower.includes("टोकन")
  ) {
    await startBookingFlow(ctx, lang);
    return;
  }

  if (
    cleanId === "MENU_STATUS" ||
    (!session.step && cleanText === "2") ||
    lower.includes("status") ||
    lower.includes("स्टेटस")
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
  handleMessage,
};
