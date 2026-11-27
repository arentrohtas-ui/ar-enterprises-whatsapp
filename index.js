const express = require("express");
const { handleOpdMessage } = require("./opd/bookingFlow");
const { handleAwaitPaymentStep } = require("./opd/paymentAndToken");
const { registerOpdStaffAppRoutes } = require("./opd/staffApps");
const { formatIstYmd } = require("./opd/menu");
const { createMasterReader, cleanSecretVal } = require("./masterReader");

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

const master = createMasterReader({ gasWebappUrl: GAS_WEBAPP_URL });

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

function getCashfreeBaseUrl(appId, secretKey, paymentMode) {
  const mode = String(paymentMode || process.env.CASHFREE_ENV || "")
    .trim()
    .toLowerCase();
  const isTest =
    appId.toUpperCase().startsWith("TEST") ||
    secretKey.toLowerCase().includes("_test_");
  return mode === "sandbox" || isTest
    ? "https://sandbox.cashfree.com/pg"
    : "https://api.cashfree.com/pg";
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
  const patientPhone = String(alert2Ahead.Patient_Phone || "").trim();
  if (!targetTokenId || !patientPhone) return null;

  const alertText =
    `🔔 *${business.name || "City Care OPD"} — 2 नंबर पहले अलर्ट*\n\n` +
    `नमस्ते *${String(alert2Ahead.Patient_Name || "Patient").trim()}*,\n` +
    `आपका टोकन *${targetTokenId}* आने में अब *केवल 2 नंबर बाकी* हैं।\n` +
    `• डॉक्टर: *${String(alert2Ahead.Doctor_Name || "Doctor").trim()}*\n` +
    `• बैच: *${String(alert2Ahead.Batch_Slot || "").trim()}*`;

  const waRes = await sendWhatsAppText(business, patientPhone, alertText);
  if (waRes && !waRes.error) {
    await master.callGas("POST", {
      action: "mark_two_ahead_sent",
      spreadsheetId: sheetId,
      spreadsheet_id: sheetId,
      tokenId: targetTokenId,
    });
    return targetTokenId;
  }
  return null;
}

