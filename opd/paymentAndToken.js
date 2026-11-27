const { sendMainMenu } = require("./menu");

function toNumberClean(val, fallback = 0) {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  const cleaned = String(val ?? "").replace(/[^0-9.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && cleaned !== "" ? n : fallback;
}

async function initiatePaymentOrBooking(ctx, data, tenDigit, lang = "hi") {
  const doc = data.selectedDoctor || {};
  const opdFee = toNumberClean(doc.opdFee, 0);
  const advCfg = toNumberClean(
    doc.advanceAmount || ctx.business?.advanceAmount || 0,
    0
  );
  const payableAmount =
    advCfg > 0 && advCfg < opdFee ? advCfg : opdFee > 0 ? opdFee : 0;

  const bookingPayload = {
    lang,
    selectedDoctor: doc,
    dayInfo: data.dayInfo,
    visitDate: data.visitDate,
    batchSlot: data.batchSlot,
    patientName: data.patientName,
    patientAge: data.patientAge,
    patientPhone: tenDigit,
    opdFee,
    payableAmount,
  };

  if (payableAmount > 0 && typeof ctx.createRazorpayLink === "function") {
    try {
      const sheetId = String(ctx.business?.sheetId || "").trim();
      const linkRes = await ctx.createRazorpayLink({
        amount: payableAmount,
        customerName: data.patientName,
        customerPhone: tenDigit,
        description: `${doc.name || "OPD"} - ${data.visitDate}`,
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
          ""
      ).trim();
      const payUrl = String(
        linkRes?.paymentLink ||
          linkRes?.payment_url ||
          linkRes?.link_url ||
          linkRes?.url ||
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

        await ctx.sendText(
          lang === "en"
            ? `💳 *Complete Payment to Confirm Token*\n\n` +
              `• Patient: *${data.patientName}* (${data.patientAge} yrs)\n` +
              `• Doctor: *${doc.name}*\n` +
              `• Date: *${data.visitDate}* | *${data.batchSlot}*\n` +
              `• Amount to Pay: *₹${payableAmount}*\n\n` +
              `Pay here: ${payUrl}\n\n` +
              `Once paid, your token will be sent automatically.`
            : `💳 *टोकन कन्फ़र्म करने के लिए पेमेंट करें*\n\n` +
              `• मरीज़: *${data.patientName}* (${data.patientAge} वर्ष)\n` +
              `• डॉक्टर: *${doc.name}*\n` +
              `• तारीख: *${data.visitDate}* | *${data.batchSlot}*\n` +
              `• देय राशि: *₹${payableAmount}*\n\n` +
              `पेमेंट लिंक: ${payUrl}\n\n` +
              `पेमेंट होते ही आपका टोकन अपने आप भेज दिया जाएगा।`
        );
        return;
      }

      await ctx.sendText(
        lang === "en"
          ? `⚠️ *Payment Link Error*\nAmount: ₹${payableAmount}\nCould not generate payment link right now.`
          : `⚠️ *पेमेंट लिंक बनाने में समस्या*\nराशि: ₹${payableAmount}\nअभी पेमेंट लिंक नहीं बन पाया।`
      );
      return;
    } catch (err) {
      console.error("Payment link creation error:", err);
      await ctx.sendText(
        lang === "en"
          ? `⚠️ Could not create payment link for ₹${payableAmount}.`
          : `⚠️ ₹${payableAmount} का पेमेंट लिंक नहीं बन सका।`
      );
      return;
    }
  }

  if (typeof ctx.recordPaidBookingAndLog === "function") {
    const tokenId = `OPD_${Date.now().toString().slice(-4)}`;
    await ctx.recordPaidBookingAndLog({
      tokenId,
      patientName: data.patientName,
      patientAge: data.patientAge,
      patientPhone: tenDigit,
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
        ? `✅ *OPD Token Booked*\n• Token: *${tokenId}*\n• Patient: *${data.patientName}*\n• Doctor: *${doc.name}*\n• Date: *${data.visitDate}* (${data.batchSlot})`
        : `✅ *OPD टोकन बुक हो गया*\n• टोकन: *${tokenId}*\n• मरीज़: *${data.patientName}*\n• डॉक्टर: *${doc.name}*\n• तारीख: *${data.visitDate}* (${data.batchSlot})`
    );
    return;
  }

  ctx.clearSession(true);
  await sendMainMenu(ctx, lang);
}

async function handleAwaitPaymentStep(ctx, data, lang = "hi") {
  const orderId = String(data.orderId || "").trim();
  if (orderId && typeof ctx.checkCashfreePaymentStatus === "function") {
    const statusRes = await ctx.checkCashfreePaymentStatus({ orderId });
    if (statusRes?.status === "PAID") {
      await ctx.sendText(
        lang === "en"
          ? "✅ Payment verified! Confirming your token..."
          : "✅ पेमेंट कन्फ़र्म हो गया है! आपका टोकन भेजा जा रहा है..."
      );
      return;
    }
  }

  await ctx.sendText(
    lang === "en"
      ? `⏳ Payment is still pending${data.payUrl ? `:\n${data.payUrl}` : "."}`
      : `⏳ आपका पेमेंट अभी पेंडिंग है${data.payUrl ? `:\n${data.payUrl}` : "।"}`
  );
}

module.exports = {
  initiatePaymentOrBooking,
  handleAwaitPaymentStep,
};
