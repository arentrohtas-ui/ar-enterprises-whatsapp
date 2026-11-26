const express = require("express");
const { getThreeDaySlots, getTwoHourBatches } = require("./opdBooking");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ar_enterprises_verify_123";
const DEFAULT_TOKEN = process.env.ACCESS_TOKEN || "";
const DEFAULT_PHONE_ID = process.env.PHONE_NUMBER_ID || "";
const SHEET_URL = process.env.WEBHOOK_SINK_URL || "";

const TENANTS = {
  ...(DEFAULT_PHONE_ID
    ? {
        [DEFAULT_PHONE_ID]: {
          id: "client_01",
          name: "AR Enterprises",
          sector: "opd",
          token: DEFAULT_TOKEN,
          sheetTab: "OPD_Tokens",
        },
      }
    : {}),
};

const sessions = new Map();
const seenMsgs = new Set();

const getTenant = (phoneId) =>
  TENANTS[phoneId]
    ? { phoneId, ...TENANTS[phoneId] }
    : {
        phoneId,
        id: "default",
        name: "AR Enterprises",
        sector: "opd",
        token: DEFAULT_TOKEN,
        sheetTab: "OPD_Tokens",
      };

const getSession = (key) => sessions.get(key) || { lang: "hi", step: null, data: {} };
const setSession = (key, patch) => sessions.set(key, { ...getSession(key), ...patch });

async function pushToSheet(payload) {
  if (!SHEET_URL) return;
  await fetch(SHEET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((e) => console.error("Sheet error:", e.message));
}

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
      body: { text: `नमस्ते / Hello *${tenant.name}*\nभाषा चुनें / Choose language:` },
      action: {
        buttons: [
          { type: "reply", reply: { id: "lang_hi", title: "हिंदी" } },
          { type: "reply", reply: { id: "lang_en", title: "English" } },
        ],
      },
    },
  });

const sendMainMenu = (tenant, to, lang) =>
  sendWA(tenant, to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: lang === "en" ? `*${tenant.name}* — Choose an option:` : `*${tenant.name}* — विकल्प चुनें:`,
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "act_book", title: "OPD Booking" } },
          { type: "reply", reply: { id: "act_status", title: "Live Status" } },
          { type: "reply", reply: { id: "act_timing", title: "Dr Timing" } },
        ],
      },
    },
  });

// ऑटोमैटिक 3-दिन के बटन भेजने का फंक्शन
const sendDayButtons = (tenant, to, lang, days) =>
  sendWA(tenant, to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: lang === "en" ? "Select booking date:" : "बुकिंग की तारीख चुनें:",
      },
      action: {
        buttons: days.slice(0, 3).map((d) => ({
          type: "reply",
          reply: {
            id: d.id,
            title: (lang === "en" ? d.labelEn : d.labelHi).slice(0, 20),
          },
        })),
      },
    },
  });

async function routeMessage(tenant, from, text, btnId) {
  const sKey = `${tenant.id}:${from}`;
  const s = getSession(sKey);
  const low = (text || "").trim().toLowerCase();

  if (["hi", "hello", "start", "lang"].includes(low)) {
    setSession(sKey, { step: null, data: {} });
    return sendLangMenu(tenant, from);
  }
  if (btnId === "lang_hi") {
    setSession(sKey, { lang: "hi", step: null });
    return sendMainMenu(tenant, from, "hi");
  }
  if (btnId === "lang_en") {
    setSession(sKey, { lang: "en", step: null });
    return sendMainMenu(tenant, from, "en");
  }
  if (low === "menu") {
    setSession(sKey, { step: null });
    return sendMainMenu(tenant, from, s.lang);
  }

  if (btnId === "act_book" || low === "1" || low.includes("book")) {
    const days = getThreeDaySlots();
    setSession(sKey, { step: "PICK_DAY", data: { days } });
    return sendDayButtons(tenant, from, s.lang, days);
  }

  if (s.step === "PICK_DAY") {
    const days = s.data.days || getThreeDaySlots();
    const day =
      days.find((d) => d.id === btnId) ||
      days[Number(low) - 1] ||
      days.find((d) => text && (d.labelHi.includes(text) || d.labelEn.includes(text)));

    if (!day) {
      return sendDayButtons(tenant, from, s.lang, days);
    }

    const batches = getTwoHourBatches("", day.isToday);
    setSession(sKey, { step: "PICK_BATCH", data: { day, batches } });
    return sendText(
      tenant,
      from,
      `${s.lang === "en" ? day.labelEn : day.labelHi}\n2-Hr Batches:\n` +
        batches.map((b, i) => `${i + 1}. ${b}`).join("\n")
    );
  }

  if (s.step === "PICK_BATCH") {
    const idx = Number(low) - 1;
    const slot = s.data.batches?.[idx] || text;
    const tokenId = `OPD-${Math.floor(1000 + Math.random() * 9000)}`;
    setSession(sKey, { step: null, data: {} });
    await pushToSheet({
      sheetTab: tenant.sheetTab,
      tokenId,
      date: s.data.day?.date,
      batch: slot,
      phone: from,
    });
    return sendText(
      tenant,
      from,
      `Token: *${tokenId}*\nDate: *${s.data.day?.date}*\nBatch: *${slot}*`
    );
  }

  return sendMainMenu(tenant, from, s.lang);
}

app.get("/", (_, res) => res.send("AR Enterprises Core Ready"));

app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  if (!value?.messages?.[0]) return;

  const msg = value.messages[0];
  if (seenMsgs.has(msg.id)) return;
  seenMsgs.add(msg.id);

  const tenant = getTenant(value.metadata?.phone_number_id);
  const btn = msg.interactive?.button_reply || msg.interactive?.list_reply;
  const text = msg.text?.body || btn?.title || "";
  await routeMessage(tenant, msg.from, text, btn?.id || "");
});

app.listen(PORT, () => console.log(`Core running on ${PORT}`));
