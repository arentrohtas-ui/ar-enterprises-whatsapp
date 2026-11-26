const doctorCache = new Map();

function getNowMin(tz = "Asia/Kolkata") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return Number(map.hour || 0) * 60 + Number(map.minute || 0);
}

function getThreeDaySlots(tz = "Asia/Kolkata") {
  const now = new Date();
  const nowMin = getNowMin(tz);

  const fmt = (offset) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).formatToParts(new Date(now.getTime() + offset * 86400000));
    const m = {};
    for (const p of parts) if (p.type !== "literal") m[p.type] = p.value;
    return `${m.day}-${m.month}-${m.year}`;
  };

  const startOffset = nowMin >= 1200 ? 1 : 0;

  return [0, 1, 2].map((i) => {
    const offset = startOffset + i;
    const date = fmt(offset);
    const isToday = offset === 0;
    return {
      id: `day_${i}`,
      date,
      isToday,
      labelHi: isToday ? `${date} (आज)` : date,
      labelEn: isToday ? `${date} (Today)` : date,
    };
  });
}

function getTwoHourBatches(rawBatches, isToday, tz = "Asia/Kolkata") {
  const list = String(
    rawBatches || "08:00-10:00,10:00-12:00,12:00-14:00,16:00-18:00,18:00-20:00"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!isToday) return list;
  const nowMin = getNowMin(tz);

  return list.filter((slot) => {
    const end = slot.split("-")[1]?.trim();
    if (!end) return true;
    const [h, m] = end.split(":").map(Number);
    return nowMin < h * 60 + (m || 0);
  });
}

async function syncDoctors(ctx, force = false) {
  const key = `${ctx.tenant.phoneId}:${ctx.tenant.sheetId || "default"}`;
  const cached = doctorCache.get(key);
  if (!force && cached && Date.now() < cached.expiresAt) return cached.list;

  const fallback = [
    {
      doctorId: "DR-1",
      doctorName: "Dr. R. K. Sharma",
      specialty: "General Physician",
      opdFee: 500,
      advanceFee: 100,
      batches: "08:00-10:00,10:00-12:00,12:00-14:00,16:00-18:00,18:00-20:00",
      weekSchedule: "Mon-Sat Open | Sun Holiday",
    },
  ];

  const data = await ctx.getSheet({ action: "get_doctors" });
  if (data?.ok && Array.isArray(data.doctors) && data.doctors.length) {
    doctorCache.set(key, { expiresAt: Date.now() + 2 * 60 * 1000, list: data.doctors });
    return data.doctors;
  }
  return cached?.list || fallback;
}

async function sendHomeMenu(ctx, lang) {
  const isEn = lang === "en";
  return ctx.sendWA({
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: isEn
          ? `🏥 *${ctx.tenant.name}*\nSelect a service:`
          : `🏥 *${ctx.tenant.name}*\nकृपया सेवा चुनें:`,
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "opd_book", title: "OPD Booking" } },
          { type: "reply", reply: { id: "opd_status", title: "Live Status" } },
          { type: "reply", reply: { id: "opd_timing", title: "Dr Timing" } },
        ],
      },
    },
  });
}

async function sendDoctorList(ctx, lang, doctors) {
  const isEn = lang === "en";
  return ctx.sendWA({
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: isEn ? "Select Doctor" : "डॉक्टर चुनें" },
      body: {
        text: isEn ? "Choose a doctor for OPD booking:" : "OPD बुकिंग के लिए डॉक्टर चुनें:",
      },
      action: {
        button: isEn ? "Doctors" : "डॉक्टर सूची",
        sections: [
          {
            title: isEn ? "Available Doctors" : "उपलब्ध डॉक्टर",
            rows: doctors.slice(0, 10).map((d) => ({
              id: `doc_${d.doctorId}`,
              title: String(d.doctorName).slice(0, 24),
              description: `₹${d.opdFee} | Adv ₹${d.advanceFee} | ${d.specialty}`.slice(0, 72),
            })),
          },
        ],
      },
    },
  });
}

