const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ar_enterprises_verify_123";
const DEFAULT_ACCESS_TOKEN = process.env.ACCESS_TOKEN || "";
const DEFAULT_PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
const WEBHOOK_SINK_URL = process.env.WEBHOOK_SINK_URL || ""; // Optional Google Apps Script URL

// हर क्लाइंट के Phone Number ID के हिसाब से कॉन्फ़िगरेशन
// नए क्लाइंट जोड़ने के लिए यहाँ एक ऑब्जेक्ट जोड़ें या DB से लोड करें
const TENANTS = {
  // टेस्ट / डिफ़ॉल्ट क्लाइंट (AR Enterprises)
  ...(DEFAULT_PHONE_NUMBER_ID
    ? {
        [DEFAULT_PHONE_NUMBER_ID]: {
          clientId: "ar_default",
          brandName: "AR Enterprises",
          sector: "platform", // "opd" | "gym" | "school" | "coaching" | "platform"
          accessToken: DEFAULT_ACCESS_TOKEN,
          sheetTab: "AR_Leads",
        },
      }
    : {}),

  // उदाहरण के लिए भविष्य के क्लाइंट्स (असली Phone Number ID और टोकन डालें):
  // "1529077573614446": {
  //   clientId: "city_opd_01",
  //   brandName: "City Care OPD",
  //   sector: "opd",
  //   accessToken: process.env.ACCESS_TOKEN,
  //   sheetTab: "OPD_Tokens",
  // },
  // "999888777666555": {
  //   clientId: "iron_gym_01",
  //   brandName: "Iron Core Gym",
  //   sector: "gym",
  //   accessToken: "CLIENT_GYM_TOKEN",
  //   sheetTab: "Gym_Enquiries",
  // },
  // "999888777666444": {
  //   clientId: "bright_school_01",
  //   brandName: "Bright Future School",
  //   sector: "school",
  //   accessToken: "CLIENT_SCHOOL_TOKEN",
  //   sheetTab: "School_Admissions",
  // },
  // "999888777666333": {
  //   clientId: "apex_coaching_01",
  //   brandName: "Apex Coaching",
  //   sector: "coaching",
  //   accessToken: "CLIENT_COACHING_TOKEN",
  //   sheetTab: "Coaching_Leads",
  // },
};

const processedMessageIds = new Set();
const userSessions = new Map(); // key: `${clientId}:${from}` -> { step, data, updatedAt }

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
    sector: "platform",
    accessToken: DEFAULT_ACCESS_TOKEN,
    sheetTab: "General_Leads",
  };
}

function getSession(clientId, from) {
  const key = `${clientId}:${from}`;
  const existing = userSessions.get(key);
  // 30 मिनट बाद सेशन रीसेट
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

async function forwardEventToSink(eventPayload) {
  if (!WEBHOOK_SINK_URL) return;
  try {
    await fetch(WEBHOOK_SINK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventPayload),
    });
  } catch (err) {
    console.error("Webhook sink error:", err.message || err);
  }
}

async function postToWhatsApp(tenant, payload) {
  if (!tenant.accessToken || !tenant.phoneNumberId) {
    console.error("Missing accessToken or phoneNumberId for tenant:", tenant.clientId);
    return;
  }

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
      console.error("WhatsApp Send API error:", JSON.stringify(data, null, 2));
    } else {
      console.log("WhatsApp Send API response:", JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error("Fetch error while calling WhatsApp API:", err.message || err);
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

async function sendMainMenu(tenant, to) {
  const isPlatform = tenant.sector === "platform";
  const bodyText = isPlatform
    ? `नमस्ते! *${tenant.brandName}* ऑटोमेशन सिस्टम में आपका स्वागत है।\nकृपया अपना सेक्टर या सेवा चुनें:\n\n` +
      `• *OPD / Clinic* — लाइव टोकन व अपॉइंटमेंट\n` +
      `• *Gym / School / Coaching* — ऑटो-रिप्लाई, फ़ीस व लीड्स\n` +
      `• *Demo / Support* — अपने बिज़नेस के लिए सेटअप`
    : `नमस्ते! *${tenant.brandName}* में आपका स्वागत है।\nकृपया नीचे से विकल्प चुनें:`;

  const buttons = isPlatform
    ? [
        { type: "reply", reply: { id: "sec_opd", title: "OPD / Clinic" } },
        { type: "reply", reply: { id: "sec_inst", title: "Gym/School/Coach" } },
        { type: "reply", reply: { id: "sec_demo", title: "Demo & Setup" } },
      ]
    : [
        { type: "reply", reply: { id: "act_primary", title: "Book / Enquire" } },
        { type: "reply", reply: { id: "act_status", title: "Status / Info" } },
        { type: "reply", reply: { id: "act_support", title: "Help Desk" } },
      ];

  await postToWhatsApp(tenant, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: { buttons },
    },
  });
}

