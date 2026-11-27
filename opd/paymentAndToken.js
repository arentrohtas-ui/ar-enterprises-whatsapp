const { sendMainMenu } = require("./menu");

function toNumberClean(val, fallback = 0) {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  const cleaned = String(val ?? "").replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && cleaned !== "" ? n : fallback;
}

function normalizeTenDigitPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function getCashfreeBaseUrl(appId, secretKey, paymentMode) {
  const mode = String(paymentMode || process.env.CASHFREE_ENV || "")
    .trim()
    .toLowerCase();
  const isTest =
    String(appId || "")
      .toUpperCase()
      .startsWith("TEST") ||
    String(secretKey || "")
      .toLowerCase()
      .includes("_test_");
  return mode === "sandbox" || isTest
    ? "https://sandbox.cashfree.com/pg"
    : "https://api.cashfree.com/pg";
}

async function verifyPaymentFromCashfreeOrCtx(ctx, data, orderId) {
  if (typeof ctx.checkCashfreePaymentStatus === "function") {
    const ctxRes = await ctx.checkCashfreePaymentStatus({ orderId });
    if (ctxRes?.status === "PAID") {
      return ctxRes;
    }
  }

  const appId = String(
    data?.cashfreeAppId ||
      ctx.business?.cashfreeAppId ||
      process.env.CASHFREE_APP_ID ||
      ""
  ).trim();
  const secretKey = String(
    data?.cashfreeSecretKey ||
      ctx.business?.cashfreeSecretKey ||
      process.env.CASHFREE_SECRET_KEY ||
      ""
  ).trim();

  if (!orderId || !appId || !secretKey) {
    return { status: "PENDING" };
  }

  const base = getCashfreeBaseUrl(
    appId,
    secretKey,
    data?.paymentMode || ctx.business?.paymentMode
  );
  const headers = {
    "x-client-id": appId,
    "x-client-secret": secretKey,
    "x-api-version": "2023-08-01",
    Accept: "application/json",
  };

  try {
    const linkResp = await fetch(
      `${base}/links/${encodeURIComponent(orderId)}`,
      { method: "GET", headers }
    );
    if (linkResp.ok) {
      const linkData = await linkResp.json();
      const linkSt = String(linkData?.link_status || "").toUpperCase();
      const paidAmt = Number(linkData?.link_amount_paid || 0);
      const reqAmt = Number(linkData?.link_amount || 0);

      if (
        linkSt === "PAID" ||
        (reqAmt > 0 && paidAmt >= reqAmt) ||
        paidAmt > 0
      ) {
        return {
          status: "PAID",
          cf_payment_id: linkData?.cf_link_id || linkData?.link_id || orderId,
        };
      }

      const ordersResp = await fetch(
        `${base}/links/${encodeURIComponent(orderId)}/orders`,
        { method: "GET", headers }
      );
      if (ordersResp.ok) {
        const ordersData = await ordersResp.json();
        const arr = Array.isArray(ordersData)
          ? ordersData
          : Array.isArray(ordersData?.orders)
          ? ordersData.orders
          : Array.isArray(ordersData?.data)
          ? ordersData.data
          : [];
        const paidOrder = arr.find((o) =>
          ["PAID", "SUCCESS", "COMPLETED"].includes(
            String(o?.order_status || "").toUpperCase()
          )
        );
        if (paidOrder) {
          return {
            status: "PAID",
            cf_payment_id:
              paidOrder?.cf_order_id || paidOrder?.order_id || orderId,
          };
        }
      }
    }
  } catch (_) {}

  try {
    const ordResp = await fetch(
      `${base}/orders/${encodeURIComponent(orderId)}`,
      { method: "GET", headers }
    );
    if (ordResp.ok) {
      const ordData = await ordResp.json();
      const st = String(ordData?.order_status || "").toUpperCase();
      if (["PAID", "SUCCESS", "COMPLETED"].includes(st)) {
        return {
          status: "PAID",
          cf_payment_id: ordData?.cf_order_id || ordData?.order_id || orderId,
        };
      }
    }
  } catch (_) {}

  return { status: "PENDING" };
}

