const express = require("express");
const { handleOpdMessage } = require("./opd/bookingFlow");
const { handleAwaitPaymentStep } = require("./opd/paymentAndToken");
const { registerOpdStaffAppRoutes } = require("./opd/staffApps");
const { formatIstYmd } = require("./opd/menu");

const app = express();
app.use(express.json());

const sessions = new Map();
const pendingPayments = new Map();
const issuedOrderTokens = new Map();

const GAS_WEBAPP_URL = String(process.env.GAS_WEBAPP_URL || "").trim();
const VERIFY_TOKEN = String(
  process.env.VERIFY_TOKEN || "ar_opd_verify_token"
).trim();
const STAFF_APP_PIN = String(process.env.STAFF_APP_PIN || "1234").trim();
const TOKEN_PREFIX = "OPD_";
const TOKEN_START_NUMBER = 101;

function cleanSecretVal(v) {
  const s = String(v ?? "").trim();
  if (!s || s.toLowerCase() === "undefined" || s.toLowerCase() === "null") {
    return "";
  }
  return s;
}

function normalizeDateYmd(input) {
  if (!input) return "";
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return formatIstYmd(input);
  }
  const s = String(input).trim();
  if (!s) return "";

  const ymdMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymdMatch) {
    return `${ymdMatch[1]}-${String(ymdMatch[2]).padStart(2, "0")}-${String(
      ymdMatch[3]
    ).padStart(2, "0")}`;
  }

  const dmyMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${String(dmyMatch[2]).padStart(2, "0")}-${String(
      dmyMatch[1]
    ).padStart(2, "0")}`;
  }

  return s.slice(0, 10);
}

function formatPhoneWith91(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  return digits;
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
  const sheetAppId = cleanSecretVal(
    raw.Cashfree_App_ID ??
      raw.cashfreeAppId ??
      raw.Cashfree_Key_ID ??
      raw.cashfreeKeyId
  );
  const sheetSecretKey = cleanSecretVal(
    raw.Cashfree_Secret_Key ??
      raw.cashfreeSecretKey ??
      raw.Cashfree_Key_Secret ??
      raw.cashfreeKeySecret
  );

  return {
    id: String(raw.Business_ID || raw.businessId || raw.id || "").trim(),
    name: String(
      raw.Business_Name || raw.businessName || raw.name || "Business"
    ).trim(),
    category: String(raw.Category || raw.category || "opd")
      .trim()
      .toLowerCase(),
    phoneId: String(
      raw.Phone_Number_ID ||
        raw.phoneNumberId ||
        raw.phoneId ||
        fallbackPhoneId ||
        ""
    ).trim(),
    token:
      cleanSecretVal(raw.WhatsApp_Token ?? raw.whatsappToken ?? raw.token) ||
      String(process.env.WA_TOKEN || "").trim(),
    sheetId:
      cleanSecretVal(
        raw.Client_Sheet_ID ?? raw.clientSheetId ?? raw.sheetId
      ) || String(process.env.DEFAULT_CLINIC_SHEET_ID || "").trim(),
    cashfreeAppId:
      sheetAppId || String(process.env.CASHFREE_APP_ID || "").trim(),
    cashfreeSecretKey:
      sheetSecretKey || String(process.env.CASHFREE_SECRET_KEY || "").trim(),
    advanceAmount: Number(
      raw.Advance_Amount ??
        raw.advanceAmount ??
        process.env.DEFAULT_ADVANCE_AMOUNT ??
        0
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

async function resolveBusiness(phoneNumberId, sheetId = "") {
  const clients = await getActiveClients();

  if (sheetId) {
    const bySheet = clients.find(
      (c) => String(c.sheetId || "").trim() === String(sheetId || "").trim()
    );
    if (bySheet) return bySheet;
  }

  const matched = clients.find(
    (c) =>
      phoneNumberId &&
      String(c.phoneId).trim() === String(phoneNumberId).trim()
  );

  return (
    matched ||
    clients[0] ||
    normalizeClientRow(
      {
        Business_Name: "OPD Clinic",
        Category: "opd",
        Phone_Number_ID: phoneNumberId || "",
        WhatsApp_Token: process.env.WA_TOKEN || "",
        Client_Sheet_ID: sheetId || process.env.DEFAULT_CLINIC_SHEET_ID || "",
        Advance_Amount: Number(process.env.DEFAULT_ADVANCE_AMOUNT || 0),
        Status: "ACTIVE",
      },
      phoneNumberId
    )
  );
}

async function sendWhatsAppText(business, toPhone, body) {
  const recipient = formatPhoneWith91(toPhone);

  if (!business?.phoneId || !business?.token || !recipient) {
    console.log("[WA TEXT SIMULATED]", business?.name, recipient, body);
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

async function sendTwoAheadAlertIfNeeded(business, sheetId, alert2Ahead) {
  if (!alert2Ahead) return null;
  const targetTokenId = String(alert2Ahead.Token_ID || "").trim();
  const patientName = String(alert2Ahead.Patient_Name || "Patient").trim();
  const patientPhone = String(alert2Ahead.Patient_Phone || "").trim();
  const doctorName = String(alert2Ahead.Doctor_Name || "Doctor").trim();
  const batchSlot = String(alert2Ahead.Batch_Slot || "").trim();

  if (!targetTokenId || !patientPhone) return null;

  const alertText =
    `🔔 *${business.name || "City Care OPD"} — 2 नंबर पहले अलर्ट*\n\n` +
    `नमस्ते *${patientName}*,\n` +
    `आपका टोकन *${targetTokenId}* आने में अब *केवल 2 नंबर बाकी* हैं।\n` +
    `• डॉक्टर: *${doctorName}*\n` +
    `• बैच: *${batchSlot}*\n\n` +
    `कृपया तैयार रहें और समय से कतार के पास पहुँचें।`;

  const waRes = await sendWhatsAppText(business, patientPhone, alertText);
  if (waRes && !waRes.error) {
    await callGas("POST", {
      action: "mark_two_ahead_sent",
      spreadsheetId: sheetId,
      spreadsheet_id: sheetId,
      tokenId: targetTokenId,
    });
    return targetTokenId;
  }
  return null;
}

function extractNextOpdTokenFromRows(existingRows = []) {
  let maxNum = TOKEN_START_NUMBER - 1;
  for (const r of existingRows) {
    const rawId = String(r?.Token_ID || r?.tokenId || "").trim();
    const match = rawId.match(/^OPD_(\d+)$/i);
    if (match) {
      const n = Number(match[1]);
      if (!Number.isNaN(n) && n > maxNum) {
        maxNum = n;
      }
    }
  }
  return `${TOKEN_PREFIX}${Math.max(TOKEN_START_NUMBER, maxNum + 1)}`;
}

async function getNextOpdTokenForSheet(sheetId) {
  try {
    const res = await callGas("GET", {
      action: "get_live_status",
      spreadsheet_id: sheetId,
      tokenId: "",
      phone: "",
    });
    const rows = Array.isArray(res?.allBookings)
      ? res.allBookings
      : Array.isArray(res?.bookings)
      ? res.bookings
      : Array.isArray(res?.data)
      ? res.data
      : [];
    return extractNextOpdTokenFromRows(rows);
  } catch (_) {
    return `${TOKEN_PREFIX}${TOKEN_START_NUMBER}`;
  }
}

async function recordPaidBookingAndLog({
  sheetId,
  tokenId,
  patientName,
  patientAge,
  patientPhone,
  doctorId,
  doctorName,
  visitDate,
  batchSlot,
  opdFee,
  advanceFee,
  paidAmount,
  paymentLinkId,
  paymentRefId,
}) {
  await callGas("POST", {
    action: "create_booking",
    spreadsheetId: sheetId,
    spreadsheet_id: sheetId,
    tokenId,
    patientName,
    patientAge,
    patientPhone,
    doctorId: doctorId || "",
    doctorName: doctorName || "",
    visitDate: normalizeDateYmd(visitDate),
    batchSlot,
    opdFee,
    advanceFee,
    paidAmount,
    queueStatus: "Waiting",
    paymentStatus: "Paid",
    greetingSent: "Yes",
    paymentLinkId: paymentLinkId || paymentRefId || "",
    paymentRefId: paymentRefId || paymentLinkId || "",
  });

  await callGas("POST", {
    action: "mark_payment_paid",
    spreadsheetId: sheetId,
    spreadsheet_id: sheetId,
    tokenId,
    patientName,
    patientPhone,
    paidAmount,
    paymentRefId: paymentRefId || paymentLinkId || "",
    cfPaymentId: paymentRefId || "",
  });
}

async function confirmPendingBookingByOrderId(orderId, paymentRefId = "") {
  const cleanOrderId = String(orderId || "").trim();
  if (!cleanOrderId) return { ok: false, reason: "Missing orderId" };

  if (issuedOrderTokens.has(cleanOrderId)) {
    return {
      ok: true,
      alreadyIssued: true,
      tokenId: issuedOrderTokens.get(cleanOrderId),
    };
  }

  const pending = pendingPayments.get(cleanOrderId);
  if (!pending) {
    return { ok: false, reason: "Pending payment record not found" };
  }

  const business = await resolveBusiness(
    pending.business?.phoneId || "",
    pending.sheetId || pending.business?.sheetId || ""
  );
  const sheetId = String(
    pending.sheetId ||
      business.sheetId ||
      process.env.DEFAULT_CLINIC_SHEET_ID ||
      ""
  ).trim();

  const tokenId = await getNextOpdTokenForSheet(sheetId);
  const doc = pending.selectedDoctor || {};
  const opdFee = Number(doc.opdFee ?? pending.opdFee ?? 0);
  const payableAmount = Number(pending.payableAmount ?? opdFee);
  const balanceAmount = Math.max(0, opdFee - payableAmount);
  const lang = pending.lang === "en" ? "en" : "hi";
  const dayLabel = pending.dayInfo?.shortLabel || "";
  const visitDate = normalizeDateYmd(pending.visitDate);
  const dayText = dayLabel ? `${dayLabel} (${visitDate})` : visitDate;
  const finalRefId = paymentRefId || cleanOrderId;

  await recordPaidBookingAndLog({
    sheetId,
    tokenId,
    patientName: pending.patientName,
    patientAge: pending.patientAge,
    patientPhone: pending.patientPhone,
    doctorId: doc.id || "",
    doctorName: doc.name || "",
    visitDate,
    batchSlot: pending.batchSlot,
    opdFee,
    advanceFee: payableAmount,
    paidAmount: payableAmount,
    paymentLinkId: cleanOrderId,
    paymentRefId: finalRefId,
  });

  issuedOrderTokens.set(cleanOrderId, tokenId);
  pendingPayments.delete(cleanOrderId);

  if (pending.sessionKey && sessions.has(pending.sessionKey)) {
    const prevSess = sessions.get(pending.sessionKey);
    sessions.set(pending.sessionKey, {
      lang: prevSess.lang || lang,
      step: null,
      data: {},
    });
  }

  const confirmMsg =
    lang === "en"
      ? `✅ *Payment Received — OPD Token Confirmed*\n\n` +
        `• Token No.: *${tokenId}*\n` +
        `• Patient: *${pending.patientName}* (${pending.patientAge} yrs)\n` +
        `• Mobile: *${pending.patientPhone}*\n` +
        `• Date: *${dayText}*\n` +
        `• Doctor: *${doc.name}*\n` +
        `• Time Slot: *${pending.batchSlot}*\n` +
        `• Paid Online: *₹${payableAmount}* (OPD Fee: ₹${opdFee})\n` +
        (balanceAmount > 0
          ? `• Balance at Counter (Cash): *₹${balanceAmount}*\n`
          : ``) +
        `• Status: *Paid*\n\n` +
        `📌 *Important Instructions:*\n` +
        `• Please arrive on time for your slot (*${pending.batchSlot}*).\n` +
        `• Please carry your *old prescription / previous slip & reports* (if any) with you.` +
        (balanceAmount > 0
          ? `\n• Pay remaining *₹${balanceAmount}* in *cash at the clinic counter*.`
          : ``)
      : `✅ *पेमेंट प्राप्त — OPD टोकन कन्फ़र्म*\n\n` +
        `• टोकन नंबर: *${tokenId}*\n` +
        `• मरीज़: *${pending.patientName}* (${pending.patientAge} वर्ष)\n` +
        `• मोबाइल: *${pending.patientPhone}*\n` +
        `• तारीख: *${dayText}*\n` +
        `• डॉक्टर: *${doc.name}*\n` +
        `• समय स्लॉट: *${pending.batchSlot}*\n` +
        `• ऑनलाइन भुगतान: *₹${payableAmount}* (OPD फ़ीस: ₹${opdFee})\n` +
        (balanceAmount > 0
          ? `• काउंटर पर शेष राशि (नकद): *₹${balanceAmount}*\n`
          : ``) +
        `• स्टेटस: *Paid*\n\n` +
        `📌 *ज़रूरी निर्देश:*\n` +
        `• कृपया अपने निर्धारित समय (*${pending.batchSlot}*) पर सही समय से क्लिनिक पहुँचें।\n` +
        `• कृपया अपनी *पुरानी पर्चा / पिछली पर्ची व पुरानी रिपोर्ट* (यदि हो तो) अवश्य साथ रखें।` +
        (balanceAmount > 0
          ? `\n• शेष राशि *₹${balanceAmount}* *क्लिनिक काउंटर पर नकद (Cash)* जमा करें।`
          : ``);

  const waTarget = pending.patientPhone || pending.from;
  await sendWhatsAppText(business, waTarget, confirmMsg);

  return { ok: true, tokenId, orderId: cleanOrderId };
}

async function verifyCashfreeOrderDirect({
  orderId,
  cashfreeAppId,
  cashfreeSecretKey,
}) {
  const cleanId = String(orderId || "").trim();
  const appId = cleanSecretVal(cashfreeAppId || process.env.CASHFREE_APP_ID);
  const secretKey = cleanSecretVal(
    cashfreeSecretKey || process.env.CASHFREE_SECRET_KEY
  );

  if (!cleanId || !appId || !secretKey) {
    return { status: "UNVERIFIED" };
  }

  const isTestKey =
    appId.toUpperCase().startsWith("TEST") ||
    secretKey.toLowerCase().includes("_test_");
  const envMode = String(process.env.CASHFREE_ENV || "").toLowerCase();
  const bases =
    envMode === "sandbox" || isTestKey
      ? ["https://sandbox.cashfree.com/pg", "https://api.cashfree.com/pg"]
      : ["https://api.cashfree.com/pg", "https://sandbox.cashfree.com/pg"];

  for (const base of bases) {
    const endpoints = [
      `${base}/orders/${encodeURIComponent(cleanId)}`,
      `${base}/links/${encodeURIComponent(cleanId)}`,
    ];

    for (const url of endpoints) {
      try {
        const resp = await fetch(url, {
          method: "GET",
          headers: {
            "x-client-id": appId,
            "x-client-secret": secretKey,
            "x-api-version": "2023-08-01",
            Accept: "application/json",
          },
        });
        if (!resp.ok) continue;
        const data = await resp.json();

        const st = String(
          data?.order_status ||
            data?.link_status ||
            data?.payment_status ||
            ""
        ).toUpperCase();

        const isPaid =
          ["PAID", "SUCCESS", "COMPLETED"].includes(st) ||
          Number(data?.link_amount_paid || 0) > 0;

        if (isPaid) {
          return {
            status: "PAID",
            cf_payment_id:
              data?.cf_order_id ||
              data?.link_id ||
              data?.cf_payment_id ||
              cleanId,
          };
        }
      } catch (_) {}
    }
  }

  return { status: "PENDING" };
}

async function createCashfreeLink({
  amount,
  customerName,
  customerPhone,
  description,
  spreadsheetId,
  businessName,
  cashfreeAppId,
  cashfreeSecretKey,
}) {
  const appId = cleanSecretVal(cashfreeAppId || process.env.CASHFREE_APP_ID);
  const secretKey = cleanSecretVal(
    cashfreeSecretKey || process.env.CASHFREE_SECRET_KEY
  );

  if (!appId || !secretKey) {
    return {
      error: "Clients_Master शीट या ENV में Cashfree App ID / Secret Key नहीं मिली।",
    };
  }

  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return { error: `अमान्य पेमेंट राशि: ${amount}` };
  }

  const isTestKey =
    appId.toUpperCase().startsWith("TEST") ||
    secretKey.toLowerCase().includes("_test_");
  const envMode = String(process.env.CASHFREE_ENV || "").toLowerCase();
  const baseUrl =
    envMode === "sandbox" || isTestKey
      ? "https://sandbox.cashfree.com/pg"
      : "https://api.cashfree.com/pg";

  const linkId = `OPDLINK_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const digits = String(customerPhone || "").replace(/\D/g, "");
  const phone10 =
    digits.length === 12 && digits.startsWith("91")
      ? digits.slice(2)
      : digits.length >= 10
      ? digits.slice(-10)
      : "";

  if (phone10.length !== 10) {
    return { error: "ग्राहक का 10 अंकों का मोबाइल नंबर सही नहीं है।" };
  }

  const resp = await fetch(`${baseUrl}/links`, {
    method: "POST",
    headers: {
      "x-client-id": appId,
      "x-client-secret": secretKey,
      "x-api-version": "2023-08-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      link_id: linkId,
      link_amount: numAmount,
      link_currency: "INR",
      link_purpose: String(description || `${businessName || "OPD"} Token`).slice(
        0,
        120
      ),
      customer_details: {
        customer_name: String(customerName || "Patient").trim().slice(0, 80),
        customer_phone: phone10,
      },
      link_notes: {
        spreadsheet_id: String(spreadsheetId || ""),
        business_name: String(businessName || ""),
      },
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return {
      error:
        data?.message ||
        data?.code ||
        `Cashfree API error (HTTP ${resp.status})`,
      raw: data,
    };
  }

  return {
    orderId: data?.link_id || linkId,
    paymentLink: data?.link_url || data?.short_url || "",
    raw: data,
  };
}

function buildCtx(business, from) {
  const key = getSessionKey(business.phoneId, from);

  return {
    from,
    business,
    getSession: () =>
      sessions.get(key) || { lang: "hi", step: null, data: {} },
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
    registerPendingPayment: (orderId, payload) => {
      if (!orderId) return;
      pendingPayments.set(String(orderId).trim(), {
        ...payload,
        from,
        business,
        sessionKey: key,
      });
    },
    confirmPendingBookingByOrderId: (orderId, paymentRefId = "") =>
      confirmPendingBookingByOrderId(orderId, paymentRefId),
    isOrderPaid: (orderId) =>
      issuedOrderTokens.has(String(orderId || "").trim()),
    getIssuedTokenForOrder: (orderId) =>
      issuedOrderTokens.get(String(orderId || "").trim()) || "",
    checkCashfreePaymentStatus: (opts) =>
      verifyCashfreeOrderDirect({
        ...opts,
        cashfreeAppId: opts?.cashfreeAppId || business.cashfreeAppId,
        cashfreeSecretKey: opts?.cashfreeSecretKey || business.cashfreeSecretKey,
      }),
    getSheet: (params) =>
      callGas("GET", { ...params, spreadsheet_id: business.sheetId }),
    postSheet: (payload) =>
      callGas("POST", { ...payload, spreadsheetId: business.sheetId }),
    recordPaidBookingAndLog: (opts) =>
      recordPaidBookingAndLog({
        ...opts,
        spreadsheetId: opts?.spreadsheetId || business.sheetId,
        sheetId: opts?.sheetId || business.sheetId,
      }),
    createCashfreeLink: (opts) =>
      createCashfreeLink({
        ...opts,
        spreadsheetId: business.sheetId,
        businessName: business.name,
        cashfreeAppId: business.cashfreeAppId,
        cashfreeSecretKey: business.cashfreeSecretKey,
      }),
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
      const recipient = formatPhoneWith91(from);
      if (!business.phoneId || !business.token || !recipient) {
        console.log("[WA INTERACTIVE]", recipient, JSON.stringify(payload));
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
            ...payload,
          }),
        }
      );
      return r.json();
    },
  };
}