async function handleInbound(tenant, from, incomingText, buttonId) {
  const text = (incomingText || "").trim();
  const lower = text.toLowerCase();
  const session = getSession(tenant.clientId, from);

  if (["hi", "hlw", "hello", "namaste", "menu", "start"].includes(lower)) {
    clearSession(tenant.clientId, from);
    await sendMainMenu(tenant, from);
    return;
  }

  // यदि यूज़र किसी चल रहे स्टेप (जैसे नाम या डिटेल) का जवाब दे रहा है
  if (session.step === "AWAITING_OPD_NAME") {
    const tokenNo = "OPD-" + Math.floor(100 + Math.random() * 900);
    clearSession(tenant.clientId, from);
    await forwardEventToSink({
      type: "opd_token",
      clientId: tenant.clientId,
      sheetTab: tenant.sheetTab,
      phone: from,
      patientName: text,
      tokenNo,
      createdAt: new Date().toISOString(),
    });
    await sendText(
      tenant,
      from,
      `*OPD टोकन जारी*\nसंस्था: *${tenant.brandName}*\nमरीज़ का नाम: *${text}*\nटोकन नंबर: *${tokenNo}*\nस्थिति: पंजीकृत\n\nनए विकल्प के लिए *MENU* लिखें।`
    );
    return;
  }

  if (session.step === "AWAITING_SECTOR_LEAD") {
    const chosenSector = session.data.sectorLabel || "Business";
    clearSession(tenant.clientId, from);
    await forwardEventToSink({
      type: "sector_enquiry",
      clientId: tenant.clientId,
      sheetTab: tenant.sheetTab,
      phone: from,
      sectorLabel: chosenSector,
      details: text,
      createdAt: new Date().toISOString(),
    });
    await sendText(
      tenant,
      from,
      `*अनुरोध दर्ज हो गया*\nसेक्टर: *${chosenSector}*\nविवरण: ${text}\n\n*AR Enterprises* टीम जल्द आगे की जानकारी साझा करेगी। मुख्य मेनू के लिए *MENU* लिखें।`
    );
    return;
  }

  // बटन या कीवर्ड रूटिंग
  if (buttonId === "sec_opd" || lower === "1" || lower.includes("opd") || lower.includes("token")) {
    setSession(tenant.clientId, from, "AWAITING_OPD_NAME");
    await sendText(
      tenant,
      from,
      `*OPD टोकन बुकिंग*\nकृपया मरीज़ का पूरा नाम लिखकर भेजें (उदाहरण: *Rahul Kumar*)।`
    );
    return;
  }

  if (
    buttonId === "sec_inst" ||
    lower === "2" ||
    ["gym", "school", "coaching", "coach"].some((k) => lower.includes(k))
  ) {
    setSession(tenant.clientId, from, "AWAITING_SECTOR_LEAD", {
      sectorLabel: "Gym / School / Coaching",
    });
    await sendText(
      tenant,
      from,
      `*Gym / School / Coaching ऑटोमेशन*\nआप किस सेक्टर (Gym, School या Coaching) और किस काम (Admission, Fee Reminder, Attendance या Inquiry) के लिए सिस्टम चाहते हैं? संक्षेप में लिखकर भेजें।`
    );
    return;
  }

  if (buttonId === "sec_demo" || lower === "3" || lower.includes("demo") || lower.includes("help")) {
    setSession(tenant.clientId, from, "AWAITING_SECTOR_LEAD", {
      sectorLabel: "Demo & Custom Setup",
    });
    await sendText(
      tenant,
      from,
      `*AR Enterprises — Demo & Setup*\nकृपया अपना नाम, बिज़नेस का नाम और ज़रूरत लिखें।`
    );
    return;
  }

  // किसी भी अन्य मैसेज पर मेनू दिखाएँ
  await sendMainMenu(tenant, from);
}

app.get("/", (req, res) => {
  res.status(200).send("AR Enterprises Multi-Tenant WhatsApp Engine is running.");
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
        const incomingPhoneId = value.metadata?.phone_number_id;
        const tenant = resolveTenant(incomingPhoneId);

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
            await sendText(
              tenant,
              from,
              "कृपया टेक्स्ट या बटन के माध्यम से जवाब दें। मुख्य मेनू के लिए *MENU* लिखें।"
            );
            continue;
          }

          console.log(
            `[${tenant.brandName} | ${tenant.phoneNumberId}] From ${from}: ${incomingText || buttonId}`
          );

          await handleInbound(tenant, from, incomingText, buttonId);
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