async function sendPaymentActionButtons(ctx, promptText, lang = "hi") {
  if (typeof ctx.sendWA === "function") {
    const waRes = await ctx.sendWA({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: promptText },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: "PAY_CHECK",
                title: lang === "en" ? "Payment Done" : "पेमेंट हो गया",
              },
            },
            {
              type: "reply",
              reply: {
                id: "PAY_CANCEL",
                title: lang === "en" ? "Cancel" : "रद्द करें",
              },
            },
          ],
        },
      },
    });
    if (waRes && !waRes.error && !waRes.errors) return;
  }

  await ctx.sendText(
    `${promptText}\n${
      lang === "en"
        ? "(Reply *1* for Payment Done or *0* to Cancel)"
        : "(पेमेंट हो गया के लिए *1* या रद्द करने के लिए *0* लिखें)"
    }`
  );
}

async function sendPaymentLinkAndButtons(
  ctx,
  { bookingPayload, payUrl, payableAmount },
  lang = "hi"
) {
  const doc = bookingPayload.selectedDoctor || {};
  const detailsText =
    lang === "en"
      ? `💳 *Payment Link Ready*\n\n` +
        `• Patient: *${bookingPayload.patientName}* (${bookingPayload.patientAge} yrs)\n` +
        `• Mobile: *${bookingPayload.patientPhone}*\n` +
        `• Doctor: *${doc.name}*\n` +
        `• Date: *${bookingPayload.visitDate}* | *${bookingPayload.batchSlot}*\n` +
        `• Amount: *₹${payableAmount}*\n\n` +
        `Pay here:\n${payUrl}`
      : `💳 *पेमेंट लिंक तैयार है*\n\n` +
        `• मरीज़: *${bookingPayload.patientName}* (${bookingPayload.patientAge} वर्ष)\n` +
        `• मोबाइल: *${bookingPayload.patientPhone}*\n` +
        `• डॉक्टर: *${doc.name}*\n` +
        `• तारीख: *${bookingPayload.visitDate}* | *${bookingPayload.batchSlot}*\n` +
        `• राशि: *₹${payableAmount}*\n\n` +
        `पेमेंट लिंक:\n${payUrl}`;

  await ctx.sendText(detailsText);

  const actionText =
    lang === "en"
      ? "Once payment is done, tap *Payment Done* to generate your token, or *Cancel* to stop."
      : "पेमेंट होने के बाद टोकन जारी करने के लिए *पेमेंट हो गया* दबाएं, या *रद्द करें* दबाएं।";

  await sendPaymentActionButtons(ctx, actionText, lang);
}

