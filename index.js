const express = require("express");
const { handleOpdMessage } = require("./opd/bookingFlow");
const { handleAwaitPaymentStep } = require("./opd/paymentAndToken");
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

function getTodayIstYmd() {
  return formatIstYmd(new Date());
}

function isPastDateYmd(dateStr) {
  const ymd = normalizeDateYmd(dateStr);
  if (!ymd) return false;
  return ymd < getTodayIstYmd();
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

async function findBookingByTokenId(sheetId, tokenId) {
  try {
    const dataRes = await callGas("GET", {
      action: "get_dashboard_data",
      spreadsheet_id: sheetId,
      spreadsheetId: sheetId,
    });
    const list = Array.isArray(dataRes?.bookings) ? dataRes.bookings : [];
    const target = String(tokenId || "").trim().toLowerCase();
    return (
      list.find(
        (b) =>
          String(b.Token_ID || b.tokenId || "").trim().toLowerCase() === target
      ) || null
    );
  } catch (_) {
    return null;
  }
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
      raw.Business_Name || raw.businessName || raw.name || "OPD Clinic"
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

function isValidStaffPin(req) {
  const pin = String(
    req.headers["x-staff-pin"] || req.query.pin || req.body?.pin || ""
  ).trim();
  return pin && pin === STAFF_APP_PIN;
}

function normalizeBookingsList(rawBookings = []) {
  return (Array.isArray(rawBookings) ? rawBookings : []).map((b) => ({
    ...b,
    Visit_Date: normalizeDateYmd(b.Visit_Date || b.visitDate || ""),
  }));
}

app.get("/", (req, res) => {
  res.status(200).send("AR Enterprises Multi-Vertical Engine is running.");
});

app.post("/api/app/login", (req, res) => {
  const pin = String(req.body?.pin || "").trim();
  if (pin !== STAFF_APP_PIN) {
    return res.status(401).json({ ok: false, error: "गलत PIN / Invalid PIN" });
  }
  return res.status(200).json({ ok: true, today: getTodayIstYmd() });
});

app.get("/api/app/data", async (req, res) => {
  try {
    if (!isValidStaffPin(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized PIN" });
    }
    const clients = await getActiveClients();
    const requestedSheetId = String(
      req.query.sheetId || process.env.DEFAULT_CLINIC_SHEET_ID || ""
    ).trim();
    const activeClient =
      clients.find((c) => c.sheetId === requestedSheetId) ||
      clients[0] || {
        name: "OPD Clinic",
        sheetId: process.env.DEFAULT_CLINIC_SHEET_ID || "",
      };

    if (!activeClient.sheetId) {
      return res.status(200).json({
        ok: true,
        today: getTodayIstYmd(),
        clients: clients.map((c) => ({
          id: c.id,
          name: c.name,
          sheetId: c.sheetId,
        })),
        clinic: activeClient,
        doctors: [],
        bookings: [],
      });
    }

    const dataRes = await callGas("GET", {
      action: "get_dashboard_data",
      spreadsheet_id: activeClient.sheetId,
      spreadsheetId: activeClient.sheetId,
    });

    return res.status(200).json({
      ok: true,
      today: getTodayIstYmd(),
      clients: clients.map((c) => ({
        id: c.id,
        name: c.name,
        sheetId: c.sheetId,
      })),
      clinic: {
        id: activeClient.id,
        name: activeClient.name,
        sheetId: activeClient.sheetId,
      },
      doctors: Array.isArray(dataRes?.doctors) ? dataRes.doctors : [],
      bookings: normalizeBookingsList(dataRes?.bookings),
    });
  } catch (err) {
    console.error("App Data Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/app/queue-status", async (req, res) => {
  try {
    if (!isValidStaffPin(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized PIN" });
    }

    const { sheetId, tokenId, queueStatus } = req.body || {};
    if (!sheetId || !tokenId || !queueStatus) {
      return res
        .status(400)
        .json({ ok: false, error: "sheetId, tokenId, queueStatus required" });
    }

    const existingBooking = await findBookingByTokenId(sheetId, tokenId);
    if (existingBooking && isPastDateYmd(existingBooking.Visit_Date)) {
      return res.status(403).json({
        ok: false,
        error: "पिछले दिन (Past Date) के रिकॉर्ड में बदलाव की अनुमति नहीं है।",
      });
    }

    const gasRes = await callGas("POST", {
      action: "update_queue_status",
      spreadsheetId: sheetId,
      spreadsheet_id: sheetId,
      tokenId: String(tokenId).trim(),
      queueStatus: String(queueStatus).trim(),
    });

    let notifiedToken = null;
    if (
      String(queueStatus).trim().toLowerCase() === "in consultation" &&
      gasRes?.alert2Ahead
    ) {
      const business = await resolveBusiness("", sheetId);
      notifiedToken = await sendTwoAheadAlertIfNeeded(
        business,
        sheetId,
        gasRes.alert2Ahead
      );
    }

    return res.status(200).json({
      ok: true,
      notified2AheadToken: notifiedToken,
      bookings: normalizeBookingsList(gasRes?.bookings),
    });
  } catch (err) {
    console.error("Queue Status Update Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/app/cash-deposit", async (req, res) => {
  try {
    if (!isValidStaffPin(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized PIN" });
    }

    const { sheetId, tokenId, amount } = req.body || {};
    const depositAmount = Number(amount);
    if (
      !sheetId ||
      !tokenId ||
      !Number.isFinite(depositAmount) ||
      depositAmount <= 0
    ) {
      return res
        .status(400)
        .json({ ok: false, error: "Valid sheetId, tokenId, and amount required" });
    }

    const existingBooking = await findBookingByTokenId(sheetId, tokenId);
    if (existingBooking && isPastDateYmd(existingBooking.Visit_Date)) {
      return res.status(403).json({
        ok: false,
        error: "पिछले दिन (Past Date) के रिकॉर्ड में Cash Deposit नहीं किया जा सकता।",
      });
    }

    const gasRes = await callGas("POST", {
      action: "record_cash_deposit",
      spreadsheetId: sheetId,
      spreadsheet_id: sheetId,
      tokenId: String(tokenId).trim(),
      depositAmount,
      amount: depositAmount,
    });

    return res.status(200).json({
      ok: true,
      bookings: normalizeBookingsList(gasRes?.bookings),
      result: gasRes,
    });
  } catch (err) {
    console.error("Cash Deposit Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/app/doctor-avail", async (req, res) => {
  try {
    if (!isValidStaffPin(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized PIN" });
    }

    const { sheetId, doctorId, doctorName, dayKey, avail } = req.body || {};
    if (!sheetId || !dayKey || !avail) {
      return res
        .status(400)
        .json({ ok: false, error: "sheetId, dayKey, avail required" });
    }

    if (String(dayKey || "").toLowerCase() === "past") {
      return res.status(403).json({
        ok: false,
        error: "पिछले दिन की उपलब्धता नहीं बदली जा सकती।",
      });
    }

    const gasRes = await callGas("POST", {
      action: "update_doctor_avail",
      spreadsheetId: sheetId,
      spreadsheet_id: sheetId,
      doctorId,
      doctorName,
      dayKey,
      avail,
    });

    return res.status(200).json({ ok: true, result: gasRes });
  } catch (err) {
    console.error("Doctor Avail Update Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

function renderStandaloneAppHtml(appRole) {
  const isDoctor = appRole === "doctor";
  const pageTitle = isDoctor ? "Doctor App" : "Reception App";
  const headerIcon = isDoctor ? "🩺" : "💻";
  const subtitleText = isDoctor
    ? "Doctor App — कुल मरीज़, कुल राशि, कतार व Present/Absent"
    : "Reception App — कतार, Cash Deposit व कुल शुल्क हिसाब";
  const todayIst = getTodayIstYmd();

  return `<!doctype html>
<html lang="hi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <title>${pageTitle}</title>
  <style>
    :root {
      --bg: #f3f6fb;
      --card: #ffffff;
      --primary: ${isDoctor ? "#0d9488" : "#0f62fe"};
      --primary-dark: ${isDoctor ? "#0f766e" : "#0043ce"};
      --text: #161616;
      --muted: #525252;
      --border: #e0e6ed;
      --wait: #fff4e5;
      --wait-t: #9a5200;
      --live: #e6f4ea;
      --live-t: #137333;
      --done: #eef2ff;
      --done-t: #3730a3;
    }
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding-bottom: 36px;
    }
    .lock-wrap {
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .lock-card {
      width: 100%;
      max-width: 360px;
      background: var(--card);
      border-radius: 20px;
      padding: 28px 22px;
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      text-align: center;
    }
    .lock-card h2 { margin: 0 0 8px; font-size: 21px; }
    .lock-card p { margin: 0 0 18px; color: var(--muted); font-size: 14px; }
    .pin-input {
      width: 100%;
      font-size: 24px;
      letter-spacing: 10px;
      text-align: center;
      padding: 12px;
      border: 1.5px solid var(--border);
      border-radius: 12px;
      margin-bottom: 14px;
      font-weight: 700;
    }
    .btn {
      border: none;
      border-radius: 12px;
      padding: 11px 13px;
      font-size: 13.5px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .btn-primary { background: var(--primary); color: #fff; width: 100%; }
    .btn-primary:active { background: var(--primary-dark); }
    .btn-live { background: #137333; color: #fff; flex: 1; }
    .btn-done { background: #3730a3; color: #fff; flex: 1; }
    .btn-wait { background: #b45309; color: #fff; flex: 1; }
    .btn-cash { background: #0f766e; color: #fff; width: 100%; margin-top: 8px; }
    .btn-ghost { background: #eef2f7; color: var(--text); }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      background: var(--card);
      border-bottom: 1px solid var(--border);
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }
    .topbar-title { font-size: 17px; font-weight: 700; margin: 0; }
    .topbar-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }

    .container { max-width: 720px; margin: 0 auto; padding: 14px; }
    .filters {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 8px;
      margin-bottom: 14px;
    }
    select, input[type="date"] {
      width: 100%;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--border);
      background: var(--card);
      font-size: 14px;
      color: var(--text);
    }
    .banner {
      background: linear-gradient(135deg, var(--primary), var(--primary-dark));
      color: #fff;
      border-radius: 16px;
      padding: 14px 16px;
      margin-bottom: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .banner-big { font-size: 20px; font-weight: 800; }
    .banner-small { font-size: 11px; opacity: 0.92; text-transform: uppercase; }

    .q-card {
      background: var(--card);
      border-radius: 16px;
      padding: 14px;
      margin-bottom: 12px;
      border: 1px solid var(--border);
      box-shadow: 0 2px 8px rgba(15, 23, 42, 0.03);
    }
    .q-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
      gap: 8px;
    }
    .token-pill {
      font-weight: 800;
      font-size: 15px;
      color: var(--primary);
    }
    .badge {
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
    }
    .b-waiting { background: var(--wait); color: var(--wait-t); }
    .b-in-consultation { background: var(--live); color: var(--live-t); }
    .b-completed { background: var(--done); color: var(--done-t); }
    .q-meta { font-size: 13px; color: var(--muted); margin: 4px 0 10px; line-height: 1.55; }
    .q-actions { display: flex; gap: 8px; flex-wrap: wrap; }

    .avail-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-top: 1px dashed var(--border);
      font-size: 13px;
      gap: 8px;
      flex-wrap: wrap;
    }
    .chip {
      padding: 6px 10px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #f8fafc;
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;
    }
    .chip-p { background: #e6f4ea; color: #137333; border-color: #b7e1cd; }
    .chip-a { background: #fce8e6; color: #c5221f; border-color: #fad2cf; }

    .toast {
      position: fixed;
      top: 68px;
      left: 50%;
      transform: translateX(-50%);
      background: #161616;
      color: #fff;
      padding: 10px 16px;
      border-radius: 12px;
      font-size: 13px;
      z-index: 50;
      display: none;
      max-width: 92vw;
      text-align: center;
    }
  </style>
</head>
<body>
  <div id="toast" class="toast"></div>

  <div id="lockScreen" class="lock-wrap">
    <div class="lock-card">
      <h2>🔐 ${headerIcon} ${pageTitle}</h2>
      <p>${pageTitle} खोलने के लिए PIN डालें</p>
      <input id="pinInput" class="pin-input" type="password" inputmode="numeric" maxlength="8" placeholder="••••" />
      <button class="btn btn-primary" onclick="unlockApp()">Unlock ${pageTitle}</button>
    </div>
  </div>

  <div id="appShell" style="display:none;">
    <div class="topbar">
      <div>
        <div id="clinicTitle" class="topbar-title">${headerIcon} ${pageTitle}</div>
        <div class="topbar-sub">${subtitleText}</div>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="btn btn-ghost" onclick="loadAllData()">🔄</button>
        <button class="btn btn-ghost" onclick="lockApp()">🔒</button>
      </div>
    </div>

    <div class="container">
      <div class="filters">
        <input id="dateFilter" type="date" onchange="renderView()" />
        <select id="doctorFilter" onchange="renderView()">
          <option value="ALL">सभी डॉक्टर / All Doctors</option>
        </select>
        <button class="btn btn-ghost" onclick="clearDateFilter()">सब तारीख</button>
      </div>

      ${
        isDoctor
          ? `<div class="banner">
              <div>
                <div class="banner-small">CURRENT RUNNING TOKEN</div>
                <div id="currentTokenText" class="banner-big">—</div>
              </div>
              <div>
                <div class="banner-small">WAITING</div>
                <div id="waitingCountText" class="banner-big">0</div>
              </div>
              <div style="text-align:right;">
                <div class="banner-small">TOTAL PATIENTS</div>
                <div id="totalPatientsText" class="banner-big">0</div>
              </div>
              <div style="width:100%;border-top:1px solid rgba(255,255,255,0.22);padding-top:10px;display:flex;justify-content:space-between;gap:12px;">
                <div>
                  <div class="banner-small">TOTAL AMOUNT (कुल शुल्क)</div>
                  <div id="totalAmountText" class="banner-big">₹0</div>
                </div>
              </div>
            </div>`
          : `<div class="banner">
              <div>
                <div class="banner-small">CURRENT RUNNING TOKEN</div>
                <div id="currentTokenText" class="banner-big">—</div>
              </div>
              <div>
                <div class="banner-small">WAITING</div>
                <div id="waitingCountText" class="banner-big">0</div>
              </div>
              <div style="text-align:right;">
                <div class="banner-small">TOTAL PATIENTS</div>
                <div id="totalPatientsText" class="banner-big">0</div>
              </div>
              <div style="width:100%;border-top:1px solid rgba(255,255,255,0.22);padding-top:10px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;">
                <div>
                  <div class="banner-small">TOTAL AMOUNT (कुल शुल्क)</div>
                  <div id="totalAmountText" class="banner-big">₹0</div>
                </div>
                <div>
                  <div class="banner-small">कुल दिया गया (PAID)</div>
                  <div id="totalPaidText" class="banner-big">₹0</div>
                </div>
                <div style="text-align:right;">
                  <div class="banner-small">कुल बाक़ी (BALANCE)</div>
                  <div id="totalBalanceText" class="banner-big">₹0</div>
                </div>
              </div>
            </div>`
      }

      <div id="mainContent"></div>
    </div>
  </div>

  <script>
    const APP_ROLE = "${appRole}";
    const TODAY_IST = "${todayIst}";
    let PIN = "";
    let state = { clinic: null, doctors: [], bookings: [] };

    function toYmd(val) {
      if (!val) return "";
      const s = String(val).trim();
      const ymd = s.match(/^(\\d{4})[-/](\\d{1,2})[-/](\\d{1,2})/);
      if (ymd) return \`\${ymd[1]}-\${String(ymd[2]).padStart(2, "0")}-\${String(ymd[3]).padStart(2, "0")}\`;
      const dmy = s.match(/^(\\d{1,2})[-/](\\d{1,2})[-/](\\d{4})/);
      if (dmy) return \`\${dmy[3]}-\${String(dmy[2]).padStart(2, "0")}-\${String(dmy[1]).padStart(2, "0")}\`;
      return s.slice(0, 10);
    }

    function isPastDate(val) {
      const ymd = toYmd(val);
      return Boolean(ymd && ymd < TODAY_IST);
    }

    function showToast(msg) {
      const el = document.getElementById("toast");
      el.textContent = msg;
      el.style.display = "block";
      clearTimeout(window._t);
      window._t = setTimeout(() => { el.style.display = "none"; }, 3200);
    }

    function clearDateFilter() {
      document.getElementById("dateFilter").value = "";
      renderView();
    }

    async function unlockApp() {
      const pin = document.getElementById("pinInput").value.trim();
      const r = await fetch("/api/app/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        showToast(d.error || "गलत PIN");
        return;
      }
      PIN = pin;
      document.getElementById("lockScreen").style.display = "none";
      document.getElementById("appShell").style.display = "block";
      document.getElementById("dateFilter").value = "";
      await loadAllData();
    }

    function lockApp() {
      PIN = "";
      document.getElementById("pinInput").value = "";
      document.getElementById("appShell").style.display = "none";
      document.getElementById("lockScreen").style.display = "flex";
    }

    async function loadAllData() {
      if (!PIN) return;
      const r = await fetch("/api/app/data", {
        headers: { "x-staff-pin": PIN },
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        showToast(d.error || "Data load failed");
        return;
      }
      state.clinic = d.clinic;
      state.doctors = d.doctors || [];
      state.bookings = d.bookings || [];
      document.getElementById("clinicTitle").textContent =
        \`${headerIcon} \${d.clinic?.name || "OPD"} — ${pageTitle}\`;

      const sel = document.getElementById("doctorFilter");
      const prevVal = sel.value || "ALL";
      sel.innerHTML = '<option value="ALL">सभी डॉक्टर / All Doctors</option>';
      state.doctors.forEach((doc) => {
        const opt = document.createElement("option");
        opt.value = doc.name;
        opt.textContent = doc.name;
        sel.appendChild(opt);
      });
      if ([...sel.options].some((o) => o.value === prevVal)) sel.value = prevVal;

      renderView();
    }

    async function setQueueStatus(tokenId, queueStatus) {
      const target = state.bookings.find((b) => String(b.Token_ID || "") === String(tokenId));
      if (target && isPastDate(target.Visit_Date)) {
        showToast("🔒 पिछले दिन के रिकॉर्ड में बदलाव की अनुमति नहीं है");
        return;
      }

      const r = await fetch("/api/app/queue-status", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-staff-pin": PIN },
        body: JSON.stringify({
          sheetId: state.clinic?.sheetId,
          tokenId,
          queueStatus,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        showToast(d.error || "Update failed");
        return;
      }
      state.bookings = d.bookings || state.bookings;
      if (d.notified2AheadToken) {
        showToast(\`✅ \${tokenId} → \${queueStatus} | 2 नंबर अलर्ट: \${d.notified2AheadToken}\`);
      } else {
        showToast(\`✅ \${tokenId} → \${queueStatus}\`);
      }
      renderView();
    }

    async function handleCashDeposit(tokenId, currentBalance, visitDate) {
      if (isPastDate(visitDate)) {
        showToast("🔒 पिछले दिन के रिकॉर्ड में Cash Deposit बंद है");
        return;
      }

      const defaultAmt = currentBalance > 0 ? String(currentBalance) : "";
      const entered = prompt(\`टोकन \${tokenId} के लिए Cash Deposit राशि (₹) डालें (बाक़ी: ₹\${currentBalance}):\`, defaultAmt);
      if (entered === null) return;
      const amt = Number(String(entered).trim());
      if (!Number.isFinite(amt) || amt <= 0) {
        showToast("कृपया सही राशि (₹) डालें");
        return;
      }

      const r = await fetch("/api/app/cash-deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-staff-pin": PIN },
        body: JSON.stringify({
          sheetId: state.clinic?.sheetId,
          tokenId,
          amount: amt,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        showToast(d.error || "Cash deposit failed");
        return;
      }
      if (Array.isArray(d.bookings) && d.bookings.length) {
        state.bookings = d.bookings;
      }
      showToast(\`💵 \${tokenId} में ₹\${amt} Cash Deposit दर्ज हुआ\`);
      renderView();
    }

    async function toggleDoctorAvail(doc, dayKey) {
      const curMap = { today: doc.todayAvail, next: doc.nextDayAvail, plus2: doc.plus2DayAvail };
      const nextAvail = String(curMap[dayKey] || "P").toUpperCase() === "P" ? "A" : "P";
      const r = await fetch("/api/app/doctor-avail", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-staff-pin": PIN },
        body: JSON.stringify({
          sheetId: state.clinic?.sheetId,
          doctorId: doc.id,
          doctorName: doc.name,
          dayKey,
          avail: nextAvail,
        }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        showToast(d.error || "Availability update failed");
        return;
      }
      await loadAllData();
      showToast(\`🩺 \${doc.name} (\${dayKey}) → \${nextAvail}\`);
    }

    function renderView() {
      const dateVal = toYmd(document.getElementById("dateFilter").value);
      const docVal = document.getElementById("doctorFilter").value;

      const list = state.bookings.filter((b) => {
        const matchDate = !dateVal || toYmd(b.Visit_Date) === dateVal;
        const matchDoc = docVal === "ALL" || String(b.Doctor_Name || "").trim() === docVal;
        return matchDate && matchDoc;
      });

      const running = list.find(
        (b) => String(b.Queue_Status || "").trim().toLowerCase() === "in consultation"
      );
      const waitingList = list.filter(
        (b) => String(b.Queue_Status || "Waiting").trim().toLowerCase() === "waiting"
      );

      let sumTotal = 0;
      let sumPaid = 0;
      let sumBalance = 0;
      list.forEach((b) => {
        const fee = Number(b.OPD_Fee || 0);
        const paid = Number(b.Paid_Amount || 0);
        sumTotal += fee;
        sumPaid += paid;
        sumBalance += Math.max(0, fee - paid);
      });

      document.getElementById("currentTokenText").textContent =
        running ? \`\${running.Token_ID} (\${running.Patient_Name})\` : "कोई नहीं / None";
      document.getElementById("waitingCountText").textContent = String(waitingList.length);
      document.getElementById("totalPatientsText").textContent = String(list.length);

      const totEl = document.getElementById("totalAmountText");
      if (totEl) totEl.textContent = \`₹\${sumTotal}\`;

      if (APP_ROLE === "reception") {
        const paidEl = document.getElementById("totalPaidText");
        const balEl = document.getElementById("totalBalanceText");
        if (paidEl) paidEl.textContent = \`₹\${sumPaid}\`;
        if (balEl) balEl.textContent = \`₹\${sumBalance}\`;
      }

      const container = document.getElementById("mainContent");
      let html = "";

      if (APP_ROLE === "doctor") {
        const docsToShow = docVal === "ALL"
          ? state.doctors
          : state.doctors.filter((d) => d.name === docVal);

        html += \`<div class="q-card"><b>🩺 Doctor Availability (P = Present, A = Absent)</b>\`;
        docsToShow.forEach((doc) => {
          html += \`
            <div class="avail-row">
              <div><b>\${doc.name}</b><br><span style="color:#525252;font-size:12px;">\${doc.specialty || ""}</span></div>
              <div style="display:flex;gap:6px;">
                <button class="chip \${doc.todayAvail === 'P' ? 'chip-p' : 'chip-a'}" onclick='toggleDoctorAvail(\${JSON.stringify(doc)}, "today")'>आज: \${doc.todayAvail || 'P'}</button>
                <button class="chip \${doc.nextDayAvail === 'P' ? 'chip-p' : 'chip-a'}" onclick='toggleDoctorAvail(\${JSON.stringify(doc)}, "next")'>कल: \${doc.nextDayAvail || 'P'}</button>
                <button class="chip \${doc.plus2DayAvail === 'P' ? 'chip-p' : 'chip-a'}" onclick='toggleDoctorAvail(\${JSON.stringify(doc)}, "plus2")'>परसों: \${doc.plus2DayAvail || 'P'}</button>
              </div>
            </div>
          \`;
        });
        html += \`</div>\`;
      }

      if (!list.length) {
        html += \`<div class="q-card" style="text-align:center;color:#525252;">इस तारीख/डॉक्टर के लिए कोई बुकिंग नहीं मिली।</div>\`;
      } else {
        list.forEach((b) => {
          const st = String(b.Queue_Status || "Waiting").trim();
          const cls = st.toLowerCase() === "in consultation"
            ? "b-in-consultation"
            : st.toLowerCase() === "completed"
            ? "b-completed"
            : "b-waiting";
          const tId = String(b.Token_ID || "");
          const visitYmd = toYmd(b.Visit_Date);
          const lockedPast = isPastDate(visitYmd);
          const opdFee = Number(b.OPD_Fee || 0);
          const paidAmt = Number(b.Paid_Amount || 0);
          const balanceAmt = Math.max(0, opdFee - paidAmt);

          const metaLine = APP_ROLE === "reception"
            ? \`👨‍⚕️ <b>\${b.Doctor_Name || ""}</b> | 📅 \${visitYmd} | ⏰ \${b.Batch_Slot || ""}<br>📱 \${b.Patient_Phone || ""} | 💳 \${b.Payment_Status || "Paid"}<br>💰 Fee: <b>₹\${opdFee}</b> | दिया: <b>₹\${paidAmt}</b> | बाक़ी: <b style="color:\${balanceAmt > 0 ? '#c5221f' : '#137333'}">₹\${balanceAmt}</b>\`
            : \`👨‍⚕️ <b>\${b.Doctor_Name || ""}</b> | 📅 \${visitYmd} | ⏰ \${b.Batch_Slot || ""}<br>📱 \${b.Patient_Phone || ""} | 💰 Fee: <b>₹\${opdFee}</b>\`;

          const disAttr = lockedPast ? "disabled" : "";
          const cashBtnHtml = APP_ROLE === "reception"
            ? \`<button class="btn btn-cash" \${disAttr} onclick="handleCashDeposit('\${tId}', \${balanceAmt}, '\${visitYmd}')">💵 Cash Deposit (बाक़ी: ₹\${balanceAmt})</button>\`
            : "";

          const lockNoteHtml = lockedPast
            ? \`<div style="margin-top:8px;font-size:12px;color:#b45309;font-weight:700;">🔒 पिछले दिन का रिकॉर्ड लॉक है (बदलाव बंद)</div>\`
            : "";

          html += \`
            <div class="q-card">
              <div class="q-top">
                <span class="token-pill">\${tId} — \${b.Patient_Name || ""} (\${b.Patient_Age || ""}y)</span>
                <span class="badge \${cls}">\${st}</span>
              </div>
              <div class="q-meta">\${metaLine}</div>
              <div class="q-actions">
                <button class="btn btn-live" \${disAttr} onclick="setQueueStatus('\${tId}', 'In Consultation')">▶ In Consultation</button>
                <button class="btn btn-done" \${disAttr} onclick="setQueueStatus('\${tId}', 'Completed')">✔ Completed</button>
                <button class="btn btn-wait" \${disAttr} onclick="setQueueStatus('\${tId}', 'Waiting')">⏳ Waiting</button>
              </div>
              \${cashBtnHtml}
              \${lockNoteHtml}
            </div>
          \`;
        });
      }

      container.innerHTML = html;
    }
  </script>
</body>
</html>`;
}

app.get("/reception-app", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(renderStandaloneAppHtml("reception"));
});

app.get("/doctor-app", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(renderStandaloneAppHtml("doctor"));
});

app.get("/app", (req, res) => {
  res.redirect("/reception-app");
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
