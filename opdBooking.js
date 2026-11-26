// 3-दिन की रोलिंग तारीख (आज के स्लॉट बीतने पर कल, परसों, तरसों)
function getThreeDaySlots(tz = "Asia/Kolkata") {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const map = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const nowMin = Number(map.hour || 0) * 60 + Number(map.minute || 0);

  const dayFmt = (offset) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(now.getTime() + offset * 86400000));

  // यदि शाम 8 बजे (1200 min) के बाद है तो कल, परसों, तरसों (1, 2, 3)
  const startOffset = nowMin >= 1200 ? 1 : 0;
  const labelsHi = startOffset === 0 ? ["आज", "कल", "परसों"] : ["कल", "परसों", "तरसों"];
  const labelsEn = startOffset === 0 ? ["Today", "Tomorrow", "Day +2"] : ["Tomorrow", "Day +2", "Day +3"];

  return [0, 1, 2].map((i) => {
    const offset = startOffset + i;
    const date = dayFmt(offset);
    return {
      id: `day_${i}`,
      date,
      isToday: offset === 0,
      labelHi: `${labelsHi[i]} (${date})`,
      labelEn: `${labelsEn[i]} (${date})`,
    };
  });
}

// "08:00-10:00,10:00-12:00,16:00-18:00" से 2-घंटे के बैच निकालना और बीता स्लॉट हटाना
function getTwoHourBatches(rawBatches, isToday, tz = "Asia/Kolkata") {
  const list = String(rawBatches || "08:00-10:00,10:00-12:00,12:00-14:00,16:00-18:00,18:00-20:00")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!isToday) return list;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const nowMin = Number(map.hour || 0) * 60 + Number(map.minute || 0);

  return list.filter((slot) => {
    const end = slot.split("-")[1]?.trim();
    if (!end) return true;
    const [h, m] = end.split(":").map(Number);
    return nowMin < h * 60 + (m || 0);
  });
}

module.exports = { getThreeDaySlots, getTwoHourBatches };
