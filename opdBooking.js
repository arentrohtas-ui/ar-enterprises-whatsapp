function getNowMin(tz = "Asia/Kolkata") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const map = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  return Number(map.hour || 0) * 60 + Number(map.minute || 0);
}

function getThreeDaySlots(tz = "Asia/Kolkata") {
  const now = new Date();
  const nowMin = getNowMin(tz);

  const formatDDMMYYYY = (offset) => {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).formatToParts(new Date(now.getTime() + offset * 86400000));
    const m = {};
    for (const p of parts) if (p.type !== "literal") m[p.type] = p.value;
    return `${m.day}-${m.month}-${m.year}`;
  };

  const startOffset = nowMin >= 1200 ? 1 : 0;

  return [0, 1, 2].map((i) => {
    const offset = startOffset + i;
    const dateStr = formatDDMMYYYY(offset);
    const isToday = offset === 0;
    return {
      id: `day_${i}`,
      date: dateStr,
      isToday,
      labelHi: isToday ? `${dateStr} (आज)` : dateStr,
      labelEn: isToday ? `${dateStr} (Today)` : dateStr,
    };
  });
}

function getTwoHourBatches(rawBatches, isToday, tz = "Asia/Kolkata") {
  const list = String(
    rawBatches || "08:00-10:00,10:00-12:00,12:00-14:00,16:00-18:00,18:00-20:00"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!isToday) return list;
  const nowMin = getNowMin(tz);

  return list.filter((slot) => {
    const end = slot.split("-")[1]?.trim();
    if (!end) return true;
    const [h, m] = end.split(":").map(Number);
    return nowMin < h * 60 + (m || 0);
  });
}

async function loadDoctors(sheetUrl, phoneId) {
  const fallback = [
    {
      doctorId: "DR-101",
      doctorName: "Dr. R. K. Sharma",
      specialty: "General Physician",
      opdFee: 500,
      advanceFee: 100,
      timing: "08:00 AM - 08:00 PM",
      batches: "08:00-10:00,10:00-12:00,12:00-14:00,16:00-18:00,18:00-20:00",
    },
    {
      doctorId: "DR-102",
      doctorName: "Dr. Priya Verma",
      specialty: "Child Specialist",
      opdFee: 600,
      advanceFee: 150,
      timing: "10:00 AM - 08:00 PM",
      batches: "10:00-12:00,12:00-14:00,16:00-18:00,18:00-20:00",
    },
  ];

  if (!sheetUrl) return fallback;
  try {
    const u = `${sheetUrl}?action=get_doctors&phone_number_id=${encodeURIComponent(phoneId || "")}`;
    const res = await fetch(u);
    const data = await res.json();
    if (data?.ok && Array.isArray(data.doctors) && data.doctors.length) {
      return data.doctors;
    }
  } catch (e) {
    console.error("Doctors load fallback:", e.message);
  }
  return fallback;
}

module.exports = { getThreeDaySlots, getTwoHourBatches, loadDoctors };
