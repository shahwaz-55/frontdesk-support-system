// Arvo business calendar: Asia/Kolkata, Mon-Fri, 09:30-18:30.
const START_MINUTE = 570;
const END_MINUTE = 1110;
const MINUTES_PER_DAY = END_MINUTE - START_MINUTE;
function dateKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function isWorkday(d, holidays = new Set()) {
  return d.getDay() !== 0 && d.getDay() !== 6 && !holidays.has(dateKey(d));
}
function atMinute(d, minute) { const x = new Date(d); x.setHours(Math.floor(minute/60), minute%60, 0, 0); return x; }
function nextWorkStart(d, holidays = new Set()) {
  const x = new Date(d); x.setDate(x.getDate()+1);
  while (!isWorkday(x, holidays)) x.setDate(x.getDate()+1);
  return atMinute(x, START_MINUTE);
}
function addWorkingMinutes(input, minutes, holidays = new Set()) {
  let d = new Date(input), remaining = Math.max(0, Number(minutes)||0);
  if (!Number.isFinite(d.getTime())) throw new Error('Invalid date');
  while (remaining > 0) {
    if (!isWorkday(d, holidays)) {
      while (!isWorkday(d, holidays)) d.setDate(d.getDate()+1);
      d = atMinute(d, START_MINUTE);
    }
    const start = atMinute(d, START_MINUTE), end = atMinute(d, END_MINUTE);
    if (d < start) d = start;
    if (d >= end) { d = nextWorkStart(d, holidays); continue; }
    const available = Math.floor((end-d)/60000);
    const used = Math.min(remaining, available);
    d = new Date(d.getTime()+used*60000); remaining -= used;
    if (remaining > 0) d = nextWorkStart(d, holidays);
  }
  return d;
}
function workingMinutesBetween(from, to, holidays = new Set()) {
  let cursor = new Date(from), finish = new Date(to);
  if (!Number.isFinite(cursor.getTime()) || !Number.isFinite(finish.getTime()) || finish <= cursor) return 0;
  let total = 0;
  while (cursor < finish) {
    if (!isWorkday(cursor, holidays)) {
      cursor.setDate(cursor.getDate()+1); cursor = atMinute(cursor, START_MINUTE); continue;
    }
    const start = atMinute(cursor, START_MINUTE), end = atMinute(cursor, END_MINUTE);
    if (cursor < start) cursor = start;
    if (cursor >= end) { cursor = nextWorkStart(cursor, holidays); continue; }
    const stop = finish < end ? finish : end;
    total += Math.max(0, Math.floor((stop-cursor)/60000));
    cursor = stop < finish ? nextWorkStart(cursor, holidays) : finish;
  }
  return total;
}
function endOfCurrentOrNextWorkday(input, holidays = new Set()) {
  let d = new Date(input);
  if (!isWorkday(d, holidays)) {
    while (!isWorkday(d, holidays)) d.setDate(d.getDate()+1);
    d = atMinute(d, START_MINUTE);
  } else if (d >= atMinute(d, END_MINUTE)) {
    d = nextWorkStart(d, holidays);
  } else if (d < atMinute(d, START_MINUTE)) {
    d = atMinute(d, START_MINUTE);
  }
  return atMinute(d, END_MINUTE);
}
function targets(priority, createdAt, holidays = new Set()) {
  // Urgent: 2h response / same working day (9h); Medium: half-day / 3 days;
  // Small: 1 working day / 1 working week.
  const map = {
    URGENT: { response: 120, resolution: MINUTES_PER_DAY },
    MEDIUM: { response: 270, resolution: 3*MINUTES_PER_DAY },
    SMALL: { response: MINUTES_PER_DAY, resolution: 5*MINUTES_PER_DAY }
  };
  const t = map[priority]; if (!t) throw new Error('Invalid priority');
  return {
    responseDueAt: addWorkingMinutes(createdAt, t.response, holidays),
    resolutionDueAt: priority === 'URGENT' ? endOfCurrentOrNextWorkday(createdAt, holidays) : addWorkingMinutes(createdAt, t.resolution, holidays)
  };
}
module.exports = { addWorkingMinutes, workingMinutesBetween, targets, isWorkday, MINUTES_PER_DAY };