async function routeCategoryMessage(ctx, text = "", btnId = "") {
  const cat = String(ctx.business?.category || "opd").toLowerCase();

  if (cat === "gym") {
    const mod = require("./gym/index");
    if (typeof mod.handleMessage === "function") {
      return mod.handleMessage(ctx, text, btnId);
    }
    return ctx.sendText("🏋️ Gym module is coming soon.");
  }

  if (cat === "school") {
    const mod = require("./school/index");
    if (typeof mod.handleMessage === "function") {
      return mod.handleMessage(ctx, text, btnId);
    }
    return ctx.sendText("🏫 School module is coming soon.");
  }

  if (cat === "coaching") {
    const mod = require("./coaching/index");
    if (typeof mod.handleMessage === "function") {
      return mod.handleMessage(ctx, text, btnId);
    }
    return ctx.sendText("📚 Coaching module is coming soon.");
  }

  const session =
    typeof ctx.getSession === "function" ? ctx.getSession() : {};
  const lang = session?.lang === "en" ? "en" : "hi";

  if (session?.step === "AWAIT_PAYMENT") {
    return handleAwaitPaymentStep(ctx, session.data || {}, lang);
  }

  return handleOpdMessage(ctx, text, btnId);
}

registerOpdStaffAppRoutes(app, {
  staffAppPin: STAFF_APP_PIN,
  callGas,
  getActiveClients,
  resolveBusiness,
  sendTwoAheadAlertIfNeeded,
});