async function initiatePaymentOrBooking(ctx, data, tenDigit, lang = "hi") {
  const doc = data.selectedDoctor || {};
  const opdFee = toNumberClean(doc.opdFee ?? data.opdFee ?? 0, 0);
  const advCfg = toNumberClean(
    doc.advanceAmount ?? ctx.business?.advanceAmount ?? 0,
    0
  );
  const payableAmount =
    advCfg > 0 && advCfg < opdFee ? advCfg : opdFee > 0 ? opdFee : 0;

  const cleanPhone = normalizeTenDigitPhone(tenDigit || data.patientPhone || "");
  const cleanName = String(data.patientName || "Patient").trim() || "Patient";
  const cleanAge = String(data.patientAge || "").trim();

  const bookingPayload = {
    lang,
    selectedDoctor: doc,
    dayInfo: data.dayInfo,
    visitDate: data.visitDate,
    batchSlot: data.batchSlot,
    patientName: cleanName,
    patientAge: cleanAge,
    patientPhone: cleanPhone,
    opdFee,
    payableAmount,
    cashfreeAppId: ctx.business?.cashfreeAppId || "",
    cashfreeSecretKey: ctx.business?.cashfreeSecretKey || "",
    paymentMode: ctx.business?.paymentMode || "",
  };

  const createLinkFn =
    typeof ctx.createCashfreeLink === "function"
      ? ctx.createCashfreeLink
      : typeof ctx.createRazorpayLink === "function"
      ? ctx.createRazorpayLink
      : null;

  if (payableAmount > 0 && createLinkFn) {
    try {
      const sheetId = String(ctx.business?.sheetId || "").trim();
      const linkRes = await createLinkFn({
        amount: payableAmount,
        customerName: cleanName,
        customerPhone: cleanPhone,
        description: `${doc.name || "OPD"} - ${data.visitDate || ""}`.trim(),
        spreadsheetId: sheetId,
        spreadsheet_id: sheetId,
        businessName: ctx.business?.name || "City Care OPD",
        cashfreeAppId: ctx.business?.cashfreeAppId || "",
        cashfreeSecretKey: ctx.business?.cashfreeSecretKey || "",
      });

      const orderId = String(
        linkRes?.orderId ||
          linkRes?.order_id ||
          linkRes?.linkId ||
          linkRes?.link_id ||
          linkRes?.id ||
          linkRes?.raw?.link_id ||
          linkRes?.raw?.order_id ||
          ""
      ).trim();

      const payUrl = String(
        linkRes?.paymentLink ||
          linkRes?.payment_url ||
          linkRes?.link_url ||
          linkRes?.short_url ||
          linkRes?.url ||
          linkRes?.raw?.link_url ||
          linkRes?.raw?.short_url ||
          ""
      ).trim();

      if (orderId && typeof ctx.registerPendingPayment === "function") {
        ctx.registerPendingPayment(orderId, bookingPayload);
      }

      if (payUrl) {
        ctx.setSession({
          lang,
          step: "AWAIT_PAYMENT",
          data: { ...bookingPayload, orderId, payUrl },
        });

        await sendPaymentLinkAndButtons(
          ctx,
          { bookingPayload, payUrl, payableAmount },
          lang
        );
        return;
      }

      const reasonText = String(
        linkRes?.error ||
          linkRes?.message ||
          linkRes?.raw?.message ||
          "Cashfree link URL not returned"
      ).trim();

      await ctx.sendText(
        lang === "en"
          ? `⚠️ *Payment Link Error*\nAmount: ₹${payableAmount}\nReason: ${reasonText}`
          : `⚠️ *पेमेंट लिंक बनाने में समस्या*\nराशि: ₹${payableAmount}\nकारण: ${reasonText}`
      );
      return;
    } catch (err) {
      await ctx.sendText(
        lang === "en"
          ? `⚠️ Could not create payment link for ₹${payableAmount}: ${err.message}`
          : `⚠️ ₹${payableAmount} का पेमेंट लिंक नहीं बन सका: ${err.message}`
      );
      return;
    }
  }

  if (typeof ctx.recordPaidBookingAndLog === "function") {
    const tokenId = `OPD_${Date.now().toString().slice(-4)}`;
    await ctx.recordPaidBookingAndLog({
      tokenId,
      patientName: cleanName,
      patientAge: cleanAge,
      patientPhone: cleanPhone,
      doctorId: doc.id || "",
      doctorName: doc.name || "",
      visitDate: data.visitDate,
      batchSlot: data.batchSlot,
      opdFee,
      advanceFee: payableAmount,
      paidAmount: payableAmount,
    });
    ctx.clearSession(true);
    await ctx.sendText(
      lang === "en"
        ? `✅ *OPD Token Booked*\n• Token: *${tokenId}*\n• Patient: *${cleanName}*\n• Doctor: *${doc.name}*\n• Date: *${data.visitDate}* (${data.batchSlot})`
        : `✅ *OPD टोकन बुक हो गया*\n• टोकन: *${tokenId}*\n• मरीज़: *${cleanName}*\n• डॉक्टर: *${doc.name}*\n• तारीख: *${data.visitDate}* (${data.batchSlot})`
    );
    return;
  }

  ctx.clearSession(true);
  await sendMainMenu(ctx, lang);
}

