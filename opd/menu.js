function formatIstYmd(dateObj = new Date()) {
  const ist = new Date(dateObj.getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function normalizeTenDigits(val = "") {
  const digits = String(val || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function extractTokenNumber(tokenId = "") {
  const m = String(tokenId || "")
    .trim()
    .match(/(\d+)$/);
  return m ? Number(m[1]) : null;
}

async function sendMainMenu(ctx, lang = "hi") {
  const bizName = ctx.business?.name || "City Care OPD";
  const bodyText =
    lang === "en"
      ? `🏥 *${bizName}*\nWelcome! How can we help you today?`
      : `🏥 *${bizName}*\nनमस्ते! आज हम आपकी क्या मदद कर सकते हैं?`;

  if (typeof ctx.sendWA === "function") {
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
    if (waRes && !waRes.error && !waRes.errors) return;
  }

  await ctx.sendText(
    lang === "en"
      ? `${bodyText}\n\n1. Book Token\n2. Live Status\n3. हिंदी में बदलें`
      : `${bodyText}\n\n1. टोकन बुक करें\n2. लाइव स्टेटस\n3. Switch to English`
  );
}

async function sendLiveQueueStatus(ctx, lang = "hi") {
  const todayYmd = formatIstYmd(new Date());
  const senderTen = normalizeTenDigits(ctx.from);

  let bookings = [];
  try {
    const res = await ctx.getSheet({ action: "get_dashboard_data" });
    if (Array.isArray(res?.bookings)) {
      bookings = res.bookings;
    }
  } catch (_) {}

  if (!bookings.length) {
    try {
      const res2 = await ctx.getSheet({ action: "get_live_status" });
      if (Array.isArray(res2?.allBookings)) bookings = res2.allBookings;
      else if (Array.isArray(res2?.bookings)) bookings = res2.bookings;
    } catch (_) {}
  }

  const todayList = bookings.filter((b) => {
    const vDate = String(b.Visit_Date || b.visitDate || "").slice(0, 10);
    return !vDate || vDate === todayYmd;
  });

  const activeList = todayList.length ? todayList : bookings;

  const running = activeList.find(
    (b) =>
      String(b.Queue_Status || b.queueStatus || "")
        .trim()
        .toLowerCase() === "in consultation"
  );

  const myBooking = senderTen
    ? [...activeList]
        .reverse()
        .find(
          (b) =>
            normalizeTenDigits(b.Patient_Phone || b.patientPhone || "") ===
              senderTen &&
            String(b.Queue_Status || b.queueStatus || "")
              .trim()
              .toLowerCase() !== "completed"
        ) ||
      [...activeList]
        .reverse()
        .find(
          (b) =>
            normalizeTenDigits(b.Patient_Phone || b.patientPhone || "") ===
            senderTen
        )
    : null;

  const runningText = running
    ? `${running.Token_ID || running.tokenId || "—"} (${
        running.Patient_Name || running.patientName || ""
      })`
    : lang === "en"
    ? "None right now"
    : "अभी कोई नहीं";

  let aheadCount = null;
  if (myBooking) {
    const myTokenId = String(myBooking.Token_ID || myBooking.tokenId || "").trim();
    const myNum = extractTokenNumber(myTokenId);
    const myDoctor = String(
      myBooking.Doctor_Name || myBooking.doctorName || ""
    )
      .trim()
      .toLowerCase();

    const sameQueue = activeList.filter((b) => {
      const st = String(b.Queue_Status || b.queueStatus || "Waiting")
        .trim()
        .toLowerCase();
      if (st === "completed") return false;
      const docName = String(b.Doctor_Name || b.doctorName || "")
        .trim()
        .toLowerCase();
      if (myDoctor && docName && docName !== myDoctor) return false;
      const bToken = String(b.Token_ID || b.tokenId || "").trim();
      if (bToken === myTokenId) return false;
      const bNum = extractTokenNumber(bToken);
      if (myNum !== null && bNum !== null) {
        return bNum < myNum;
      }
      return false;
    });

    aheadCount = sameQueue.length;
  }

  if (lang === "en") {
    let msg =
      `📊 *Live OPD Queue Status*\n\n` +
      `• Current Running Token: *${runningText}*\n`;

    if (myBooking) {
      const myToken = myBooking.Token_ID || myBooking.tokenId || "—";
      msg += `• Your OPD Token: *${myToken}*\n`;
      msg += `• Patients Ahead of You: *${aheadCount ?? 0}*\n`;
    } else {
      msg += `• Your OPD Token: *Not found for this number*\n`;
    }

    await ctx.sendText(msg.trim());
    return;
  }

  let msg =
    `📊 *लाइव OPD कतार स्टेटस*\n\n` +
    `• अभी चल रहा टोकन: *${runningText}*\n`;

  if (myBooking) {
    const myToken = myBooking.Token_ID || myBooking.tokenId || "—";
    msg += `• आपका OPD टोकन नंबर: *${myToken}*\n`;
    msg += `• आपसे पहले आने वाले मरीज़: *${aheadCount ?? 0}*\n`;
  } else {
    msg += `• आपका OPD टोकन नंबर: *इस नंबर पर कोई सक्रिय टोकन नहीं मिला*\n`;
  }

  await ctx.sendText(msg.trim());
}

module.exports = {
  formatIstYmd,
  sendMainMenu,
  sendLiveQueueStatus,
};