app.get("/", (req, res) => {
  res.status(200).send("AR Enterprises Multi-Vertical Engine is running.");
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

// Cashfree Auto-Confirmation Webhook Endpoint
app.post("/webhook/cashfree", async (req, res) => {
  try {
    const body = req.body || {};
    const eventType = String(
      body.type || body.event || body.event_type || ""
    ).toUpperCase();

    const candidateIds = [
      body.data?.order?.order_id,
      body.data?.link?.link_id,
      body.data?.payment?.order_id,
      body.order?.order_id,
      body.link_id,
      body.order_id,
    ]
      .map((x) => String(x || "").trim())
      .filter(Boolean);

    const matchedOrderId =
      candidateIds.find((id) => pendingPayments.has(id)) ||
      candidateIds[0] ||
      "";

    const paymentStatus = String(
      body.data?.payment?.payment_status ||
        body.data?.order?.order_status ||
        body.payment_status ||
        body.order_status ||
        ""
    ).toUpperCase();

    const paymentRefId = String(
      body.data?.payment?.cf_payment_id ||
        body.data?.payment?.bank_reference ||
        body.cf_payment_id ||
        ""
    ).trim();

    const isPaid =
      eventType.includes("SUCCESS") ||
      eventType.includes("PAID") ||
      ["SUCCESS", "PAID", "COMPLETED"].includes(paymentStatus);

    if (isPaid && matchedOrderId && pendingPayments.has(matchedOrderId)) {
      const issued = await confirmPendingBookingByOrderId(
        matchedOrderId,
        paymentRefId
      );
      return res.status(200).json({ ok: true, autoConfirmed: issued });
    }

    return res.status(200).json({ ok: true, received: true });
  } catch (err) {
    console.error("Cashfree Webhook Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

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

    await routeCategoryMessage(ctx, text, btnId);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("WA Webhook Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = Number(process.env.PORT || 10000);
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`AR Enterprises Multi-Vertical Engine running on ${PORT}`);
});

server.on("error", (err) => {
  console.error("HTTP Server Error:", err.code || err.message);
});