async function getNextOpdTokenForSheet(sheetId) {
  try {
    const res = await master.callGas("GET", {
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
    let maxNum = TOKEN_START_NUMBER - 1;
    for (const r of rows) {
      const m = String(r?.Token_ID || r?.tokenId || "")
        .trim()
        .match(/^OPD_(\d+)$/i);
      if (m) {
        const n = Number(m[1]);
        if (!Number.isNaN(n) && n > maxNum) maxNum = n;
      }
    }
    return `${TOKEN_PREFIX}${Math.max(TOKEN_START_NUMBER, maxNum + 1)}`;
  } catch (_) {
    return `${TOKEN_PREFIX}${TOKEN_START_NUMBER}`;
  }
}

async function recordPaidBookingAndLog(payload) {
  await master.callGas("POST", {
    action: "create_booking",
    spreadsheetId: payload.sheetId,
    spreadsheet_id: payload.sheetId,
    tokenId: payload.tokenId,
    patientName: payload.patientName,
    patientAge: payload.patientAge,
    patientPhone: payload.patientPhone,
    doctorId: payload.doctorId || "",
    doctorName: payload.doctorName || "",
    visitDate: normalizeDateYmd(payload.visitDate),
    batchSlot: payload.batchSlot,
    opdFee: payload.opdFee,
    advanceFee: payload.advanceFee,
    paidAmount: payload.paidAmount,
    queueStatus: "Waiting",
    paymentStatus: "Paid",
    greetingSent: "Yes",
    paymentLinkId: payload.paymentLinkId || payload.paymentRefId || "",
    paymentRefId: payload.paymentRefId || payload.paymentLinkId || "",
  });

  await master.callGas("POST", {
    action: "mark_payment_paid",
    spreadsheetId: payload.sheetId,
    spreadsheet_id: payload.sheetId,
    tokenId: payload.tokenId,
    patientName: payload.patientName,
    patientPhone: payload.patientPhone,
    paidAmount: payload.paidAmount,
    paymentRefId: payload.paymentRefId || payload.paymentLinkId || "",
    cfPaymentId: payload.paymentRefId || "",
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
  if (!pending) return { ok: false, reason: "Pending payment not found" };

  const business = await master.resolveBusiness(
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
  const visitDate = normalizeDateYmd(pending.visitDate);
  const dayText = pending.dayInfo?.shortLabel
    ? `${pending.dayInfo.shortLabel} (${visitDate})`
    : visitDate;

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
    paymentRefId: paymentRefId || cleanOrderId,
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
      ? `✅ *Payment Received — OPD Token Confirmed*\n\n• Token No.: *${tokenId}*\n• Patient: *${pending.patientName}* (${pending.patientAge} yrs)\n• Mobile: *${pending.patientPhone}*\n• Date: *${dayText}*\n• Doctor: *${doc.name}*\n• Time Slot: *${pending.batchSlot}*\n• Paid Online: *₹${payableAmount}* (OPD Fee: ₹${opdFee})${
          balanceAmount > 0
            ? `\n• Balance at Counter (Cash): *₹${balanceAmount}*`
            : ""
        }\n• Status: *Paid*`
      : `✅ *पेमेंट प्राप्त — OPD टोकन कन्फ़र्म*\n\n• टोकन नंबर: *${tokenId}*\n• मरीज़: *${pending.patientName}* (${pending.patientAge} वर्ष)\n• मोबाइल: *${pending.patientPhone}*\n• तारीख: *${dayText}*\n• डॉक्टर: *${doc.name}*\n• समय स्लॉट: *${pending.batchSlot}*\n• ऑनलाइन भुगतान: *₹${payableAmount}* (OPD फ़ीस: ₹${opdFee})${
          balanceAmount > 0
            ? `\n• काउंटर पर शेष राशि (नकद): *₹${balanceAmount}*`
            : ""
        }\n• स्टेटस: *Paid*`;

  await sendWhatsAppText(business, pending.patientPhone || pending.from, confirmMsg);
  return { ok: true, tokenId, orderId: cleanOrderId };
}

async function verifyCashfreeOrderDirect({
  orderId,
  cashfreeAppId,
  cashfreeSecretKey,
  paymentMode,
}) {
  const cleanId = String(orderId || "").trim();
  const appId = cleanSecretVal(cashfreeAppId || process.env.CASHFREE_APP_ID);
  const secretKey = cleanSecretVal(
    cashfreeSecretKey || process.env.CASHFREE_SECRET_KEY
  );
  if (!cleanId || !appId || !secretKey) return { status: "UNVERIFIED" };

  const base = getCashfreeBaseUrl(appId, secretKey, paymentMode);
  for (const path of ["orders", "links"]) {
    try {
      const resp = await fetch(`${base}/${path}/${encodeURIComponent(cleanId)}`, {
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
        data?.order_status || data?.link_status || data?.payment_status || ""
      ).toUpperCase();
      if (
        ["PAID", "SUCCESS", "COMPLETED"].includes(st) ||
        Number(data?.link_amount_paid || 0) > 0
      ) {
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
  paymentMode,
}) {
  const appId = cleanSecretVal(cashfreeAppId || process.env.CASHFREE_APP_ID);
  const secretKey = cleanSecretVal(
    cashfreeSecretKey || process.env.CASHFREE_SECRET_KEY
  );
  if (!appId || !secretKey) {
    return { error: "Cashfree App ID / Secret Key नहीं मिली।" };
  }
  const numAmount = Number(amount);
  if (!Number.isFinite(numAmount) || numAmount <= 0) {
    return { error: `अमान्य पेमेंट राशि: ${amount}` };
  }

  const digits = String(customerPhone || "").replace(/\D/g, "");
  const phone10 =
    digits.length === 12 && digits.startsWith("91")
      ? digits.slice(2)
      : digits.length >= 10
      ? digits.slice(-10)
      : "";
  if (phone10.length !== 10) {
    return { error: "10 अंकों का मोबाइल नंबर सही नहीं है।" };
  }

  const baseUrl = getCashfreeBaseUrl(appId, secretKey, paymentMode);
  const linkId = `OPDLINK_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

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
  const key = `${business.phoneId || "default"}:${from || "user"}`;
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
    confirmPendingBookingByOrderId,
    isOrderPaid: (orderId) =>
      issuedOrderTokens.has(String(orderId || "").trim()),
    getIssuedTokenForOrder: (orderId) =>
      issuedOrderTokens.get(String(orderId || "").trim()) || "",
    checkCashfreePaymentStatus: (opts) =>
      verifyCashfreeOrderDirect({
        ...opts,
        cashfreeAppId: opts?.cashfreeAppId || business.cashfreeAppId,
        cashfreeSecretKey: opts?.cashfreeSecretKey || business.cashfreeSecretKey,
        paymentMode: opts?.paymentMode || business.paymentMode,
      }),
    getSheet: (params) =>
      master.callGas("GET", { ...params, spreadsheet_id: business.sheetId }),
    postSheet: (payload) =>
      master.callGas("POST", { ...payload, spreadsheetId: business.sheetId }),
    recordPaidBookingAndLog: (opts) =>
      recordPaidBookingAndLog({
        ...opts,
        sheetId: opts?.sheetId || opts?.spreadsheetId || business.sheetId,
      }),
    createCashfreeLink: (opts) =>
      createCashfreeLink({
        ...opts,
        spreadsheetId: business.sheetId,
        businessName: business.name,
        cashfreeAppId: business.cashfreeAppId,
        cashfreeSecretKey: business.cashfreeSecretKey,
        paymentMode: opts?.paymentMode || business.paymentMode,
      }),
    createRazorpayLink: (opts) =>
      createCashfreeLink({
        ...opts,
        spreadsheetId: business.sheetId,
        businessName: business.name,
        cashfreeAppId: business.cashfreeAppId,
        cashfreeSecretKey: business.cashfreeSecretKey,
        paymentMode: opts?.paymentMode || business.paymentMode,
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
    return typeof mod.handleMessage === "function"
      ? mod.handleMessage(ctx, text, btnId)
      : ctx.sendText("🏋️ Gym module is coming soon.");
  }

  if (cat === "school") {
    const mod = require("./school/index");
    return typeof mod.handleMessage === "function"
      ? mod.handleMessage(ctx, text, btnId)
      : ctx.sendText("🏫 School module is coming soon.");
  }

  if (cat === "coaching") {
    const mod = require("./coaching/index");
    return typeof mod.handleMessage === "function"
      ? mod.handleMessage(ctx, text, btnId)
      : ctx.sendText("📚 Coaching module is coming soon.");
  }

  const session = typeof ctx.getSession === "function" ? ctx.getSession() : {};
  const lang = session?.lang === "en" ? "en" : "hi";

  if (session?.step === "AWAIT_PAYMENT") {
    return handleAwaitPaymentStep(ctx, session.data || {}, lang, text, btnId);
  }
  return handleOpdMessage(ctx, text, btnId);
}

registerOpdStaffAppRoutes(app, {
  staffAppPin: STAFF_APP_PIN,
  callGas: master.callGas,
  getActiveClients: master.getActiveClients,
  resolveBusiness: master.resolveBusiness,
  sendTwoAheadAlertIfNeeded,
});

app.get("/", (req, res) => {
  res.status(200).send("AR Enterprises Multi-Vertical Engine is running.");
});

app.get("/webhook/whatsapp", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === VERIFY_TOKEN
  ) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  return res.status(403).send("Forbidden");
});

app.post("/webhook/cashfree", async (req, res) => {
  try {
    const body = req.body || {};
    const eventType = String(
      body.type || body.event || body.event_type || ""
    ).toUpperCase();
    const ids = [
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
      ids.find((id) => pendingPayments.has(id)) || ids[0] || "";
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

app.post("/webhook/whatsapp", async (req, res) => {
  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value || {};
    const msg = value?.messages?.[0];
    if (!msg) return res.status(200).json({ ok: true });

    const business = await master.resolveBusiness(
      value?.metadata?.phone_number_id || ""
    );
    const ctx = buildCtx(business, msg.from);

    let text = "";
    let btnId = "";
    if (msg.type === "text") {
      text = msg.text?.body || "";
    } else if (msg.type === "interactive") {
      const reply =
        msg.interactive?.button_reply || msg.interactive?.list_reply || {};
      btnId = reply.id || "";
      text = reply.title || "";
    }

    await routeCategoryMessage(ctx, text, btnId);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("WA Webhook Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = Number(process.env.PORT || 10000);
app.listen(PORT, "0.0.0.0", () => {
  console.log(`AR Enterprises Multi-Vertical Engine running on ${PORT}`);
});
