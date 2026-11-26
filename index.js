const express = require("express");
const crypto = require("crypto");
const opdFlow = require("./opdBooking");
const {
  getUserState,
  setUserState,
  clearUserState,
  saveBusinessData,
  fetchBusinessData,
} = require("./dataStore");

const app = express();
app.use(
  express.json({
    verify: (req, _, buf) => {
      req.rawBody = buf;
    },
  })
);

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ar_enterprises_verify_123";
const DEFAULT_TOKEN = process.env.ACCESS_TOKEN || "";
const DEFAULT_PHONE_ID = process.env.PHONE_NUMBER_ID || "";
const SHEET_URL = process.env.WEBHOOK_SINK_URL || "";
const DEFAULT_SHEET_ID = process.env.GOOGLE_SHEET_ID || "";
const MASTER_SHEET_ID = process.env.MASTER_SHEET_ID || DEFAULT_SHEET_ID;
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";

let masterCache = { expiresAt: 0, byPhoneId: {}, list: [] };

async function syncMasterSheet(force = false) {
  if (!force && Date.now() < masterCache.expiresAt) {
    return masterCache;
  }
  if (!SHEET_URL || !MASTER_SHEET_ID) return masterCache;

  try {
    const qs = new URLSearchParams({
      action: "get_clients",
      master_sheet_id: MASTER_SHEET_ID,
    });
    const res = await fetch(`${SHEET_URL}?${qs.toString()}`);
    const data = await res.json();
    if (data?.ok && Array.isArray(data.clients)) {
      const byPhoneId = {};
      for (const c of data.clients) {
        if (c.phoneId) byPhoneId[c.phoneId] = c;
      }
      masterCache = {
        expiresAt: Date.now() + 60 * 1000,
        byPhoneId,
        list: data.clients,
      };
    }
  } catch (e) {
    console.error("Master sheet sync error:", e.message);
  }
  return masterCache;
}

async function resolveBusiness(phoneId, extra = {}) {
  const cache = await syncMasterSheet(false);
  const found =
    (phoneId && cache.byPhoneId[phoneId]) ||
    (extra.businessId &&
      cache.list.find(
        (c) => String(c.businessId || "").trim() === String(extra.businessId).trim()
      )) ||
    null;

  if (found) {
    return {
      id: found.businessId || phoneId || "default_opd",
      name: found.name || "OPD Clinic",
      sector: "opd",
      phoneId: found.phoneId || phoneId || DEFAULT_PHONE_ID,
      token: found.token || DEFAULT_TOKEN,
      sheetId: found.sheetId || DEFAULT_SHEET_ID,
      razorpayKeyId: found.razorpayKeyId || process.env.RAZORPAY_KEY_ID || "",
      razorpayKeySecret: found.razorpayKeySecret || process.env.RAZORPAY_KEY_SECRET || "",
      razorpayAccountId: found.razorpayAccountId || "",
      advanceAmount: Number(found.advanceAmount || 0),
    };
  }

  return {
    id: DEFAULT_PHONE_ID || "default_opd",
    name: "AR Enterprises OPD",
    sector: "opd",
    phoneId: phoneId || DEFAULT_PHONE_ID,
    token: DEFAULT_TOKEN,
    sheetId: extra.sheetId || DEFAULT_SHEET_ID,
    razorpayKeyId: process.env.RAZORPAY_KEY_ID || "",
    razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || "",
    razorpayAccountId: "",
    advanceAmount: 0,
  };
}

const seenMessages = new Set();

