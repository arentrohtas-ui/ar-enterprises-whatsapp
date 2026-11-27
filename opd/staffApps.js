const { formatIstYmd } = require("./menu");

// Doctor App और Reception App के आइकन लिंक
const DOCTOR_APP_ICON_URL =
  "https://i.pinimg.com/736x/52/ac/3c/52ac3cf08aeb4ffe3a71970320fcdcb4.jpg";
const RECEPTION_APP_ICON_URL =
  "https://static.vecteezy.com/system/resources/previews/045/357/302/non_2x/reception-service-icon-hotel-outline-symbol-flat-suitable-for-website-logo-app-template-and-ui-design-free-vector.jpg";

function getDefaultIconDataUri(appRole = "reception") {
  const isDoctor = String(appRole).toLowerCase() === "doctor";
  const bg = isDoctor ? "#0d9488" : "#0f62fe";
  const symbol = isDoctor ? "+" : "OPD";
  const svg = isDoctor
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${bg}"/><rect x="220" y="128" width="72" height="256" rx="18" fill="#ffffff"/><rect x="128" y="220" width="256" height="72" rx="18" fill="#ffffff"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${bg}"/><text x="256" y="286" font-family="system-ui,Arial,sans-serif" font-size="136" font-weight="800" fill="#ffffff" text-anchor="middle">${symbol}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function resolveAppIconUrl(appRole = "reception") {
  const isDoctor = String(appRole).toLowerCase() === "doctor";
  const custom = isDoctor
    ? String(DOCTOR_APP_ICON_URL || "").trim()
    : String(RECEPTION_APP_ICON_URL || "").trim();
  if (custom) return custom;
  return getDefaultIconDataUri(appRole);
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

function normalizeBookingsList(rawBookings = []) {
  return (Array.isArray(rawBookings) ? rawBookings : []).map((b) => ({
    ...b,
    Visit_Date: normalizeDateYmd(b.Visit_Date || b.visitDate || ""),
  }));
}

async function findBookingByTokenId(callGas, sheetId, tokenId) {
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

function findClientByBusinessId(clients = [], { businessId = "", sheetId = "" } = {}) {
  const cleanBizId = String(businessId || "").trim().toLowerCase();
  const cleanSheetId = String(sheetId || "").trim();

  if (cleanBizId) {
    const exactMatch = clients.find(
      (c) =>
        String(c.id || "").trim().toLowerCase() === cleanBizId ||
        String(c.opdId || "").trim().toLowerCase() === cleanBizId
    );
    return exactMatch || null;
  }

  if (cleanSheetId) {
    const bySheet = clients.find(
      (c) => String(c.sheetId || "").trim() === cleanSheetId
    );
    return bySheet || null;
  }

  return null;
}

function getExpectedPinForRole(client, role, fallbackPin) {
  const cleanRole = String(role || "").trim().toLowerCase();
  if (cleanRole === "doctor") {
    return String(client?.doctorPin || client?.staffPin || fallbackPin || "").trim();
  }
  if (cleanRole === "reception") {
    return String(
      client?.receptionPin || client?.staffPin || fallbackPin || ""
    ).trim();
  }
  return String(
    client?.doctorPin || client?.receptionPin || client?.staffPin || fallbackPin || ""
  ).trim();
}

function renderStandaloneAppHtml(appRole, businessId = "") {
  const isDoctor = appRole === "doctor";
  const pageTitle = isDoctor ? "Doctor App" : "Reception App";
  const headerIcon = isDoctor ? "🩺" : "💻";
  const subtitleText = isDoctor
    ? "Doctor App — Date Range, Total, Online, Cash, Dues व PDF"
    : "Reception App — Date Range, Total, Online, Cash, Dues व PDF";
  const todayIst = getTodayIstYmd();
  const iconUrl = resolveAppIconUrl(appRole);
  const manifestUrl = `/app-manifest.json?role=${encodeURIComponent(
    appRole
  )}&businessId=${encodeURIComponent(businessId)}`;

  return `<!doctype html>
<html lang="hi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <meta name="theme-color" content="${isDoctor ? "#0d9488" : "#0f62fe"}" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="${pageTitle}${businessId ? ` (${businessId})` : ""}" />
  <link rel="manifest" href="${manifestUrl}" />
  <link rel="icon" href="${iconUrl}" />
  <link rel="apple-touch-icon" href="${iconUrl}" />
  <title>${pageTitle}${businessId ? ` (${businessId})` : ""}</title>
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
      padding: 10px 12px;
      font-size: 13px;
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
    .btn-pdf { background: #111827; color: #fff; }
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

    .container { max-width: 760px; margin: 0 auto; padding: 14px; }
    .filter-box {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 10px;
      margin-bottom: 14px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    @media (min-width: 600px) {
      .filter-box {
        grid-template-columns: 1fr 1fr 1.2fr auto auto;
        align-items: end;
      }
    }
    .f-group label {
      display: block;
      font-size: 11px;
      font-weight: 700;
      color: var(--muted);
      margin-bottom: 4px;
    }
    select, input[type="date"] {
      width: 100%;
      padding: 9px 10px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: #f8fafc;
      font-size: 13.5px;
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
    .banner-big { font-size: 19px; font-weight: 800; }
    .banner-small { font-size: 11px; opacity: 0.92; text-transform: uppercase; }
    .acct-grid {
      width: 100%;
      border-top: 1px solid rgba(255, 255, 255, 0.22);
      padding-top: 10px;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 14px;
    }
    @media (min-width: 520px) {
      .acct-grid {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
    }

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

    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.55);
      z-index: 60;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }
    .modal-box {
      width: 100%;
      max-width: 420px;
      background: var(--card);
      border-radius: 18px;
      padding: 18px;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.22);
    }
    .modal-box h3 { margin: 0 0 6px; font-size: 17px; }
    .modal-box p { margin: 0 0 12px; font-size: 12.5px; color: var(--muted); }
    .opt-section { margin-bottom: 12px; }
    .opt-title { font-size: 12px; font-weight: 700; margin-bottom: 6px; color: var(--text); }
    .opt-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .chk-item {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 13px;
      background: #f8fafc;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px 10px;
      cursor: pointer;
    }
    .chk-item input { margin: 0; cursor: pointer; }

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

  <div id="pdfOptModal" class="modal-backdrop">
    <div class="modal-box">
      <h3>📄 PDF Report Options</h3>
      <p>रिपोर्ट में क्या-क्या देखना है चुनें (कम पेज के लिए Day-wise Summary और बिना Patient Name रखें):</p>

      <div class="opt-section">
        <div class="opt-title">Report Mode</div>
        <select id="pdfModeSelect">
          <option value="daywise">Day-wise Summary (हर दिन की 1 लाइन — कम पेज)</option>
          <option value="detail">Token-wise Detail (हर मरीज़/टोकन की अलग लाइन)</option>
        </select>
      </div>

      <div class="opt-section">
        <div class="opt-title">Columns / Fields</div>
        <div class="opt-grid">
          <label class="chk-item"><input id="optPatientName" type="checkbox" /> Patient Name</label>
          <label class="chk-item"><input id="optDoctor" type="checkbox" checked /> Doctor</label>
          <label class="chk-item"><input id="optFee" type="checkbox" checked /> Fee</label>
          <label class="chk-item"><input id="optOnline" type="checkbox" checked /> Online</label>
          <label class="chk-item"><input id="optCash" type="checkbox" checked /> Cash</label>
          <label class="chk-item"><input id="optDues" type="checkbox" checked /> Dues</label>
        </div>
      </div>

      <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:14px;">
        <button class="btn btn-ghost" onclick="closePdfModal()">रद्द करें</button>
        <button class="btn btn-pdf" onclick="generateConfiguredPdf()">🖨️ PDF बनाएं</button>
      </div>
    </div>
  </div>

  <div id="lockScreen" class="lock-wrap">
    <div class="lock-card">
      <h2>🔐 ${headerIcon} ${pageTitle}</h2>
      <p>${businessId ? `Business ID: <b>${businessId}</b> — ` : ""}${pageTitle} का PIN डालें</p>
      <input id="pinInput" class="pin-input" type="password" inputmode="numeric" maxlength="12" placeholder="••••" />
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
      <div class="filter-box">
        <div class="f-group">
          <label>From Date (से)</label>
          <input id="fromDateFilter" type="date" onchange="renderView()" />
        </div>
        <div class="f-group">
          <label>To Date (तक)</label>
          <input id="toDateFilter" type="date" onchange="renderView()" />
        </div>
        <div class="f-group" style="grid-column: span 2;">
          <label>Doctor (डॉक्टर)</label>
          <select id="doctorFilter" onchange="renderView()">
            <option value="ALL">सभी डॉक्टर / All Doctors</option>
          </select>
        </div>
        <button class="btn btn-ghost" onclick="clearDateFilter()">सब तारीख</button>
        <button class="btn btn-pdf" onclick="openPdfModal()">📄 PDF Report</button>
      </div>

      <div class="banner">
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
        <div class="acct-grid">
          <div>
            <div class="banner-small">TOTAL AMOUNT</div>
            <div id="totalAmountText" class="banner-big">₹0</div>
          </div>
          <div>
            <div class="banner-small">ONLINE</div>
            <div id="totalOnlineText" class="banner-big">₹0</div>
          </div>
          <div>
            <div class="banner-small">CASH</div>
            <div id="totalCashText" class="banner-big">₹0</div>
          </div>
          <div>
            <div class="banner-small">DUES (बाक़ी)</div>
            <div id="totalBalanceText" class="banner-big">₹0</div>
          </div>
        </div>
      </div>

      <div id="mainContent"></div>
    </div>
  </div>

  <script>
    const APP_ROLE = "${appRole}";
    const BUSINESS_ID = "${businessId}";
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

    function splitPaidByChannel(booking) {
      const paid = Math.max(0, Number(booking?.Paid_Amount || 0));
      const explicitCash = Number(booking?.Cash_Amount ?? booking?.cashAmount ?? NaN);
      const explicitOnline = Number(booking?.Online_Amount ?? booking?.onlineAmount ?? NaN);

      if (Number.isFinite(explicitCash) || Number.isFinite(explicitOnline)) {
        const cash = Number.isFinite(explicitCash) ? Math.max(0, explicitCash) : 0;
        const online = Number.isFinite(explicitOnline)
          ? Math.max(0, explicitOnline)
          : Math.max(0, paid - cash);
        return { online, cash };
      }

      const modeText = \`\${booking?.Payment_Mode || ""} \${booking?.Payment_Status || ""}\`.toLowerCase();
      const isCash = modeText.includes("cash");
      if (isCash) {
        return { online: 0, cash: paid };
      }
      return { online: paid, cash: 0 };
    }

    function getFilteredBookings() {
      let fromVal = toYmd(document.getElementById("fromDateFilter").value);
      let toVal = toYmd(document.getElementById("toDateFilter").value);
      const docVal = document.getElementById("doctorFilter").value;

      if (fromVal && toVal && fromVal > toVal) {
        const tmp = fromVal;
        fromVal = toVal;
        toVal = tmp;
      }

      const list = state.bookings
        .filter((b) => {
          const vDate = toYmd(b.Visit_Date);
          const matchFrom = !fromVal || (vDate && vDate >= fromVal);
          const matchTo = !toVal || (vDate && vDate <= toVal);
          const matchDoc = docVal === "ALL" || String(b.Doctor_Name || "").trim() === docVal;
          return matchFrom && matchTo && matchDoc;
        })
        .sort((a, b) => {
          const da = toYmd(a.Visit_Date);
          const db = toYmd(b.Visit_Date);
          if (da !== db) return da < db ? -1 : 1;
          return String(a.Token_ID || "").localeCompare(String(b.Token_ID || ""));
        });

      return { list, fromVal, toVal, docVal };
    }

    function showToast(msg) {
      const el = document.getElementById("toast");
      el.textContent = msg;
      el.style.display = "block";
      clearTimeout(window._t);
      window._t = setTimeout(() => { el.style.display = "none"; }, 3200);
    }

    function clearDateFilter() {
      document.getElementById("fromDateFilter").value = "";
      document.getElementById("toDateFilter").value = "";
      renderView();
    }

    function openPdfModal() {
      const { list } = getFilteredBookings();
      if (!list.length) {
        showToast("इस Date Range में कोई डेटा नहीं है");
        return;
      }
      document.getElementById("pdfOptModal").style.display = "flex";
    }

    function closePdfModal() {
      document.getElementById("pdfOptModal").style.display = "none";
    }

    function buildQuery() {
      const params = new URLSearchParams();
      if (BUSINESS_ID) params.set("businessId", BUSINESS_ID);
      if (APP_ROLE) params.set("role", APP_ROLE);
      if (state.clinic?.sheetId) params.set("sheetId", state.clinic.sheetId);
      const q = params.toString();
      return q ? \`?\${q}\` : "";
    }

    async function unlockApp() {
      const pin = document.getElementById("pinInput").value.trim();
      const r = await fetch("/api/app/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, businessId: BUSINESS_ID, role: APP_ROLE }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        showToast(d.error || "गलत PIN");
        return;
      }
      PIN = pin;
      document.getElementById("lockScreen").style.display = "none";
      document.getElementById("appShell").style.display = "block";
      document.getElementById("fromDateFilter").value = "";
      document.getElementById("toDateFilter").value = "";
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
      const r = await fetch(\`/api/app/data\${buildQuery()}\`, {
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
          businessId: BUSINESS_ID || state.clinic?.id,
          role: APP_ROLE,
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
      const entered = prompt(\`टोकन \${tokenId} के लिए Cash Deposit राशि (₹) डालें (Dues: ₹\${currentBalance}):\`, defaultAmt);
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
          businessId: BUSINESS_ID || state.clinic?.id,
          role: APP_ROLE,
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
      } else {
        state.bookings = state.bookings.map((b) => {
          if (String(b.Token_ID || "") !== String(tokenId)) return b;
          const nextPaid = Number(b.Paid_Amount || 0) + amt;
          const prevCash = Number(b.Cash_Amount || 0);
          const modeLower = String(b.Payment_Mode || "").toLowerCase();
          const nextCash = modeLower.includes("cash") || prevCash > 0 ? prevCash + amt : amt;
          return {
            ...b,
            Paid_Amount: nextPaid,
            Cash_Amount: nextCash,
            Payment_Mode: b.Payment_Mode || "Cash",
          };
        });
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
          businessId: BUSINESS_ID || state.clinic?.id,
          role: APP_ROLE,
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

    function escapeHtml(str) {
      return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function generateConfiguredPdf() {
      const { list, fromVal, toVal, docVal } = getFilteredBookings();
      if (!list.length) {
        showToast("इस Date Range में कोई डेटा नहीं है");
        closePdfModal();
        return;
      }

      const mode = document.getElementById("pdfModeSelect").value;
      const showPatientName = document.getElementById("optPatientName").checked;
      const showDoctor = document.getElementById("optDoctor").checked;
      const showFee = document.getElementById("optFee").checked;
      const showOnline = document.getElementById("optOnline").checked;
      const showCash = document.getElementById("optCash").checked;
      const showDues = document.getElementById("optDues").checked;

      closePdfModal();

      let sumTotal = 0;
      let sumOnline = 0;
      let sumCash = 0;
      let sumDues = 0;

      const dayMap = new Map();
      list.forEach((b) => {
        const vDate = toYmd(b.Visit_Date) || "—";
        const fee = Math.max(0, Number(b.OPD_Fee || 0));
        const paid = Math.max(0, Number(b.Paid_Amount || 0));
        const dues = Math.max(0, fee - paid);
        const { online, cash } = splitPaidByChannel(b);

        sumTotal += fee;
        sumOnline += online;
        sumCash += cash;
        sumDues += dues;

        if (!dayMap.has(vDate)) {
          dayMap.set(vDate, {
            date: vDate,
            count: 0,
            doctors: new Set(),
            fee: 0,
            online: 0,
            cash: 0,
            dues: 0,
          });
        }
        const dRec = dayMap.get(vDate);
        dRec.count += 1;
        if (b.Doctor_Name) dRec.doctors.add(String(b.Doctor_Name).trim());
        dRec.fee += fee;
        dRec.online += online;
        dRec.cash += cash;
        dRec.dues += dues;
      });

      const cols = [];
      cols.push({ key: "date", label: "Date", align: "left" });
      if (mode === "daywise") {
        cols.push({ key: "patients", label: "Patients", align: "center" });
      } else {
        cols.push({ key: "token", label: "Token", align: "left" });
        if (showPatientName) {
          cols.push({ key: "patient", label: "Patient Name", align: "left" });
        }
      }
      if (showDoctor) cols.push({ key: "doctor", label: "Doctor", align: "left" });
      if (showFee) cols.push({ key: "fee", label: "Fee", align: "right" });
      if (showOnline) cols.push({ key: "online", label: "Online", align: "right" });
      if (showCash) cols.push({ key: "cash", label: "Cash", align: "right" });
      if (showDues) cols.push({ key: "dues", label: "Dues", align: "right" });

      const headHtml = cols
        .map((c) => \`<th style="text-align:\${c.align};">\${c.label}</th>\`)
        .join("");

      let bodyRowsHtml = "";
      if (mode === "daywise") {
        bodyRowsHtml = [...dayMap.values()]
          .map((dRec) => {
            const cells = cols.map((c) => {
              if (c.key === "date") return \`<td style="text-align:left;"><b>\${escapeHtml(dRec.date)}</b></td>\`;
              if (c.key === "patients") return \`<td style="text-align:center;">\${dRec.count}</td>\`;
              if (c.key === "doctor") return \`<td style="text-align:left;">\${escapeHtml([...dRec.doctors].join(", ") || "—")}</td>\`;
              if (c.key === "fee") return \`<td style="text-align:right;">₹\${dRec.fee}</td>\`;
              if (c.key === "online") return \`<td style="text-align:right;">₹\${dRec.online}</td>\`;
              if (c.key === "cash") return \`<td style="text-align:right;">₹\${dRec.cash}</td>\`;
              if (c.key === "dues") return \`<td style="text-align:right;color:\${dRec.dues > 0 ? '#b91c1c' : '#15803d'};"><b>₹\${dRec.dues}</b></td>\`;
              return "<td>—</td>";
            });
            return \`<tr>\${cells.join("")}</tr>\`;
          })
          .join("");
      } else {
        bodyRowsHtml = list
          .map((b) => {
            const fee = Math.max(0, Number(b.OPD_Fee || 0));
            const paid = Math.max(0, Number(b.Paid_Amount || 0));
            const dues = Math.max(0, fee - paid);
            const { online, cash } = splitPaidByChannel(b);
            const patientLabel = \`\${b.Patient_Name || ""}\${b.Patient_Age ? \` (\${b.Patient_Age}y)\` : ""}\`;

            const cells = cols.map((c) => {
              if (c.key === "date") return \`<td style="text-align:left;">\${escapeHtml(toYmd(b.Visit_Date))}</td>\`;
              if (c.key === "token") return \`<td style="text-align:left;"><b>\${escapeHtml(b.Token_ID)}</b></td>\`;
              if (c.key === "patient") return \`<td style="text-align:left;">\${escapeHtml(patientLabel)}</td>\`;
              if (c.key === "doctor") return \`<td style="text-align:left;">\${escapeHtml(b.Doctor_Name)}</td>\`;
              if (c.key === "fee") return \`<td style="text-align:right;">₹\${fee}</td>\`;
              if (c.key === "online") return \`<td style="text-align:right;">₹\${online}</td>\`;
              if (c.key === "cash") return \`<td style="text-align:right;">₹\${cash}</td>\`;
              if (c.key === "dues") return \`<td style="text-align:right;color:\${dues > 0 ? '#b91c1c' : '#15803d'};"><b>₹\${dues}</b></td>\`;
              return "<td>—</td>";
            });
            return \`<tr>\${cells.join("")}</tr>\`;
          })
          .join("");
      }

      const footCells = cols.map((c, idx) => {
        if (idx === 0) return \`<td style="text-align:left;">TOTAL</td>\`;
        if (mode === "daywise" && c.key === "patients") {
          return \`<td style="text-align:center;">\${list.length}</td>\`;
        }
        if (c.key === "fee") return \`<td style="text-align:right;">₹\${sumTotal}</td>\`;
        if (c.key === "online") return \`<td style="text-align:right;">₹\${sumOnline}</td>\`;
        if (c.key === "cash") return \`<td style="text-align:right;">₹\${sumCash}</td>\`;
        if (c.key === "dues") return \`<td style="text-align:right;">₹\${sumDues}</td>\`;
        return "<td></td>";
      });

      const rangeLabel =
        fromVal || toVal
          ? \`\${fromVal || "शुरू"} से \${toVal || "आज तक"}\`
          : "सभी तारीख (All Dates)";
      const clinicName = escapeHtml(state.clinic?.name || BUSINESS_ID || "OPD Clinic");
      const doctorLabel = docVal === "ALL" ? "सभी डॉक्टर (All Doctors)" : escapeHtml(docVal);

      const printWin = window.open("", "_blank");
      if (!printWin) {
        showToast("Pop-up blocked — ब्राउज़र में Pop-up Allow करें");
        return;
      }

      printWin.document.write(\`<!doctype html>
<html lang="hi">
<head>
  <meta charset="utf-8" />
  <title>\${clinicName} — OPD Report (\${rangeLabel})</title>
  <style>
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 16px; color: #111827; }
    .hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f62fe; padding-bottom: 10px; margin-bottom: 12px; }
    .hdr h1 { margin: 0 0 4px; font-size: 18px; color: #0f172a; }
    .hdr p { margin: 2px 0; font-size: 12px; color: #475569; }
    .cards { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin-bottom: 12px; }
    .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 6px 8px; background: #f8fafc; }
    .card span { display: block; font-size: 10px; color: #475569; text-transform: uppercase; font-weight: 700; }
    .card b { font-size: 14px; color: #0f172a; }
    table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
    th, td { border: 1px solid #cbd5e1; padding: 5px 7px; }
    th { background: #0f62fe; color: #fff; font-weight: 700; }
    tr:nth-child(even) { background: #f8fafc; }
    tfoot td { background: #e2e8f0; font-weight: 800; }
    @media print {
      .no-print { display: none; }
      body { margin: 6mm; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="margin-bottom:10px;text-align:right;">
    <button onclick="window.print()" style="background:#0f62fe;color:#fff;border:none;padding:8px 14px;border-radius:8px;font-weight:700;cursor:pointer;">🖨️ Print / Save as PDF</button>
  </div>
  <div class="hdr">
    <div>
      <h1>\${clinicName} — \${mode === "daywise" ? "Day-wise Summary Report" : "Token-wise OPD Report"}</h1>
      <p><b>Date Range:</b> \${rangeLabel} | <b>Doctor:</b> \${doctorLabel}</p>
    </div>
    <div style="text-align:right;">
      <p><b>Generated:</b> \${TODAY_IST}</p>
      <p><b>ID:</b> \${escapeHtml(BUSINESS_ID || state.clinic?.id || "")}</p>
    </div>
  </div>

  <div class="cards">
    <div class="card"><span>Total Patients</span><b>\${list.length}</b></div>
    <div class="card"><span>Total Amount</span><b>₹\${sumTotal}</b></div>
    <div class="card"><span>Online</span><b>₹\${sumOnline}</b></div>
    <div class="card"><span>Cash</span><b>₹\${sumCash}</b></div>
    <div class="card"><span>Dues</span><b style="color:#b91c1c;">₹\${sumDues}</b></div>
  </div>

  <table>
    <thead><tr>\${headHtml}</tr></thead>
    <tbody>\${bodyRowsHtml}</tbody>
    <tfoot><tr>\${footCells.join("")}</tr></tfoot>
  </table>
  <script>
    window.onload = function() { setTimeout(function() { window.print(); }, 300); };
  </script>
</body>
</html>\`);
      printWin.document.close();
    }

    function renderView() {
      const { list, docVal } = getFilteredBookings();

      const running = list.find(
        (b) => String(b.Queue_Status || "").trim().toLowerCase() === "in consultation"
      );
      const waitingList = list.filter(
        (b) => String(b.Queue_Status || "Waiting").trim().toLowerCase() === "waiting"
      );

      let sumTotal = 0;
      let sumOnline = 0;
      let sumCash = 0;
      let sumDues = 0;

      list.forEach((b) => {
        const fee = Math.max(0, Number(b.OPD_Fee || 0));
        const paid = Math.max(0, Number(b.Paid_Amount || 0));
        const { online, cash } = splitPaidByChannel(b);
        sumTotal += fee;
        sumOnline += online;
        sumCash += cash;
        sumDues += Math.max(0, fee - paid);
      });

      document.getElementById("currentTokenText").textContent =
        running ? \`\${running.Token_ID} (\${running.Patient_Name})\` : "कोई नहीं / None";
      document.getElementById("waitingCountText").textContent = String(waitingList.length);
      document.getElementById("totalPatientsText").textContent = String(list.length);
      document.getElementById("totalAmountText").textContent = \`₹\${sumTotal}\`;
      document.getElementById("totalOnlineText").textContent = \`₹\${sumOnline}\`;
      document.getElementById("totalCashText").textContent = \`₹\${sumCash}\`;
      document.getElementById("totalBalanceText").textContent = \`₹\${sumDues}\`;

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
        html += \`<div class="q-card" style="text-align:center;color:#525252;">इस Date Range / डॉक्टर के लिए कोई बुकिंग नहीं मिली।</div>\`;
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
          const opdFee = Math.max(0, Number(b.OPD_Fee || 0));
          const paidAmt = Math.max(0, Number(b.Paid_Amount || 0));
          const balanceAmt = Math.max(0, opdFee - paidAmt);
          const { online, cash } = splitPaidByChannel(b);

          const metaLine = \`👨‍⚕️ <b>\${b.Doctor_Name || ""}</b> | 📅 \${visitYmd} | ⏰ \${b.Batch_Slot || ""}<br>📱 \${b.Patient_Phone || ""} | 💳 \${b.Payment_Status || "Paid"}<br>💰 Total: <b>₹\${opdFee}</b> | Online: <b>₹\${online}</b> | Cash: <b>₹\${cash}</b> | Dues: <b style="color:\${balanceAmt > 0 ? '#c5221f' : '#137333'}">₹\${balanceAmt}</b>\`;

          const disAttr = lockedPast ? "disabled" : "";
          const cashBtnHtml = APP_ROLE === "reception"
            ? \`<button class="btn btn-cash" \${disAttr} onclick="handleCashDeposit('\${tId}', \${balanceAmt}, '\${visitYmd}')">💵 Cash Deposit (Dues: ₹\${balanceAmt})</button>\`
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

function registerOpdStaffAppRoutes(app, deps) {
  const {
    staffAppPin,
    callGas,
    getActiveClients,
    resolveBusiness,
    sendTwoAheadAlertIfNeeded,
  } = deps;

  async function verifyStaffRequest(req, expectedRole = "") {
    const pin = String(
      req.headers["x-staff-pin"] || req.query.pin || req.body?.pin || ""
    ).trim();
    if (!pin) return { ok: false, error: "PIN आवश्यक है" };

    const businessId = String(
      req.body?.businessId ||
        req.body?.opdId ||
        req.query.businessId ||
        req.query.opdId ||
        req.headers["x-business-id"] ||
        ""
    ).trim();
    const sheetId = String(
      req.body?.sheetId || req.query.sheetId || ""
    ).trim();
    const role = String(
      expectedRole || req.body?.role || req.query.role || ""
    ).trim();

    let clients = [];
    try {
      clients = await getActiveClients();
    } catch (_) {}

    const targetClient = findClientByBusinessId(clients, {
      businessId,
      sheetId,
    });
    if (!targetClient) {
      return { ok: false, error: "Business ID नहीं मिली" };
    }

    const validPin = getExpectedPinForRole(targetClient, role, staffAppPin);
    if (pin !== validPin) {
      return { ok: false, error: "गलत PIN / Invalid PIN" };
    }
    return { ok: true, client: targetClient };
  }

  app.get("/app-manifest.json", (req, res) => {
    const role =
      String(req.query.role || "reception").trim().toLowerCase() === "doctor"
        ? "doctor"
        : "reception";
    const bizId = String(req.query.businessId || "").trim();
    const isDoctor = role === "doctor";
    const appName = `${isDoctor ? "Doctor App" : "Reception App"}${
      bizId ? ` - ${bizId}` : ""
    }`;
    const startUrl = bizId
      ? `/${role}-app/${encodeURIComponent(bizId)}`
      : `/${role}-app`;
    const iconUrl = resolveAppIconUrl(role);

    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    res.json({
      name: appName,
      short_name: appName.slice(0, 24),
      start_url: startUrl,
      scope: "/",
      display: "standalone",
      background_color: "#f3f6fb",
      theme_color: isDoctor ? "#0d9488" : "#0f62fe",
      icons: [
        {
          src: iconUrl,
          sizes: "192x192",
          type: iconUrl.startsWith("data:image/svg+xml")
            ? "image/svg+xml"
            : "image/png",
          purpose: "any maskable",
        },
        {
          src: iconUrl,
          sizes: "512x512",
          type: iconUrl.startsWith("data:image/svg+xml")
            ? "image/svg+xml"
            : "image/png",
          purpose: "any maskable",
        },
      ],
    });
  });

  app.post("/api/app/login", async (req, res) => {
    const check = await verifyStaffRequest(req);
    if (!check.ok) {
      return res.status(401).json({ ok: false, error: check.error });
    }
    return res.status(200).json({
      ok: true,
      today: getTodayIstYmd(),
      businessId: check.client?.id || "",
    });
  });

  app.get("/api/app/data", async (req, res) => {
    try {
      const check = await verifyStaffRequest(req);
      if (!check.ok) {
        return res.status(401).json({ ok: false, error: check.error });
      }
      const clients = await getActiveClients();
      const activeClient = check.client;

      if (!activeClient?.sheetId) {
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
      const check = await verifyStaffRequest(req);
      if (!check.ok) {
        return res.status(401).json({ ok: false, error: check.error });
      }

      const { sheetId, tokenId, queueStatus } = req.body || {};
      const targetSheetId = String(sheetId || check.client?.sheetId || "").trim();
      if (!targetSheetId || !tokenId || !queueStatus) {
        return res
          .status(400)
          .json({ ok: false, error: "sheetId, tokenId, queueStatus required" });
      }

      const existingBooking = await findBookingByTokenId(
        callGas,
        targetSheetId,
        tokenId
      );
      if (existingBooking && isPastDateYmd(existingBooking.Visit_Date)) {
        return res.status(403).json({
          ok: false,
          error: "पिछले दिन (Past Date) के रिकॉर्ड में बदलाव की अनुमति नहीं है।",
        });
      }

      const gasRes = await callGas("POST", {
        action: "update_queue_status",
        spreadsheetId: targetSheetId,
        spreadsheet_id: targetSheetId,
        tokenId: String(tokenId).trim(),
        queueStatus: String(queueStatus).trim(),
      });

      let notifiedToken = null;
      if (
        String(queueStatus).trim().toLowerCase() === "in consultation" &&
        gasRes?.alert2Ahead
      ) {
        const business = await resolveBusiness("", targetSheetId);
        notifiedToken = await sendTwoAheadAlertIfNeeded(
          business,
          targetSheetId,
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
      const check = await verifyStaffRequest(req, "reception");
      if (!check.ok) {
        return res.status(401).json({ ok: false, error: check.error });
      }

      const { sheetId, tokenId, amount } = req.body || {};
      const targetSheetId = String(sheetId || check.client?.sheetId || "").trim();
      const depositAmount = Number(amount);
      if (
        !targetSheetId ||
        !tokenId ||
        !Number.isFinite(depositAmount) ||
        depositAmount <= 0
      ) {
        return res.status(400).json({
          ok: false,
          error: "Valid sheetId, tokenId, and amount required",
        });
      }

      const existingBooking = await findBookingByTokenId(
        callGas,
        targetSheetId,
        tokenId
      );
      if (existingBooking && isPastDateYmd(existingBooking.Visit_Date)) {
        return res.status(403).json({
          ok: false,
          error:
            "पिछले दिन (Past Date) के रिकॉर्ड में Cash Deposit नहीं किया जा सकता।",
        });
      }

      const gasRes = await callGas("POST", {
        action: "record_cash_deposit",
        spreadsheetId: targetSheetId,
        spreadsheet_id: targetSheetId,
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
      const check = await verifyStaffRequest(req, "doctor");
      if (!check.ok) {
        return res.status(401).json({ ok: false, error: check.error });
      }

      const { sheetId, doctorId, doctorName, dayKey, avail } = req.body || {};
      const targetSheetId = String(sheetId || check.client?.sheetId || "").trim();
      if (!targetSheetId || !dayKey || !avail) {
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
        spreadsheetId: targetSheetId,
        spreadsheet_id: targetSheetId,
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

  const missingIdHtml = `<!doctype html>
  <html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Invalid Link</title></head>
  <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f3f6fb;margin:0;padding:20px;text-align:center;">
    <div style="background:#fff;padding:28px;border-radius:16px;box-shadow:0 4px 20px rgba(0,0,0,0.08);max-width:360px;">
      <h2 style="color:#c5221f;margin:0 0 10px;">⚠️ अधूरा लिंक (Invalid URL)</h2>
      <p style="color:#525252;font-size:14px;line-height:1.5;margin:0;">बिना Business ID के ऐप नहीं खुल सकता। कृपया अपने क्लिनिक का सही लिंक इस्तेमाल करें।</p>
    </div>
  </body></html>`;

  app.get("/reception-app", (req, res) => {
    const bizId = String(req.query.businessId || req.query.opdId || "").trim();
    if (!bizId) return res.status(400).send(missingIdHtml);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderStandaloneAppHtml("reception", bizId));
  });

  app.get("/reception-app/:businessId", (req, res) => {
    const bizId = String(req.params.businessId || "").trim();
    if (!bizId) return res.status(400).send(missingIdHtml);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderStandaloneAppHtml("reception", bizId));
  });

  app.get("/doctor-app", (req, res) => {
    const bizId = String(req.query.businessId || req.query.opdId || "").trim();
    if (!bizId) return res.status(400).send(missingIdHtml);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderStandaloneAppHtml("doctor", bizId));
  });

  app.get("/doctor-app/:businessId", (req, res) => {
    const bizId = String(req.params.businessId || "").trim();
    if (!bizId) return res.status(400).send(missingIdHtml);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderStandaloneAppHtml("doctor", bizId));
  });

  app.get("/app", (req, res) => {
    const bizId = String(req.query.businessId || req.query.opdId || "").trim();
    if (!bizId) return res.status(400).send(missingIdHtml);
    res.redirect(`/reception-app/${encodeURIComponent(bizId)}`);
  });
}

module.exports = {
  registerOpdStaffAppRoutes,
};
