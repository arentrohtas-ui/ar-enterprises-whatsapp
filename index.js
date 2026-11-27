const express = require("express");
const opdBooking = require("./opdBooking");
const { createCashfreeLink, handleCashfreeWebhook } = require("./cashfreeHelper");

const app = express();
app.use(express.json());

const sessions = new Map();
const GAS_WEBAPP_URL = String(process.env.GAS_WEBAPP_URL || "").trim();
const VERIFY_TOKEN = String(process.env.VERIFY_TOKEN || "ar_opd_verify_token").trim();

function getSessionKey(phoneId, from) {
  return `${phoneId || "default"}:${from || "user"}`;
}

async function callGas(method = "GET", paramsOrBody = {}) {
  if (!GAS_WEBAPP_URL) {
    return { ok: false, error: "GAS_WEBAPP_URL missing" };
  }

  if (method === "GET") {
    const url = new URL(GAS_WEBAPP_URL);
    Object.entries(paramsOrBody).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v) !== "") {
        url.searchParams.set(k, String(v));
      }
    });
    const r = await fetch(url.toString());
    return r.json();
  }

  const r = await fetch(GAS_WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(paramsOrBody),
  });
  return r.json();
}

function normalizeClientRow(raw = {}, fallbackPhoneId = "") {
  return {
    id: String(raw.Business_ID || raw.businessId || raw.id || "").trim(),
    name: String(raw.Business_Name || raw.businessName || raw.name || "OPD Clinic").trim(),
    category: String(raw.Category || raw.category || "opd").trim(),
    phoneId: String(
      raw.Phone_Number_ID || raw.phoneNumberId || raw.phoneId || fallbackPhoneId || ""
    ).trim(),
    token: String(
      raw.WhatsApp_Token || raw.whatsappToken || raw.token || process.env.WA_TOKEN || ""
    ).trim(),
    sheetId: String(
      raw.Client_Sheet_ID ||
        raw.clientSheetId ||
        raw.sheetId ||
        process.env.DEFAULT_CLINIC_SHEET_ID ||
        ""
    ).trim(),
    cashfreeAppId: String(
      raw.Cashfree_App_ID ||
        raw.cashfreeAppId ||
        raw.Cashfree_Key_ID ||
        raw.cashfreeKeyId ||
        ""
    ).trim(),
    cashfreeSecretKey: String(
      raw.Cashfree_Secret_Key ||
        raw.cashfreeSecretKey ||
        raw.Cashfree_Key_Secret ||
        raw.cashfreeKeySecret ||
        ""
    ).trim(),
    advanceAmount: Number(
      raw.Advance_Amount ?? raw.advanceAmount ?? process.env.DEFAULT_ADVANCE_AMOUNT ?? 0
    ),
    status: String(raw.Status || raw.status || "ACTIVE").trim().toUpperCase(),
  };
}

async function resolveBusiness(phoneNumberId) {
  const res = await callGas("GET", { action: "get_clients" });
  const rawList = Array.isArray(res?.clients)
    ? res.clients
    : Array.isArray(res?.data)
    ? res.data
    : [];

  const clients = rawList
    .map((item) => normalizeClientRow(item, phoneNumberId))
    .filter((c) => c.status !== "INACTIVE" && c.status !== "DISABLED");

  const matched = clients.find(
    (c) => phoneNumberId && String(c.phoneId).trim() === String(phoneNumberId).trim()
  );

  return (
    matched ||
    clients[0] ||
    normalizeClientRow(
      {
        Business_Name: "OPD Clinic",
        Phone_Number_ID: phoneNumberId || "",
        WhatsApp_Token: process.env.WA_TOKEN || "",
        Client_Sheet_ID: process.env.DEFAULT_CLINIC_SHEET_ID || "",
        Advance_Amount: Number(process.env.DEFAULT_ADVANCE_AMOUNT || 0),
        Status: "ACTIVE",
      },
      phoneNumberId
    )
  );
}

function buildCtx(business, from) {
  const key = getSessionKey(business.phoneId, from);

  return {
    from,
    business,
    getSession: () => sessions.get(key) || { lang: "hi", step: null, data: {} },
    setSession: (next) => {
      const prev = sessions.get(key) || { lang: "hi", step: null, data: {} };
      sessions.set(key, {
        lang: next.lang || prev.lang || "hi",
        step: next.step !== undefined ? next.step : prev.step,
        data: next.data !== undefined ? next.data : prev.data,
      });
    },
    clearSession: (keepLang = true) => {
      const prev = sessions.get(key) || { lang: "hi" };
      sessions.set(key, {
        lang: keepLang ? prev.lang || "hi" : "hi",
        step: null,
        data: {},
      });
    },
    getSheet: (params) =>
      callGas("GET", { ...params, spreadsheet_id: business.sheetId }),
    postSheet: (payload) =>
      callGas("POST", { ...payload, spreadsheetId: business.sheetId }),
    createRazorpayLink: (opts) =>
      createCashfreeLink({
        ...opts,
        spreadsheetId: business.sheetId,
        businessName: business.name,
        cashfreeAppId: business.cashfreeAppId,
        cashfreeSecretKey: business.cashfreeSecretKey,
      }),
    sendText: async (body) => {
      if (!business.phoneId || !business.token) {
        console.log("[WA TEXT]", from, body);
        return { ok: true, simulated: true };
      }
      const r = await fetch(
        `https://graph.facebook.com/v21.0/${business.phoneId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${business.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: from,
            type: "text",
            text: { body },
          }),
        }
      );
      return r.json();
    },
    sendWA: async (payload) => {
      if (!business.phoneId || !business.token) {
        console.log("[WA INTERACTIVE]", from, JSON.stringify(payload));
        return { ok: true, simulated: true };
      }
      const r = await fetch(
        `https://graph.facebook.com/v21.0/${business.phoneId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${business.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: from,
            ...payload,
          }),
        }
      );
      return r.json();
    },
  };
}

app.get("/", (req, res) => {
  res.status(200).json({ ok: true, service: "AR Enterprises OPD Engine" });
});

// Meta WhatsApp Webhook Verification
app.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.status(403).send("Forbidden");
});

// Cashfree Webhook Endpoint
app.post("/webhook/cashfree", handleCashfreeWebhook);

// Meta WhatsApp Incoming Message Endpoint
app.post("/webhook/whatsapp", async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value || {};
    const msg = value?.messages?.[0];
    if (!msg) return res.status(200).json({ ok: true });

    const from = msg.from;
    const phoneNumberId = value?.metadata?.phone_number_id || "";
    const business = await resolveBusiness(phoneNumberId);
    const ctx = buildCtx(business, from);

    let text = "";
    let btnId = "";

    if (msg.type === "text") {
      text = msg.text?.body || "";
    } else if (msg.type === "interactive") {
      if (msg.interactive?.type === "button_reply") {
        btnId = msg.interactive.button_reply?.id || "";
        text = msg.interactive.button_reply?.title || "";
      } else if (msg.interactive?.type === "list_reply") {
        btnId = msg.interactive.list_reply?.id || "";
        text = msg.interactive.list_reply?.title || "";
      }
    }

    await opdBooking.handleMessage(ctx, text, btnId);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("WA Webhook Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`AR Enterprises OPD Engine running on ${PORT}`);
});