async function handleAwaitPaymentStep(
  ctx,
  data,
  lang = "hi",
  cleanText = "",
  cleanId = ""
) {
  const lower = String(cleanText || "").trim().toLowerCase();
  const isCancel =
    cleanId === "PAY_CANCEL" ||
    ["0", "cancel", "रद्द", "कैंसल", "band"].includes(lower);

  if (isCancel) {
    ctx.clearSession(true);
    await ctx.sendText(
      lang === "en"
        ? "❌ Booking cancelled. Type *Hi* to start again."
        : "❌ बुकिंग रद्द कर दी गई है। दोबारा शुरू करने के लिए *नमस्ते* या *Hi* लिखें।"
    );
    return;
  }

  const orderId = String(data.orderId || "").trim();
  if (orderId && typeof ctx.registerPendingPayment === "function") {
    ctx.registerPendingPayment(orderId, { ...data, lang });
  }

  const statusRes = await verifyPaymentFromCashfreeOrCtx(ctx, data, orderId);
  if (statusRes?.status === "PAID") {
    if (typeof ctx.confirmPendingBookingByOrderId === "function") {
      const issued = await ctx.confirmPendingBookingByOrderId(
        orderId,
        statusRes.cf_payment_id || orderId
      );
      if (issued?.ok && issued?.tokenId) {
        return;
      }
    }

    if (typeof ctx.recordPaidBookingAndLog === "function") {
      const tokenId = `OPD_${Date.now().toString().slice(-4)}`;
      const doc = data.selectedDoctor || {};
      await ctx.recordPaidBookingAndLog({
        tokenId,
        patientName: data.patientName || "Patient",
        patientAge: data.patientAge || "",
        patientPhone: normalizeTenDigitPhone(data.patientPhone),
        doctorId: doc.id || "",
        doctorName: doc.name || "",
        visitDate: data.visitDate || "",
        batchSlot: data.batchSlot || "",
        opdFee: toNumberClean(doc.opdFee ?? data.opdFee ?? 0, 0),
        advanceFee: toNumberClean(data.payableAmount ?? data.opdFee ?? 0, 0),
        paidAmount: toNumberClean(data.payableAmount ?? data.opdFee ?? 0, 0),
        paymentLinkId: orderId,
        paymentRefId: statusRes.cf_payment_id || orderId,
      });
      ctx.clearSession(true);
      await ctx.sendText(
        lang === "en"
          ? `✅ *Payment Received — OPD Token Confirmed*\n\n• Token No.: *${tokenId}*\n• Patient: *${data.patientName}*\n• Doctor: *${doc.name}*\n• Date: *${data.visitDate}* (${data.batchSlot})`
          : `✅ *पेमेंट प्राप्त — OPD टोकन कन्फ़र्म*\n\n• टोकन नंबर: *${tokenId}*\n• मरीज़: *${data.patientName}*\n• डॉक्टर: *${doc.name}*\n• तारीख: *${data.visitDate}* (${data.batchSlot})`
      );
      return;
    }
  }

  const payLine = data.payUrl ? `\n\nपेमेंट लिंक:\n${data.payUrl}` : "";
  const retryMsg =
    lang === "en"
      ? `⚠️ Payment has not been completed yet. Please complete the payment first and try again.${payLine}`
      : `⚠️ आपका भुगतान अभी पूरा नहीं हुआ है। कृपया पहले भुगतान करें और फिर दोबारा ट्राई करें।${payLine}`;

  await sendPaymentActionButtons(ctx, retryMsg, lang);
}

module.exports = {
  initiatePaymentOrBooking,
  handleAwaitPaymentStep,
};
