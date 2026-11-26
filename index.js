const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ar_enterprises_verify_123";
const DEFAULT_ACCESS_TOKEN = process.env.ACCESS_TOKEN || "";
const DEFAULT_PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
const WEBHOOK_SINK_URL = process.env.WEBHOOK_SINK_URL || "";

// हर क्लाइंट के Phone Number ID के अनुसार कॉन्फ़िगरेशन
const TENANTS = {
  ...(DEFAULT_PHONE_NUMBER_ID
    ? {
        [DEFAULT_PHONE_NUMBER_ID]: {
          clientId: "ar_core_demo",
          brandName: "AR Enterprises",
          sector: "platform",
          accessToken: DEFAULT_ACCESS_TOKEN,
          sheetTab: "Clients_Master_Data",
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
    clientId: id || "ar_core_demo",
    brandName: "AR Enterprises",
    sector: "platform",
    accessToken: DEFAULT_ACCESS_TOKEN,
    sheetTab: "Clients_Master_Data",
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

function makeRefId(prefix) {
  return `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
}

async function saveToSheet(tenant, record) {
  if (!WEBHOOK_SINK_URL) return;
  try {
    const res = await fetch(WEBHOOK_SINK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: tenant.clientId,
        brandName: tenant.brandName,
        sector: tenant.sector,
        sheetTab: tenant.sheetTab,
        createdAt: new Date().toISOString(),
        ...record,
      }),
    });
    const out = await res.text();
    console.log("Sheet sink response:", out);
  } catch (err) {
    console.error("Sheet sink error:", err.message || err);
  }
}

async function postToWhatsApp(tenant, payload) {
  if (!tenant.accessToken || !tenant.phoneNumberId) {
    console.error("Missing accessToken or phoneNumberId:", tenant.clientId);
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

async function sendMainMenu(tenant, to) {
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
          `कृपया विकल्प चुनें:\n\n` +
          `• *OPD Token* — क्लिनिक/हॉस्पिटल टोकन\n` +
          `• *Gym / School* — मेंबरशिप, एडमिशन व फ़ीस\n` +
          `• *Coaching / Demo* — बैच, डेमो व ऐप सेटअप`,
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "flow_opd", title: "OPD Token" } },
          { type: "reply", reply: { id: "flow_gym_school", title: "Gym / School" } },
          { type: "reply", reply: { id: "flow_coaching_demo", title: "Coaching / Demo" } },
        ],
      },
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

  if (session.step === "OPD_NAME") {
    const refId = makeRefId("OPD");
    clearSession(tenant.clientId, from);
    await saveToSheet(tenant, {
      sector: "opd",
      eventType: "opd_token_created",
      referenceId: refId,
      personName: text,
      phone: from,
      details: "OPD Queue Token",
      status: "Active Token",
      amount: 0,
    });
    await sendText(
      tenant,
      from,
      `*OPD टोकन जारी*\nसंस्था: *${tenant.brandName}*\nनाम: *${text}*\nटोकन ID: *${refId}*\nस्थिति: शीट/ऐप डैशबोर्ड में दर्ज\n\nमेनू के लिए *MENU* लिखें।`
    );
    return;
  }

  if (session.step === "GYM_SCHOOL_INFO") {
    const refId = makeRefId("GS");
    clearSession(tenant.clientId, from);
    await saveToSheet(tenant, {
      sector: "gym_school",
      eventType: "gym_school_request",
      referenceId: refId,
      personName: from,
      phone: from,
      details: text,
      status: "New Request",
      amount: 0,
    });
    await sendText(
      tenant,
      from,
      `*रिकॉर्ड सेव हो गया*\nरेफरेंस ID: *${refId}*\nविवरण: ${text}\nस्थिति: डैशबोर्ड शीट में जुड़ गया\n\nमुख्य मेनू के लिए *MENU* लिखें।`
    );
    return;
  }

  if (session.step === "COACHING_DEMO_INFO") {
    const refId = makeRefId("CD");
    clearSession(tenant.clientId, from);
    await saveToSheet(tenant, {
      sector: "coaching_demo",
      eventType: "coaching_demo_request",
      referenceId: refId,
      personName: from,
      phone: from,
      details: text,
      status: "Demo Scheduled",
      amount: 0,
    });
    await sendText(
      tenant,
      from,
      `*डेमो / पूछताछ दर्ज*\nरेफरेंस ID: *${refId}*\nविवरण: ${text}\nस्थिति: डैशबोर्ड शीट में जुड़ गया\n\nमुख्य मेनू के लिए *MENU* लिखें।`
    );
    return;
  }

  if (buttonId === "flow_opd" || lower === "1" || lower.includes("opd") || lower.includes("token")) {
    setSession(tenant.clientId, from, "OPD_NAME");
    await sendText(tenant, from, `*OPD टोकन*\nकृपया मरीज़ का नाम लिखकर भेजें।`);
    return;
  }

  if (
    buttonId === "flow_gym_school" ||
    lower === "2" ||
    lower.includes("gym") ||
    lower.includes("school")
  ) {
    setSession(tenant.clientId, from, "GYM_SCHOOL_INFO");
    await sendText(
      tenant,
      from,
      `*Gym / School*\nकृपया अपना नाम, सेक्टर (Gym या School) और ज़रूरत (Membership, Admission, Fee या Attendance) एक मैसेज में लिखें।`
    );
    return;
  }

  if (
    buttonId === "flow_coaching_demo" ||
    lower === "3" ||
    lower.includes("coaching") ||
    lower.includes("demo")
  ) {
    setSession(tenant.clientId, from, "COACHING_DEMO_INFO");
    await sendText(
      tenant,
      from,
      `*Coaching / Demo*\nकृपया अपना नाम, संस्थान/कोचिंग का नाम और ज़रूरत लिखें।`
    );
    return;
  }

  await sendMainMenu(tenant, from);
}

app.get("/", (req, res) => {
  res.status(200).send("AR Enterprises Core WhatsApp + Sheet Engine running.");
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
          await handleInbound(tenant, from, incomingText, buttonId);
        }
      }
    }
  } catch (err) {
    console.error("Webhook error:", err);
  }
});

app.listen(PORT, () => {
  console.log(`AR Enterprises Core Engine running on port ${PORT}`);
});
