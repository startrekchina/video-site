// Site convention instead of bklit's en-US defaults: Beijing time, "MM-DD" for whole days and
// "HH:mm" within a day (the status board's series are hourly or daily).
const CST = 8 * 3_600_000;
const pad = (n: number) => String(n).padStart(2, "0");

function parts(date: Date) {
  const local = new Date(date.getTime() + CST);
  return {
    day: `${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
    midnight: local.getUTCHours() === 0 && local.getUTCMinutes() === 0,
    weekday: "日一二三四五六"[local.getUTCDay()],
  };
}

export const shortDateFmt = {
  format: (date: Date) => {
    const p = parts(date);
    return p.midnight ? p.day : p.time;
  },
};

export const weekdayDateFmt = {
  format: (date: Date) => {
    const p = parts(date);
    return p.midnight ? `${p.day} 周${p.weekday}` : `${p.day} ${p.time}`;
  },
};

export const hmsTimeFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Shanghai",
});

// `Intl.NumberFormat.prototype.format` is a bound getter — safe to extract.
export const intFmt = new Intl.NumberFormat("zh-CN").format;
