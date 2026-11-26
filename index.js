const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ar_enterprises_verify_123";
const DEFAULT_ACCESS_TOKEN = process.env.ACCESS_TOKEN || "";
const DEFAULT_PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
const WEBHOOK_SINK_URL = process.env.WEBHOOK_SINK_URL || "";

// हर क्लाइंट के Phone Number ID के हिसाब से अलग बिज़नेस सेटिंग
const TENANTS = {
  ...(DEFAULT_PHONE_NUMBER_ID
    ? {
        [DEFAULT_PHONE_NUMBER_ID]: {
          clientId: "city_care_opd",
          brandName: "City Care OPD & Polyclinic",
          sector: "opd", // "opd" | "gym" | "school" | "coaching"
          accessToken: DEFAULT_ACCESS_TOKEN,
          upiOrPayBaseUrl: "https://ar-enterprises-whatsapp.onrender.com/pay-demo",
        },
      }
    : {}),
  // नया क्लाइंट जोड़ने के लिए बस उसका Phone Number ID और Token नीचे जोड़ें:
  // "987654321012345": {
  //   clientId: "fit_zone_gym",
  //   brandName: "FitZone Gym",
  //   sector: "gym",
  //   accessToken: "CLIENT_TOKEN",
  //   upiOrPayBaseUrl: "",
  // },
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
  if (existing && Date.now() - existing.updatedAt > 30 * 60 * 1000) {
    userSessions.delete(key);
    return { step: null, data: {}, updatedAt: Date.now() };
  }
  return existing || { step: null, data: {}, updatedAt: Date.now() };
}

function setSession(clientId, from, step, data = {}) {
  userSessions.set(`${clientId}:${from}`, {
    step,
    data,
    updatedAt: Date.now(),
  });
}

function clearSession(clientId, from) {
  userSessions.delete(`${clientId}:${from}`);
}

function makeId(prefix) {
  return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
}

