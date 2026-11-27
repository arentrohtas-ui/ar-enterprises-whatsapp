const express = require("express");
const opdBooking = require("./opdBooking");
const { createCashfreeLink, handleCashfreeWebhook } = require("./cashfreeHelper");

const app = express();
app.use(express.json());

const sessions = new Map();
const GAS_WEBAPP_URL = String(process.env.GAS_WEBAPP_URL || "").trim();
const VERIFY_TOKEN = String(process.env.VERIFY_TOKEN || "ar_opd_verify_token").trim();
const CRON_SECRET = String(process.env.CRON_SECRET || "").trim();
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getTodayIstYmd() {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

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

async function getActiveClients() {
  const res = await callGas("GET", { action: "get_clients" });
  const rawList = Array.isArray(res?.clients)
    ? res.clients
    : Array.isArray(res?.data)
    ? res.data
    : [];

  return rawList
    .map((item) => normalizeClientRow(item))
    .filter((c) => c.status !== "INACTIVE" && c.status !== "DISABLED");
}

async function resolveBusiness(phoneNumberId) {
  const clients = await getActiveClients();

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

async function sendWhatsAppText(business, toPhone, body) {
  const digits = String(toPhone || "").replace(/\D/g, "");
  const recipient = digits.length === 10 ? `91${digits}` : digits;

  if (!business.phoneId || !business.token || !recipient) {
    console.log("[WA REMINDER SIMULATED]", business.name, recipient, body);
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
        to: recipient,
        type: "text",
        text: { body },
      }),
    }
  );
  return r.json();
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
    sendText: (body) => sendWhatsAppText(business, from, body),
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

async function runScheduledReminders(visitDate = "") {
  const targetDate = String(visitDate || "").trim() || getTodayIstYmd();
  const clients = await getActiveClients();
  const summary = [];

  for (const client of clients) {
    if (!client.sheetId) continue;

    const dueRes = await callGas("GET", {
      action: "get_due_reminders",
      spreadsheet_id: client.sheetId,
      visitDate: targetDate,
    });

    const dueList = Array.isArray(dueRes?.reminders) ? dueRes.reminders : [];
    let sentCount = 0;

    for (const item of dueList) {
      const tokenId = String(item.Token_ID || "").trim();
      const patientName = String(item.Patient_Name || "Patient").trim();
      const patientPhone = String(item.Patient_Phone || "").trim();
      const doctorName = String(item.Doctor_Name || "Doctor").trim();
      const batchSlot = String(item.Batch_Slot || "").trim();
      const dateStr = String(item.Visit_Date || targetDate).slice(0, 10);

      if (!tokenId || !patientPhone) continue;

      const reminderText =
        `⏰ *OPD Appointment Reminder — ${client.name}*\n\n` +
        `नमस्ते *${patientName}*,\n` +
        `आपका OPD टोकन *${tokenId}* आज (*${dateStr}*) के लिए शेड्यूल है।\n` +
        `• डॉक्टर: *${doctorName}*\n` +
        `• समय बैच: *${batchSlot}*\n\n` +
        `कृपया समय से पहले क्लिनिक पहुँचें।`;

      const waRes = await sendWhatsAppText(client, patientPhone, reminderText);
      if (waRes && !waRes.error) {
        await callGas("POST", {
          action: "mark_reminder_sent",
          spreadsheetId: client.sheetId,
          tokenId,
          reminderSent: "Yes",
        });
        sentCount += 1;
      }
    }

    summary.push({
      clinic: client.name,
      sheetId: client.sheetId,
      dueFound: dueList.length,
      sent: sentCount,
    });
  }

  return { ok: true, visitDate: targetDate, summary };
}

app.get("/", (req, res) => {
  res.status(200).json({ ok: true, service: "AR Enterprises OPD Engine" });
});

app.all("/send-reminders", async (req, res) => {
  try {
    if (CRON_SECRET) {
      const provided =
        req.headers["x-cron-secret"] ||
        req.query.secret ||
        req.body?.secret ||
        "";
      if (String(provided).trim() !== CRON_SECRET) {
        return res.status(401).json({ ok: false, error: "Unauthorized" });
      }
    }

    const visitDate = req.query.visitDate || req.body?.visitDate || "";
    const result = await runScheduledReminders(visitDate);
    return res.status(200).json(result);
  } catch (err) {
    console.error("Send Reminders Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
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
