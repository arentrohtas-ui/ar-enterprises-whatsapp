const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function formatIstYmd(dateObj) {
  const ist = new Date(dateObj.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function fetchBookingsList(ctx) {
  try {
    const res = await ctx.getSheet({
      action: "get_live_status",
      tokenId: "",
      phone: "",
    });
    if (Array.isArray(res?.allBookings)) return res.allBookings;
    if (Array.isArray(res?.bookings)) return res.bookings;
    if (Array.isArray(res?.data)) return res.data;
  } catch (_) {}

  try {
    const res2 = await ctx.getSheet({ action: "get_dashboard_data" });
    if (Array.isArray(res2?.bookings)) return res2.bookings;
  } catch (_) {}

  return [];
}

async function sendMainMenu(ctx, lang = "hi") {
  const clinicName = ctx.business?.name || "City Care OPD";

  if (typeof ctx.sendWA === "function") {
    const bodyText =
      lang === "en"
        ? `🏥 *${clinicName}*\nWelcome! How can we help you today?`
        : `🏥 *${clinicName}*\nनमस्ते! आज हम आपकी क्या मदद कर सकते हैं?`;

    const waRes = await ctx.sendWA({
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: "MENU_BOOK",
                title: lang === "en" ? "Book Token" : "टोकन बुक करें",
              },
            },
            {
              type: "reply",
              reply: {
                id: "MENU_STATUS",
                title: lang === "en" ? "Live Status" : "लाइव स्टेटस",
              },
            },
            {
              type: "reply",
              reply: {
                id: "MENU_LANG",
                title: lang === "en" ? "हिंदी में बदलें" : "Switch to English",
              },
            },
          ],
        },
      },
    });
    if (waRes && !waRes.error) return;
  }

  const fallbackMsg =
    lang === "en"
      ? `🏥 *${clinicName}*\n\n1️⃣ Reply *1* to *Book OPD Token*\n2️⃣ Reply *2* to check *Live Queue Status*\n3️⃣ Reply *3* to switch to *हिंदी*`
      : `🏥 *${clinicName}*\n\n1️⃣ *OPD टोकन बुक* करने के लिए *1* भेजें\n2️⃣ *लाइव कतार स्टेटस* देखने के लिए *2* भेजें\n3️⃣ *English* में बदलने के लिए *3* भेजें`;

  await ctx.sendText(fallbackMsg);
}

async function sendLiveQueueStatus(ctx, lang = "hi") {
  const bookings = await fetchBookingsList(ctx);
  const today = formatIstYmd(new Date());
  const todayList = bookings.filter(
    (b) => String(b.Visit_Date || "").slice(0, 10) === today
  );
  const activeList = todayList.length ? todayList : bookings;

  const running = activeList.find(
    (b) =>
      String(b.Queue_Status || "").trim().toLowerCase() === "in consultation"
  );
  const waitingCount = activeList.filter(
    (b) =>
      String(b.Queue_Status || "Waiting").trim().toLowerCase() === "waiting"
  ).length;

  const msg =
    lang === "en"
      ? `📊 *Live OPD Queue Status*\n\n` +
        `• Current Running Token: *${
          running ? `${running.Token_ID} (${running.Patient_Name})` : "None"
        }*\n` +
        `• Waiting Patients: *${waitingCount}*\n` +
        `• Total Bookings: *${activeList.length}*`
      : `📊 *लाइव OPD कतार स्टेटस*\n\n` +
        `• अभी चल रहा टोकन: *${
          running ? `${running.Token_ID} (${running.Patient_Name})` : "कोई नहीं"
        }*\n` +
        `• प्रतीक्षा में मरीज़: *${waitingCount}*\n` +
        `• कुल बुकिंग: *${activeList.length}*`;

  await ctx.sendText(msg);
}

module.exports = {
  sendMainMenu,
  sendLiveQueueStatus,
  formatIstYmd,
  IST_OFFSET_MS,
};
