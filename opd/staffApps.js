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
    ? "Doctor App — Live Queue व Day/Patient Report"
    : "Reception App — Live Queue, Cash Deposit व Day/Patient Report";
  const todayIst = getTodayIstYmd();
  const iconUrl = resolveAppIconUrl(appRole);
  const manifestUrl =
    "/app-manifest.json?role=" +
    encodeURIComponent(appRole) +
    "&businessId=" +
    encodeURIComponent(businessId);
  const primaryColor = isDoctor ? "#0d9488" : "#0f62fe";
  const primaryDark = isDoctor ? "#0f766e" : "#0043ce";
  const safeBizId = String(businessId || "").replace(/[<>"'&]/g, "");

  return [
    "<!doctype html>",
    '<html lang="hi">',
    "<head>",
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />',
    '  <meta name="theme-color" content="' + primaryColor + '" />',
    '  <meta name="apple-mobile-web-app-capable" content="yes" />',
    '  <meta name="apple-mobile-web-app-title" content="' + pageTitle + (safeBizId ? " (" + safeBizId + ")" : "") + '" />',
    '  <link rel="manifest" href="' + manifestUrl + '" />',
    '  <link rel="icon" href="' + iconUrl + '" />',
    '  <link rel="apple-touch-icon" href="' + iconUrl + '" />',
    "  <title>" + pageTitle + (safeBizId ? " (" + safeBizId + ")" : "") + "</title>",
    "  <style>",
    "    :root {",
    "      --bg: #f3f6fb;",
    "      --card: #ffffff;",
    "      --primary: " + primaryColor + ";",
    "      --primary-dark: " + primaryDark + ";",
    "      --text: #161616;",
    "      --muted: #525252;",
    "      --border: #e0e6ed;",
    "      --wait: #fff4e5;",
    "      --wait-t: #9a5200;",
    "      --live: #e6f4ea;",
    "      --live-t: #137333;",
    "      --done: #eef2ff;",
    "      --done-t: #3730a3;",
    "    }",
    "    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }",
    "    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: var(--bg); color: var(--text); padding-bottom: 44px; }",
    "    .lock-wrap { min-height: 100dvh; display: flex; align-items: center; justify-content: center; padding: 20px; }",
    "    .lock-card { width: 100%; max-width: 360px; background: var(--card); border-radius: 20px; padding: 28px 22px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); text-align: center; }",
    "    .lock-card h2 { margin: 0 0 8px; font-size: 21px; }",
    "    .lock-card p { margin: 0 0 18px; color: var(--muted); font-size: 14px; }",
    "    .pin-input { width: 100%; font-size: 24px; letter-spacing: 10px; text-align: center; padding: 12px; border: 1.5px solid var(--border); border-radius: 12px; margin-bottom: 14px; font-weight: 700; }",
    "    .btn { border: none; border-radius: 12px; padding: 10px 12px; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }",
    "    .btn:disabled { opacity: 0.45; cursor: not-allowed; }",
    "    .btn-primary { background: var(--primary); color: #fff; width: 100%; }",
    "    .btn-primary:active { background: var(--primary-dark); }",
    "    .btn-live { background: #137333; color: #fff; flex: 1; }",
    "    .btn-done { background: #3730a3; color: #fff; flex: 1; }",
    "    .btn-wait { background: #b45309; color: #fff; flex: 1; }",
    "    .btn-cash { background: #0f766e; color: #fff; width: 100%; margin-top: 8px; }",
    "    .btn-pdf { background: #111827; color: #fff; }",
    "    .btn-ghost { background: #eef2f7; color: var(--text); }",
    "    .topbar { position: sticky; top: 0; z-index: 20; background: var(--card); border-bottom: 1px solid var(--border); padding: 12px 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }",
    "    .topbar-title { font-size: 17px; font-weight: 700; margin: 0; }",
    "    .topbar-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }",
    "    .container { max-width: 780px; margin: 0 auto; padding: 14px; }",
    "    .live-bar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }",
    "    .live-bar select { flex: 1; min-width: 190px; }",
    "    .day-tabs { display: flex; gap: 6px; flex-wrap: wrap; }",
    "    .day-btn { padding: 8px 11px; border-radius: 10px; border: 1px solid var(--border); background: var(--card); color: var(--text); font-size: 12.5px; font-weight: 700; cursor: pointer; }",
    "    .day-btn.active { background: var(--primary); color: #fff; border-color: var(--primary); }",
    "    select, input[type='date'] { width: 100%; padding: 9px 10px; border-radius: 10px; border: 1px solid var(--border); background: #f8fafc; font-size: 13.5px; color: var(--text); }",
    "    .banner { background: linear-gradient(135deg, var(--primary), var(--primary-dark)); color: #fff; border-radius: 16px; padding: 14px 16px; margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }",
    "    .banner-big { font-size: 19px; font-weight: 800; }",
    "    .banner-small { font-size: 11px; opacity: 0.92; text-transform: uppercase; }",
    "    .acct-grid { width: 100%; border-top: 1px solid rgba(255, 255, 255, 0.22); padding-top: 10px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; }",
    "    @media (min-width: 520px) { .acct-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }",
    "    .q-card { background: var(--card); border-radius: 16px; padding: 14px; margin-bottom: 12px; border: 1px solid var(--border); box-shadow: 0 2px 8px rgba(15, 23, 42, 0.03); }",
    "    .q-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; gap: 8px; }",
    "    .token-pill { font-weight: 800; font-size: 15px; color: var(--primary); }",
    "    .badge { padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; white-space: nowrap; }",
    "    .b-waiting { background: var(--wait); color: var(--wait-t); }",
    "    .b-in-consultation { background: var(--live); color: var(--live-t); }",
    "    .b-completed { background: var(--done); color: var(--done-t); }",
    "    .q-meta { font-size: 13px; color: var(--muted); margin: 4px 0 10px; line-height: 1.55; }",
    "    .q-actions { display: flex; gap: 8px; flex-wrap: wrap; }",
    "    .avail-row { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-top: 1px dashed var(--border); font-size: 13px; gap: 8px; flex-wrap: wrap; }",
    "    .chip { padding: 6px 10px; border-radius: 10px; border: 1px solid var(--border); background: #f8fafc; font-weight: 700; font-size: 12px; cursor: pointer; }",
    "    .chip-p { background: #e6f4ea; color: #137333; border-color: #b7e1cd; }",
    "    .chip-a { background: #fce8e6; color: #c5221f; border-color: #fad2cf; }",
    "    .report-box { background: var(--card); border: 1.5px solid var(--border); border-radius: 18px; padding: 16px; margin-top: 22px; }",
    "    .report-title { font-size: 16px; font-weight: 800; margin: 0 0 12px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }",
    "    .report-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; }",
    "    @media (min-width: 600px) { .report-controls { grid-template-columns: 1fr 1fr 1.2fr; } }",
    "    .f-group label { display: block; font-size: 11px; font-weight: 700; color: var(--muted); margin-bottom: 4px; }",
    "    .check-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; background: #f8fafc; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 12px; font-size: 13px; }",
    "    .check-row label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font-weight: 600; }",
    "    .tbl-wrap { width: 100%; overflow-x: auto; }",
    "    table.rep-tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }",
    "    table.rep-tbl th, table.rep-tbl td { border: 1px solid var(--border); padding: 7px 8px; text-align: left; white-space: nowrap; }",
    "    table.rep-tbl th { background: #1e293b; color: #fff; font-weight: 700; }",
    "    table.rep-tbl tfoot td { background: #e2e8f0; font-weight: 800; }",
    "    .toast { position: fixed; top: 68px; left: 50%; transform: translateX(-50%); background: #161616; color: #fff; padding: 10px 16px; border-radius: 12px; font-size: 13px; z-index: 50; display: none; max-width: 92vw; text-align: center; }",
    "  </style>",
    "</head>",
    "<body>",
    '  <div id="toast" class="toast"></div>',
    '  <div id="lockScreen" class="lock-wrap">',
    '    <div class="lock-card">',
    "      <h2>🔐 " + headerIcon + " " + pageTitle + "</h2>",
    "      <p>" + (safeBizId ? "Business ID: <b>" + safeBizId + "</b> — " : "") + pageTitle + " का PIN डालें</p>",
    '      <input id="pinInput" class="pin-input" type="password" inputmode="numeric" maxlength="12" placeholder="••••" onkeydown="if(event.key===\'Enter\')unlockApp()" />',
    '      <button id="unlockBtn" class="btn btn-primary" onclick="unlockApp()">Unlock ' + pageTitle + "</button>",
    "    </div>",
    "  </div>",
    '  <div id="appShell" style="display:none;">',
    '    <div class="topbar">',
    "      <div>",
    '        <div id="clinicTitle" class="topbar-title">' + headerIcon + " " + pageTitle + "</div>",
    '        <div class="topbar-sub">' + subtitleText + "</div>",
    "      </div>",
    '      <div style="display:flex; gap:6px;">',
    '        <button class="btn btn-ghost" onclick="loadAllData()">🔄</button>',
    '        <button class="btn btn-ghost" onclick="lockApp()">🔒</button>',
    "      </div>",
    "    </div>",
    '    <div class="container">',
    '      <div class="live-bar">',
    '        <select id="doctorFilter" onchange="renderAll()"><option value="ALL">सभी डॉक्टर / All Doctors</option></select>',
    '        <div id="dayTabs" class="day-tabs"></div>',
    "      </div>",
    '      <div class="banner">',
    '        <div><div class="banner-small">CURRENT RUNNING TOKEN</div><div id="currentTokenText" class="banner-big">—</div></div>',
    '        <div><div class="banner-small">WAITING</div><div id="waitingCountText" class="banner-big">0</div></div>',
    '        <div style="text-align:right;"><div class="banner-small">TOTAL PATIENTS</div><div id="totalPatientsText" class="banner-big">0</div></div>',
    '        <div class="acct-grid">',
    '          <div><div class="banner-small">TOTAL AMOUNT</div><div id="totalAmountText" class="banner-big">₹0</div></div>',
    '          <div><div class="banner-small">ONLINE</div><div id="totalOnlineText" class="banner-big">₹0</div></div>',
    '          <div><div class="banner-small">CASH</div><div id="totalCashText" class="banner-big">₹0</div></div>',
    '          <div><div class="banner-small">DUES (बाक़ी)</div><div id="totalBalanceText" class="banner-big">₹0</div></div>',
    "        </div>",
    "      </div>",
    '      <div id="liveQueueSection"></div>',
    '      <div class="report-box">',
    '        <div class="report-title">',
    "          <span>📊 Date Range Report (Day-wise & Patient-wise)</span>",
    '          <button class="btn btn-pdf" onclick="downloadRangePdf()">📄 PDF Report</button>',
    "        </div>",
    '        <div class="report-controls">',
    '          <div class="f-group"><label>From Date (से)</label><input id="fromDateFilter" type="date" onchange="renderReportSection()" /></div>',
    '          <div class="f-group"><label>To Date (तक)</label><input id="toDateFilter" type="date" onchange="renderReportSection()" /></div>',
    '          <div class="f-group"><label>Report Type</label><select id="reportModeSelect" onchange="renderReportSection()"><option value="day">Day-wise (हर दिन कितने मरीज़ व हिसाब)</option><option value="patient">Patient-wise (हर मरीज़ की डिटेल)</option></select></div>',
    "        </div>",
    '        <div class="check-row">',
    '          <label><input id="chkPatientName" type="checkbox" onchange="renderReportSection()" /> Patient Name (नाम दिखाएं)</label>',
    '          <label><input id="chkDoctor" type="checkbox" checked onchange="renderReportSection()" /> Doctor</label>',
    '          <label><input id="chkFee" type="checkbox" checked onchange="renderReportSection()" /> Fee</label>',
    '          <label><input id="chkOnline" type="checkbox" checked onchange="renderReportSection()" /> Online</label>',
    '          <label><input id="chkCash" type="checkbox" checked onchange="renderReportSection()" /> Cash</label>',
    '          <label><input id="chkDues" type="checkbox" checked onchange="renderReportSection()" /> Dues</label>',
    '          <button class="btn btn-ghost" style="margin-left:auto;" onclick="clearReportDates()">Reset Dates</button>',
    "        </div>",
    '        <div id="reportPreviewArea"></div>',
    "      </div>",
    "    </div>",
    "  </div>",
    "  <script>",
    "    var APP_ROLE = " + JSON.stringify(appRole) + ";",
    "    var BUSINESS_ID = " + JSON.stringify(businessId) + ";",
    "    var TODAY_IST = " + JSON.stringify(todayIst) + ";",
    "    var PIN = '';",
    "    var state = { clinic: null, doctors: [], bookings: [] };",
    "    var activeDayOffset = 0;",
    "    var nextFillOffset = 2;",
    "    function addDaysYmd(baseYmd, offsetDays) {",
    "      var parts = toYmd(baseYmd).split('-');",
    "      if (parts.length !== 3) return baseYmd;",
    "      var dt = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + Number(offsetDays || 0)));",
    "      return dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0');",
    "    }",
    "    function getSelectedLiveDate() {",
    "      return addDaysYmd(TODAY_IST, activeDayOffset);",
    "    }",
    "    function selectLiveDay(offset) {",
    "      activeDayOffset = Number(offset) || 0;",
    "      nextFillOffset = activeDayOffset + 1;",
    "      renderDayTabs();",
    "      renderLiveQueueSection();",
    "    }",
    "    function autoAdvanceDay() {",
    "      var targetOffset = nextFillOffset;",
    "      activeDayOffset = targetOffset;",
    "      nextFillOffset = targetOffset + 1;",
    "      renderDayTabs();",
    "      renderLiveQueueSection();",
    "      showToast('📅 ' + addDaysYmd(TODAY_IST, targetOffset) + ' (+" + targetOffset + 'd) ऑटो-फ़िल हुआ');",
    "    }",
    "    function renderDayTabs() {",
    "      var wrap = document.getElementById('dayTabs');",
    "      if (!wrap) return;",
    "      var d0 = TODAY_IST;",
    "      var d1 = addDaysYmd(TODAY_IST, 1);",
    "      var d2 = addDaysYmd(TODAY_IST, 2);",
    "      var dNext = addDaysYmd(TODAY_IST, nextFillOffset);",
    "      var tabs = [",
    "        { off: 0, label: 'Today (' + d0.slice(5) + ')' },",
    "        { off: 1, label: 'Tomorrow (' + d1.slice(5) + ')' },",
    "        { off: 2, label: '+2 Day (' + d2.slice(5) + ')' },",
    "      ];",
    "      var html = tabs.map(function(t) {",
    "        var cls = activeDayOffset === t.off ? 'day-btn active' : 'day-btn';",
    "        return '<button class=\"' + cls + '\" onclick=\"selectLiveDay(' + t.off + ')\">' + t.label + '</button>';",
    "      }).join('');",
    "      html += '<button class=\"day-btn\" onclick=\"autoAdvanceDay()\">Auto Next +' + nextFillOffset + 'd (' + dNext.slice(5) + ')</button>';",
    "      wrap.innerHTML = html;",
    "    }",
    "    function toYmd(val) {",
    "      if (!val) return '';",
    "      var s = String(val).trim();",
    "      var parts = s.slice(0, 10).split(/[-/]/);",
    "      if (parts.length === 3) {",
    "        if (parts[0].length === 4) return parts[0] + '-' + parts[1].padStart(2, '0') + '-' + parts[2].padStart(2, '0');",
    "        if (parts[2].length === 4) return parts[2] + '-' + parts[1].padStart(2, '0') + '-' + parts[0].padStart(2, '0');",
    "      }",
    "      return s.slice(0, 10);",
    "    }",
    "    function isPastDate(val) {",
    "      var ymd = toYmd(val);",
    "      return Boolean(ymd && ymd < TODAY_IST);",
    "    }",
    "    function splitPaidByChannel(booking) {",
    "      var paid = Math.max(0, Number((booking && booking.Paid_Amount) || 0));",
    "      var explicitCash = Number((booking && (booking.Cash_Amount !== undefined ? booking.Cash_Amount : booking.cashAmount)));",
    "      var explicitOnline = Number((booking && (booking.Online_Amount !== undefined ? booking.Online_Amount : booking.onlineAmount)));",
    "      if (Number.isFinite(explicitCash) || Number.isFinite(explicitOnline)) {",
    "        var cash = Number.isFinite(explicitCash) ? Math.max(0, explicitCash) : 0;",
    "        var online = Number.isFinite(explicitOnline) ? Math.max(0, explicitOnline) : Math.max(0, paid - cash);",
    "        return { online: online, cash: cash };",
    "      }",
    "      var modeText = (String((booking && booking.Payment_Mode) || '') + ' ' + String((booking && booking.Payment_Status) || '')).toLowerCase();",
    "      if (modeText.indexOf('cash') !== -1) return { online: 0, cash: paid };",
    "      return { online: paid, cash: 0 };",
    "    }",
    "    function getDoctorFilteredBookings() {",
    "      var docVal = document.getElementById('doctorFilter').value;",
    "      return state.bookings.filter(function(b) {",
    "        return docVal === 'ALL' || String(b.Doctor_Name || '').trim() === docVal;",
    "      });",
    "    }",
    "    function getReportFilteredBookings() {",
    "      var fromVal = toYmd(document.getElementById('fromDateFilter').value);",
    "      var toVal = toYmd(document.getElementById('toDateFilter').value);",
    "      var baseList = getDoctorFilteredBookings();",
    "      if (fromVal && toVal && fromVal > toVal) { var tmp = fromVal; fromVal = toVal; toVal = tmp; }",
    "      var list = baseList.filter(function(b) {",
    "        var vDate = toYmd(b.Visit_Date);",
    "        var matchFrom = !fromVal || (vDate && vDate >= fromVal);",
    "        var matchTo = !toVal || (vDate && vDate <= toVal);",
    "        return matchFrom && matchTo;",
    "      });",
    "      return { list: list, fromVal: fromVal, toVal: toVal };",
    "    }",
    "    function buildDayWiseRows(list) {",
    "      var map = {};",
    "      list.forEach(function(b) {",
    "        var d = toYmd(b.Visit_Date) || 'Unknown';",
    "        if (!map[d]) {",
    "          map[d] = { date: d, patients: 0, fee: 0, online: 0, cash: 0, dues: 0, docs: {}, names: [] };",
    "        }",
    "        var fee = Math.max(0, Number(b.OPD_Fee || 0));",
    "        var paid = Math.max(0, Number(b.Paid_Amount || 0));",
    "        var dues = Math.max(0, fee - paid);",
    "        var ch = splitPaidByChannel(b);",
    "        map[d].patients += 1;",
    "        map[d].fee += fee;",
    "        map[d].online += ch.online;",
    "        map[d].cash += ch.cash;",
    "        map[d].dues += dues;",
    "        var docName = String(b.Doctor_Name || '').trim();",
    "        if (docName) map[d].docs[docName] = true;",
    "        var pName = String(b.Patient_Name || '').trim();",
    "        if (pName) map[d].names.push(pName);",
    "      });",
    "      return Object.keys(map).sort().map(function(k) {",
    "        var it = map[k];",
    "        return {",
    "          date: it.date,",
    "          patients: it.patients,",
    "          patientNames: it.names.join(', '),",
    "          doctor: Object.keys(it.docs).join(', '),",
    "          fee: it.fee,",
    "          online: it.online,",
    "          cash: it.cash,",
    "          dues: it.dues",
    "        };",
    "      });",
    "    }",
    "    function showToast(msg) {",
    "      var el = document.getElementById('toast');",
    "      el.textContent = msg;",
    "      el.style.display = 'block';",
    "      clearTimeout(window._t);",
    "      window._t = setTimeout(function() { el.style.display = 'none'; }, 3500);",
    "    }",
    "    function clearReportDates() {",
    "      document.getElementById('fromDateFilter').value = '';",
    "      document.getElementById('toDateFilter').value = '';",
    "      renderReportSection();",
    "    }",
    "    function buildQuery() {",
    "      var params = new URLSearchParams();",
    "      if (BUSINESS_ID) params.set('businessId', BUSINESS_ID);",
    "      if (APP_ROLE) params.set('role', APP_ROLE);",
    "      if (state.clinic && state.clinic.sheetId) params.set('sheetId', state.clinic.sheetId);",
    "      var q = params.toString();",
    "      return q ? '?' + q : '';",
    "    }",
    "    async function unlockApp() {",
    "      var btn = document.getElementById('unlockBtn');",
    "      var pin = document.getElementById('pinInput').value.trim();",
    "      if (!pin) { showToast('कृपया PIN डालें'); return; }",
    "      if (btn) { btn.disabled = true; btn.textContent = 'Checking...'; }",
    "      try {",
    "        var r = await fetch('/api/app/login', {",
    "          method: 'POST',",
    "          headers: { 'Content-Type': 'application/json' },",
    "          body: JSON.stringify({ pin: pin, businessId: BUSINESS_ID, role: APP_ROLE }),",
    "        });",
    "        var d = await r.json();",
    "        if (!r.ok || !d.ok) { showToast(d.error || 'गलत PIN'); return; }",
    "        PIN = pin;",
    "        activeDayOffset = 0;",
    "        nextFillOffset = 2;",
    "        document.getElementById('lockScreen').style.display = 'none';",
    "        document.getElementById('appShell').style.display = 'block';",
    "        await loadAllData();",
    "      } catch (err) {",
    "        showToast('Network Error: ' + (err && err.message ? err.message : 'Server unreachable'));",
    "      } finally {",
    "        if (btn) { btn.disabled = false; btn.textContent = 'Unlock " + pageTitle + "'; }",
    "      }",
    "    }",
    "    function lockApp() {",
    "      PIN = '';",
    "      document.getElementById('pinInput').value = '';",
    "      document.getElementById('appShell').style.display = 'none';",
    "      document.getElementById('lockScreen').style.display = 'flex';",
    "    }",
    "    async function loadAllData() {",
    "      if (!PIN) return;",
    "      try {",
    "        var r = await fetch('/api/app/data' + buildQuery(), { headers: { 'x-staff-pin': PIN } });",
    "        var d = await r.json();",
    "        if (!r.ok || !d.ok) { showToast(d.error || 'Data load failed'); return; }",
    "        state.clinic = d.clinic;",
    "        state.doctors = d.doctors || [];",
    "        state.bookings = d.bookings || [];",
    "        document.getElementById('clinicTitle').textContent = " + JSON.stringify(headerIcon + " ") + " + ((d.clinic && d.clinic.name) || 'OPD') + " + JSON.stringify(" — " + pageTitle) + ";",
    "        var sel = document.getElementById('doctorFilter');",
    "        var prevVal = sel.value || 'ALL';",
    "        sel.innerHTML = '<option value=\"ALL\">सभी डॉक्टर / All Doctors</option>';",
    "        state.doctors.forEach(function(doc) {",
    "          var opt = document.createElement('option');",
    "          opt.value = doc.name;",
    "          opt.textContent = doc.name;",
    "          sel.appendChild(opt);",
    "        });",
    "        if ([].slice.call(sel.options).some(function(o) { return o.value === prevVal; })) sel.value = prevVal;",
    "        renderAll();",
    "      } catch (err) {",
    "        showToast('Load Error: ' + (err && err.message ? err.message : 'Failed'));",
    "      }",
    "    }",
    "    async function setQueueStatus(tokenId, queueStatus) {",
    "      var target = state.bookings.find(function(b) { return String(b.Token_ID || '') === String(tokenId); });",
    "      if (target && isPastDate(target.Visit_Date)) { showToast('🔒 पिछले दिन के रिकॉर्ड में बदलाव की अनुमति नहीं है'); return; }",
    "      var r = await fetch('/api/app/queue-status', {",
    "        method: 'POST',",
    "        headers: { 'Content-Type': 'application/json', 'x-staff-pin': PIN },",
    "        body: JSON.stringify({ businessId: BUSINESS_ID || (state.clinic && state.clinic.id), role: APP_ROLE, sheetId: state.clinic && state.clinic.sheetId, tokenId: tokenId, queueStatus: queueStatus }),",
    "      });",
    "      var d = await r.json();",
    "      if (!r.ok || !d.ok) { showToast(d.error || 'Update failed'); return; }",
    "      state.bookings = d.bookings || state.bookings;",
    "      showToast(d.notified2AheadToken ? ('✅ ' + tokenId + ' → ' + queueStatus + ' | 2 नंबर अलर्ट: ' + d.notified2AheadToken) : ('✅ ' + tokenId + ' → ' + queueStatus));",
    "      renderAll();",
    "    }",
    "    async function handleCashDeposit(tokenId, currentBalance, visitDate) {",
    "      if (isPastDate(visitDate)) { showToast('🔒 पिछले दिन के रिकॉर्ड में Cash Deposit बंद है'); return; }",
    "      var defaultAmt = currentBalance > 0 ? String(currentBalance) : '';",
    "      var entered = prompt('टोकन ' + tokenId + ' के लिए Cash Deposit राशि (₹) डालें (Dues: ₹' + currentBalance + '):', defaultAmt);",
    "      if (entered === null) return;",
    "      var amt = Number(String(entered).trim());",
    "      if (!Number.isFinite(amt) || amt <= 0) { showToast('कृपया सही राशि (₹) डालें'); return; }",
    "      var r = await fetch('/api/app/cash-deposit', {",
    "        method: 'POST',",
    "        headers: { 'Content-Type': 'application/json', 'x-staff-pin': PIN },",
    "        body: JSON.stringify({ businessId: BUSINESS_ID || (state.clinic && state.clinic.id), role: APP_ROLE, sheetId: state.clinic && state.clinic.sheetId, tokenId: tokenId, amount: amt }),",
    "      });",
    "      var d = await r.json();",
    "      if (!r.ok || !d.ok) { showToast(d.error || 'Cash deposit failed'); return; }",
    "      if (Array.isArray(d.bookings) && d.bookings.length) {",
    "        state.bookings = d.bookings;",
    "      } else {",
    "        state.bookings = state.bookings.map(function(b) {",
    "          if (String(b.Token_ID || '') !== String(tokenId)) return b;",
    "          var nextPaid = Number(b.Paid_Amount || 0) + amt;",
    "          var prevCash = Number(b.Cash_Amount || 0);",
    "          var modeLower = String(b.Payment_Mode || '').toLowerCase();",
    "          var nextCash = (modeLower.indexOf('cash') !== -1 || prevCash > 0) ? prevCash + amt : amt;",
    "          return Object.assign({}, b, { Paid_Amount: nextPaid, Cash_Amount: nextCash, Payment_Mode: b.Payment_Mode || 'Cash' });",
    "        });",
    "      }",
    "      showToast('💵 ' + tokenId + ' में ₹' + amt + ' Cash Deposit दर्ज हुआ');",
    "      renderAll();",
    "    }",
    "    async function toggleDoctorAvailByIndex(idx, dayKey) {",
    "      var doc = state.doctors[idx];",
    "      if (!doc) return;",
    "      var curMap = { today: doc.todayAvail, next: doc.nextDayAvail, plus2: doc.plus2DayAvail };",
    "      var nextAvail = String(curMap[dayKey] || 'P').toUpperCase() === 'P' ? 'A' : 'P';",
    "      var r = await fetch('/api/app/doctor-avail', {",
    "        method: 'POST',",
    "        headers: { 'Content-Type': 'application/json', 'x-staff-pin': PIN },",
    "        body: JSON.stringify({ businessId: BUSINESS_ID || (state.clinic && state.clinic.id), role: APP_ROLE, sheetId: state.clinic && state.clinic.sheetId, doctorId: doc.id, doctorName: doc.name, dayKey: dayKey, avail: nextAvail }),",
    "      });",
    "      var d = await r.json();",
    "      if (!r.ok || !d.ok) { showToast(d.error || 'Availability update failed'); return; }",
    "      await loadAllData();",
    "      showToast('🩺 ' + doc.name + ' (' + dayKey + ') → ' + nextAvail);",
    "    }",
    "    function escapeHtml(str) {",
    "      return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');",
    "    }",
    "    function renderLiveQueueSection() {",
    "      var docVal = document.getElementById('doctorFilter').value;",
    "      var selectedDayYmd = getSelectedLiveDate();",
    "      var liveList = getDoctorFilteredBookings().filter(function(b) { return toYmd(b.Visit_Date) === selectedDayYmd; });",
    "      var running = liveList.find(function(b) { return String(b.Queue_Status || '').trim().toLowerCase() === 'in consultation'; });",
    "      var waitingList = liveList.filter(function(b) { return String(b.Queue_Status || 'Waiting').trim().toLowerCase() === 'waiting'; });",
    "      var sumTotal = 0, sumOnline = 0, sumCash = 0, sumDues = 0;",
    "      liveList.forEach(function(b) {",
    "        var fee = Math.max(0, Number(b.OPD_Fee || 0));",
    "        var paid = Math.max(0, Number(b.Paid_Amount || 0));",
    "        var ch = splitPaidByChannel(b);",
    "        sumTotal += fee; sumOnline += ch.online; sumCash += ch.cash; sumDues += Math.max(0, fee - paid);",
    "      });",
    "      document.getElementById('currentTokenText').textContent = running ? (running.Token_ID + ' (' + running.Patient_Name + ')') : 'कोई नहीं / None';",
    "      document.getElementById('waitingCountText').textContent = String(waitingList.length);",
    "      document.getElementById('totalPatientsText').textContent = String(liveList.length);",
    "      document.getElementById('totalAmountText').textContent = '₹' + sumTotal;",
    "      document.getElementById('totalOnlineText').textContent = '₹' + sumOnline;",
    "      document.getElementById('totalCashText').textContent = '₹' + sumCash;",
    "      document.getElementById('totalBalanceText').textContent = '₹' + sumDues;",
    "      var container = document.getElementById('liveQueueSection');",
    "      var html = '';",
    "      if (APP_ROLE === 'doctor') {",
    "        var docsWithIdx = state.doctors.map(function(d, i) { return { doc: d, idx: i }; });",
    "        if (docVal !== 'ALL') docsWithIdx = docsWithIdx.filter(function(item) { return item.doc.name === docVal; });",
    "        html += '<div class=\"q-card\"><b>🩺 Doctor Availability (P = Present, A = Absent)</b>';",
    "        docsWithIdx.forEach(function(item) {",
    "          var doc = item.doc, idx = item.idx;",
    "          var tAv = doc.todayAvail || 'P', nAv = doc.nextDayAvail || 'P', pAv = doc.plus2DayAvail || 'P';",
    "          html += '<div class=\"avail-row\"><div><b>' + escapeHtml(doc.name) + '</b><br><span style=\"color:#525252;font-size:12px;\">' + escapeHtml(doc.specialty || '') + '</span></div><div style=\"display:flex;gap:6px;\"><button class=\"chip ' + (tAv === 'P' ? 'chip-p' : 'chip-a') + '\" onclick=\"toggleDoctorAvailByIndex(' + idx + ', \\'today\\')\">आज: ' + tAv + '</button><button class=\"chip ' + (nAv === 'P' ? 'chip-p' : 'chip-a') + '\" onclick=\"toggleDoctorAvailByIndex(' + idx + ', \\'next\\')\">कल: ' + nAv + '</button><button class=\"chip ' + (pAv === 'P' ? 'chip-p' : 'chip-a') + '\" onclick=\"toggleDoctorAvailByIndex(' + idx + ', \\'plus2\\')\">परसों: ' + pAv + '</button></div></div>';",
    "        });",
    "        html += '</div>';",
    "      }",
    "      if (!liveList.length) {",
    "        html += '<div class=\"q-card\" style=\"text-align:center;color:#525252;\">' + selectedDayYmd + ' के लिए कोई लाइव मरीज़ नहीं है।</div>';",
    "      } else {",
    "        liveList.forEach(function(b) {",
    "          var st = String(b.Queue_Status || 'Waiting').trim();",
    "          var cls = st.toLowerCase() === 'in consultation' ? 'b-in-consultation' : st.toLowerCase() === 'completed' ? 'b-completed' : 'b-waiting';",
    "          var tId = String(b.Token_ID || '');",
    "          var visitYmd = toYmd(b.Visit_Date);",
    "          var opdFee = Math.max(0, Number(b.OPD_Fee || 0));",
    "          var paidAmt = Math.max(0, Number(b.Paid_Amount || 0));",
    "          var balanceAmt = Math.max(0, opdFee - paidAmt);",
    "          var ch = splitPaidByChannel(b);",
    "          var metaLine = '👨‍⚕️ <b>' + escapeHtml(b.Doctor_Name || '') + '</b> | 📅 ' + visitYmd + ' | ⏰ ' + escapeHtml(b.Batch_Slot || '') + '<br>📱 ' + escapeHtml(b.Patient_Phone || '') + '<br>💰 Total: <b>₹' + opdFee + '</b> | Online: <b>₹' + ch.online + '</b> | Cash: <b>₹' + ch.cash + '</b> | Dues: <b style=\"color:' + (balanceAmt > 0 ? '#c5221f' : '#137333') + ';\">₹' + balanceAmt + '</b>';",
    "          var cashBtnHtml = APP_ROLE === 'reception' ? '<button class=\"btn btn-cash\" onclick=\"handleCashDeposit(\\'' + escapeHtml(tId) + '\\', ' + balanceAmt + ', \\'' + visitYmd + '\\')\">💵 Cash Deposit (Dues: ₹' + balanceAmt + ')</button>' : '';",
    "          html += '<div class=\"q-card\"><div class=\"q-top\"><span class=\"token-pill\">' + escapeHtml(tId) + ' — ' + escapeHtml(b.Patient_Name || '') + ' (' + escapeHtml(b.Patient_Age || '') + 'y)</span><span class=\"badge ' + cls + '\">' + escapeHtml(st) + '</span></div><div class=\"q-meta\">' + metaLine + '</div><div class=\"q-actions\"><button class=\"btn btn-live\" onclick=\"setQueueStatus(\\'' + escapeHtml(tId) + '\\', \\'In Consultation\\')\">▶ In Consultation</button><button class=\"btn btn-done\" onclick=\"setQueueStatus(\\'' + escapeHtml(tId) + '\\', \\'Completed\\')\">✔ Completed</button><button class=\"btn btn-wait\" onclick=\"setQueueStatus(\\'' + escapeHtml(tId) + '\\', \\'Waiting\\')\">⏳ Waiting</button></div>' + cashBtnHtml + '</div>';",
    "        });",
    "      }",
    "      container.innerHTML = html;",
    "    }",
    "    function getReportTableModel() {",
    "      var filtered = getReportFilteredBookings();",
    "      var mode = document.getElementById('reportModeSelect').value;",
    "      var showName = document.getElementById('chkPatientName').checked;",
    "      var showDoc = document.getElementById('chkDoctor').checked;",
    "      var showFee = document.getElementById('chkFee').checked;",
    "      var showOnline = document.getElementById('chkOnline').checked;",
    "      var showCash = document.getElementById('chkCash').checked;",
    "      var showDues = document.getElementById('chkDues').checked;",
    "      var sumPatients = filtered.list.length, sumFee = 0, sumOnline = 0, sumCash = 0, sumDues = 0;",
    "      filtered.list.forEach(function(b) {",
    "        var fee = Math.max(0, Number(b.OPD_Fee || 0));",
    "        var paid = Math.max(0, Number(b.Paid_Amount || 0));",
    "        var ch = splitPaidByChannel(b);",
    "        sumFee += fee; sumOnline += ch.online; sumCash += ch.cash; sumDues += Math.max(0, fee - paid);",
    "      });",
    "      var headers = ['Date'];",
    "      if (mode === 'patient') headers.push('Token');",
    "      headers.push('Patients');",
    "      if (showName) headers.push(mode === 'patient' ? 'Patient Name' : 'Names');",
    "      if (showDoc) headers.push('Doctor');",
    "      if (showFee) headers.push('Fee');",
    "      if (showOnline) headers.push('Online');",
    "      if (showCash) headers.push('Cash');",
    "      if (showDues) headers.push('Dues');",
    "      var bodyRows = [];",
    "      if (mode === 'day') {",
    "        var dayRows = buildDayWiseRows(filtered.list);",
    "        dayRows.forEach(function(dr) {",
    "          var r = [escapeHtml(dr.date), '<b>' + dr.patients + '</b>'];",
    "          if (showName) r.push(escapeHtml(dr.patientNames));",
    "          if (showDoc) r.push(escapeHtml(dr.doctor));",
    "          if (showFee) r.push('₹' + dr.fee);",
    "          if (showOnline) r.push('₹' + dr.online);",
    "          if (showCash) r.push('₹' + dr.cash);",
    "          if (showDues) r.push('₹' + dr.dues);",
    "          bodyRows.push(r);",
    "        });",
    "      } else {",
    "        var sortedPts = filtered.list.slice().sort(function(a, b) {",
    "          var da = toYmd(a.Visit_Date), db = toYmd(b.Visit_Date);",
    "          return da === db ? String(a.Token_ID || '').localeCompare(String(b.Token_ID || '')) : (da < db ? -1 : 1);",
    "        });",
    "        sortedPts.forEach(function(b) {",
    "          var fee = Math.max(0, Number(b.OPD_Fee || 0));",
    "          var paid = Math.max(0, Number(b.Paid_Amount || 0));",
    "          var dues = Math.max(0, fee - paid);",
    "          var ch = splitPaidByChannel(b);",
    "          var r = [escapeHtml(toYmd(b.Visit_Date)), '<b>' + escapeHtml(b.Token_ID) + '</b>', '1'];",
    "          if (showName) r.push(escapeHtml(b.Patient_Name) + (b.Patient_Age ? ' (' + escapeHtml(b.Patient_Age) + 'y)' : ''));",
    "          if (showDoc) r.push(escapeHtml(b.Doctor_Name || ''));",
    "          if (showFee) r.push('₹' + fee);",
    "          if (showOnline) r.push('₹' + ch.online);",
    "          if (showCash) r.push('₹' + ch.cash);",
    "          if (showDues) r.push('₹' + dues);",
    "          bodyRows.push(r);",
    "        });",
    "      }",
    "      var footRow = ['TOTAL'];",
    "      if (mode === 'patient') footRow.push('—');",
    "      footRow.push('<b>' + sumPatients + '</b>');",
    "      if (showName) footRow.push('—');",
    "      if (showDoc) footRow.push('—');",
    "      if (showFee) footRow.push('₹' + sumFee);",
    "      if (showOnline) footRow.push('₹' + sumOnline);",
    "      if (showCash) footRow.push('₹' + sumCash);",
    "      if (showDues) footRow.push('₹' + sumDues);",
    "      return { headers: headers, bodyRows: bodyRows, footRow: footRow, sumPatients: sumPatients, sumFee: sumFee, sumOnline: sumOnline, sumCash: sumCash, sumDues: sumDues, fromVal: filtered.fromVal, toVal: filtered.toVal, mode: mode };",
    "    }",
    "    function renderReportSection() {",
    "      var m = getReportTableModel();",
    "      var area = document.getElementById('reportPreviewArea');",
    "      if (!m.bodyRows.length) {",
    "        area.innerHTML = '<div style=\"text-align:center;color:#525252;padding:14px;\">चुनी हुई Date Range में कोई डेटा नहीं मिला।</div>';",
    "        return;",
    "      }",
    "      var ths = m.headers.map(function(h) { return '<th>' + h + '</th>'; }).join('');",
    "      var trs = m.bodyRows.map(function(r) { return '<tr>' + r.map(function(c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('');",
    "      var tfs = '<tr>' + m.footRow.map(function(c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';",
    "      area.innerHTML = '<div class=\"tbl-wrap\"><table class=\"rep-tbl\"><thead><tr>' + ths + '</tr></thead><tbody>' + trs + '</tbody><tfoot>' + tfs + '</tfoot></table></div>';",
    "    }",
    "    function downloadRangePdf() {",
    "      var m = getReportTableModel();",
    "      if (!m.bodyRows.length) { showToast('इस Date Range में कोई रिपोर्ट डेटा नहीं है'); return; }",
    "      var rangeLabel = (m.fromVal || m.toVal) ? ((m.fromVal || 'शुरू') + ' से ' + (m.toVal || 'आज तक')) : 'सभी तारीख (All Dates)';",
    "      var clinicName = escapeHtml((state.clinic && state.clinic.name) || BUSINESS_ID || 'OPD Clinic');",
    "      var modeLabel = m.mode === 'day' ? 'Day-wise Summary' : 'Patient-wise Detail';",
    "      var printWin = window.open('', '_blank');",
    "      if (!printWin) { showToast('Pop-up blocked — ब्राउज़र में Pop-up Allow करें'); return; }",
    "      var ths = m.headers.map(function(h) { return '<th>' + h + '</th>'; }).join('');",
    "      var trs = m.bodyRows.map(function(r) { return '<tr>' + r.map(function(c) { return '<td>' + c + '</td>'; }).join('') + '</tr>'; }).join('');",
    "      var tfs = '<tr>' + m.footRow.map(function(c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';",
    "      var reportDoc = '<!doctype html><html lang=\"hi\"><head><meta charset=\"utf-8\" /><title>' + clinicName + ' — ' + modeLabel + '</title><style>body{font-family:system-ui,sans-serif;margin:18px;color:#111827;}.hdr{display:flex;justify-content:space-between;border-bottom:2px solid #0f62fe;padding-bottom:10px;margin-bottom:14px;}.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px;}.card{border:1px solid #cbd5e1;border-radius:8px;padding:8px;background:#f8fafc;}table{width:100%;border-collapse:collapse;font-size:12px;}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;}th{background:#0f62fe;color:#fff;}tfoot td{background:#e2e8f0;font-weight:800;}@media print{.no-print{display:none;}}</style></head><body><div class=\"no-print\" style=\"margin-bottom:10px;text-align:right;\"><button onclick=\"window.print()\" style=\"background:#0f62fe;color:#fff;border:none;padding:9px 14px;border-radius:8px;font-weight:700;cursor:pointer;\">🖨️ Print / Save as PDF</button></div><div class=\"hdr\"><div><h1 style=\"margin:0 0 4px;font-size:19px;\">' + clinicName + ' — ' + modeLabel + '</h1><p style=\"margin:0;font-size:12px;\"><b>Period:</b> ' + rangeLabel + '</p></div><div style=\"text-align:right;font-size:12px;\"><b>Generated:</b> ' + TODAY_IST + '</div></div><div class=\"cards\"><div class=\"card\"><div>Total Patients</div><b>' + m.sumPatients + '</b></div><div class=\"card\"><div>Total Fee</div><b>₹' + m.sumFee + '</b></div><div class=\"card\"><div>Online</div><b>₹' + m.sumOnline + '</b></div><div class=\"card\"><div>Cash</div><b>₹' + m.sumCash + '</b></div><div class=\"card\"><div>Dues</div><b style=\"color:#b91c1c;\">₹' + m.sumDues + '</b></div></div><table><thead><tr>' + ths + '</tr></thead><tbody>' + trs + '</tbody><tfoot>' + tfs + '</tfoot></table></body></html>';",
    "      printWin.document.open();",
    "      printWin.document.write(reportDoc);",
    "      printWin.document.close();",
    "    }",
    "    function renderAll() {",
    "      renderDayTabs();",
    "      renderLiveQueueSection();",
    "      renderReportSection();",
    "    }",
    "  </script>",
    "</body>",
    "</html>",
  ].join("\n");
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