async function fetchDoctorsForTenant(phoneNumberId) {
  if (!WEBHOOK_SINK_URL) return [];
  try {
    const url = `${WEBHOOK_SINK_URL}?action=get_doctors&phone_number_id=${encodeURIComponent(
      phoneNumberId
    )}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.ok && Array.isArray(json.doctors)) {
      return json.doctors;
    }
  } catch (err) {
    console.error("Error fetching doctors from Sheet:", err.message || err);
  }
  return [];
}

async function postToSheet(payload) {
  if (!WEBHOOK_SINK_URL) return null;
  try {
    const res = await fetch(WEBHOOK_SINK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    console.log("Sheet response:", text);
    return text;
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

function formatWeekSchedule(doc) {
  const w = doc.weekSchedule || {};
  return (
    `Mon: ${w.Mon || "-"} | Tue: ${w.Tue || "-"} | Wed: ${w.Wed || "-"}\n` +
    `Thu: ${w.Thu || "-"} | Fri: ${w.Fri || "-"} | Sat: ${w.Sat || "-"}\n` +
    `Sun: ${w.Sun || "Holiday"}` +
    (doc.holidayNote ? `\nनोट: ${doc.holidayNote}` : "")
  );
}

async function sendOpdHomeMenu(tenant, to) {
  await postToWhatsApp(tenant, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text:
          `नमस्ते! *${tenant.brandName}* में आपका स्वागत है।\n` +
          `कृपया नीचे से विकल्प चुनें:\n\n` +
          `• *Book OPD Token* — डॉक्टर चुनें और टोकन लें\n` +
          `• *Doctors & Fee* — सभी डॉक्टरों की फ़ीस, टाइमिंग व 1 हफ्ते का शेड्यूल\n` +
          `• *Help / Timing* — पता व सहायता`,
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "opd_book", title: "Book OPD Token" } },
          { type: "reply", reply: { id: "opd_schedule", title: "Doctors & Fee" } },
          { type: "reply", reply: { id: "opd_help", title: "Help / Timing" } },
        ],
      },
    },
  });
}

async function sendDoctorSelectionList(tenant, to, doctors) {
  if (!doctors.length) {
    await sendText(
      tenant,
      to,
      `अभी *${tenant.brandName}* के लिए शीट में कोई डॉक्टर एक्टिव नहीं है। कृपया थोड़ी देर बाद प्रयास करें।`
    );
    return;
  }

  // WhatsApp Interactive List (10 डॉक्टर तक सीधे चुनने के लिए)
  const rows = doctors.slice(0, 10).map((doc) => ({
    id: `pick_doc_${doc.doctorId}`,
    title: doc.doctorName.slice(0, 24),
    description: `Fee ₹${doc.opdFee} | Adv ₹${doc.advanceFee} | ${doc.timing}`.slice(0, 72),
  }));

  await postToWhatsApp(tenant, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "डॉक्टर चुनें" },
      body: {
        text: `*${tenant.brandName}* में उपलब्ध डॉक्टरों की सूची नीचे दी गई है। अपॉइंटमेंट/टोकन के लिए डॉक्टर चुनें:`,
      },
      action: {
        button: "Select Doctor",
        sections: [{ title: "Available Doctors", rows }],
      },
    },
  });
}

async function sendAllDoctorsScheduleText(tenant, to, doctors) {
  if (!doctors.length) {
    await sendText(tenant, to, `अभी डॉक्टर शेड्यूल शीट में उपलब्ध नहीं है।`);
    return;
  }

  const blocks = doctors.map(
    (d, idx) =>
      `*${idx + 1}. ${d.doctorName}* (${d.specialty})\n` +
      `• कुल फ़ीस: *₹${d.opdFee}* | एडवांस फ़ीस: *₹${d.advanceFee}*\n` +
      `• समय: *${d.timing}*\n` +
      `• साप्ताहिक शेड्यूल:\n${formatWeekSchedule(d)}`
  );

  await sendText(
    tenant,
    to,
    `*${tenant.brandName} — डॉक्टर लिस्ट व 7-दिन शेड्यूल*\n\n${blocks.join(
      "\n\n"
    )}\n\nटोकन बुक करने के लिए *BOOK* लिखें।`
  );
}

async function handleOpdFlow(tenant, from, text, buttonId) {
  const lower = text.toLowerCase();
  const session = getSession(tenant.clientId, from);

  if (["hi", "hlw", "hello", "namaste", "menu", "start"].includes(lower)) {
    clearSession(tenant.clientId, from);
    await sendOpdHomeMenu(tenant, from);
    return;
  }

  // डॉक्टर चुनने के बाद मरीज़ का नाम लेकर टोकन + पेमेंट लेजर एंट्री करना
  if (session.step === "OPD_AWAITING_PATIENT_NAME" && session.data.doctor) {
    const doc = session.data.doctor;
    const tokenId = makeId("OPD");
    const paymentId = makeId("PAY");
    const visitDate = new Date().toISOString().slice(0, 10);

    clearSession(tenant.clientId, from);

    await postToSheet({
      action: "create_opd_booking",
      createdAt: new Date().toISOString(),
      phoneNumberId: tenant.phoneNumberId,
      clientName: tenant.brandName,
      tokenId,
      paymentId,
      patientName: text,
      patientPhone: from,
      doctorId: doc.doctorId,
      doctorName: doc.doctorName,
      visitDate,
      opdFee: doc.opdFee,
      advanceFee: doc.advanceFee,
      paidAmount: 0,
      paymentMode: doc.advanceFee > 0 ? "Online Advance" : "Counter Cash",
    });

    let msg =
      `*OPD टोकन बुक हो गया*\n` +
      `संस्था: *${tenant.brandName}*\n` +
      `टोकन नंबर: *${tokenId}*\n` +
      `मरीज़: *${text}*\n` +
      `डॉक्टर: *${doc.doctorName}* (${doc.specialty})\n` +
      `समय: *${doc.timing}*\n` +
      `कुल फ़ीस: *₹${doc.opdFee}*\n`;

    if (doc.advanceFee > 0) {
      const payLink = tenant.upiOrPayBaseUrl
        ? `${tenant.upiOrPayBaseUrl}?token=${tokenId}&amount=${doc.advanceFee}`
        : "";
      msg +=
        `एडवांस फ़ीस: *₹${doc.advanceFee}* (पेमेंट ID: ${paymentId})\n` +
        (payLink ? `एडवांस पेमेंट लिंक: ${payLink}\n` : "") +
        `स्थिति: *Advance Pending* (पेमेंट के बाद कन्फ़र्म रसीद मिलेगी)\n`;
    } else {
      msg += `स्थिति: *Confirmed (फ़ीस क्लिनिक काउंटर पर)*\n`;
    }

    msg += `\nमुख्य मेनू के लिए *MENU* लिखें।`;
    await sendText(tenant, from, msg);
    return;
  }

  // Interactive List से डॉक्टर चुना गया
  if (buttonId && buttonId.startsWith("pick_doc_")) {
    const chosenDocId = buttonId.replace("pick_doc_", "");
    const doctors = await fetchDoctorsForTenant(tenant.phoneNumberId);
    const doc = doctors.find((d) => d.doctorId === chosenDocId);

    if (!doc) {
      await sendText(tenant, from, `डॉक्टर की जानकारी नहीं मिली। कृपया *BOOK* लिखकर फिर चुनें।`);
      return;
    }

    setSession(tenant.clientId, from, "OPD_AWAITING_PATIENT_NAME", { doctor: doc });
    await sendText(
      tenant,
      from,
      `आपने चुना है: *${doc.doctorName}* (${doc.specialty})\n` +
        `• फ़ीस: *₹${doc.opdFee}* | एडवांस: *₹${doc.advanceFee}*\n` +
        `• समय: *${doc.timing}*\n` +
        `• साप्ताहिक शेड्यूल:\n${formatWeekSchedule(doc)}\n\n` +
        `अब कृपया *मरीज़ का पूरा नाम* लिखकर भेजें:`
    );
    return;
  }

  if (buttonId === "opd_book" || lower === "1" || lower.includes("book") || lower.includes("token")) {
    const doctors = await fetchDoctorsForTenant(tenant.phoneNumberId);
    await sendDoctorSelectionList(tenant, from, doctors);
    return;
  }

  if (
    buttonId === "opd_schedule" ||
    lower === "2" ||
    lower.includes("doctor") ||
    lower.includes("fee") ||
    lower.includes("schedule")
  ) {
    const doctors = await fetchDoctorsForTenant(tenant.phoneNumberId);
    await sendAllDoctorsScheduleText(tenant, from, doctors);
    return;
  }

  if (buttonId === "opd_help" || lower === "3" || lower.includes("help")) {
    await sendText(
      tenant,
      from,
      `*${tenant.brandName} — सहायता*\n• नया टोकन लेने के लिए *BOOK* लिखें।\n• सभी डॉक्टरों की फ़ीस और 1 हफ्ते का शेड्यूल देखने के लिए *FEE* लिखें।`
    );
    return;
  }

  await sendOpdHomeMenu(tenant, from);
}

// पेमेंट गेटवे (Razorpay/Cashfree) वेबहुक से पेमेंट कन्फ़र्म होने पर शीट अपडेट + WhatsApp रसीद
app.post("/payment-webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const { phoneNumberId, tokenId, patientPhone, patientName, doctorName, paidAmount, gatewayRef } =
      req.body || {};
    if (!tokenId) return;

    const tenant = resolveTenant(phoneNumberId);
    await postToSheet({
      action: "confirm_payment",
      tokenId,
      paidAmount: Number(paidAmount || 0),
      gatewayRef: gatewayRef || "PG-CONFIRMED",
    });

    if (patientPhone) {
      await sendText(
        tenant,
        patientPhone,
        `*पेमेंट रसीद कन्फ़र्म*\n` +
          `संस्था: *${tenant.brandName}*\n` +
          `टोकन नंबर: *${tokenId}*\n` +
          `मरीज़: *${patientName || ""}*\n` +
          `डॉक्टर: *${doctorName || ""}*\n` +
          `जमा राशि: *₹${paidAmount}*\n` +
          `रेफरेंस: ${gatewayRef || "Confirmed"}`
      );
    }
  } catch (err) {
    console.error("Payment webhook error:", err);
  }
});

app.get("/", (req, res) => {
  res.status(200).send("AR Enterprises Multi-Tenant OPD + Ledger Engine running.");
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
            await sendText(tenant, from, "कृपया टेक्स्ट या बटन चुनें। मेनू के लिए *MENU* लिखें।");
            continue;
          }

          console.log(`[${tenant.brandName}] From ${from}: ${incomingText || buttonId}`);
          await handleOpdFlow(tenant, from, incomingText, buttonId);
        }
      }
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }
});

app.listen(PORT, () => {
  console.log(`AR Enterprises Multi-Tenant Engine running on port ${PORT}`);
});
