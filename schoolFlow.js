const SCHOOL_CLASSES = [
  { id: "c_nur_ukg", name: "Nursery - UKG", timing: "08:30 AM - 12:00 PM", fee: "₹1,200/mo" },
  { id: "c_1_5", name: "Class 1 to 5", timing: "08:00 AM - 01:30 PM", fee: "₹1,500/mo" },
  { id: "c_6_10", name: "Class 6 to 10", timing: "08:00 AM - 02:00 PM", fee: "₹2,000/mo" },
];

async function sendHomeMenu(ctx, lang) {
  const isEn = lang === "en";
  return ctx.sendWA({
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: isEn
          ? `🏫 *${ctx.tenant.name}*\nChoose an option:`
          : `🏫 *${ctx.tenant.name}*\nकृपया विकल्प चुनें:`,
      },
      action: {
        buttons: [
          { type: "reply", reply: { id: "sch_adm", title: isEn ? "Admission Inquiry" : "एडमिशन पूछताछ" } },
          { type: "reply", reply: { id: "sch_fee", title: isEn ? "Classes & Fee" : "क्लास व फ़ीस" } },
          { type: "reply", reply: { id: "sch_att", title: isEn ? "Student / Parent" : "स्टूडेंट / पैरेंट" } },
        ],
      },
    },
  });
}

async function sendClassList(ctx, lang, mode) {
  const isEn = lang === "en";
  return ctx.sendWA({
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: isEn ? "Select Class" : "क्लास चुनें" },
      body: {
        text:
          mode === "att"
            ? isEn
              ? "Select student's class:"
              : "स्टूडेंट की क्लास चुनें:"
            : isEn
            ? "Select class for admission inquiry:"
            : "एडमिशन पूछताछ के लिए क्लास चुनें:",
      },
      action: {
        button: isEn ? "Classes" : "क्लास सूची",
        sections: [
          {
            title: isEn ? "School Classes" : "उपलब्ध क्लास",
            rows: SCHOOL_CLASSES.map((c) => ({
              id: `${mode}_${c.id}`,
              title: c.name.slice(0, 24),
              description: `${c.timing} | ${c.fee}`.slice(0, 72),
            })),
          },
        ],
      },
    },
  });
}

async function handleMessage(ctx, text, btnId) {
  const s = ctx.getSession();
  const lang = s.lang || "hi";
  const isEn = lang === "en";
  const low = text.toLowerCase();

  if (low === "menu") {
    ctx.setSession({ lang, step: null, data: {} });
    return sendHomeMenu(ctx, lang);
  }

  // क्लास, टाइमिंग व फ़ीस जानकारी
  if (btnId === "sch_fee" || low.includes("fee") || low.includes("class") || low.includes("timing")) {
    const info = SCHOOL_CLASSES.map(
      (c, i) => `${i + 1}. *${c.name}*\n   Time: ${c.timing} | Fee: ${c.fee}`
    ).join("\n\n");
    return ctx.sendText(
      `🏫 *${ctx.tenant.name}*\n\n${info}` +
        (isEn ? "\n\nType *MENU* for options." : "\n\nमेनू के लिए *MENU* लिखें।")
    );
  }

  // एडमिशन पूछताछ या स्टूडेंट/पैरेंट एंट्री
  if (btnId === "sch_adm" || low.includes("admission") || low.includes("inquiry")) {
    ctx.setSession({ lang, step: "SCH_PICK_CLASS", data: { mode: "admission" } });
    return sendClassList(ctx, lang, "admission");
  }

  if (btnId === "sch_att" || low.includes("student") || low.includes("parent")) {
    ctx.setSession({ lang, step: "SCH_PICK_CLASS", data: { mode: "student_record" } });
    return sendClassList(ctx, lang, "att");
  }

  // क्लास चुनने के बाद नाम पूछना
  if (s.step === "SCH_PICK_CLASS" || btnId.startsWith("admission_") || btnId.startsWith("student_record_")) {
    const mode = s.data?.mode || (btnId.startsWith("student_record_") ? "student_record" : "admission");
    const classId = btnId.replace(/^(admission_|student_record_)/, "");
    const cls = SCHOOL_CLASSES.find((c) => c.id === classId) || SCHOOL_CLASSES[0];

    ctx.setSession({ lang, step: "SCH_ASK_NAME", data: { mode, cls } });
    return ctx.sendText(
      isEn
        ? `🎒 Class: *${cls.name}* (${cls.timing})\nEnter *Student Full Name*: `
        : `🎒 क्लास: *${cls.name}* (${cls.timing})\nकृपया *स्टूडेंट का पूरा नाम* लिखें:`
    );
  }

  // स्कूल की अपनी अलग शीट में सेव करना
  if (s.step === "SCH_ASK_NAME") {
    const cls = s.data?.cls || SCHOOL_CLASSES[0];
    const mode = s.data?.mode || "admission";
    const refId = `${mode === "admission" ? "SCH-ADM" : "SCH-STU"}-${Math.floor(1000 + Math.random() * 9000)}`;

    ctx.setSession({ lang, step: null, data: {} });

    await ctx.postSheet({
      sheetTab: "School_Records",
      action: "create_school_entry",
      createdAt: new Date().toISOString(),
      refId,
      type: mode,
      studentName: text,
      phone: ctx.from,
      className: cls.name,
      timing: cls.timing,
      fee: cls.fee,
      status: mode === "admission" ? "Inquiry Received" : "Active / Logged",
    });

    return ctx.sendText(
      isEn
        ? `✅ *${mode === "admission" ? "Admission Inquiry Saved" : "Student Record Saved"}*\n` +
            `• ID: *${refId}*\n• Student: *${text}*\n• Class: *${cls.name}* (${cls.timing})\n• Fee: ${cls.fee}\n\nType *MENU*.`
        : `✅ *${mode === "admission" ? "एडमिशन पूछताछ दर्ज" : "स्टूडेंट रिकॉर्ड दर्ज"}*\n` +
            `• ID: *${refId}*\n• स्टूडेंट: *${text}*\n• क्लास: *${cls.name}* (${cls.timing})\n• फ़ीस: ${cls.fee}\n\nमेनू के लिए *MENU* लिखें।`
    );
  }

  return sendHomeMenu(ctx, lang);
}

module.exports = { sendHomeMenu, handleMessage };
