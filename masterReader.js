function cleanSecretVal(v) {
  const s = String(v ?? "").trim();
  if (!s || s.toLowerCase() === "undefined" || s.toLowerCase() === "null") {
    return "";
  }
  return s;
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
  const paymentMode = cleanSecretVal(
    raw.Payment_Mode ?? raw.paymentMode ?? raw.Cashfree_Env ?? raw.cashfreeEnv
  ).toLowerCase();

  const businessId = String(
    raw.Business_ID || raw.businessId || raw.id || ""
  ).trim();
  const opdId = String(
    raw.OPD_ID || raw.opdId || raw.Opd_Id || businessId || ""
  ).trim();
  const fallbackPin =
    cleanSecretVal(raw.Staff_PIN ?? raw.staffPin) ||
    String(process.env.STAFF_APP_PIN || "1234").trim();

  return {
    id: businessId,
    opdId,
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
    paymentMode:
      paymentMode === "sandbox" || paymentMode === "production"
        ? paymentMode
        : "",
    doctorPin: cleanSecretVal(raw.Doctor_PIN ?? raw.doctorPin) || fallbackPin,
    receptionPin:
      cleanSecretVal(raw.Reception_PIN ?? raw.receptionPin) || fallbackPin,
    staffPin: fallbackPin,
    advanceAmount: Number(
      raw.Advance_Amount ??
        raw.advanceAmount ??
        process.env.DEFAULT_ADVANCE_AMOUNT ??
        0
    ),
    status: String(raw.Status || raw.status || "ACTIVE").trim().toUpperCase(),
  };
}

function createMasterReader({ gasWebappUrl }) {
  async function callGas(method = "GET", paramsOrBody = {}) {
    if (!gasWebappUrl) {
      return { ok: false, error: "GAS_WEBAPP_URL missing" };
    }
    if (method === "GET") {
      const url = new URL(gasWebappUrl);
      Object.entries(paramsOrBody).forEach(([k, v]) => {
        if (v !== undefined && v !== null && String(v) !== "") {
          url.searchParams.set(k, String(v));
        }
      });
      const r = await fetch(url.toString());
      return r.json();
    }
    const r = await fetch(gasWebappUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(paramsOrBody),
    });
    return r.json();
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

  return {
    callGas,
    getActiveClients,
    resolveBusiness,
  };
}

module.exports = {
  cleanSecretVal,
  normalizeClientRow,
  createMasterReader,
};
