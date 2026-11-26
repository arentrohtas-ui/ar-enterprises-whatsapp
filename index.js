const express = require("express");
const { getThreeDaySlots, getTwoHourBatches, loadDoctors } = require("./opdBooking");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ar_enterprises_verify_123";
const DEFAULT_TOKEN = process.env.ACCESS_TOKEN || "";
const DEFAULT_PHONE_ID = process.env.PHONE_NUMBER_ID || "";
const SHEET_URL = process.env.WEBHOOK_SINK_URL || "";

const TENANTS = {
  ...(DEFAULT_PHONE_ID
    ? {
        [DEFAULT_PHONE_ID]: {
          id: "client_01",
          name: "AR Enterprises",
          sector: "opd",
          token: DEFAULT_TOKEN,
          sheetTab: "OPD_Tokens",
        },
      }
    : {}),
};

const sessions = new Map();
const seenMsgs = new Set();

const getTenant = (phoneId) =>
  TENANTS[phoneId]
    ? { phoneId, ...TENANTS[phoneId] }
    : {
        phoneId,
        id: "default",
        name: "AR Enterprises",
        sector: "opd",
        token: DEFAULT_TOKEN,
        sheetTab: "OPD_Tokens",
      };

const getSession = (key) => sessions.get(key) || { lang: "hi", step: null, data: {} };
const setSession = (key, patch) => sessions.set(key, { ...getSession(key), ...patch });

