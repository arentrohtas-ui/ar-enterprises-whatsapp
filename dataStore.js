const userSessions = new Map();

function buildSessionKey(businessId, customerPhone) {
  const biz = String(businessId || "default_opd").trim();
  const phone = String(customerPhone || "system").trim();
  return `${biz}:${phone}`;
}

function getUserState(businessId, customerPhone) {
  const key = buildSessionKey(businessId, customerPhone);
  return (
    userSessions.get(key) || {
      lang: "hi",
      step: null,
      data: {},
    }
  );
}

function setUserState(businessId, customerPhone, patch = {}) {
  const key = buildSessionKey(businessId, customerPhone);
  const current = getUserState(businessId, customerPhone);
  const updated = {
    ...current,
    ...patch,
    data: patch.data ? { ...current.data, ...patch.data } : current.data,
  };
  userSessions.set(key, updated);
  return updated;
}

function clearUserState(businessId, customerPhone, keepLang = true) {
  const current = getUserState(businessId, customerPhone);
  const reset = {
    lang: keepLang ? current.lang || "hi" : "hi",
    step: null,
    data: {},
  };
  userSessions.set(buildSessionKey(businessId, customerPhone), reset);
  return reset;
}

function resolveTargetSheetId(ctx, payload = {}) {
  return String(
    payload.spreadsheetId ||
      ctx?.business?.sheetId ||
      ctx?.tenant?.sheetId ||
      ""
  ).trim();
}

async function saveBusinessData(ctx, payload = {}) {
  if (!ctx?.sheetUrl) return { ok: false, error: "Missing sheetUrl" };

  const biz = ctx.business || ctx.tenant || {};
  const targetSheetId = resolveTargetSheetId(ctx, payload);

  const body = {
    ...(targetSheetId ? { spreadsheetId: targetSheetId } : {}),
    businessId: biz.id || "",
    businessName: biz.name || "",
    phoneNumberId: biz.phoneId || "",
    customerPhone: ctx.from || "",
    category: biz.sector || "opd",
    sector: biz.sector || "opd",
    ...payload,
  };

  try {
    const res = await fetch(ctx.sheetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (err) {
    console.error("saveBusinessData error:", err.message);
    return { ok: false, error: err.message };
  }
}

async function fetchBusinessData(ctx, params = {}) {
  if (!ctx?.sheetUrl) return { ok: false, error: "Missing sheetUrl" };

  const biz = ctx.business || ctx.tenant || {};
  const targetSheetId = String(
    params.spreadsheet_id || biz.sheetId || ""
  ).trim();

  const qs = new URLSearchParams({
    business_id: biz.id || "",
    phone_number_id: biz.phoneId || "",
    customer_phone: ctx.from || "",
    ...(targetSheetId ? { spreadsheet_id: targetSheetId } : {}),
    ...params,
  });

  try {
    const res = await fetch(`${ctx.sheetUrl}?${qs.toString()}`);
    return await res.json();
  } catch (err) {
    console.error("fetchBusinessData error:", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  getUserState,
  setUserState,
  clearUserState,
  saveBusinessData,
  fetchBusinessData,
};
