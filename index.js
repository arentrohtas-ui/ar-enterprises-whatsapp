const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "ar_enterprises_verify_123";

// डुप्लिकेट webhook deliveries रोकने के लिए इन-मेमोरी सेट (प्रोडक्शन में DB/Redis में ले जा सकते हैं)
const processedMessageIds = new Set();

function markProcessed(msgId) {
  if (!msgId) return false;
  if (processedMessageIds.has(msgId)) return true;
  processedMessageIds.add(msgId);
  if (processedMessageIds.size > 5000) {
    const firstKey = processedMessageIds.values().next().value;
    processedMessageIds.delete(firstKey);
  }
  return false;
}

async function sendWhatsAppText(to, bodyText) {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.error("Missing ACCESS_TOKEN or PHONE_NUMBER_ID in environment variables");
    return;
  }

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v27.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          preview_url: false,
          body: bodyText,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("WhatsApp Send API response:", JSON.stringify(response.data, null, 2));
  } catch (err) {
    console.error(
      "WhatsApp Send API error:",
      JSON.stringify(err.response?.data || err.message, null, 2)
    );
  }
}

async function sendInteractiveMenu(to) {
  if (!ACCESS_TOKEN || !PHONE_NUMBER_ID) return;

  try {
    const response = await axios.post(
      `https://graph.facebook.com/v27.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: {
            text:
              "नमस्ते! *AR Enterprises* में आपका स्वागत है।\n" +
              "कृपया नीचे से विकल्प चुनें:\n\n" +
              "• *OPD / Appointment* — टोकन या अपॉइंटमेंट जानकारी\n" +
              "• *WhatsApp Bot* — क्लिनिक, स्कूल, जिम या रेस्टोरेंट ऑटोमेशन\n" +
              "• *Website / Support* — कस्टम वेबसाइट व सहायता",
          },
          action: {
            buttons: [
              {
                type: "reply",
                reply: { id: "menu_opd", title: "OPD Token" },
              },
              {
                type: "reply",
                reply: { id: "menu_automation", title: "WhatsApp Bot" },
              },
              {
                type: "reply",
                reply: { id: "menu_support", title: "Website & Help" },
              },
            ],
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("Interactive menu sent:", JSON.stringify(response.data, null, 2));
  } catch (err) {
    console.error(
      "Interactive menu error:",
      JSON.stringify(err.response?.data || err.message, null, 2)
    );
  }
}

function buildReplyForInput(inputText, buttonId) {
  const clean = (inputText || "").trim().toLowerCase();

  if (
    buttonId === "menu_opd" ||
    clean === "1" ||
    clean.includes("opd") ||
    clean.includes("token") ||
    clean.includes("appointment")
  ) {
    return (
      "*AR Enterprises — OPD & Token System*\n" +
      "• लाइव OPD टोकन व WhatsApp अपॉइंटमेंट बुकिंग उपलब्ध है।\n" +
      "• अपनी बुकिंग या टोकन स्टेटस के लिए *TOKEN <आपका नाम>* लिखकर भेजें।\n" +
      "• मुख्य मेनू के लिए *MENU* लिखें।"
    );
  }

  if (
    buttonId === "menu_automation" ||
    clean === "2" ||
    clean.includes("bot") ||
    clean.includes("automation") ||
    clean.includes("school") ||
    clean.includes("clinic")
  ) {
    return (
      "*AR Enterprises — WhatsApp Cloud API Automation*\n" +
      "हम क्लिनिक, हॉस्पिटल, स्कूल, कोचिंग, जिम और रेस्टोरेंट के लिए ऑटो-रिप्लाई, अपॉइंटमेंट, रिमाइंडर और पेमेंट फ्लो बनाते हैं।\n" +
      "डेमो के लिए *DEMO <बिज़नेस का प्रकार>* लिखें (जैसे: *DEMO Clinic*)।"
    );
  }

  if (
    buttonId === "menu_support" ||
    clean === "3" ||
    clean.includes("website") ||
    clean.includes("support") ||
    clean.includes("help")
  ) {
    return (
      "*AR Enterprises — Web & Automation Support*\n" +
      "• कस्टम वेबसाइट, WhatsApp API इंटीग्रेशन और लाइव सपोर्ट।\n" +
      "• कृपया अपना नाम और ज़रूरत यहाँ मैसेज कर दें, टीम जल्द संपर्क करेगी।"
    );
  }

  if (clean.startsWith("token ")) {
    const patientName = inputText.slice(6).trim() || "Guest";
    const tokenNumber = "OPD-" + Math.floor(100 + Math.random() * 900);
    return (
      `*OPD टोकन जारी*\n` +
      `नाम: *${patientName}*\n` +
      `टोकन नंबर: *${tokenNumber}*\n` +
      `स्थिति: कतार में पंजीकृत\n` +
      `मेनू देखने के लिए *MENU* लिखें।`
    );
  }

  if (clean.startsWith("demo ")) {
    const bizType = inputText.slice(5).trim() || "Business";
    return (
      `*डेमो अनुरोध दर्ज*\n` +
      `सेक्टर: *${bizType}*\n` +
      `हमारी *AR Enterprises* टीम आपके *${bizType}* वर्कफ़्लो का डेमो सेटअप तैयार करेगी।`
    );
  }

  return null;
}

// Health check
app.get("/", (req, res) => {
  res.status(200).send("AR Enterprises WhatsApp Bot is running.");
});

// Webhook Verification (GET)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified successfully.");
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Inbound Webhook Events (POST)
app.post("/webhook", async (req, res) => {
  // Meta को तुरंत 200 OK भेजें ताकि retry न हो
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== "whatsapp_business_account") return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const value = change.value || {};
        const phoneNumberId = value.metadata?.phone_number_id;

        // यदि ENV में PHONE_NUMBER_ID सेट है तो मैच करें (डेमो/टेस्ट के दौरान मिसमैच हो तो लॉग करें)
        if (PHONE_NUMBER_ID && phoneNumberId && phoneNumberId !== PHONE_NUMBER_ID) {
          console.warn(
            `Incoming phone_number_id (${phoneNumberId}) differs from ENV PHONE_NUMBER_ID (${PHONE_NUMBER_ID})`
          );
        }

        for (const msg of value.messages || []) {
          if (markProcessed(msg.id)) {
            console.log("Duplicate message ignored:", msg.id);
            continue;
          }

          const from = msg.from;
          let incomingText = "";
          let buttonId = "";

          if (msg.type === "text") {
            incomingText = msg.text?.body || "";
          } else if (msg.type === "interactive") {
            const replyObj =
              msg.interactive?.button_reply || msg.interactive?.list_reply;
            buttonId = replyObj?.id || "";
            incomingText = replyObj?.title || "";
          } else {
            await sendWhatsAppText(
              from,
              "अभी टेक्स्ट या बटन मैसेज समर्थित है। कृपया *MENU* लिखकर विकल्प देखें।"
            );
            continue;
          }

          console.log(
            `[AR Enterprises | ${phoneNumberId || PHONE_NUMBER_ID}] From ${from}: ${
              incomingText || buttonId
            }`
          );

          const clean = incomingText.trim().toLowerCase();
          if (
            clean === "hi" ||
            clean === "hlw" ||
            clean === "hello" ||
            clean === "namaste" ||
            clean === "menu"
          ) {
            await sendInteractiveMenu(from);
          } else {
            const customReply = buildReplyForInput(incomingText, buttonId);
            if (customReply) {
              await sendWhatsAppText(from, customReply);
            } else {
              await sendInteractiveMenu(from);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("Webhook processing error:", err);
  }
});

app.listen(PORT, () => {
  console.log(`AR Enterprises server running on port ${PORT}`);
});