async function pushToSheet(payload) {
  if (!SHEET_URL) return;
  await fetch(SHEET_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch((e) => console.error("Sheet error:", e.message));
}

async function sendWA(tenant, to, payload) {
  if (!tenant.token || !tenant.phoneId) return;
  await fetch(`https://graph.facebook.com/v27.0/${tenant.phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tenant.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, ...payload }),
  }).catch((e) => console.error("WA error:", e.message));
}

const sendText = (tenant, to, body) =>
  sendWA(tenant, to, { type: "text", text: { preview_url: false, body } });

const sendLangMenu = (tenant, to) =>
  sendWA(tenant, to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: `नमस्ते / Hello *${tenant.name}*\nभाषा चुनें / Choose language:` },
      action: {
        buttons: [
          { type: "reply", reply: { id: "lang_hi", title: "हिंदी" } },
          { type: "reply", reply: { id: "lang_en", title: "English" } },
        ],
      },
    },
  });

const sendMainMenu = (tenant, to, lang) =>
  sendWA(tenant, to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: lang === "en" ? `*${tenant.name}* — Choose an option:` : `*${tenant.name}* — विकल्प चुनें:`,
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "act_book", title: "OPD Booking" } },
          { type: "reply", reply: { id: "act_status", title: "Live Status" } },
          { type: "reply", reply: { id: "act_timing", title: "Dr Timing" } },
        ],
      },
    },
  });

const sendDoctorMenu = (tenant, to, lang, doctors) =>
  sendWA(tenant, to, {
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: lang === "en" ? "Select Doctor" : "डॉक्टर चुनें" },
      body: {
        text: lang === "en" ? "Choose a doctor first:" : "पहले डॉक्टर चुनें:",
      },
      action: {
        button: lang === "en" ? "Doctors" : "डॉक्टर सूची",
        sections: [
          {
            title: lang === "en" ? "Available Doctors" : "उपलब्ध डॉक्टर",
            rows: doctors.slice(0, 10).map((d) => ({
              id: `doc_${d.doctorId}`,
              title: String(d.doctorName).slice(0, 24),
              description: `Fee ₹${d.opdFee} | Adv ₹${d.advanceFee}`.slice(0, 72),
            })),
          },
        ],
      },
    },
  });

const sendDayButtons = (tenant, to, lang, doc, days) =>
  sendWA(tenant, to, {
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text:
          lang === "en"
            ? `Doctor: *${doc.doctorName}*\nSelect booking date:`
            : `डॉक्टर: *${doc.doctorName}*\nबुकिंग की तारीख चुनें:`,
      },
      action: {
        buttons: days.slice(0, 3).map((d) => ({
          type: "reply",
          reply: {
            id: d.id,
            title: (lang === "en" ? d.labelEn : d.labelHi).slice(0, 20),
          },
        })),
      },
    },
  });

// 2-घंटे के बैच चुनने के लिए इंटरैक्टिव मेन्यू (3 तक हों तो बटन, 4+ हों तो लिस्ट)
const sendBatchSelector = (tenant, to, lang, doc, day, batches) => {
  const isEn = lang === "en";
  const headerText = `${doc ? `${doc.doctorName} | ` : ""}${isEn ? day.labelEn : day.labelHi}`;

  if (batches.length <= 3) {
    return sendWA(tenant, to, {
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: `${headerText}\n${isEn ? "Select 2-hour batch:" : "2-घंटे का बैच चुनें:"}`,
        },
        action: {
          buttons: batches.map((slot, idx) => ({
            type: "reply",
            reply: { id: `batch_${idx}`, title: slot.slice(0, 20) },
          })),
        },
      },
    });
  }

  return sendWA(tenant, to, {
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: isEn ? "2-Hr Batches" : "2-घंटे के बैच" },
      body: {
        text: `${headerText}\n${isEn ? "Choose a 2-hour batch slot:" : "उपलब्ध 2-घंटे का बैच चुनें:"}`,
      },
      action: {
        button: isEn ? "Select Batch" : "बैच चुनें",
        sections: [
          {
            title: isEn ? "Available Slots" : "उपलब्ध समय",
            rows: batches.slice(0, 10).map((slot, idx) => ({
              id: `batch_${idx}`,
              title: slot.slice(0, 24),
              description: isEn ? "2-hour OPD batch" : "2 घंटे का OPD बैच",
            })),
          },
        ],
      },
    },
  });
};

async function routeMessage(tenant, from, text, btnId) {
  const sKey = `${tenant.id}:${from}`;
  const prev = getSession(sKey);
  const low = (text || "").trim().toLowerCase();

  if (["hi", "hello", "start", "lang"].includes(low)) {
    setSession(sKey, { step: null, data: {} });
    return sendLangMenu(tenant, from);
  }
  if (btnId === "lang_hi" || low === "हिंदी") {
    setSession(sKey, { lang: "hi", step: null, data: {} });
    return sendMainMenu(tenant, from, "hi");
  }
  if (btnId === "lang_en" || low === "english") {
    setSession(sKey, { lang: "en", step: null, data: {} });
    return sendMainMenu(tenant, from, "en");
  }

  const lang = prev.lang || "hi";

  if (low === "menu") {
    setSession(sKey, { lang, step: null, data: {} });
    return sendMainMenu(tenant, from, lang);
  }

  if (btnId === "act_book" || low === "1" || low.includes("book")) {
    const doctors = await loadDoctors(SHEET_URL, tenant.phoneId);
    setSession(sKey, { lang, step: "PICK_DOC", data: { doctors } });
    return sendDoctorMenu(tenant, from, lang, doctors);
  }

  if (prev.step === "PICK_DOC" || (btnId && btnId.startsWith("doc_"))) {
    const doctors = prev.data?.doctors || (await loadDoctors(SHEET_URL, tenant.phoneId));
    const chosenId = btnId?.startsWith("doc_") ? btnId.replace("doc_", "") : "";
    const doc =
      doctors.find((d) => d.doctorId === chosenId) ||
      doctors[Number(low) - 1] ||
      doctors.find((d) => text && d.doctorName.toLowerCase().includes(low));

    if (!doc) return sendDoctorMenu(tenant, from, lang, doctors);

    const days = getThreeDaySlots();
    setSession(sKey, { lang, step: "PICK_DAY", data: { doc, days } });
    return sendDayButtons(tenant, from, lang, doc, days);
  }

  if (prev.step === "PICK_DAY") {
    const doc = prev.data?.doc;
    const days = prev.data?.days || getThreeDaySlots();
    const day =
      days.find((d) => d.id === btnId) ||
      days[Number(low) - 1] ||
      days.find((d) => text && (d.labelHi.includes(text) || d.labelEn.includes(text)));

    if (!day) return sendDayButtons(tenant, from, lang, doc, days);

    const batches = getTwoHourBatches(doc?.batches, day.isToday);
    if (!batches.length) {
      return sendText(
        tenant,
        from,
        lang === "en"
          ? "No batches left for this date. Type *MENU* to choose another date."
          : "इस तारीख़ के लिए कोई बैच बाकी नहीं है। दूसरी तारीख़ चुनने के लिए *MENU* लिखें।"
      );
    }

    setSession(sKey, { lang, step: "PICK_BATCH", data: { doc, day, batches } });
    return sendBatchSelector(tenant, from, lang, doc, day, batches);
  }

  if (prev.step === "PICK_BATCH") {
    const batches = prev.data?.batches || [];
    let slot = "";
    if (btnId && btnId.startsWith("batch_")) {
      slot = batches[Number(btnId.replace("batch_", ""))] || "";
    } else {
      slot = batches[Number(low) - 1] || batches.find((b) => b.includes(text)) || "";
    }

    if (!slot) {
      return sendBatchSelector(tenant, from, lang, prev.data?.doc, prev.data?.day, batches);
    }

    setSession(sKey, { lang, step: "ASK_NAME", data: { ...prev.data, slot } });
    return sendText(
      tenant,
      from,
      lang === "en"
        ? `Batch: *${slot}*\nEnter patient name:`
        : `बैच: *${slot}*\nमरीज़ का नाम लिखें:`
    );
  }

  if (prev.step === "ASK_NAME") {
    const tokenId = `OPD-${Math.floor(1000 + Math.random() * 9000)}`;
    const record = {
      sheetTab: tenant.sheetTab,
      tokenId,
      patientName: text,
      doctorName: prev.data?.doc?.doctorName || "",
      date: prev.data?.day?.date || "",
      batch: prev.data?.slot || "",
      phone: from,
      status: "Waiting",
    };
    setSession(sKey, { lang, step: null, data: {} });
    await pushToSheet(record);
    return sendText(
      tenant,
      from,
      `Token: *${tokenId}*\nName: *${text}*\nDoctor: *${record.doctorName}*\nDate: *${record.date}*\nBatch: *${record.batch}*`
    );
  }

  return sendMainMenu(tenant, from, lang);
}

app.get("/", (_, res) => res.send("AR Enterprises Core Ready"));

app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  const entry = req.body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  if (!value?.messages?.[0]) return;

  const msg = value.messages[0];
  if (seenMsgs.has(msg.id)) return;
  seenMsgs.add(msg.id);

  const tenant = getTenant(value.metadata?.phone_number_id);
  const btn = msg.interactive?.button_reply || msg.interactive?.list_reply;
  const text = msg.text?.body || btn?.title || "";
  await routeMessage(tenant, msg.from, text, btn?.id || "");
});

app.listen(PORT, () => console.log(`Core running on ${PORT}`));
