const express = require('express');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'ar_enterprises_verify_123';

const DEFAULT_ACCESS_TOKEN = process.env.ACCESS_TOKEN || '';
const DEFAULT_PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || '';

// भविष्य में अलग-अलग क्लाइंट्स के Phone Number ID के हिसाब से यहाँ या डेटाबेस से रूट होगा
const TENANTS = {};

function getTenantConfig(phoneNumberId) {
  if (phoneNumberId && TENANTS[phoneNumberId]) {
    return {
      phoneNumberId,
      name: TENANTS[phoneNumberId].name,
      token: TENANTS[phoneNumberId].token
    };
  }
  return {
    phoneNumberId: phoneNumberId || DEFAULT_PHONE_NUMBER_ID,
    name: 'AR Enterprises',
    token: DEFAULT_ACCESS_TOKEN
  };
}

app.get('/', (req, res) => {
  res.status(200).send('AR Enterprises Multi-Tenant WhatsApp Server is running');
});

// Meta Webhook Verification (GET)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// Incoming WhatsApp Events & Messages (POST)
app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const phoneNumberId = value?.metadata?.phone_number_id;
    const message = value?.messages?.[0];

    if (message && message.type === 'text') {
      const from = message.from;
      const textBody = message.text.body.trim();
      const tenant = getTenantConfig(phoneNumberId);

      console.log(`[${tenant.name} | ${phoneNumberId}] From ${from}: ${textBody}`);

      if (tenant.token && phoneNumberId) {
        const replyText =
          `नमस्ते! *${tenant.name}* से जुड़ने के लिए धन्यवाद।\n` +
          `आपका संदेश मिला: "${textBody}"\n` +
          `विकल्प: 1. OPD टोकन | 2. जानकारी | 3. सहायता`;

        await sendWhatsAppMessage(phoneNumberId, tenant.token, from, replyText);
      } else {
        console.warn('Missing ACCESS_TOKEN or PHONE_NUMBER_ID');
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook error:', err);
    res.sendStatus(200);
  }
});

async function sendWhatsAppMessage(phoneNumberId, token, to, text) {
  const url = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text }
    })
  });
  const data = await response.json();
  console.log('WhatsApp Send API response:', data);
}

app.listen(PORT, () => {
  console.log(`AR Enterprises server running on port ${PORT}`);
});