async function sendWA(business, to, payload) {
  if (!business.token || !business.phoneId || !to) return;
  await fetch(`https://graph.facebook.com/v27.0/${business.phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${business.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", to, ...payload }),
  }).catch((e) => console.error("WA send error:", e.message));
}

const sendText = (business, to, body) =>
  sendWA(business, to, { type: "text", text: { preview_url: false, body } });

const sendLangMenu = (business, to) =>
  sendWA(business, to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: `🏥 *${business.name}*\nनमस्ते / Hello! भाषा चुनें / Choose language:`,
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "lang_hi", title: "हिंदी" } },
          { type: "reply", reply: { id: "lang_en", title: "English" } },
        ],
      },
    },
  });

async function createRazorpayLink(
  business,
  { amountInRupees, tokenId, patientName, phone, description }
) {
  const amt = Number(amountInRupees || 0);
  if (!business.razorpayKeyId || !business.razorpayKeySecret || amt <= 0) {
    return null;
  }
  try {
    const auth = Buffer.from(
      `${business.razorpayKeyId}:${business.razorpayKeySecret}`
    ).toString("base64");
    const cleanPhone = String(phone || "").replace(/\D/g, "").slice(-10);

    const res = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: Math.round(amt * 100),
        currency: "INR",
        description: description || `${business.name} - Token ${tokenId}`,
        customer: {
          name: patientName || "Patient",
          ...(cleanPhone.length === 10 ? { contact: `+91${cleanPhone}` } : {}),
        },
        notify: { sms: false, email: false },
        notes: {
          businessId: business.id || "",
          phoneNumberId: business.phoneId || "",
          sheetId: business.sheetId || "",
          tokenId: tokenId || "",
          patientName: patientName || "",
          patientPhone: phone || "",
        },
      }),
    });

    const data = await res.json();
    if (data?.short_url) {
      return { id: data.id, shortUrl: data.short_url };
    }
  } catch (e) {
    console.error("Razorpay payment link error:", e.message);
  }
  return null;
}

function createContext(business, from) {
  return {
    tenant: business,
    business,
    from,
    sheetUrl: SHEET_URL,
    getSession: () => getUserState(business.id, from),
    setSession: (patch) => setUserState(business.id, from, patch),
    clearSession: (keepLang = true) => clearUserState(business.id, from, keepLang),
    sendWA: (payload) => sendWA(business, from, payload),
    sendText: (body) => sendText(business, from, body),
    sendLangMenu: () => sendLangMenu(business, from),
    createRazorpayLink: (opts) => createRazorpayLink(business, opts),
    postSheet: (payload) =>
      saveBusinessData({ tenant: business, from, sheetUrl: SHEET_URL }, payload),
    getSheet: (params) =>
      fetchBusinessData({ tenant: business, from, sheetUrl: SHEET_URL }, params),
  };
}

app.get("/", (_, res) => res.send("AR Enterprises OPD Engine Running"));

app.get("/webhook", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === VERIFY_TOKEN
  ) {
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
    if (!msg || seenMessages.has(msg.id)) return;
    seenMessages.add(msg.id);

    const incomingPhoneId = value.metadata?.phone_number_id;
    const business = await resolveBusiness(incomingPhoneId);
    const ctx = createContext(business, msg.from);

    const btn = msg.interactive?.button_reply || msg.interactive?.list_reply;
    const text = (msg.text?.body || btn?.title || "").trim();
    const btnId = btn?.id || "";
    const low = text.toLowerCase();

    if (low === "sync_clients") {
      await syncMasterSheet(true);
      return sendText(business, msg.from, "✅ Master sheet synced.");
    }

    if (["hi", "hello", "start", "lang"].includes(low) || btnId === "act_lang") {
      clearUserState(business.id, msg.from, true);
      return sendLangMenu(business, msg.from);
    }

    if (btnId === "lang_hi" || low === "हिंदी") {
      setUserState(business.id, msg.from, { lang: "hi", step: null, data: {} });
      return opdFlow.sendHomeMenu(ctx, "hi");
    }

    if (btnId === "lang_en" || low === "english") {
      setUserState(business.id, msg.from, { lang: "en", step: null, data: {} });
      return opdFlow.sendHomeMenu(ctx, "en");
    }

    await opdFlow.handleMessage(ctx, text, btnId);
  } catch (err) {
    console.error("Webhook error:", err.message);
  }
});

app.post("/razorpay-webhook", async (req, res) => {
  try {
    if (RAZORPAY_WEBHOOK_SECRET && req.rawBody) {
      const sig = req.headers["x-razorpay-signature"] || "";
      const expected = crypto
        .createHmac("sha256", RAZORPAY_WEBHOOK_SECRET)
        .update(req.rawBody)
        .digest("hex");
      if (sig !== expected) return res.sendStatus(400);
    }

    const event = req.body?.event || "";
    const paymentEntity = req.body?.payload?.payment?.entity || {};
    const linkEntity = req.body?.payload?.payment_link?.entity || {};
    const notes = linkEntity.notes || paymentEntity.notes || {};

    if (event === "payment.captured" || event === "payment_link.paid") {
      const business = await resolveBusiness(notes.phoneNumberId, {
        businessId: notes.businessId,
        sheetId: notes.sheetId,
      });
      const ctx = createContext(business, notes.patientPhone || "");
      const paidAmount = Math.round(
        Number(paymentEntity.amount || linkEntity.amount || 0) / 100
      );

      await ctx.postSheet({
        action: "mark_payment_paid",
        spreadsheetId: notes.sheetId || business.sheetId,
        businessId: business.id,
        razorpayAccountId: business.razorpayAccountId || "",
        tokenId: notes.tokenId || "",
        paymentLinkId: linkEntity.id || "",
        razorpayPaymentId: paymentEntity.id || "",
        patientName: notes.patientName || "",
        phone: notes.patientPhone || "",
        paidAmount,
      });

      if (notes.patientPhone) {
        await sendText(
          business,
          notes.patientPhone,
          `✅ *Payment Confirmed — ${business.name}*\n` +
            `• Token ID: *${notes.tokenId || "-"}*\n` +
            `• Paid Amount: *₹${paidAmount}*\n` +
            `• Payment ID: *${paymentEntity.id || "-"}*\n\n` +
            `आपकी बुकिंग पक्की हो गई है। लाइव कतार के लिए *STATUS* लिखें।`
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Razorpay webhook error:", err.message);
    res.status(500).json({ ok: false });
  }
});

app.post("/run-reminders", async (req, res) => {
  try {
    const phoneId = req.body?.phoneNumberId || DEFAULT_PHONE_ID;
    const business = await resolveBusiness(phoneId, {
      businessId: req.body?.businessId,
      sheetId: req.body?.sheetId,
    });
    const ctx = createContext(business, "");
    const result = opdFlow.sendDueReminders
      ? await opdFlow.sendDueReminders(ctx)
      : { sent: 0 };
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => console.log(`AR Enterprises OPD Engine running on ${PORT}`));