async function sendDayButtons(ctx, lang, doc, days) {
  const isEn = lang === "en";
  return ctx.sendWA({
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: isEn
          ? `👨‍⚕️ *${doc.doctorName}* (Fee: ₹${doc.opdFee})\nSelect booking date:`
          : `👨‍⚕️ *${doc.doctorName}* (फ़ीस: ₹${doc.opdFee})\nबुकिंग की तारीख़ चुनें:`,
      },
      action: {
        buttons: days.slice(0, 3).map((d) => ({
          type: "reply",
          reply: { id: d.id, title: (isEn ? d.labelEn : d.labelHi).slice(0, 20) },
        })),
      },
    },
  });
}

async function sendBatchSelector(ctx, lang, doc, day, batches) {
  const isEn = lang === "en";
  const head = `👨‍⚕️ *${doc.doctorName}* | 📅 *${isEn ? day.labelEn : day.labelHi}*`;

  if (batches.length <= 3) {
    return ctx.sendWA({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: `${head}\n${isEn ? "Select 2-hour batch:" : "2-घंटे का बैच चुनें:"}` },
        action: {
          buttons: batches.map((slot, idx) => ({
            type: "reply",
            reply: { id: `batch_${idx}`, title: slot.slice(0, 20) },
          })),
        },
      },
    });
  }

  return ctx.sendWA({
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: isEn ? "2-Hr Batches" : "2-घंटे के बैच" },
      body: { text: `${head}\n${isEn ? "Choose a 2-hour batch:" : "2-घंटे का बैच चुनें:"}` },
      action: {
        button: isEn ? "Select Batch" : "बैच चुनें",
        sections: [
          {
            title: isEn ? "Available Slots" : "उपलब्ध समय",
            rows: batches.slice(0, 10).map((slot, idx) => ({
              id: `batch_${idx}`,
              title: slot.slice(0, 24),
              description: isEn ? "2-hour OPD slot" : "2 घंटे का OPD स्लॉट",
            })),
          },
        ],
      },
    },
  });
}

async function sendLiveStatus(ctx, lang, query = "") {
  const isEn = lang === "en";
  const data = await ctx.getSheet({ action: "get_live_status", query });
  if (!data?.ok) {
    return ctx.sendText(isEn ? "Live status unavailable right now." : "अभी लाइव स्टेटस उपलब्ध नहीं है।");
  }

  if (query && Array.isArray(data.matched) && data.matched.length) {
    const lines = data.matched
      .slice(-3)
      .map(
        (m) =>
          `• Token: *${m.tokenId}* (${m.patientName})\n` +
          `  Dr: *${m.doctorName}* | ${m.visitDate} [${m.batchSlot}]\n` +
          `  Queue: *${m.queueStatus}* | Pay: *${m.paymentStatus}*`
      )
      .join("\n\n");
    return ctx.sendText(
      (isEn ? "🔎 *Live Token Status:*\n\n" : "🔎 *लाइव टोकन स्टेटस:*\n\n") +
        lines +
        (isEn
          ? `\n\n• Running Token: *${data.currentToken}* | Waiting: *${data.waitingCount}*\nType *MENU* for main menu.`
          : `\n\n• चालू टोकन: *${data.currentToken}* | प्रतीक्षा में: *${data.waitingCount}*\nमेनू के लिए *MENU* लिखें।`)
    );
  }

  ctx.setSession({ lang, step: "STATUS_LOOKUP" });
  return ctx.sendText(
    isEn
      ? `📊 *Live OPD Queue*\n• Current Token in Cabin: *${data.currentToken}*\n• Total Waiting: *${data.waitingCount}*\n\nSend your *Token ID* (e.g. OPD-1234) or *Name* to track, or type *MENU*.`
      : `📊 *लाइव OPD कतार*\n• केबिन में चालू टोकन: *${data.currentToken}*\n• कुल प्रतीक्षा में: *${data.waitingCount}*\n\nअपना *Token ID* (जैसे OPD-1234) या *नाम* लिखकर देखें, या *MENU* लिखें।`
  );
}

