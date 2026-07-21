// ⚠️ 純字串生成 VCALENDAR（零依賴，不裝 ics 套件）。specs/export-offline.md §a。
// 時間一律 floating local time（無 TZID/Z）：跨時區旅行時「當地 08:00」直覺正確，免時區資料庫依賴。
import type { SavedTrip } from "./trips";

const CRLF = "\r\n";

/** RFC 5545 TEXT 跳脫：反斜線/分號/逗號/換行。 */
function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * RFC 5545 摺行：內容行超過 75 bytes（不是字元數）要摺，續行開頭加一個空白。
 * 依 Unicode code point 逐一累加 UTF-8 位元組數，不會切在多位元組字元中間
 * （中文字每字 3 bytes，硬切會產生亂碼）。
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let isFirst = true;

  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    const limit = isFirst ? 75 : 74; // 續行開頭多一個空白佔 1 byte
    if (curBytes + chBytes > limit && cur !== "") {
      out.push((isFirst ? "" : " ") + cur);
      isFirst = false;
      cur = "";
      curBytes = 0;
    }
    cur += ch;
    curBytes += chBytes;
  }
  if (cur) out.push((isFirst ? "" : " ") + cur);
  return out.join(CRLF);
}

/** YYYY-MM-DD + HH:mm（+ addMinutes 分鐘偏移，可跨午夜進位）→ floating local `YYYYMMDDTHHMMSS`。 */
function toIcsLocal(date: string, time: string, addMinutes = 0): string {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const totalMin = h * 60 + min + addMinutes;
  const dayOverflow = Math.floor(totalMin / 1440);
  const clampedMin = ((totalMin % 1440) + 1440) % 1440;
  const finalH = Math.floor(clampedMin / 60);
  const finalMin = clampedMin % 60;

  // 用 setUTCDate 而非讓 Date.UTC 隱式正規化 day 參數：兩者行為相同（ECMAScript 規範保證溢位/負數
  // 都會正確跨月跨年進位，已用 node 實測核對），但顯式呼叫意圖更清楚（GLM REVIEW 建議）。
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dayOverflow);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${String(finalH).padStart(2, "0")}${String(finalMin).padStart(2, "0")}00`;
}

/** DTSTAMP 是「產生時間」的機器時戳，依 RFC 5545 慣例用 UTC（跟事件本身的 floating local 不同性質）。 */
function formatIcsTimestampUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function pushEvent(
  lines: string[],
  uid: string,
  dtstamp: string,
  dtstart: string,
  dtend: string,
  summary: string,
  extra?: { description?: string; location?: string },
) {
  lines.push("BEGIN:VEVENT");
  lines.push(`UID:${uid}@atlas`);
  lines.push(`DTSTAMP:${dtstamp}`);
  lines.push(`DTSTART:${dtstart}`);
  lines.push(`DTEND:${dtend}`);
  lines.push(foldLine(`SUMMARY:${escapeText(summary)}`));
  if (extra?.description) lines.push(foldLine(`DESCRIPTION:${escapeText(extra.description)}`));
  if (extra?.location) lines.push(foldLine(`LOCATION:${escapeText(extra.location)}`));
  lines.push("END:VEVENT");
}

/** 依 startDate 換算 day N 的實際日期；缺 startDate 或格式不合回 undefined（不依賴 lib/trip-days.ts，維持零依賴/單一職責）。 */
function dateForDayLocal(startDate: string, day: number): string | undefined {
  const d = new Date(`${startDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setUTCDate(d.getUTCDate() + (day - 1));
  return d.toISOString().slice(0, 10);
}

export function generateIcs(trip: SavedTrip): string {
  const lines: string[] = [];
  const dtstamp = formatIcsTimestampUtc(new Date());

  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//Atlas AI//Trip Export//ZH");
  lines.push("CALSCALE:GREGORIAN");

  for (const [i, f] of (trip.flights ?? []).entries()) {
    if (!f.date) continue; // 沒日期不知道哪天，略過（缺欄位降級）
    pushEvent(
      lines,
      `${trip.id}-flight-${i}`,
      dtstamp,
      toIcsLocal(f.date, f.departTime),
      toIcsLocal(f.date, f.arriveTime),
      `${f.airline ? `${f.airline} ` : ""}${f.flightNo} ${f.from}→${f.to}`,
      { description: f.note },
    );
  }

  for (const [i, l] of (trip.lodgings ?? []).entries()) {
    if (l.checkInDate) {
      const time = l.checkInTime ?? "15:00";
      pushEvent(
        lines,
        `${trip.id}-lodging-${i}-checkin`,
        dtstamp,
        toIcsLocal(l.checkInDate, time),
        toIcsLocal(l.checkInDate, time, 60),
        `入住 ${l.name}`,
        { location: l.address },
      );
    }
    if (l.checkOutDate) {
      const time = l.checkOutTime ?? "11:00";
      pushEvent(
        lines,
        `${trip.id}-lodging-${i}-checkout`,
        dtstamp,
        toIcsLocal(l.checkOutDate, time),
        toIcsLocal(l.checkOutDate, time, 60),
        `退房 ${l.name}`,
        { location: l.address },
      );
    }
  }

  if (trip.startDate) {
    for (const day of trip.days) {
      const date = dateForDayLocal(trip.startDate, day.day);
      if (!date) continue;
      for (const [i, item] of day.schedule.entries()) {
        pushEvent(
          lines,
          `${trip.id}-day${day.day}-${i}`,
          dtstamp,
          toIcsLocal(date, item.time),
          toIcsLocal(date, item.time, item.durationMin ?? 60),
          item.title,
          { description: item.description, location: item.location },
        );
      }
    }
  } else {
    lines.push("X-COMMENT:此行程未設定出發日期，僅匯出航班與住宿事件");
  }

  lines.push("END:VCALENDAR");
  return lines.join(CRLF) + CRLF;
}
