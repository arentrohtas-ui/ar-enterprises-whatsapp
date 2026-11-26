const express = require("express");
const opdFlow = require("./opdBooking");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ar_enterprises_verify_123";
const DEFAULT_TOKEN = process.env.ACCESS_TOKEN || "";
const DEFAULT_PHONE_ID = process.env.PHONE_NUMBER_ID || "";
const SHEET_URL = process.env.WEBHOOK_SINK_URL || "";
const DEFAULT_SHEET_ID = process.env.GOOGLE_SHEET_ID || "";

// वैकल्पिक: Render Env में TENANTS_JSON डालने पर बिना कोड बदले नए क्लाइंट जुड़ेंगे
let ENV_TENANTS = {};
if (process.env.TENANTS_JSON) {
  try {
    ENV_TENANTS = JSON.parse(process.env.TENANTS_JSON);
  } catch (e) {
    console.error("Invalid TENANTS_JSON:", e.message);
  }
}

// वैकल्पिक प्लग-इन लोडर ताकि फ़ाइल न बनी हो तब भी सर्वर क्रैश न करे
function safeRequire(modulePath) {
  try {
    return require(modulePath);
  } catch (e) {
    return null;
  }
}

const gymFlow = safeRequire("./gymFlow");
const coachingFlow = safeRequire("./coachingFlow");
const schoolFlow = safeRequire("./schoolFlow");

// चारों बिज़नेस सेक्टर पहले से रजिस्टर्ड
const SECTOR_FLOWS = {
  opd: opdFlow,
  gym: gymFlow || opdFlow,
  coaching: coachingFlow || opdFlow,
  school: schoolFlow || opdFlow,
};

// हर क्लाइंट (Phone Number ID) की अपनी अलग Sheet ID और Sector
const TENANTS = {
  ...(DEFAULT_PHONE_ID
    ? {
        [DEFAULT_PHONE_ID]: {
          id: "client_01",
          name: "AR Enterprises",
          sector: "opd",
          token: DEFAULT_TOKEN,
          sheetId: DEFAULT_SHEET_ID,
        },
      }
    : {}),
  ...ENV_TENANTS,
};

const sessions = new Map();
const seenMsgs = new Set();

const getTenant = (phoneId) => {
  const fromMap = (phoneId && TENANTS[phoneId]) || null;
  if (fromMap) return { phoneId, ...fromMap };
  return {
    phoneId,
    id: phoneId || "default",
    name: "AR Enterprises",
    sector: "opd",
    token: DEFAULT_TOKEN,
    sheetId: DEFAULT_SHEET_ID,
  };
};

const getSession = (key) => sessions.get(key) || { lang: "hi", step: null, data: {} };
const setSession = (key, patch) => sessions.set(key, { ...getSession(key), ...patch });

async function sendWA(tenant, to, payload) {
  if (!tenant.token || !tenant.phoneId) return;
  await fetch(`https://graph.facebook.com/v27.0/${tenant.phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tenant.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, ...payload }),
  }).catch((e) => console.error("WA error:", e.message));
}

const sendText = (tenant, to, body) =>
  sendWA(tenant, to, { type: "text", text: { preview_url: false, body } });

const sendLangMenu = (tenant, to) =>
  sendWA(tenant, to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: `✨ *${tenant.name}*\nनमस्ते / Hello! भाषा चुनें / Choose language:` },
      action: {
        buttons: [
          { type: "reply", reply: { id: "lang_hi", title: "हिंदी" } },
          { type: "reply", reply: { id: "lang_en", title: "English" } },
        ],
      },
    },
  });

function buildContext(tenant, from, sKey) {
  return {
    tenant,
    from,
    sheetUrl: SHEET_URL,
    getSession: () => getSession(sKey),
    setSession: (patch) => setSession(sKey, patch),
    sendWA: (payload) => sendWA(tenant, from, payload),
    sendText: (body) => sendText(tenant, from, body),
    sendLangMenu: () => sendLangMenu(tenant, from),
    postSheet: async (payload) => {
      if (!SHEET_URL) return null;
      const res = await fetch(SHEET_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(tenant.sheetId ? { spreadsheetId: tenant.sheetId } : {}),
          phoneNumberId: tenant.phoneId,
          clientName: tenant.name,
          sector: tenant.sector,
          ...payload,
        }),
      });
      return res.json().catch(() => null);
    },
    getSheet: async (params = {}) => {
      if (!SHEET_URL) return null;
      const qs = new URLSearchParams({
        phone_number_id: tenant.phoneId || "",
        ...(tenant.sheetId ? { spreadsheet_id: tenant.sheetId } : {}),
        ...params,
      });
      const res = await fetch(`${SHEET_URL}?${qs.toString()}`);
      return res.json().catch(() => null);
    },
  };
}

app.get("/", (_, res) => res.send("AR Enterprises Multi-Sector Core Ready"));

app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const entry = req.body?.entry?.[0];
    const value = entry?.changes?.[0]?.value;
    const msg = value?.messages?.[0];
    if (!msg || seenMsgs.has(msg.id)) return;
    seenMsgs.add(msg.id);

    const tenant = getTenant(value.metadata?.phone_number_id);
    const sKey = `${tenant.id}:${msg.from}`;
    const btn = msg.interactive?.button_reply || msg.interactive?.list_reply;
    const text = (msg.text?.body || btn?.title || "").trim();
    const btnId = btn?.id || "";
    const low = text.toLowerCase();
    const ctx = buildContext(tenant, msg.from, sKey);
    const flow = SECTOR_FLOWS[tenant.sector] || opdFlow;

    if (["hi", "hello", "start", "lang"].includes(low) || btnId === "act_lang") {
      setSession(sKey, { step: null, data: {} });
      return sendLangMenu(tenant, msg.from);
    }
    if (btnId === "lang_hi" || low === "हिंदी") {
      setSession(sKey, { lang: "hi", step: null, data: {} });
      return flow.sendHomeMenu(ctx, "hi");
    }
    if (btnId === "lang_en" || low === "english") {
      setSession(sKey, { lang: "en", step: null, data: {} });
      return flow.sendHomeMenu(ctx, "en");
    }

    await flow.handleMessage(ctx, text, btnId);
  } catch (err) {
    console.error("Webhook error:", err.message);
  }
});

app.post("/run-reminders", async (req, res) => {
  try {
    const phoneId = req.body?.phoneNumberId || DEFAULT_PHONE_ID;
    const tenant = getTenant(phoneId);
    const ctx = buildContext(tenant, "", `${tenant.id}:cron`);
    const result = opdFlow.sendDueReminders ? await opdFlow.sendDueReminders(ctx) : { sent: 0 };
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`AR Enterprises Core running on ${PORT}`));