async function sendDueReminders(ctx) {
  const data = await ctx.getSheet({ action: "get_due_reminders" });
  const list = data?.reminders || [];
  let sent = 0;

  for (const r of list) {
    if (!r.patientPhone) continue;
    await fetch(`https://graph.facebook.com/v27.0/${ctx.tenant.phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ctx.tenant.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: r.patientPhone,
        type: "text",
        text: {
          preview_url: false,
          body:
            `⏰ *OPD Reminder — ${ctx.tenant.name}*\n` +
            `• Token: *${r.tokenId}* | Name: *${r.patientName}*\n` +
            `• Doctor: *${r.doctorName}*\n` +
            `• Date: *${r.visitDate}* | Batch: *${r.batchSlot}*`,
        },
      }),
    }).catch(() => {});

    await ctx.postSheet({ action: "mark_reminder_sent", tokenId: r.tokenId });
    sent += 1;
  }
  return { sent };
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

  if (low === "sync") {
    const docs = await syncDoctors(ctx, true);
    return ctx.sendText(isEn ? `✅ Synced ${docs.length} doctors.` : `✅ ${docs.length} डॉक्टर सिंक हो गए।`);
  }

  if (low === "remind") {
    const out = await sendDueReminders(ctx);
    return ctx.sendText(isEn ? `⏰ ${out.sent} reminders sent.` : `⏰ ${out.sent} रिमाइंडर भेजे गए।`);
  }

  if (btnId === "opd_status" || low.includes("status")) {
    return sendLiveStatus(ctx, lang);
  }
  if (s.step === "STATUS_LOOKUP") {
    ctx.setSession({ lang, step: null, data: {} });
    return sendLiveStatus(ctx, lang, text);
  }

  if (btnId === "opd_timing" || low.includes("timing") || low.includes("fee")) {
    const docs = await syncDoctors(ctx);
    const out = docs
      .map(
        (d, i) =>
          `*${i + 1}. ${d.doctorName}* (${d.specialty})\n` +
          `• Fee: ₹${d.opdFee} | Adv: ₹${d.advanceFee}\n` +
          `• Batches: ${d.batches}\n` +
          `• Schedule: ${d.weekSchedule || "Mon-Sat Open | Sun Holiday"}`
      )
      .join("\n\n");
    return ctx.sendText(out + (isEn ? "\n\nType *MENU*." : "\n\nमेनू के लिए *MENU* लिखें।"));
  }

  if (btnId === "opd_book" || low.includes("book")) {
    const docs = await syncDoctors(ctx);
    ctx.setSession({ lang, step: "PICK_DOC", data: { docs } });
    return sendDoctorList(ctx, lang, docs);
  }

  if (s.step === "PICK_DOC" || btnId.startsWith("doc_")) {
    const docs = s.data?.docs || (await syncDoctors(ctx));
    const id = btnId.startsWith("doc_") ? btnId.replace("doc_", "") : "";
    const doc = docs.find((d) => d.doctorId === id) || docs[Number(low) - 1];
    if (!doc) return sendDoctorList(ctx, lang, docs);

    const days = getThreeDaySlots();
    ctx.setSession({ lang, step: "PICK_DAY", data: { doc, days } });
    return sendDayButtons(ctx, lang, doc, days);
  }

  if (s.step === "PICK_DAY" || btnId.startsWith("day_")) {
    const doc = s.data?.doc || { doctorName: "Doctor", opdFee: 0, batches: "" };
    const days = s.data?.days || getThreeDaySlots();
    const day = days.find((d) => d.id === btnId) || days[Number(low) - 1];
    if (!day) return sendDayButtons(ctx, lang, doc, days);

    const batches = getTwoHourBatches(doc.batches, day.isToday);
    if (!batches.length) {
      return ctx.sendText(
        isEn ? "No batches left today. Type *MENU*." : "आज के लिए कोई बैच बाकी नहीं। *MENU* लिखें।"
      );
    }
    ctx.setSession({ lang, step: "PICK_BATCH", data: { doc, day, batches } });
    return sendBatchSelector(ctx, lang, doc, day, batches);
  }

  if (s.step === "PICK_BATCH" || btnId.startsWith("batch_")) {
    const batches = s.data?.batches || getTwoHourBatches("", false);
    const slot = btnId.startsWith("batch_")
      ? batches[Number(btnId.replace("batch_", ""))]
      : batches[Number(low) - 1];
    if (!slot) return sendBatchSelector(ctx, lang, s.data?.doc, s.data?.day, batches);

    ctx.setSession({ lang, step: "ASK_NAME", data: { ...s.data, slot } });
    return ctx.sendText(
      isEn ? `🕒 Batch: *${slot}*\nEnter *Patient Name*:` : `🕒 बैच: *${slot}*\nकृपया *मरीज़ का नाम* लिखें:`
    );
  }

  if (s.step === "ASK_NAME") {
    const doc = s.data?.doc || {};
    const day = s.data?.day || {};
    const slot = s.data?.slot || "";
    const tokenId = `OPD-${Math.floor(1000 + Math.random() * 9000)}`;
    const paymentId = `PAY-${Math.floor(1000 + Math.random() * 9000)}`;
    const payAmount = Number(doc.advanceFee || doc.opdFee || 0);

    ctx.setSession({ lang, step: null, data: {} });

    const rzpLink = ctx.createRazorpayLink
      ? await ctx.createRazorpayLink({
          amountInRupees: payAmount,
          tokenId,
          patientName: text,
          phone: ctx.from,
          description: `${ctx.tenant.name} - ${doc.doctorName} (${tokenId})`,
        })
      : null;

    await ctx.postSheet({
      action: "create_opd_booking",
      createdAt: new Date().toISOString(),
      tokenId,
      paymentId,
      paymentLinkId: rzpLink?.id || "",
      patientName: text,
      patientPhone: ctx.from,
      doctorId: doc.doctorId || "",
      doctorName: doc.doctorName || "",
      visitDate: day.date || "",
      batchSlot: slot,
      opdFee: doc.opdFee || 0,
      advanceFee: doc.advanceFee || 0,
      paidAmount: 0,
    });

    const payLineEn = rzpLink?.shortUrl
      ? `\n💳 *Pay Advance (₹${payAmount}):* ${rzpLink.shortUrl}`
      : `\n💳 Pay ₹${payAmount} at clinic counter.`;
    const payLineHi = rzpLink?.shortUrl
      ? `\n💳 *एडवांस पेमेंट (₹${payAmount}) लिंक:* ${rzpLink.shortUrl}`
      : `\n💳 ₹${payAmount} क्लिनिक काउंटर पर जमा करें।`;

    return ctx.sendText(
      isEn
        ? `✅ *OPD Token Generated*\n• Token: *${tokenId}*\n• Name: *${text}*\n• Doctor: *${doc.doctorName}*\n• Date: *${day.date}* | Batch: *${slot}*\n• Fee: ₹${doc.opdFee} | Adv: ₹${doc.advanceFee}${payLineEn}\n\nType *STATUS* for live queue or *MENU*.`
        : `✅ *OPD टोकन जारी*\n• टोकन ID: *${tokenId}*\n• मरीज़: *${text}*\n• डॉक्टर: *${doc.doctorName}*\n• तारीख़: *${day.date}* | बैच: *${slot}*\n• फ़ीस: ₹${doc.opdFee} | एडवांस: ₹${doc.advanceFee}${payLineHi}\n\nलाइव कतार देखने के लिए *STATUS* या *MENU* लिखें।`
    );
  }

  return sendHomeMenu(ctx, lang);
}

module.exports = { sendHomeMenu, handleMessage, sendDueReminders };
