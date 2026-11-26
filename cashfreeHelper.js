function getCashfreeBaseUrl() {
  const env = String(process.env.CASHFREE_ENV || "sandbox")
    .trim()
    .toLowerCase();
  return env === "production" || env === "prod"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
}

async function createCashfreeLink({
  amountInRupees,
  tokenId,
  patientName,
  phone,
  description,
  spreadsheetId = "",
  businessName = "OPD Clinic",
  cashfreeAppId = "",
  cashfreeSecretKey = "",
}) {
  const appId = String(cashfreeAppId || "").trim();
  const secretKey = String(cashfreeSecretKey || "").trim();

  // क्लाइंट की अपनी Cashfree API key न होने पर लिंक नहीं बनेगा (Pay at Counter)
  if (!appId || !secretKey || Number(amountInRupees || 0) <= 0) {
    return null;
  }

  const cleanPhone =
    String(phone || "").replace(/\D/g, "").slice(-10) || "9999999999";
  const safeToken = String(tokenId || "OPD").replace(/[^a-zA-Z0-9_-]/g, "");
  const linkId = `${safeToken}_${Date.now()}`;
  const webhookUrl = String(process.env.CASHFREE_WEBHOOK_URL || "").trim();

  const payload = {
    link_id: linkId,
    link_amount: Number(amountInRupees),
    link_currency: "INR",
    link_purpose: String(
      description || `${businessName} Advance (${tokenId})`
    ).slice(0, 100),
    customer_details: {
      customer_name: String(patientName || "Patient").slice(0, 50),
      customer_phone: cleanPhone,
    },
    link_notify: {
      send_sms: false,
      send_email: false,
    },
    link_notes: {
      tokenId: String(tokenId || ""),
      spreadsheetId: String(spreadsheetId || ""),
      patientName: String(patientName || ""),
      patientPhone: cleanPhone,
    },
  };

  if (webhookUrl.startsWith("https://")) {
    payload.link_meta = {
      notify_url: webhookUrl,
    };
  }

  const res = await fetch(`${getCashfreeBaseUrl()}/links`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-version": "2023-08-01",
      "x-client-id": appId,
      "x-client-secret": secretKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok || !data.link_url) {
    console.error("Cashfree Link Error:", data);
    return null;
  }

  return {
    id: data.link_id || linkId,
    shortUrl: data.link_url,
  };
}

async function handleCashfreeWebhook(req, res) {
  try {
    const body = req.body || {};
    const eventType = String(body.type || "").toUpperCase();
    const data = body.data || {};
    const order = data.order || {};
    const payment = data.payment || {};
    const linkNotes =
      order.order_tags ||
      data.link_notes ||
      data.customer_details ||
      {};

    const paymentStatus = String(
      payment.payment_status || order.order_status || ""
    ).toUpperCase();

    const isSuccess =
      eventType.includes("PAYMENT_SUCCESS") ||
      paymentStatus === "SUCCESS" ||
      paymentStatus === "PAID";

    if (!isSuccess) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const tokenId =
      linkNotes.tokenId ||
      String(order.order_id || "").split("_")[0] ||
      "";
    const spreadsheetId =
      linkNotes.spreadsheetId ||
      String(process.env.DEFAULT_CLINIC_SHEET_ID || "").trim();
    const paidAmount = Number(
      payment.payment_amount || order.order_amount || 0
    );
    const cfPaymentId = String(
      payment.cf_payment_id || order.order_id || `CF_${Date.now()}`
    );

    const gasUrl = String(process.env.GAS_WEBAPP_URL || "").trim();
    if (gasUrl && spreadsheetId && tokenId) {
      await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark_payment_paid",
          spreadsheetId,
          tokenId,
          paidAmount,
          razorpayPaymentId: cfPaymentId,
          patientName: linkNotes.patientName || "",
          patientPhone: linkNotes.patientPhone || "",
        }),
      });
    }

    return res.status(200).json({ ok: true, tokenId, paidAmount });
  } catch (err) {
    console.error("Cashfree Webhook Error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

module.exports = {
  createCashfreeLink,
  handleCashfreeWebhook,
};
