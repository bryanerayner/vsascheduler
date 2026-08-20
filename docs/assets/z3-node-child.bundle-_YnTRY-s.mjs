// src/z3-node-child.ts
import { parentPort } from "node:worker_threads";

// src/dates.ts
var MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12
};
var WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function iso(y, m, d) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function parseIso(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDays(isoDate, n) {
  const dt = parseIso(isoDate);
  dt.setUTCDate(dt.getUTCDate() + n);
  return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
function weekdayName(isoDate) {
  return WEEKDAYS[parseIso(isoDate).getUTCDay()];
}
function inferYear(title, fallback = 2026) {
  const m = String(title || "").match(/20\d{2}/);
  return m ? Number(m[0]) : fallback;
}
function parseClock(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = (m[3] || "").replace(/\./g, "");
  if (ap.startsWith("p") && h < 12) h += 12;
  if (ap.startsWith("a") && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
function formatClockShort(minutes) {
  const h24 = Math.floor(minutes / 60) % 24;
  const min = minutes % 60;
  return `${h24}:${String(min).padStart(2, "0")}`;
}
function parseHumanDate(raw, year) {
  const s = String(raw || "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  const isoMatch = s.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const range = s.match(
    /\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s*[–—-]\s*(\d{1,2})(?:st|nd|rd|th)?\b/
  );
  if (range && MONTHS[range[1].toLowerCase()]) {
    return iso(year, MONTHS[range[1].toLowerCase()], Number(range[2]));
  }
  const long = s.match(
    /\b(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)?\s*,?\s*([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(20\d{2}))?\b/i
  );
  if (long && MONTHS[long[1].toLowerCase()]) {
    const y = long[3] ? Number(long[3]) : year;
    const month = MONTHS[long[1].toLowerCase()];
    const day = Number(long[2]);
    if (day >= 1 && day <= 31) return iso(y, month, day);
  }
  const numeric = s.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (numeric) return iso(Number(numeric[3]), Number(numeric[1]), Number(numeric[2]));
  return null;
}
function thanksgivingSaturday(year) {
  let d = new Date(Date.UTC(year, 10, 1));
  const thursdays = [];
  while (d.getUTCMonth() === 10) {
    if (d.getUTCDay() === 4) thursdays.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const t = thursdays[3] || thursdays[thursdays.length - 1];
  const sat = new Date(t);
  sat.setUTCDate(t.getUTCDate() + 2);
  return iso(sat.getUTCFullYear(), sat.getUTCMonth() + 1, sat.getUTCDate());
}
function saturdaysInclusive(firstIso, lastIso, weekStarts = "Saturday") {
  const out = [];
  const { start } = weekBounds(firstIso, weekStarts || "Saturday");
  let sat = start;
  while (weekdayName(sat) !== "saturday") sat = addDays(sat, 1);
  if (sat > lastIso) return out;
  for (let d = sat; d <= lastIso; d = addDays(d, 7)) out.push(d);
  return out;
}
function weekBounds(dateIso, weekStarts) {
  const startName = weekStarts.trim().toLowerCase();
  const startIdx = WEEKDAYS.indexOf(startName);
  const dow = parseIso(dateIso).getUTCDay();
  const back = startIdx < 0 ? dow : (dow - startIdx + 7) % 7;
  const start = addDays(dateIso, -back);
  return { start, end: addDays(start, 6) };
}
function parseAvailability(raw) {
  const s = String(raw || "").trim();
  if (!s) return [];
  const windows = [];
  const chunks = s.split(/;|\n/).map((c) => c.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const m = chunk.match(
      /^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*[–—-]\s*(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)/i
    );
    if (!m) continue;
    const start = parseClock(m[2]);
    const end = parseClock(m[3]);
    if (start == null || end == null) continue;
    windows.push({ day: m[1].toLowerCase(), startMinutes: start, endMinutes: end });
  }
  return windows;
}

// src/calendar.ts
function seasonYear(league) {
  return inferYear(league.season.title || league.season.headerTitle, 2026);
}
function playingSaturdays(league) {
  const first = league.season.firstIso;
  const last = league.season.lastIso;
  if (!first || !last) return [];
  return saturdaysInclusive(first, last, league.season.weekStarts || "Saturday");
}
function byeIsos(league) {
  const year = seasonYear(league);
  const set = /* @__PURE__ */ new Set();
  for (const s of league.season.specials) {
    if (s.kind !== "bye") continue;
    if (s.iso) {
      set.add(snapToSaturday(s.iso, league.season.weekStarts));
      continue;
    }
    if (/thanksgiving/i.test(s.raw + " " + (s.note || ""))) {
      const t = thanksgivingSaturday(year);
      const sats = playingSaturdays(league);
      const inRange = sats.find((d) => d === t) || sats.filter((d) => d <= t).pop();
      if (inRange) set.add(inRange);
    }
  }
  return set;
}
function rainCheckIsos(league) {
  return league.season.specials.filter((s) => s.kind === "rain-check" && s.iso).map((s) => s.iso);
}
function snapToSaturday(isoDate, weekStarts) {
  if (weekdayName(isoDate) === "saturday") return isoDate;
  const { start } = weekBounds(isoDate, weekStarts || "Saturday");
  let d = start;
  for (let i = 0; i < 7; i++) {
    if (weekdayName(d) === "saturday") return d;
    d = addDays(d, 1);
  }
  return isoDate;
}
function weeks(league) {
  const sats = playingSaturdays(league);
  const byes = byeIsos(league);
  const rains = new Set(rainCheckIsos(league));
  const startName = league.season.weekStarts || "Saturday";
  const out = sats.map((sat) => {
    const { start, end } = weekBounds(sat, startName);
    const isBye = byes.has(sat);
    return {
      startIso: start,
      endIso: end,
      label: sat,
      kind: isBye ? "bye" : "playing",
      saturdays: [sat]
    };
  });
  for (const r of rains) {
    if (out.some((w) => w.saturdays.includes(r))) continue;
    const { start, end } = weekBounds(r, startName);
    out.push({
      startIso: start,
      endIso: end,
      label: r,
      kind: "rain-check",
      saturdays: [r]
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}
function owedGames(league) {
  return weeks(league).filter((w) => w.kind === "playing").length;
}

// src/model.ts
function printName(p) {
  const custom = (p.printName || "").trim();
  if (custom) return custom;
  return [p.first, p.last].filter(Boolean).join(" ").trim();
}
function teamKey(name, bracket) {
  return `${bracket.trim()} ${name.trim()}`.replace(/\s+/g, " ");
}
function teamLabel(t) {
  return teamKey(t.name, t.bracket);
}
function norm(s) {
  return String(s || "").toLowerCase().replace(/[_./]+/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
function familyLast(f) {
  return f.parents.find((p) => p.last)?.last || f.children.find((c) => c.last)?.last || "Family";
}
function personKey(p) {
  const name = printName(p);
  const phone = (p.phone || "").trim();
  return phone ? `${name}::${phone}` : name;
}

// src/carve.ts
function findTeam(league, raw) {
  const nraw = norm(raw);
  if (!nraw) return void 0;
  const exact = league.teams.find((t) => norm(teamLabel(t)) === nraw);
  if (exact) return exact;
  const named2 = league.teams.filter((t) => norm(t.name) === nraw);
  return named2.length === 1 ? named2[0] : void 0;
}
function withheldMatchups(league) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const t of league.teams) {
    for (const w of t.willNotPlay) {
      const other = findTeam(league, w);
      if (!other || teamLabel(other) === teamLabel(t)) continue;
      const pair = [teamLabel(t), teamLabel(other)].sort();
      const key = pair.join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a: pair[0], b: pair[1] });
    }
  }
  return out;
}
function snapCarveDate(league, raw) {
  if (!raw) return void 0;
  const parsed = parseHumanDate(raw, seasonYear(league));
  if (!parsed) return void 0;
  const sats = playingSaturdays(league);
  if (sats.includes(parsed)) return parsed;
  let d = parsed;
  for (let i = 0; i < 7; i++) {
    if (weekdayName(d) === "saturday") break;
    d = addDays(d, -1);
  }
  if (sats.includes(d)) return d;
  return sats.find((s) => Math.abs(Date.parse(`${s}T00:00:00Z`) - Date.parse(`${parsed}T00:00:00Z`)) <= 2 * 864e5) || parsed;
}
function carveDateShort(c) {
  const raw = c.date || "";
  const m = raw.match(/([A-Za-z]+)\s+(\d{1,2})/);
  if (m) {
    const month = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
    return `${month} ${m[2]}`;
  }
  return raw;
}
function clock(raw) {
  return parseClock(raw) ?? -1;
}
function rematchTally(games) {
  const m = /* @__PURE__ */ new Map();
  for (const g of games) {
    const k = [g.home, g.away].sort().join(" vs ");
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
function matchupScoreLines(league, games) {
  const withheld = withheldMatchups(league);
  const scores = [];
  const diagnostics = [];
  for (const w of withheld) {
    scores.push({ key: "withheld", text: `Matchup withheld: ${w.a} vs ${w.b}` });
  }
  if (!withheld.length) return { scores, diagnostics };
  const tally = rematchTally(games);
  const cap = league.season.rematchCap || 2;
  const extra = [...tally.entries()].filter(([, n]) => n > cap);
  const who = extra.map(([k, n]) => `${k} \xD7${n}`).join("; ");
  scores.push({
    key: "rematch",
    text: extra.length ? `other clubs absorbed an extra rematch to make the ban possible \u2014 ${who}` : `no extra rematches needed to keep ${withheld.map((w) => `${w.a} vs ${w.b}`).join(", ")} off the table`
  });
  if (extra.length) {
    for (const w of withheld) {
      diagnostics.push(
        `The rematch cap is ${cap}. Honoring ${w.a} vs ${w.b} withheld would break it \u2014 raise the cap or drop the ban.`
      );
    }
  }
  return { scores, diagnostics };
}
function carveHonorLines(league, games) {
  if (!league.carveOuts.length) return [];
  const honored = [];
  for (const c of league.carveOuts) {
    const team = findTeam(league, c.team);
    if (!team) continue;
    const label = teamLabel(team);
    const mine = games.filter((g) => g.home === label || g.away === label);
    if (c.notAt) {
      const snap = snapCarveDate(league, c.date);
      const onDay = snap ? mine.filter((g) => g.dateIso === snap) : mine;
      const want = clock(c.notAt);
      if (onDay.length && onDay.every((g) => clock(g.kickoff) !== want)) {
        honored.push(`${label} ${carveDateShort(c)} ${c.notAt} withheld`);
      }
    }
    if (c.mustUse) {
      const want = clock(c.mustUse);
      const relevant = c.everySaturday ? mine.filter((g) => weekdayName(g.dateIso) === "saturday") : mine;
      if (relevant.length && relevant.every((g) => clock(g.kickoff) === want)) {
        honored.push(`${label} ${c.everySaturday ? "every Saturday" : carveDateShort(c)} ${c.mustUse}`);
      }
    }
  }
  return [
    {
      key: "carve-outs",
      text: `carve-outs honored: ${honored.length}${honored.length ? ` \u2014 ${honored.join("; ")}` : ""}`
    }
  ];
}
function mondaySixCount(games) {
  const six = games.filter((g) => g.ageGroup === "6U");
  return { monday: six.filter((g) => weekdayName(g.dateIso) === "monday").length, total: six.length };
}
function mustUseMondayDiagnostic(league, games) {
  const lock = league.carveOuts.find((c) => c.mustUse && c.everySaturday);
  if (!lock) return void 0;
  const { monday, total } = mondaySixCount(games);
  if (!monday || !total) return void 0;
  const team = findTeam(league, lock.team);
  const label = team ? teamLabel(team) : lock.team;
  const word = monday === 1 ? "game" : "games";
  return `Honoring ${label} at ${lock.mustUse} every Saturday moved ${monday} 6U ${word} to Monday night.`;
}

// src/clock.ts
var NTSSA_CLOCK = {
  LL: { warmupMinutes: 15, firstHalfMinutes: 16, secondHalfMinutes: 16, waterBreakMinutes: 2, halfTimeMinutes: 4, vacateMinutes: 10 },
  "6U": { warmupMinutes: 15, firstHalfMinutes: 16, secondHalfMinutes: 16, waterBreakMinutes: 2, halfTimeMinutes: 4, vacateMinutes: 10 },
  "8U": { warmupMinutes: 15, firstHalfMinutes: 20, secondHalfMinutes: 20, waterBreakMinutes: 2, halfTimeMinutes: 6, vacateMinutes: 10 },
  "10U": { warmupMinutes: 15, firstHalfMinutes: 25, secondHalfMinutes: 25, waterBreakMinutes: 0, halfTimeMinutes: 5, vacateMinutes: 10 },
  "12U": { warmupMinutes: 15, firstHalfMinutes: 30, secondHalfMinutes: 30, waterBreakMinutes: 0, halfTimeMinutes: 10, vacateMinutes: 10 },
  "14U": { warmupMinutes: 15, firstHalfMinutes: 35, secondHalfMinutes: 35, waterBreakMinutes: 0, halfTimeMinutes: 10, vacateMinutes: 10 },
  "16U": { warmupMinutes: 15, firstHalfMinutes: 40, secondHalfMinutes: 40, waterBreakMinutes: 0, halfTimeMinutes: 10, vacateMinutes: 10 }
};
function bracketClockKey(raw) {
  const s = String(raw || "").trim();
  const uFirst = s.match(/^u\s*(\d+)/i);
  if (uFirst) return `${uFirst[1]}U`;
  const nU = s.match(/^(\d+)\s*u/i);
  if (nU) return `${nU[1]}U`;
  if (/^ll$|learner/i.test(s)) return "LL";
  const girls = s.match(/^(\d+)\s*u\b/i);
  if (girls) return `${girls[1]}U`;
  return s;
}
function ntssaClock(bracket) {
  const key = bracketClockKey(bracket);
  const numbered = key.match(/^(\d+)U/i);
  if (numbered && NTSSA_CLOCK[`${numbered[1]}U`]) return { ...NTSSA_CLOCK[`${numbered[1]}U`] };
  if (NTSSA_CLOCK[key]) return { ...NTSSA_CLOCK[key] };
  return { ...NTSSA_CLOCK["6U"] };
}
function num(n, fallback) {
  return n == null || !Number.isFinite(n) || n < 0 ? fallback : Math.round(n);
}
function resolveClock(ag) {
  const def = ntssaClock(ag?.name || "6U");
  const play = num(ag?.gameLengthMinutes, def.firstHalfMinutes + def.secondHalfMinutes);
  const first = num(ag?.firstHalfMinutes, Math.floor(play / 2));
  const second = num(ag?.secondHalfMinutes, Math.max(0, play - first));
  return {
    warmupMinutes: num(ag?.warmupMinutes, def.warmupMinutes),
    firstHalfMinutes: first,
    secondHalfMinutes: second,
    waterBreakMinutes: num(ag?.waterBreakMinutes, def.waterBreakMinutes),
    halfTimeMinutes: num(ag?.halfTimeMinutes, def.halfTimeMinutes),
    vacateMinutes: num(ag?.vacateMinutes, def.vacateMinutes)
  };
}
function playMinutes(c) {
  return c.firstHalfMinutes + c.secondHalfMinutes;
}
function onClockMinutes(c) {
  const waters = c.waterBreakMinutes > 0 ? 2 * c.waterBreakMinutes : 0;
  return playMinutes(c) + waters + c.halfTimeMinutes;
}
function occupyMinutes(c) {
  return c.warmupMinutes + onClockMinutes(c) + c.vacateMinutes;
}

// src/haversine.ts
var R_KM = 6371;
var KM_PER_MILE = 1.60934;
var MPH = 40;
function toRad(d) {
  return d * Math.PI / 180;
}
function haversineMiles(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  const km = 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  return km / KM_PER_MILE;
}
function crowFliesMinutes(a, b) {
  const miles = haversineMiles(a, b);
  return Math.max(1, Math.round(miles / MPH * 60));
}

// src/validate.ts
function crossClassPairs(league) {
  const out = [];
  for (const a of league.ageGroups) {
    for (const m of a.mayPlayWith) {
      if (norm(m) === norm(a.name)) continue;
      const b = league.ageGroups.find((x) => norm(x.name) === norm(m));
      if (!b) continue;
      if (!b.mayPlayWith.some((x) => norm(x) === norm(a.name))) continue;
      const key = [a.name, m].sort((x, y) => x.localeCompare(y)).join(" \u2194 ");
      if (!out.includes(key)) out.push(key);
    }
  }
  return out;
}
function specialSnapsTo(iso2, dateIso) {
  if (iso2 === dateIso) return true;
  return Math.abs(Date.parse(`${iso2}T00:00:00Z`) - Date.parse(`${dateIso}T00:00:00Z`)) <= 2 * 864e5;
}
function isHomeGuestDate(league, dateIso) {
  if ((league.season.homeWeekends || []).some((w) => w.dateIso === dateIso)) return true;
  return league.season.specials.some((s) => {
    if (s.kind !== "interleague-home" || !s.iso) return false;
    return specialSnapsTo(s.iso, dateIso);
  });
}
function isAwayGuestDate(league, dateIso) {
  if ((league.season.awayWeekends || []).some((w) => w.dateIso === dateIso)) return true;
  return league.season.specials.some((s) => {
    if (s.kind !== "interleague-away" || !s.iso) return false;
    return specialSnapsTo(s.iso, dateIso);
  });
}
function travelMinutes(league, from, to) {
  if (norm(from) === norm(to)) return { minutes: 0, crowFlies: false, missing: false };
  const hit = league.travel.find(
    (t) => norm(t.from) === norm(from) && norm(t.to) === norm(to) || norm(t.from) === norm(to) && norm(t.to) === norm(from)
  );
  if (hit && hit.minutes != null) return { minutes: hit.minutes, crowFlies: !!hit.crowFlies, missing: false };
  const a = league.campuses.find((c) => norm(c.name) === norm(from));
  const b = league.campuses.find((c) => norm(c.name) === norm(to));
  if (a && b && a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    return {
      minutes: crowFliesMinutes({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng }),
      crowFlies: true,
      missing: false
    };
  }
  return { minutes: null, crowFlies: false, missing: true };
}

// src/fake-league.ts
function field(name, type, campus, parking, availableRaw) {
  return {
    name,
    type,
    campus,
    parking,
    availableRaw,
    windows: parseAvailability(availableRaw)
  };
}
var FIELDS = [
  field("Van Complex Field A", "small", "Van Complex", "Lot North", "Saturday 8:00\u201318:00"),
  field("Van Complex Field B", "small", "Van Complex", "Lot North", "Saturday 8:00\u201318:00; Monday 18:00\u201320:30"),
  field("Van Complex Field C", "medium", "Van Complex", "Lot East", "Saturday 8:00\u201318:00; Monday 18:00\u201320:30"),
  field("Van Complex Field D", "medium", "Van Complex", "Lot East", "Saturday 8:00\u201318:00; Monday 18:00\u201320:30"),
  field("Van Complex Field E", "nine", "Van Complex", "Lot South", "Saturday 8:00\u201318:00; Monday 18:00\u201320:30"),
  field("Van High School Stadium", "full", "Van High School", "Student Lot", "Saturday 12:00\u201318:00")
];

// src/planning.ts
function minutesOf(raw, fallback) {
  let n = parseClock(raw) ?? fallback;
  if (n < 7 * 60) n += 12 * 60;
  return n;
}
function preferredKickCost(league, bracket, minutes, day = "saturday") {
  const hits = league.preferredSlots.filter((p) => norm(p.bracket) === norm(bracket)).sort((a, b) => a.rank - b.rank);
  if (!hits.length) return 0;
  const sameDay = hits.filter((p) => p.day.toLowerCase() === day.toLowerCase());
  const exact = sameDay.find((p) => minutesOf(p.time, -1) === minutes);
  if (exact) return (exact.rank - 1) * 8;
  if (!sameDay.length) return 80;
  const start = minutesOf(sameDay[0].time, 9 * 60);
  const delta = minutes - start;
  if (delta === 0) return 0;
  if (delta < 0) return Math.ceil(-delta / 15) * 3;
  return Math.ceil(delta / 15) * 6;
}

// src/folding.ts
var FAKE_LEAGUE_HEAP_BOUND = 48;
function heapBoundFor(naivePersonVars) {
  if (naivePersonVars <= 200) return FAKE_LEAGUE_HEAP_BOUND;
  return Math.max(FAKE_LEAGUE_HEAP_BOUND, Math.ceil(naivePersonVars / 3));
}
function named(p) {
  return !!p && !!printName(p);
}
function samePerson(a, b) {
  if (!named(a) || !named(b)) return false;
  if (printName(a) !== printName(b)) return false;
  if (a.phone && b.phone) return a.phone === b.phone;
  return true;
}
function personSat(p) {
  return `person:${personKey(p)}`;
}
function householdSat(f) {
  const head = f.parents[0];
  return `hh:${head ? personKey(head) : familyLast(f)}`;
}
function unitSat(label) {
  return `unit:${label}`;
}
function restSat(label) {
  return `rest:${label}`;
}
function theName(bare) {
  if (/^the\s/i.test(bare)) return bare;
  if (/s$/i.test(bare)) return `The ${bare}`;
  return `The ${bare}s`;
}
function teamBare(label) {
  return label.replace(/^\d+U(?:\s+Girls)?\s+/i, "").trim() || label;
}
function captionFor(kind) {
  return kind === "unit" ? "easy peasy" : "complexity here and there";
}
function displayTeam(label, kind) {
  const bare = teamBare(label);
  const title = /super stars|oreos/i.test(bare) ? theName(bare) : label;
  return `${title} \u2014 ${captionFor(kind)}`;
}
function displayHousehold(last, kind) {
  const fold = kind === "folded" ? "unit" : "exploded";
  return `${theName(last)} \u2014 ${captionFor(fold)}`;
}
function teamCampuses(league, team) {
  const ag = league.ageGroups.find((a) => norm(a.name) === norm(team.bracket));
  const fields = league.fields.filter((f) => ag?.fieldClasses.some((c) => norm(c) === norm(f.type)));
  return new Set(fields.map((f) => f.campus));
}
function findTeam2(league, raw) {
  const n = norm(raw);
  return league.teams.find(
    (t) => norm(teamLabel(t)) === n || norm(`${t.bracket} ${t.name}`) === n || norm(t.name) === n
  );
}
function teamsForAdult(league, p) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (t) => {
    if (!t) return;
    const k = teamLabel(t);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  for (const t of league.teams) {
    if (t.coach && samePerson(t.coach, p)) add(t);
    if (t.assistant && samePerson(t.assistant, p)) add(t);
  }
  for (const raw of [...p.coachOf || [], ...p.assistantOf || []]) add(findTeam2(league, raw));
  return out;
}
function familyOnTeam(f, team) {
  const label = teamLabel(team);
  if (f.children.some((c) => c.bracket === team.bracket && c.team === team.name)) return true;
  return f.parents.some(
    (p) => [...p.coachOf, ...p.assistantOf].some(
      (raw) => norm(raw) === norm(label) || norm(raw) === norm(`${team.bracket} ${team.name}`)
    )
  );
}
function staffDoubleDuty(league, p) {
  return league.staff.some((s) => samePerson(s, p));
}
function analyzeHousehold(league, f) {
  const last = familyLast(f);
  const head = f.parents[0];
  const id = head ? personKey(head) : last;
  const teams = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (t) => {
    if (!t) return;
    const k = teamLabel(t);
    if (seen.has(k)) return;
    seen.add(k);
    teams.push(t);
  };
  for (const c of f.children) add(league.teams.find((t) => t.bracket === c.bracket && t.name === c.team));
  for (const p of f.parents) for (const t of teamsForAdult(league, p)) add(t);
  const reasons = [];
  const childTeams = new Set(
    f.children.map((c) => `${c.bracket} ${c.team}`).filter((s) => s.trim())
  );
  if (childTeams.size > 1) reasons.push("siblings-two-teams");
  for (const p of f.parents) {
    const duties = teamsForAdult(league, p);
    if (duties.length > 1) reasons.push("two-benches");
    for (const c of f.children) {
      const kidTeam = `${c.bracket} ${c.team}`;
      if (duties.some((t) => teamLabel(t) !== kidTeam && norm(teamLabel(t)) !== norm(kidTeam))) {
        reasons.push("coach-and-parent");
        break;
      }
    }
    if (staffDoubleDuty(league, p)) reasons.push("ref-and-parent");
  }
  if (teams.length > 1) {
    const campuses = /* @__PURE__ */ new Set();
    for (const t of teams) for (const c of teamCampuses(league, t)) campuses.add(c);
    if (campuses.size > 1) reasons.push("campus-hop");
    if (f.parents.length >= 2) reasons.push("two-cars");
  }
  const uniqueReasons = [...new Set(reasons)];
  return {
    family: f,
    id,
    last,
    teams,
    reasons: uniqueReasons,
    simple: uniqueReasons.length === 0 && teams.length <= 1,
    people: [...f.parents, ...f.children]
  };
}
function naiveHumansOnTeam(team, families) {
  const names = /* @__PURE__ */ new Set();
  if (named(team.coach)) names.add(printName(team.coach));
  if (named(team.assistant)) names.add(printName(team.assistant));
  for (const p of team.players) if (p.name) names.add(p.name);
  for (const f of families) {
    if (!familyOnTeam(f, team)) continue;
    for (const p of f.parents) names.add(printName(p));
    for (const c of f.children) names.add(printName(c));
  }
  return names.size;
}
function naiveHumans(league) {
  const names = /* @__PURE__ */ new Set();
  for (const t of league.teams) {
    if (named(t.coach)) names.add(personKey(t.coach));
    if (named(t.assistant)) names.add(personKey(t.assistant));
    for (const p of t.players) if (p.name) names.add(p.name);
  }
  for (const f of league.families) {
    for (const p of f.parents) names.add(personKey(p));
    for (const c of f.children) names.add(personKey(c));
  }
  for (const s of league.staff) names.add(personKey(s));
  return names;
}
function adultIsSpecial(league, p, households) {
  if (teamsForAdult(league, p).length > 1) return true;
  if (staffDoubleDuty(league, p)) return true;
  return households.some((h) => !h.simple && h.people.some((x) => samePerson(x, p)));
}
function foldTeam(league, team, households) {
  const label = teamLabel(team);
  const on = households.filter((h) => familyOnTeam(h.family, team));
  const specials = on.filter((h) => !h.simple);
  const coachSpecial = named(team.coach) && adultIsSpecial(league, team.coach, households);
  const asstSpecial = named(team.assistant) && adultIsSpecial(league, team.assistant, households);
  const exploded = specials.length > 0 || coachSpecial || asstSpecial;
  const naiveCount = naiveHumansOnTeam(team, league.families);
  const reasons = exploded ? [...new Set(specials.flatMap((h) => h.reasons))] : ["unit"];
  if (coachSpecial && !reasons.includes("two-benches") && team.coach && teamsForAdult(league, team.coach).length > 1) {
    reasons.push("two-benches");
  }
  if (asstSpecial && team.assistant && staffDoubleDuty(league, team.assistant) && !reasons.includes("ref-and-parent")) {
    reasons.push("ref-and-parent");
  }
  if (!exploded) {
    return {
      label,
      kind: "unit",
      caption: captionFor("unit"),
      display: displayTeam(label, "unit"),
      satKey: unitSat(label),
      varCount: 1,
      naiveCount,
      reasons,
      members: [
        { satKey: unitSat(label), label, kind: "unit", reason: "unit" }
      ]
    };
  }
  const members = [];
  const seen = /* @__PURE__ */ new Set();
  const add = (m) => {
    if (seen.has(m.satKey)) return;
    seen.add(m.satKey);
    members.push(m);
  };
  for (const h of specials) {
    const reason = h.reasons[0] || "siblings-two-teams";
    for (const c of h.family.children) {
      if (c.bracket === team.bracket && c.team === team.name) {
        add({ satKey: personSat(c), label: printName(c), kind: "person", reason });
      }
    }
    for (const p of h.family.parents) {
      if (teamsForAdult(league, p).some((t) => teamLabel(t) === label)) {
        add({ satKey: personSat(p), label: printName(p), kind: "person", reason });
      }
    }
  }
  if (named(team.coach) && coachSpecial) {
    add({
      satKey: personSat(team.coach),
      label: printName(team.coach),
      kind: "person",
      reason: reasons.find((r) => r !== "unit") || "two-benches"
    });
  }
  if (named(team.assistant) && asstSpecial) {
    add({
      satKey: personSat(team.assistant),
      label: printName(team.assistant),
      kind: "person",
      reason: reasons.find((r) => r !== "unit") || "ref-and-parent"
    });
  }
  for (const h of on.filter((x) => x.simple)) {
    add({
      satKey: householdSat(h.family),
      label: theName(h.last),
      kind: "household",
      reason: "unit"
    });
  }
  const covered = /* @__PURE__ */ new Set();
  for (const h of on) {
    for (const p of h.people) covered.add(printName(p));
  }
  if (named(team.coach) && coachSpecial) covered.add(printName(team.coach));
  if (named(team.assistant) && asstSpecial) covered.add(printName(team.assistant));
  const leftover = team.players.some((p) => p.name && !covered.has(p.name)) || named(team.coach) && !covered.has(printName(team.coach)) || named(team.assistant) && !covered.has(printName(team.assistant));
  if (leftover) {
    add({ satKey: restSat(label), label: `${label} (the rest)`, kind: "unit", reason: "unit" });
  }
  const kind = "exploded";
  return {
    label,
    kind,
    caption: captionFor(kind),
    display: displayTeam(label, kind),
    satKey: restSat(label),
    varCount: members.length,
    naiveCount,
    reasons: reasons.filter((r) => r !== "unit"),
    members
  };
}
function foldLeague(league) {
  const households = league.families.map((f) => analyzeHousehold(league, f));
  const teams = league.teams.map((t) => foldTeam(league, t, households));
  const keys = /* @__PURE__ */ new Set();
  for (const t of teams) for (const m of t.members) keys.add(m.satKey);
  const householdRows = households.map((h) => {
    const kind = h.simple ? "folded" : "exploded";
    const satKeys = h.simple ? [householdSat(h.family)] : h.people.map(personSat);
    return {
      id: h.id,
      last: h.last,
      label: theName(h.last),
      kind,
      caption: captionFor(kind === "folded" ? "unit" : "exploded"),
      display: displayHousehold(h.last, kind),
      reasons: h.reasons,
      satKeys,
      teams: h.teams.map(teamLabel)
    };
  });
  const naivePersonVars = naiveHumans(league).size;
  return {
    teams,
    households: householdRows,
    naivePersonVars,
    foldedPersonVars: keys.size,
    bound: heapBoundFor(naivePersonVars)
  };
}
function satKeysForTeam(plan, team) {
  const row = plan.teams.find((t) => t.label === teamLabel(team));
  if (!row) return [unitSat(teamLabel(team))];
  if (row.kind === "unit") return [row.satKey];
  return row.members.map((m) => m.satKey);
}
function snapshotFolding(plan, z3Vars = 0) {
  return {
    naiveVars: plan.naivePersonVars,
    foldedVars: plan.foldedPersonVars,
    z3Vars,
    heap: plan.foldedPersonVars,
    bound: plan.bound,
    teams: plan.teams.map((t) => ({
      label: t.label,
      kind: t.kind,
      caption: t.caption,
      display: t.display,
      varCount: t.varCount,
      naiveCount: t.naiveCount
    })),
    households: plan.households.map((h) => ({
      last: h.last,
      label: h.label,
      kind: h.kind,
      caption: h.caption,
      display: h.display,
      reasons: [...h.reasons]
    }))
  };
}

// src/diversity.ts
function pairKey(a, b) {
  return [a, b].sort().join("|");
}
function mayMeet(league, a, b) {
  if (teamLabel(a) === teamLabel(b)) return false;
  if (norm(a.bracket) !== norm(b.bracket)) return false;
  if (a.willNotPlay.some((w) => norm(w) === norm(b.association) || norm(w) === norm(teamLabel(b)))) return false;
  if (b.willNotPlay.some((w) => norm(w) === norm(a.association) || norm(w) === norm(teamLabel(a)))) return false;
  return true;
}
function possiblePairs(league) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < league.teams.length; i++) {
    for (let j = i + 1; j < league.teams.length; j++) {
      const a = league.teams[i];
      const b = league.teams[j];
      if (!mayMeet(league, a, b)) continue;
      const key = pairKey(teamLabel(a), teamLabel(b));
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a: teamLabel(a), b: teamLabel(b), bracket: a.bracket });
    }
  }
  return out;
}
function meetingsByPair(games) {
  const m = /* @__PURE__ */ new Map();
  for (const g of games) {
    const k = pairKey(g.home, g.away);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
function scoreSeasonDiversity(league, games) {
  const possible = possiblePairs(league);
  const met = meetingsByPair(games);
  const leftoverPairs = possible.filter((p) => !met.get(pairKey(p.a, p.b))).map((p) => ({ a: p.a, b: p.b }));
  const uniquePairs = possible.filter((p) => (met.get(pairKey(p.a, p.b)) || 0) > 0).length;
  const possiblePairsN = possible.length;
  const histMap = /* @__PURE__ */ new Map();
  for (const p of possible) {
    const n = met.get(pairKey(p.a, p.b)) || 0;
    histMap.set(n, (histMap.get(n) || 0) + 1);
  }
  const rematchHistogram = [...histMap.entries()].sort((a, b) => a[0] - b[0]).map(([meetings, pairs]) => ({ meetings, pairs }));
  const teams = league.teams.map((t) => {
    const label = teamLabel(t);
    const opps = /* @__PURE__ */ new Set();
    let rematches = 0;
    for (const g of games) {
      if (g.home !== label && g.away !== label) continue;
      const other = g.home === label ? g.away : g.home;
      if (opps.has(other)) rematches += 1;
      else opps.add(other);
    }
    const possibleN = possible.filter((p) => p.a === label || p.b === label).length;
    return { team: label, bracket: t.bracket, unique: opps.size, possible: possibleN, rematches };
  });
  const brackets = [...new Set(league.teams.map((t) => t.bracket))].map((bracket) => {
    const pool = possible.filter((p) => p.bracket === bracket);
    const unique = pool.filter((p) => (met.get(pairKey(p.a, p.b)) || 0) > 0).length;
    const leftover = pool.length - unique;
    const score2 = pool.length ? Math.round(100 * unique / pool.length) : 100;
    return { bracket, uniquePairs: unique, possiblePairs: pool.length, leftover, score: score2 };
  });
  const extras = [...met.values()].reduce((n, c) => n + Math.max(0, c - 1), 0);
  const coverage = possiblePairsN ? uniquePairs / possiblePairsN : games.length ? 1 : 0;
  const gameN = games.length || 1;
  const rematchDrag = Math.min(1, extras / gameN);
  const score = Math.round(100 * coverage * (1 - 0.4 * rematchDrag));
  const leftoverBit = leftoverPairs.length ? leftoverPairs.slice(0, 4).map((p) => `${p.a} vs ${p.b}`).join(", ") + (leftoverPairs.length > 4 ? "\u2026" : "") : "every possible pair met";
  const text = `Diversity: ${score} \u2014 ${uniquePairs} of ${possiblePairsN} pairs met \xB7 leftover ${leftoverBit}`;
  return {
    score,
    uniquePairs,
    possiblePairs: possiblePairsN,
    leftoverPairs,
    rematchHistogram,
    teams,
    brackets,
    text
  };
}

// src/season-score.ts
var HARD = 1e4;
var REMATCH = 80;
var HOUSEHOLD = 40;
var TRAVEL_MIN = 1;
function clockOr(s, fallback) {
  let n = parseClock(s) ?? fallback;
  if (n < 7 * 60) n += 12 * 60;
  return n;
}
function fieldShort(name) {
  const m = name.match(/Field\s+([A-Z])/i);
  if (m) return `Field ${m[1].toUpperCase()}`;
  if (/stadium/i.test(name)) return name;
  return name;
}
function findField(league, raw) {
  const n = norm(raw);
  if (!n) return void 0;
  return league.fields.find((f) => norm(f.name) === n) || league.fields.find((f) => norm(fieldShort(f.name)) === n) || league.fields.find((f) => norm(f.name).endsWith(n) || n.endsWith(norm(fieldShort(f.name))));
}
function grassRank(league, bracket, kickoff, day) {
  return preferredKickCost(league, bracket, clockOr(kickoff, 9 * 60), day);
}
function fieldOpenAt(field2, dayName, kick, vacate) {
  const win = field2.windows.find((w) => w.day === dayName);
  if (field2.windows.length && !win) return false;
  if (win && (kick < win.startMinutes || vacate > win.endMinutes + 5)) return false;
  return true;
}
function legalFieldFor(league, game, field2) {
  const ag = league.ageGroups.find((a) => norm(a.name) === norm(game.ageGroup));
  if (!ag) return true;
  return ag.fieldClasses.some((c) => norm(c) === norm(field2.type));
}
function windowsOverlap(a0, a1, b0, b1) {
  return !(a1 <= b0 || b1 <= a0);
}
function teamOn(g, label) {
  return g.home === label || g.away === label;
}
function householdCost(league, games) {
  let cost = 0;
  for (const f of league.families) {
    if (f.children.length < 2) continue;
    const dates = [...new Set(games.map((g) => g.dateIso))];
    for (const date of dates) {
      const stops = [];
      for (const c of f.children) {
        const t = league.teams.find((x) => x.name === c.team && x.bracket === c.bracket);
        const label = t ? teamLabel(t) : `${c.bracket} ${c.team}`;
        const g = games.find((x) => x.dateIso === date && teamOn(x, label));
        if (!g) continue;
        stops.push({
          kick: clockOr(g.kickoff, 10 * 60),
          vacate: clockOr(g.vacate, clockOr(g.end, 11 * 60)),
          campus: g.campus
        });
      }
      for (let i = 0; i < stops.length; i++) {
        for (let j = i + 1; j < stops.length; j++) {
          if (!windowsOverlap(stops[i].kick - 15, stops[i].vacate, stops[j].kick - 15, stops[j].vacate)) continue;
          cost += norm(stops[i].campus) === norm(stops[j].campus) ? HOUSEHOLD / 2 : HOUSEHOLD;
        }
      }
    }
  }
  return cost;
}
function coachTravelHard(league, games) {
  let n = 0;
  const byCoach = /* @__PURE__ */ new Map();
  for (const t of league.teams) {
    if (!t.coach) continue;
    const who = `${t.coach.first} ${t.coach.last}`.trim();
    const label = teamLabel(t);
    for (const g of games) {
      if (!teamOn(g, label)) continue;
      byCoach.set(who, [...byCoach.get(who) || [], g]);
    }
  }
  for (const list of byCoach.values()) {
    const sorted = [...list].sort((a, b) => a.dateIso.localeCompare(b.dateIso) || clockOr(a.kickoff, 0) - clockOr(b.kickoff, 0));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].dateIso !== sorted[i - 1].dateIso) continue;
      const prev = sorted[i - 1];
      const next = sorted[i];
      const prevKick = clockOr(prev.kickoff, 0);
      const nextKick = clockOr(next.kickoff, 0);
      const prevEnd = clockOr(prev.end, prevKick + 50);
      if (prevEnd > nextKick) {
        n += 1;
        continue;
      }
      if (norm(prev.campus) === norm(next.campus)) continue;
      const travel = travelMinutes(league, prev.campus, next.campus).minutes ?? 0;
      const ready = clockOr(prev.vacate, prevEnd) + travel;
      if (ready > nextKick) n += 1;
    }
  }
  return n;
}
function rematchCost(league, games) {
  const cap = league.season.rematchCap || 2;
  const withheld = new Set(withheldMatchups(league).map((w) => [w.a, w.b].sort().join("|")));
  const tally = /* @__PURE__ */ new Map();
  for (const g of games) {
    const k = [g.home, g.away].sort().join("|");
    const cur = tally.get(k) || { n: 0, bracket: g.ageGroup };
    cur.n += 1;
    tally.set(k, cur);
  }
  let cost = 0;
  const byBracket = /* @__PURE__ */ new Map();
  for (const [k, { n, bracket }] of tally) {
    if (withheld.has(k)) cost += HARD * n;
    const extra = Math.max(0, n - cap);
    const add = extra * REMATCH;
    cost += add;
    byBracket.set(bracket, (byBracket.get(bracket) || 0) + add);
  }
  return { cost, byBracket };
}
function scoreSeasonZ3(league, games) {
  const rem = rematchCost(league, games);
  let hard = 0;
  let grass = 0;
  let travel = 0;
  const house = householdCost(league, games);
  hard += coachTravelHard(league, games) * HARD;
  const byBracket = /* @__PURE__ */ new Map();
  const bump = (bracket) => {
    const row = byBracket.get(bracket) || {
      cost: 0,
      rematch: 0,
      grass: 0,
      travel: 0,
      household: 0,
      games: 0,
      hard: 0
    };
    byBracket.set(bracket, row);
    return row;
  };
  const weekOf = /* @__PURE__ */ new Map();
  for (const g of games) {
    const key = `${g.weekIso || g.dateIso}|${g.home}`;
    const keyB = `${g.weekIso || g.dateIso}|${g.away}`;
    weekOf.set(key, [...weekOf.get(key) || [], g]);
    weekOf.set(keyB, [...weekOf.get(keyB) || [], g]);
  }
  for (const list of weekOf.values()) {
    if (list.length > 1) hard += HARD * (list.length - 1);
  }
  for (const g of games) {
    const row = bump(g.ageGroup);
    row.games += 1;
    const field2 = findField(league, g.field);
    const day = weekdayName(g.dateIso);
    const kick = clockOr(g.kickoff, 10 * 60);
    const vacate = clockOr(g.vacate, kick + 60);
    if (field2 && !legalFieldFor(league, g, field2)) {
      hard += HARD;
      row.hard += HARD;
    }
    if (field2 && !fieldOpenAt(field2, day, kick, vacate)) {
      hard += HARD;
      row.hard += HARD;
    }
    if (!g.center && !league.season.proceedWithoutStaff) {
      hard += HARD;
      row.hard += HARD;
    }
    const gGrass = grassRank(league, g.ageGroup, g.kickoff, day);
    grass += gGrass;
    row.grass += gGrass;
    const home = findTeam(league, g.home);
    const homeCampus = home && league.associations.find((a) => norm(a.name) === norm(home.association))?.homeCampus || "Van Complex";
    if (norm(g.campus) !== norm(homeCampus)) {
      const mins = travelMinutes(league, homeCampus, g.campus).minutes ?? 30;
      travel += mins * TRAVEL_MIN;
      row.travel += mins * TRAVEL_MIN;
    }
  }
  const fieldDay = /* @__PURE__ */ new Map();
  for (const g of games) {
    const k = `${g.dateIso}|${g.field}|${g.campus}`;
    fieldDay.set(k, [...fieldDay.get(k) || [], g]);
  }
  for (const list of fieldDay.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a0 = clockOr(list[i].warmupStart, clockOr(list[i].kickoff, 0) - 15);
        const a1 = clockOr(list[i].vacate, clockOr(list[i].end, 0));
        const b0 = clockOr(list[j].warmupStart, clockOr(list[j].kickoff, 0) - 15);
        const b1 = clockOr(list[j].vacate, clockOr(list[j].end, 0));
        if (windowsOverlap(a0, a1, b0, b1)) hard += HARD;
      }
    }
  }
  for (const [bracket, add] of rem.byBracket) {
    bump(bracket).rematch += add;
  }
  const houseShare = byBracket.size || 1;
  for (const row of byBracket.values()) {
    row.household = Math.round(house / houseShare);
    row.cost = row.hard + row.rematch + row.grass + row.travel + row.household;
  }
  const cost = hard + rem.cost + grass + travel + house;
  const score = Math.max(0, 2e4 - rem.cost - grass - travel - house - Math.min(hard, 5e3));
  const brackets = [...byBracket.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([bracket, r]) => ({
    bracket,
    cost: r.cost,
    rematch: r.rematch,
    grass: r.grass,
    travel: r.travel,
    household: r.household,
    games: r.games,
    text: `${bracket}: ${r.cost} (rematch ${r.rematch}, grass ${r.grass}, travel ${r.travel})`
  }));
  const bits = brackets.map((b) => `${b.bracket} ${b.cost}`).join(" \xB7 ");
  const text = `Z3 season: ${score} (cost ${cost} \xB7 whole fall) \xB7 ${bits || "no games"}`;
  return {
    scope: "season",
    cost,
    score,
    hardHeld: hard === 0,
    rematchCost: rem.cost,
    grassCost: grass,
    travelCost: travel,
    householdCost: house,
    hardCost: hard,
    brackets,
    text
  };
}
function stampSeasonScores(league, cfg) {
  const z3 = scoreSeasonZ3(league, cfg.games);
  const diversity = scoreSeasonDiversity(league, cfg.games);
  cfg.z3Season = z3;
  cfg.diversity = diversity;
  cfg.scores = cfg.scores.filter((s) => s.key !== "z3" && s.key !== "diversity" && !s.key.startsWith("z3-"));
  const head = [{ key: "z3", text: z3.text }, { key: "diversity", text: diversity.text }];
  const rest = cfg.scores;
  cfg.scores = [...head, ...rest];
  for (const b of z3.brackets) {
    cfg.scores.push({ key: `z3-${norm(b.bracket).replace(/\s+/g, "-")}`, text: b.text });
  }
  return cfg;
}

// src/sims.ts
var SIMS_DAY_START = 7 * 60;
var HOUSE_DRIVE = 15;
var CAR_SEATS = 5;
function clock2(raw, fallback) {
  return parseClock(raw) ?? fallback;
}
function firstName(name) {
  return name.trim().split(/\s+/)[0] || name;
}
function slug(s) {
  return norm(s).replace(/\s+/g, "-") || "trace";
}
function findTeam3(league, label) {
  return league.teams.find((t) => norm(teamLabel(t)) === norm(label));
}
function addAgent(map, name, role) {
  const n = name.trim();
  if (!n) return;
  const roles = map.get(n) || [];
  if (!roles.includes(role)) roles.push(role);
  map.set(n, roles);
}
function collectDuties(league, games) {
  const roles = /* @__PURE__ */ new Map();
  const duties = [];
  const pushDuty = (name, role, game) => {
    const n = name.trim();
    if (!n) return;
    addAgent(roles, n, role);
    duties.push({
      agent: n,
      role,
      gameId: game.id,
      kickoff: clock2(game.kickoff, 9 * 60),
      warmup: clock2(game.warmupStart, clock2(game.kickoff, 9 * 60) - 15),
      end: clock2(game.end, clock2(game.kickoff, 9 * 60) + 50),
      vacate: clock2(game.vacate, clock2(game.kickoff, 9 * 60) + 60),
      field: game.field,
      campus: game.campus,
      parking: game.parking
    });
  };
  for (const game of games) {
    for (const label of [game.home, game.away]) {
      const team = findTeam3(league, label);
      if (!team) continue;
      for (const p of team.players) pushDuty(p.name, "child", game);
      if (team.coach) pushDuty(printName(team.coach), "coach", game);
      if (team.assistant) pushDuty(printName(team.assistant), "assistant", game);
    }
    if (game.center) pushDuty(game.center, "center", game);
    for (const a of game.assistants) pushDuty(a, "line", game);
  }
  const agents = [...roles.entries()].map(([name, r]) => ({
    id: name,
    name,
    roles: r
  }));
  agents.sort((a, b) => a.name.localeCompare(b.name));
  return { agents, duties };
}
function campusTravel(league, from, to) {
  if (!from || from === "house") {
    if (norm(to) === norm("Van Complex")) return HOUSE_DRIVE;
    const extra = travelMinutes(league, "Van Complex", to);
    return HOUSE_DRIVE + (extra.minutes ?? 45);
  }
  if (norm(from) === norm(to)) return 0;
  return travelMinutes(league, from, to).minutes ?? 45;
}
function timeOverlap(a, b) {
  return a.warmup < b.vacate && b.warmup < a.vacate;
}
function togetherRoute(league, stops) {
  if (!stops.length) return { ok: true, steps: [], minutes: null };
  const sorted = [...stops].sort((a, b) => a.kickoff - b.kickoff || a.who.localeCompare(b.who));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (timeOverlap(sorted[i], sorted[j]) && norm(sorted[i].campus) !== norm(sorted[j].campus)) {
        return {
          ok: false,
          steps: [
            `${sorted[i].first} at ${sorted[i].field} (${sorted[i].campus}) and ${sorted[j].first} at ${sorted[j].field} (${sorted[j].campus}) overlap.`
          ],
          minutes: null
        };
      }
    }
  }
  let loc = null;
  let freeAt = SIMS_DAY_START;
  const steps = [];
  let lastTravel = null;
  for (const stop of sorted) {
    const already = !!loc && norm(loc) === norm(stop.campus);
    if (already) {
      steps.push(
        `${stop.parking || stop.field} is a walk across ${stop.campus} \u2014 they make ${stop.first}'s ${formatClockShort(stop.kickoff)}.`
      );
      freeAt = Math.max(freeAt, stop.vacate);
      continue;
    }
    const travel = campusTravel(league, loc, stop.campus);
    const arrive = freeAt + travel;
    if (arrive > stop.kickoff) {
      return {
        ok: false,
        steps: [...steps, `Cannot reach ${stop.field} by the ${formatClockShort(stop.kickoff)} kickoff.`],
        minutes: lastTravel
      };
    }
    if (loc) {
      lastTravel = travel;
      steps.push(`${travel} minutes from ${loc} to ${stop.campus} \u2014 from the travel sheet.`);
    }
    steps.push(`${stop.first} on ${stop.field} at ${formatClockShort(stop.kickoff)}.`);
    freeAt = Math.max(arrive, stop.vacate);
    loc = stop.campus;
  }
  return { ok: true, steps, minutes: lastTravel };
}
function lockedDriver(league, family, stop) {
  for (const parent of family.parents) {
    const name = printName(parent);
    if (parent.coachOf.some((c) => norm(c) === norm(stop.team) || norm(c) === norm(stop.game.home) || norm(c) === norm(stop.game.away))) {
      return name;
    }
    const teams = league.teams.filter((t) => t.coach && printName(t.coach) === name);
    if (teams.some((t) => stop.game.home === teamLabel(t) || stop.game.away === teamLabel(t))) return name;
  }
  return null;
}
function seatsOk(drivers, bag) {
  return 1 + bag.length <= CAR_SEATS && drivers.length > 0;
}
function splitPlan(league, family, stops) {
  const drivers = family.parents.map(printName).filter(Boolean);
  if (!stops.length) return { ok: true, bags: [], steps: [] };
  if (!drivers.length) return { ok: false, bags: [], steps: ["No adult can drive."] };
  const n = Math.min(2, drivers.length);
  const assignments = n === 1 ? [0] : (() => {
    const out = [];
    const limit = 1 << stops.length;
    for (let mask = 0; mask < limit; mask++) out.push(mask);
    return out;
  })();
  const tryMask = (mask) => {
    const bags = [[], []];
    for (let i = 0; i < stops.length; i++) {
      const bit = n === 1 ? 0 : mask >> i & 1;
      bags[bit].push(stops[i]);
    }
    const used = [];
    const taken = /* @__PURE__ */ new Set();
    for (let b = 0; b < n; b++) {
      if (!bags[b].length) continue;
      let driver = "";
      for (const stop of bags[b]) {
        const lock = lockedDriver(league, family, stop);
        if (lock && bags[b].every((s) => !lockedDriver(league, family, s) || lockedDriver(league, family, s) === lock)) {
          if (taken.has(lock) && driver && driver !== lock) return null;
          driver = lock;
        }
      }
      if (!driver) {
        driver = drivers.find((d) => !taken.has(d)) || "";
      }
      if (!driver || taken.has(driver)) return null;
      if (!seatsOk([driver], bags[b])) return null;
      const route = togetherRoute(league, bags[b]);
      if (!route.ok) return null;
      taken.add(driver);
      used.push({ driver, stops: bags[b] });
    }
    return used;
  };
  if (n === 1) {
    const used = tryMask(0);
    if (used) {
      return {
        ok: true,
        bags: used,
        steps: used.flatMap((bag) => [
          `${firstName(bag.driver)} takes ${bag.stops.map((s) => s.first).join(" and ")}.`,
          ...togetherRoute(league, bag.stops).steps
        ])
      };
    }
    return { ok: false, bags: [], steps: ["One driver cannot cover both games."] };
  }
  for (const mask of assignments) {
    const used = tryMask(mask);
    if (used) {
      return {
        ok: true,
        bags: used,
        steps: used.map(
          (bag) => `${firstName(bag.driver)} takes ${bag.stops.map((s) => s.first).join(" and ")} to ${bag.stops.map((s) => s.field).join(" / ")}.`
        )
      };
    }
  }
  return { ok: false, bags: [], steps: ["Even two cars leave a child without a driver."] };
}
function joinAnd(names) {
  if (names.length <= 1) return names[0] || "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}
function makesItHeadline(family, stops, minutes) {
  const adults = joinAnd(family.parents.map((p) => firstName(printName(p))));
  const ride = family.parents.length === 1 ? "gets in the car" : "get in the car";
  const kids = joinAnd(stops.map((s) => s.first));
  const sorted = [...stops].sort((a2, b2) => a2.kickoff - b2.kickoff);
  if (sorted.length === 1) {
    return `${adults} ${ride} with ${kids}, make ${sorted[0].field} at ${formatClockShort(sorted[0].kickoff)}.`;
  }
  const a = sorted[0];
  const b = sorted[1];
  if (norm(a.campus) === norm(b.campus)) {
    return `${adults} ${ride} with ${kids}, make ${a.field} at ${formatClockShort(a.kickoff)}. ${a.parking || a.field} to ${b.parking || b.field} is a walk \u2014 they make ${b.first}'s ${formatClockShort(b.kickoff)}.`;
  }
  const n = minutes ?? 0;
  return `${adults} ${ride} with ${kids}, make ${a.field} at ${formatClockShort(a.kickoff)}, ${n} minutes to ${b.field}, they make it.`;
}
function kidStopsFor(league, family, games) {
  const stops = [];
  for (const child of family.children) {
    const team = league.teams.find((t) => t.name === child.team && t.bracket === child.bracket);
    if (!team) continue;
    const label = teamLabel(team);
    const game = games.find((g) => g.home === label || g.away === label);
    if (!game) continue;
    stops.push({
      who: printName(child),
      first: firstName(printName(child)),
      team: label,
      game,
      kickoff: clock2(game.kickoff, 9 * 60),
      warmup: clock2(game.warmupStart, clock2(game.kickoff, 9 * 60) - 15),
      end: clock2(game.end, clock2(game.kickoff, 9 * 60) + 50),
      vacate: clock2(game.vacate, clock2(game.kickoff, 9 * 60) + 60),
      field: game.field,
      campus: game.campus,
      parking: game.parking
    });
  }
  return stops;
}
function judgeFamily(league, family, games) {
  const stops = kidStopsFor(league, family, games);
  if (stops.length < 1) return null;
  const last = familyLast(family);
  const id = slug(last);
  const together = togetherRoute(league, stops);
  if (together.ok) {
    if (stops.length === 1) {
      return {
        id,
        subject: last,
        kind: "family",
        verdict: "makes-it",
        headline: makesItHeadline(family, stops, together.minutes),
        steps: together.steps
      };
    }
    const togetherLine = family.parents.length > 1 ? "One car. Both adults ride with both kids." : "One car. The household rides together.";
    return {
      id,
      subject: last,
      kind: "family",
      verdict: "makes-it",
      headline: makesItHeadline(family, stops, together.minutes),
      steps: [togetherLine, ...together.steps]
    };
  }
  const split = splitPlan(league, family, stops);
  if (split.ok && split.bags.length >= 1) {
    const bits = split.bags.map(
      (bag) => `${firstName(bag.driver)} takes ${joinAnd(bag.stops.map((s) => s.first))} to ${bag.stops.map((s) => s.field).join(" / ")}`
    );
    return {
      id,
      subject: last,
      kind: "family",
      verdict: "needs-two-cars",
      headline: `Not possible: they need two cars. ${bits.join("; ")}.`,
      steps: [
        ...together.steps,
        "The league assumes one car. A second car would cover it only if the household splits.",
        ...split.steps
      ]
    };
  }
  return {
    id,
    subject: last,
    kind: "family",
    verdict: "even-two-cars-cannot",
    headline: `This game day is going to be tough for the ${last} family. See? Even if they have 2 cars, they cannot take their kids to both games.`,
    steps: [
      ...together.steps,
      ...split.steps,
      `${family.parents.length <= 1 ? "There is only one adult who can drive." : "Every adult is already committed."} Two cars do not create a second driver.`
    ]
  };
}
function judgePerson(league, name, mine) {
  const scars = [];
  const traces = [];
  const sorted = [...mine].sort((a, b) => a.warmup - b.warmup || a.kickoff - b.kickoff);
  const whistle = mine.some((d) => d.role === "center" || d.role === "line");
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const duty = sorted[i];
    const playOverlap = !(duty.kickoff >= prev.end || prev.kickoff >= duty.end);
    if (playOverlap) {
      const two = norm(duty.campus) === norm(prev.campus) ? `${prev.field} and ${duty.field}` : `${prev.campus} and ${duty.campus}`;
      const text = `${name} would have to be on ${two} at ${formatClockShort(duty.kickoff)}.`;
      scars.push({ kind: "two-places", agent: name, text });
      traces.push({
        id: slug(name),
        subject: name,
        kind: whistle ? "referee" : "coach",
        verdict: "two-places",
        headline: text,
        steps: [
          `${prev.field} plays through ${formatClockShort(prev.end)}.`,
          `${duty.field} kicks off at ${formatClockShort(duty.kickoff)}.`
        ]
      });
      continue;
    }
    const travel = campusTravel(league, prev.campus, duty.campus);
    if (norm(prev.campus) !== norm(duty.campus) && prev.vacate + travel > duty.kickoff) {
      const kind = whistle ? "ref-flight" : "travel";
      const text = kind === "ref-flight" ? `${name} cannot close ${prev.campus} at ${formatClockShort(prev.vacate)} and stand ${duty.field} at ${formatClockShort(duty.kickoff)} \u2014 ${travel} minutes on the travel sheet.` : `${name} cannot cover the ${travel}-minute drive from ${prev.campus} to ${duty.campus} before ${formatClockShort(duty.kickoff)}.`;
      scars.push({ kind, agent: name, text });
      traces.push({
        id: slug(name),
        subject: name,
        kind: whistle ? "referee" : "coach",
        verdict: kind === "ref-flight" ? "ref-flight" : "two-places",
        headline: text,
        steps: [
          `Vacate ${prev.campus} at ${formatClockShort(prev.vacate)}.`,
          `Kickoff at ${duty.campus} is ${formatClockShort(duty.kickoff)}.`,
          `The travel sheet says ${travel} minutes.`
        ]
      });
    }
  }
  return { scars, traces };
}
function scoreFrom(scars, traces, dutyCount, allowUnstaffed = false) {
  const twoPlaces = scars.filter((s) => s.kind === "two-places").length;
  const late = scars.filter((s) => s.kind === "late").length;
  const refFlights = scars.filter((s) => s.kind === "ref-flight").length;
  const unstaffed = traces.filter((t) => t.verdict === "unstaffed").length;
  const unstaffedCost = allowUnstaffed ? 0 : unstaffed;
  const evenTwo = traces.filter((t) => t.verdict === "even-two-cars-cannot").length;
  const needTwo = traces.filter((t) => t.verdict === "needs-two-cars").length;
  let score = 100;
  score -= twoPlaces * 40;
  score -= late * 20;
  score -= refFlights * 35;
  score -= unstaffedCost * 30;
  score -= evenTwo * 40;
  score -= needTwo * 25;
  score -= scars.filter((s) => s.kind === "travel").length * 20;
  if (score < 0) score = 0;
  const legal = twoPlaces === 0 && late === 0 && refFlights === 0 && unstaffedCost === 0 && evenTwo === 0;
  const feasible = legal && needTwo === 0;
  if (!feasible) score = Math.min(score, 49);
  const onTime = Math.max(0, dutyCount - late);
  return { feasible, legal, score, scars, traces, onTime, late, twoPlaces, refFlights, carsShort: needTwo + evenTwo };
}
function uniqueDutyCount(byAgent) {
  let n = 0;
  for (const list of byAgent.values()) n += list.length;
  return n;
}
function playSaturday(league, cfg, dateIso) {
  const games = cfg.games.filter((g) => g.dateIso === dateIso);
  const { agents, duties } = collectDuties(league, games);
  const scars = [];
  const traces = [];
  const allowUnstaffed = !!league.season.proceedWithoutStaff;
  for (const game of games) {
    if (!game.center) {
      const text = allowUnstaffed ? `${game.ageGroup} has no center referee on ${dateIso} \u2014 recorded: proceed without named staff.` : `Unplayable: ${game.ageGroup} needs a center referee on ${dateIso} and none are available.`;
      if (!allowUnstaffed) {
        scars.push({ kind: "unstaffed", agent: `${game.home} vs ${game.away}`, text });
      }
      traces.push({
        id: slug(game.id || `${game.home}-${game.away}`),
        subject: `${game.home} vs ${game.away}`,
        kind: "staffing",
        verdict: "unstaffed",
        headline: text,
        steps: [`${game.kickoff} ${game.field} has no center.`]
      });
    }
  }
  const byAgent = /* @__PURE__ */ new Map();
  for (const d of duties) {
    const list = byAgent.get(d.agent) || [];
    if (list.some((x) => x.gameId === d.gameId && x.role === d.role)) continue;
    list.push(d);
    byAgent.set(d.agent, list);
  }
  for (const [name, mine] of byAgent) {
    const judged = judgePerson(league, name, mine);
    scars.push(...judged.scars);
    traces.push(...judged.traces);
  }
  for (const family of league.families) {
    const trace = judgeFamily(league, family, games);
    if (!trace) continue;
    traces.push(trace);
    if (trace.verdict === "needs-two-cars" || trace.verdict === "even-two-cars-cannot") {
      scars.push({ kind: trace.verdict, agent: trace.subject, text: trace.headline });
    }
  }
  const uniqScars = [];
  const seenS = /* @__PURE__ */ new Set();
  for (const s of scars) {
    const k = `${s.kind}|${s.agent}|${s.text}`;
    if (seenS.has(k)) continue;
    seenS.add(k);
    uniqScars.push(s);
  }
  const uniqTraces = [];
  const seenT = /* @__PURE__ */ new Set();
  for (const t of traces) {
    const k = `${t.verdict}|${t.subject}|${t.headline}`;
    if (seenT.has(k)) continue;
    seenT.add(k);
    uniqTraces.push(t);
  }
  return {
    dateIso,
    agents,
    duties,
    score: scoreFrom(uniqScars, uniqTraces, uniqueDutyCount(byAgent), allowUnstaffed)
  };
}
function judgeSeason(league, cfg) {
  const dates = [...new Set(cfg.games.map((g) => g.dateIso))].sort();
  const days = dates.map((d) => playSaturday(league, cfg, d));
  return {
    legal: days.every((d) => d.score.legal),
    feasible: days.every((d) => d.score.feasible),
    days
  };
}
function clocksOverlap(a, b) {
  if (a.dateIso !== b.dateIso) return false;
  const a0 = parseClock(a.kickoff) ?? 0;
  const a1 = parseClock(a.end) ?? a0 + 50;
  const b0 = parseClock(b.kickoff) ?? 0;
  const b1 = parseClock(b.end) ?? b0 + 50;
  return a0 < b1 && b0 < a1;
}
function familyOverlapScores(league, games) {
  const lines = [];
  for (const f of league.families) {
    const kids = f.children.map((c) => {
      const team = league.teams.find((t) => t.name === c.team && t.bracket === c.bracket);
      const label = team ? teamLabel(team) : `${c.bracket} ${c.team}`;
      const gs = games.filter((g) => g.home === label || g.away === label);
      return { label, gs };
    });
    const dates = new Set(kids.flatMap((k) => k.gs.map((g) => g.dateIso)));
    for (const date of dates) {
      const on = kids.map((k) => ({ ...k, g: k.gs.find((x) => x.dateIso === date) })).filter((k) => k.g);
      for (let i = 0; i < on.length; i++) {
        for (let j = i + 1; j < on.length; j++) {
          const A = on[i].g;
          const B = on[j].g;
          if (!clocksOverlap(A, B) || norm(A.campus) === norm(B.campus)) continue;
          const t = travelMinutes(league, A.campus, B.campus).minutes ?? 8;
          lines.push({
            key: "overlap",
            text: `${familyLast(f)} family overlap: 1 \u2014 ${on[i].label} ${A.kickoff} ${A.campus} and ${on[j].label} ${B.kickoff} ${B.campus} \u2014 ${t}-minute drive, one car cannot cover`
          });
        }
      }
    }
  }
  return lines;
}
function applySimsJudgment(league, cfg) {
  const judged = judgeSeason(league, cfg);
  cfg.simsValid = judged.legal;
  cfg.scores = cfg.scores.filter((s) => s.key !== "sims" && s.key !== "overlap");
  cfg.scores.push(...familyOverlapScores(league, cfg.games));
  if (!judged.legal) {
    const bad = judged.days.find((d) => !d.score.legal);
    const proof = bad?.score.traces.find(
      (t) => t.verdict === "even-two-cars-cannot" || t.verdict === "ref-flight" || t.verdict === "two-places" || t.verdict === "unstaffed"
    )?.headline || "the best car plan still fails";
    cfg.scores.push({ key: "sims", text: `Sims judge: this Saturday is not legal \u2014 ${proof}` });
  } else if (!judged.feasible) {
    const bad = judged.days.find((d) => !d.score.feasible);
    const proof = bad?.score.traces.find((t) => t.verdict === "needs-two-cars")?.headline || "a family needs two cars";
    cfg.scores.push({ key: "sims", text: `Sims judge: ${proof}` });
  } else {
    cfg.scores.push({ key: "sims", text: "Sims judge: every Saturday holds" });
  }
  return cfg;
}

// src/solver.ts
var SLOT_STRIDE = 100;
var cachedNode;
function defaultLoadZ3() {
  return cachedNode ??= import("z3-solver").then(async (m) => await m.init());
}
function clockOr2(s, fallback) {
  let n = parseClock(s) ?? fallback;
  if (n < 7 * 60) n += 12 * 60;
  return n;
}
function fieldShort2(name) {
  const m = name.match(/Field\s+([A-Z])/i);
  if (m) return `Field ${m[1].toUpperCase()}`;
  if (/stadium/i.test(name)) return name;
  return name;
}
function pairTeams(teams, weekIndex) {
  const list = [...teams];
  if (list.length < 2) return [];
  const pairs = [];
  const rot = weekIndex % list.length;
  const arr = [...list.slice(rot), ...list.slice(0, rot)];
  for (let i = 0; i + 1 < arr.length; i += 2) pairs.push([arr[i], arr[i + 1]]);
  if (arr.length % 2 === 1 && arr.length >= 3) {
    pairs.push([arr[arr.length - 1], arr[0]]);
  }
  return pairs;
}
function matchupKey(assoc, bracket, dateIso) {
  return `${norm(assoc)}|${norm(bracket)}|${dateIso}`;
}
function legalUnorderedPairs(teams) {
  const out = [];
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      if (!refusedPair(teams[i], teams[j])) out.push([teams[i], teams[j]]);
    }
  }
  return out;
}
async function optimizeSeasonMatchups(league, loadZ3 = defaultLoadZ3) {
  const sats = playingSaturdays(league).filter((d) => !weeks(league).find((w) => w.label === d && w.kind === "bye"));
  const pairs = /* @__PURE__ */ new Map();
  const pools = /* @__PURE__ */ new Map();
  for (const t of league.teams) {
    const k = `${norm(t.association)}|${norm(t.bracket)}`;
    pools.set(k, [...pools.get(k) || [], t]);
  }
  let verdict = "sat";
  let extras = 0;
  let optimized = 0;
  const cap = league.season.rematchCap || 2;
  for (const group of pools.values()) {
    if (group.length < 2) continue;
    const legal = legalUnorderedPairs(group);
    if (!legal.length) continue;
    const assoc = group[0].association;
    const bracket = group[0].bracket;
    if (group.length === 2) {
      for (const d of sats) {
        pairs.set(matchupKey(assoc, bracket, d), [[teamLabel(group[0]), teamLabel(group[1])]]);
      }
      continue;
    }
    optimized += 1;
    const { Context } = await loadZ3();
    const tag = `${bracket}_${assoc}`.replace(/[^A-Za-z0-9]/g, "").slice(0, 24);
    const Z3 = Context(`van_match_${tag}_${sats.length}`);
    const opt = new Z3.Optimize();
    opt.set("timeout", 12e3);
    const gamesPerWeek = group.length % 2 === 0 ? group.length / 2 : Math.ceil(group.length / 2);
    const vars = sats.map(
      (_, wi) => legal.map((_2, pi) => {
        const v = Z3.Int.const(`w${wi}p${pi}`);
        opt.add(v.ge(0));
        opt.add(v.le(1));
        return v;
      })
    );
    for (let wi = 0; wi < sats.length; wi++) {
      opt.add(Z3.Sum(...vars[wi]).eq(gamesPerWeek));
      for (const t of group) {
        const label = teamLabel(t);
        const mine = legal.map((p, pi) => teamLabel(p[0]) === label || teamLabel(p[1]) === label ? vars[wi][pi] : null).filter((v) => !!v);
        if (!mine.length) continue;
        opt.add(Z3.Sum(...mine).ge(1));
        opt.add(Z3.Sum(...mine).le(2));
      }
    }
    const cost = [Z3.Int.val(0)];
    const extraVars = legal.map((_, pi) => {
      const count = Z3.Sum(...vars.map((row) => row[pi]));
      const extra = Z3.Int.const(`ex${pi}`);
      opt.add(extra.ge(0));
      opt.add(extra.ge(count.sub(cap)));
      cost.push(extra.mul(80));
      cost.push(Z3.If(count.eq(0), Z3.Int.val(40), Z3.Int.val(0)));
      return extra;
    });
    opt.minimize(Z3.Sum(...cost));
    const dayVerdict = await opt.check();
    if (dayVerdict !== "sat") {
      verdict = String(dayVerdict);
      try {
        opt.release();
      } catch {
      }
      continue;
    }
    const model = opt.model();
    for (const ev of extraVars) extras += num2(model, ev);
    for (let wi = 0; wi < sats.length; wi++) {
      const chosen = [];
      for (let pi = 0; pi < legal.length; pi++) {
        if (num2(model, vars[wi][pi]) === 1) {
          chosen.push([teamLabel(legal[pi][0]), teamLabel(legal[pi][1])]);
        }
      }
      pairs.set(matchupKey(assoc, bracket, sats[wi]), chosen);
    }
    try {
      opt.release();
    } catch {
    }
  }
  return { pairs, verdict, extras, pools: optimized };
}
function pairsForGroup(group, dateIso, weekIndex, matchups) {
  if (!group.length) return [];
  const labels = matchups?.pairs.get(matchupKey(group[0].association, group[0].bracket, dateIso));
  if (!labels?.length) return pairTeamsLegal(group, weekIndex);
  const byLabel = new Map(group.map((t) => [teamLabel(t), t]));
  const out = [];
  for (const [a, b] of labels) {
    const A = byLabel.get(a);
    const B = byLabel.get(b);
    if (A && B && !refusedPair(A, B)) out.push([A, B]);
  }
  return out.length ? out : pairTeamsLegal(group, weekIndex);
}
function pairTeamsLegal(teams, weekIndex) {
  const first = pairTeams(teams, weekIndex).filter(([a, b]) => !refusedPair(a, b));
  const used = new Set(first.flatMap(([a, b]) => [teamLabel(a), teamLabel(b)]));
  const leftover = teams.filter((t) => !used.has(teamLabel(t)));
  const extra = [];
  const pool = [...leftover];
  while (pool.length) {
    const home = pool.shift();
    const idx = pool.findIndex((t) => !refusedPair(home, t));
    if (idx >= 0) {
      extra.push([home, pool.splice(idx, 1)[0]]);
      continue;
    }
    const partner = teams.find((t) => teamLabel(t) !== teamLabel(home) && !refusedPair(home, t));
    if (partner) extra.push([home, partner]);
  }
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const p of [...first, ...extra]) {
    const k = [teamLabel(p[0]), teamLabel(p[1])].sort().join("|");
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}
function occupies(kickoffMin, length, warmup = 15, vacate = 10) {
  return {
    kick: kickoffMin,
    warmup: kickoffMin - warmup,
    end: kickoffMin + length,
    vacate: kickoffMin + length + vacate
  };
}
function fmt(min) {
  return formatClockShort(min);
}
function prettySatKey(key) {
  if (key.startsWith("person:")) {
    const rest = key.slice(7);
    const i = rest.indexOf("::");
    if (i < 0) return rest;
    const name = rest.slice(0, i);
    const phone = rest.slice(i + 2);
    return phone ? `${name} (${phone})` : name;
  }
  if (key.startsWith("unit:") || key.startsWith("rest:")) return key.slice(5);
  if (key.startsWith("hh:")) return key.slice(3).split("::")[0];
  return key;
}
function explainUnsat(league, live) {
  let camel;
  let occupied;
  for (let a = 0; a < live.length; a++) {
    for (let b = a + 1; b < live.length; b++) {
      const shared = live[a].job.people.filter((p) => live[b].job.people.includes(p));
      if (shared.length && live[a].cands.length && live[b].cands.length) {
        let allClash = true;
        for (const A of live[a].cands) {
          for (const B of live[b].cands) {
            const travel = travelMinutes(league, A.field.campus, B.field.campus).minutes ?? 90;
            if (!personClash(
              { ...A.occ, campus: A.field.campus },
              { ...B.occ, campus: B.field.campus },
              travel
            )) {
              allClash = false;
            }
          }
        }
        if (allClash && !camel) {
          const whoRaw = prettySatKey(shared.find((s) => s.startsWith("person:")) || shared[0]);
          const who = whoRaw.replace(/\s*\([^)]+\)\s*$/, "");
          const A = live[a].cands[0];
          const B = live[b].cands[0];
          const earlier = A.kick <= B.kick ? A : B;
          const later = earlier === A ? B : A;
          const clubs = [teamLabel(live[a].job.home), teamLabel(live[b].job.home)].sort(
            (x, y) => (parseInt(x, 10) || 99) - (parseInt(y, 10) || 99)
          );
          if (norm(A.field.campus) !== norm(B.field.campus)) {
            const travel = travelMinutes(league, earlier.field.campus, later.field.campus).minutes ?? 35;
            camel = `Broke the camel's back: ${who} would still be at ${earlier.field.campus} (vacate ${fmt(earlier.occ.vacate)}) and cannot be on ${fieldShort2(later.field.name)} for a ${fmt(later.kick)} kickoff \u2014 ${travel} minutes on the travel sheet.`;
          } else {
            const kick = fmt(A.kick);
            const fields = [fieldShort2(A.field.name), fieldShort2(B.field.name)].sort();
            camel = `Broke the camel's back: ${who} would have to be on ${fields[0]} and ${fields[1]} at ${kick}. ${clubs[0]} and ${clubs[1]} both asked for rank-1 ${kick}.`;
          }
        }
      }
      const alwaysStacked = live[a].cands.length && live[b].cands.length && live[a].cands.every(
        (A) => live[b].cands.every((B) => A.field.name === B.field.name && windowsOverlap2(A.occ, B.occ))
      );
      if (alwaysStacked && !occupied) {
        const later = live[a].cands[0].kick <= live[b].cands[0].kick ? live[b].cands[0] : live[a].cands[0];
        const earlier = later === live[b].cands[0] ? live[a].cands[0] : live[b].cands[0];
        occupied = `${fieldShort2(earlier.field.name)} is still occupied (warm-up / play / vacate) through ${fmt(earlier.occ.vacate)}; a ${fmt(later.kick)} kickoff does not fit.`;
      }
    }
  }
  return camel || occupied;
}
function windowsOverlap2(a, b) {
  return !(a.vacate <= b.warmup || b.vacate <= a.warmup);
}
function personClash(a, b, travel) {
  const aKick = a.kick ?? a.warmup;
  const bKick = b.kick ?? b.warmup;
  const aEnd = a.end ?? a.vacate;
  const bEnd = b.end ?? b.vacate;
  const playOverlap = !(aEnd <= bKick || bEnd <= aKick);
  if (norm(a.campus) === norm(b.campus)) return playOverlap;
  return !(a.vacate + travel <= bKick || b.vacate + travel <= aKick);
}
function fieldOpen(field2, dayName, kick, vacate) {
  const win = field2.windows.find((w) => w.day === dayName);
  if (field2.windows.length && !win) return false;
  if (win && (kick < win.startMinutes || vacate > win.endMinutes + 5)) return false;
  return true;
}
function saturdaySlots(league, bracket) {
  const set = /* @__PURE__ */ new Set();
  const prefs = league.preferredSlots.filter((p) => !bracket || norm(p.bracket) === norm(bracket));
  const saturdayPrefs = prefs.filter((p) => p.day.toLowerCase() === "saturday");
  for (const p of saturdayPrefs) set.add(clockOr2(p.time, 9 * 60));
  if (bracket) {
    const ag = league.ageGroups.find((a) => norm(a.name) === norm(bracket));
    const clock3 = resolveClock(ag);
    const start = saturdayPrefs[0] ? clockOr2(saturdayPrefs[0].time, 8 * 60) : 8 * 60;
    const step = Math.max(15, occupyMinutes(clock3));
    for (let m = start; m + onClockMinutes(clock3) <= 18 * 60; m += step) set.add(m);
    for (const d of [-30, 30]) {
      const t = start + d;
      if (t >= 8 * 60 && t <= 16 * 60) set.add(t);
    }
  } else {
    for (let m = 8 * 60; m <= 16 * 60; m += 60) set.add(m);
    for (const p of league.preferredSlots) set.add(clockOr2(p.time, 9 * 60));
  }
  if (league.carveOuts.some((c) => c.mustUse)) {
    for (const p of league.preferredSlots) set.add(clockOr2(p.time, 9 * 60));
  }
  return [...set].sort((a, b) => a - b);
}
function slotRank(league, bracket, minutes, day = "saturday") {
  return preferredKickCost(league, bracket, minutes, day);
}
function dateOnWeekday(fromIso, day) {
  const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const want = names.indexOf(day.toLowerCase());
  if (want < 0) return fromIso;
  const have = names.indexOf(weekdayName(fromIso));
  let delta = want - have;
  if (delta < 0) delta += 7;
  return addDays(fromIso, delta);
}
function jobDates(league, job) {
  const sat = weekdayName(job.dateIso);
  const days = [
    ...new Set(
      league.preferredSlots.filter((p) => norm(p.bracket) === norm(job.bracket)).map((p) => p.day.toLowerCase())
    )
  ];
  if (!days.length) return [{ iso: job.dateIso, day: sat }];
  const out = [];
  for (const day of days) {
    const iso2 = dateOnWeekday(job.dateIso, day);
    if (out.some((d) => d.iso === iso2)) continue;
    out.push({ iso: iso2, day });
  }
  return out.length ? out : [{ iso: job.dateIso, day: sat }];
}
function preferredKickOnDay(league, bracket, day, kick) {
  return league.preferredSlots.some(
    (p) => norm(p.bracket) === norm(bracket) && p.day.toLowerCase() === day.toLowerCase() && clockOr2(p.time, -1) === kick
  );
}
function carveForbids(league, job, dateIso, kick) {
  const labels = [teamLabel(job.home), teamLabel(job.away)];
  for (const c of league.carveOuts) {
    const team = findTeam(league, c.team);
    if (!team || !labels.includes(teamLabel(team))) continue;
    if (c.notAt) {
      const snap = snapCarveDate(league, c.date);
      const hitDate = c.everySaturday ? weekdayName(dateIso) === "saturday" : dateIso === snap;
      if (hitDate && clockOr2(c.notAt, -1) === kick) return true;
    }
    if (c.mustUse) {
      const snap = snapCarveDate(league, c.date);
      const hit = c.everySaturday || dateIso === snap;
      if (hit && clockOr2(c.mustUse, -1) !== kick) return true;
    }
  }
  return false;
}
function preferredVenue(league, bracket, minutes) {
  const hit = league.preferredSlots.find(
    (p) => norm(p.bracket) === norm(bracket) && p.day.toLowerCase() === "saturday" && clockOr2(p.time, -1) === minutes && p.venue
  );
  return hit?.venue;
}
function refusedPair(home, away) {
  if (home.willNotPlay.some((w) => norm(w) === norm(away.association) || norm(w) === norm(teamLabel(away)))) {
    return true;
  }
  if (away.willNotPlay.some((w) => norm(w) === norm(home.association) || norm(w) === norm(teamLabel(home)))) {
    return true;
  }
  return false;
}
function peopleOn(plan, home, away) {
  return [.../* @__PURE__ */ new Set([...satKeysForTeam(plan, home), ...satKeysForTeam(plan, away)])];
}
function ageMinutes(league, bracket) {
  const ag = league.ageGroups.find((a) => norm(a.name) === norm(bracket));
  return onClockMinutes(resolveClock(ag));
}
function controlledAssoc(league, name) {
  return !!league.associations.find((a) => norm(a.name) === norm(name) && a.controlled);
}
function materializeGuestTeams(league) {
  const out = [];
  for (const a of league.associations.filter((x) => !x.controlled)) {
    for (const g of a.guestSides) {
      const n = Math.max(1, g.teamCount || 1);
      for (let i = 0; i < n; i++) {
        const base = g.name || `${a.name} ${g.ageGroup}`;
        out.push({
          name: n > 1 ? `${base} ${i + 1}` : base,
          bracket: g.ageGroup,
          association: a.name,
          jersey: g.jersey || "navy",
          players: [],
          willNotPlay: [],
          willNotTravelTo: [],
          awayDesired: 0,
          guestDesired: 0
        });
      }
    }
  }
  return out;
}
function guestCap(league, guest) {
  const assoc = league.associations.find((a) => a.name === guest.association);
  const side = assoc?.guestSides.find((s) => norm(s.ageGroup) === norm(guest.bracket));
  return side?.gamesRequested || 4;
}
function campusControlled(league, campus) {
  if (/van/i.test(campus)) return true;
  const camp = league.campuses.find((c) => norm(c.name) === norm(campus));
  const assoc = league.associations.find(
    (a) => camp?.association && norm(a.name) === norm(camp.association) || a.homeCampus && norm(a.homeCampus) === norm(campus)
  );
  return !!assoc?.controlled;
}
function mixedFields(league, home, away) {
  const ha = league.ageGroups.find((a) => norm(a.name) === norm(home.bracket));
  const aa = league.ageGroups.find((a) => norm(a.name) === norm(away.bracket));
  const classes = (ha?.fieldClasses || []).filter((c) => (aa?.fieldClasses || []).some((x) => norm(x) === norm(c)));
  const use = classes.length ? classes : ha?.fieldClasses || [];
  const homeCtl = controlledAssoc(league, home.association);
  const awayCtl = controlledAssoc(league, away.association);
  const guest = !homeCtl ? home : !awayCtl ? away : void 0;
  const guestCampus = guest ? league.associations.find((a) => a.name === guest.association)?.homeCampus : void 0;
  return league.fields.filter((f) => {
    if (!use.some((c) => norm(c) === norm(f.type))) return false;
    if (home.willNotTravelTo.some((c) => norm(c) === norm(f.campus))) return false;
    if (away.willNotTravelTo.some((c) => norm(c) === norm(f.campus))) return false;
    if (homeCtl && awayCtl) return campusControlled(league, f.campus);
    if (guestCampus) return norm(f.campus) === norm(guestCampus) || campusControlled(league, f.campus);
    return true;
  });
}
function mayPlayTogether(league, a, b) {
  const agA = league.ageGroups.find((x) => norm(x.name) === norm(a.bracket));
  const agB = league.ageGroups.find((x) => norm(x.name) === norm(b.bracket));
  if (!agA || !agB) return false;
  return agA.mayPlayWith.some((m) => norm(m) === norm(b.bracket)) && agB.mayPlayWith.some((m) => norm(m) === norm(a.bracket));
}
function pushJob(jobs, diagnostics, league, plan, dateIso, weekIndex, home, away, notes) {
  if (refusedPair(home, away)) return;
  const shorter = ageMinutes(league, home.bracket) <= ageMinutes(league, away.bracket) ? home.bracket : away.bracket;
  const clock3 = resolveClock(league.ageGroups.find((a) => norm(a.name) === norm(shorter)));
  const length = onClockMinutes(clock3);
  const base = mixedFields(league, home, away);
  const awayLeague = notes.find((n) => n.startsWith("away \u2014 "))?.slice("away \u2014 ".length);
  const guestHome = notes.some((n) => n.startsWith("guest \u2014 "));
  const pinch = awayLeague ? base.filter(
    (f) => norm(f.campus) === norm(league.associations.find((a) => a.name === awayLeague)?.homeCampus || "")
  ) : guestHome ? base.filter((f) => campusControlled(league, f.campus)) : base.filter((f) => campusControlled(league, f.campus));
  const fields = pinch.length ? pinch : base;
  if (!fields.length) {
    diagnostics.push(`No legal field for ${teamLabel(home)} vs ${teamLabel(away)} on ${dateIso}`);
    return;
  }
  jobs.push({
    key: `${dateIso}:${teamLabel(home)}:${teamLabel(away)}`,
    dateIso,
    weekIndex,
    home,
    away,
    bracket: shorter,
    length,
    warmup: clock3.warmupMinutes,
    vacatePad: clock3.vacateMinutes,
    people: peopleOn(plan, home, away),
    fields,
    notes
  });
}
function buildJobs(league, plan, matchups) {
  const sats = playingSaturdays(league).filter((d) => !weeks(league).find((w) => w.label === d && w.kind === "bye"));
  const jobs = [];
  const diagnostics = [];
  const guests = materializeGuestTeams(league);
  const guestLoad = /* @__PURE__ */ new Map();
  sats.forEach((dateIso, weekIndex) => {
    const used = /* @__PURE__ */ new Set();
    if (isHomeGuestDate(league, dateIso)) {
      const brackets = [...new Set(league.teams.map((t) => t.bracket))];
      for (const bracket of brackets) {
        const rec = league.teams.filter(
          (t) => t.bracket === bracket && /rec/i.test(t.association) && t.guestDesired > 0 && !used.has(teamLabel(t))
        );
        const acd = league.teams.filter(
          (t) => t.bracket === bracket && /academy/i.test(t.association) && !used.has(teamLabel(t))
        );
        const n = Math.min(rec.length, acd.length);
        for (let i = 0; i < n; i++) {
          pushJob(jobs, diagnostics, league, plan, dateIso, weekIndex, rec[i], acd[i], [
            "guest date \u2014 Academy (controlled)"
          ]);
          used.add(teamLabel(rec[i]));
          used.add(teamLabel(acd[i]));
        }
      }
    }
    const pools = /* @__PURE__ */ new Map();
    for (const t of league.teams) {
      if (used.has(teamLabel(t))) continue;
      const key = `${t.association}|${t.bracket}`;
      pools.set(key, [...pools.get(key) || [], t]);
    }
    for (const group of pools.values()) {
      for (const [home, away] of pairsForGroup(group, dateIso, weekIndex, matchups)) {
        if (used.has(teamLabel(home)) || used.has(teamLabel(away))) continue;
        pushJob(jobs, diagnostics, league, plan, dateIso, weekIndex, home, away, []);
        used.add(teamLabel(home));
        used.add(teamLabel(away));
      }
    }
    const leftover = league.teams.filter((t) => !used.has(teamLabel(t)));
    for (let i = 0; i < leftover.length; i++) {
      for (let j = i + 1; j < leftover.length; j++) {
        const home = leftover[i];
        const away = leftover[j];
        if (used.has(teamLabel(home)) || used.has(teamLabel(away))) continue;
        if (norm(home.association) !== norm(away.association)) continue;
        if (!mayPlayTogether(league, home, away)) continue;
        if (norm(home.bracket) === norm(away.bracket)) continue;
        const clock3 = Math.min(ageMinutes(league, home.bracket), ageMinutes(league, away.bracket));
        const young = ageMinutes(league, home.bracket) <= ageMinutes(league, away.bracket) ? home.bracket : away.bracket;
        pushJob(jobs, diagnostics, league, plan, dateIso, weekIndex, home, away, [
          `cross-bracket \u2014 ${young} clock, small field`,
          `this game is ${clock3} minutes`
        ]);
        used.add(teamLabel(home));
        used.add(teamLabel(away));
      }
    }
    const still = league.teams.filter((t) => !used.has(teamLabel(t)) && controlledAssoc(league, t.association));
    const awayDate = isAwayGuestDate(league, dateIso);
    const homeDate = isHomeGuestDate(league, dateIso);
    const trips = (league.season.awayWeekends || []).filter((w) => w.dateIso === dateIso);
    const visits = (league.season.homeWeekends || []).filter((w) => w.dateIso === dateIso);
    for (const van of still) {
      if (used.has(teamLabel(van))) continue;
      const trip = trips.find((w) => norm(w.bracket) === norm(van.bracket));
      const visit = visits.find((w) => norm(w.bracket) === norm(van.bracket));
      if (!van.awayDesired && !van.guestDesired && !van.guestTravel && !trip && !visit) continue;
      const wantAssoc = trip?.association || visit?.association;
      const pool = guests.filter((g) => {
        if (norm(g.bracket) !== norm(van.bracket)) return false;
        if (wantAssoc) return norm(g.association) === norm(wantAssoc);
        return true;
      });
      if (!pool.length) continue;
      const ranked = [...pool].sort((a, b) => {
        const la = guestLoad.get(teamLabel(a)) || 0;
        const lb = guestLoad.get(teamLabel(b)) || 0;
        if (la !== lb) return la - lb;
        return (weekIndex + a.association.length) % 7 - (weekIndex + b.association.length) % 7;
      });
      const opp = ranked.find((g) => (guestLoad.get(teamLabel(g)) || 0) < guestCap(league, g));
      if (!opp) continue;
      const weTravel = trip ? true : visit ? false : awayDate || /we travel/i.test(van.guestTravel || "") && !homeDate;
      const notes = weTravel ? [`away \u2014 ${opp.association}`] : [`guest \u2014 ${opp.association} at home`];
      const home = weTravel ? opp : van;
      const away = weTravel ? van : opp;
      pushJob(jobs, diagnostics, league, plan, dateIso, weekIndex, home, away, notes);
      used.add(teamLabel(van));
      guestLoad.set(teamLabel(opp), (guestLoad.get(teamLabel(opp)) || 0) + 1);
    }
  });
  return { jobs, diagnostics };
}
function num2(model, expr) {
  const raw = model.eval(expr).toString();
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Z3 model was not a number: ${raw}`);
  return n;
}
var lastProbe;
async function probeZ3(loadZ3 = defaultLoadZ3) {
  if (lastProbe) return lastProbe;
  const { Context } = await loadZ3();
  const Z3 = Context("probe");
  const x = Z3.Int.const("x");
  const s = new Z3.Solver();
  s.add(x.add(x).eq(2));
  const verdict = await s.check();
  if (verdict !== "sat" && verdict !== "unsat" && verdict !== "unknown") {
    throw new Error(`Z3 probe returned ${verdict}`);
  }
  lastProbe = verdict;
  return verdict;
}
function fiatCampusCost(league, job, field2, dateIso) {
  const van = [job.home, job.away].find((t) => controlledAssoc(league, t.association));
  const guest = [job.home, job.away].find((t) => t !== van);
  if (!van || !guest) return 0;
  const guestCampus = league.associations.find((a) => a.name === guest.association)?.homeCampus || "";
  const awayDate = isAwayGuestDate(league, dateIso);
  const homeDate = isHomeGuestDate(league, dateIso);
  const weTravel = awayDate || /we travel/i.test(van.guestTravel || "") && !homeDate;
  const atGuest = guestCampus && norm(field2.campus) === norm(guestCampus);
  const atVan = /van/i.test(field2.campus);
  if (weTravel) {
    if (atGuest) return 0;
    if (atVan) return 14;
    return 8;
  }
  if (atVan) return 0;
  return 14;
}
function candidatesFor(league, job, slots) {
  const out = [];
  const dates = jobDates(league, job);
  const kicks = new Set(saturdaySlots(league, job.bracket));
  for (const { day } of dates) {
    if (day === "saturday") continue;
    for (const p of league.preferredSlots) {
      if (norm(p.bracket) === norm(job.bracket) && p.day.toLowerCase() === day) {
        kicks.add(clockOr2(p.time, 9 * 60));
      }
    }
  }
  const use = (kicks.size ? [...kicks] : slots).sort((a, b) => a - b);
  for (let di = 0; di < dates.length; di++) {
    const { iso: iso2, day } = dates[di];
    for (let rawSi = 0; rawSi < use.length; rawSi++) {
      const kick = use[rawSi];
      if (day !== "saturday" && !preferredKickOnDay(league, job.bracket, day, kick)) continue;
      if (carveForbids(league, job, iso2, kick)) continue;
      const occ = occupies(kick, job.length, job.warmup, job.vacatePad);
      const dayVenue = day === "saturday" ? preferredVenue(league, job.bracket, kick) : void 0;
      for (let fi = 0; fi < job.fields.length; fi++) {
        const field2 = job.fields[fi];
        if (!fieldOpen(field2, day, kick, occ.vacate)) continue;
        const venueHit = dayVenue ? norm(field2.name) === norm(dayVenue) || norm(field2.name).includes(norm(dayVenue)) : true;
        out.push({
          si: di * SLOT_STRIDE + rawSi,
          fi,
          dateIso: iso2,
          kick,
          occ,
          field: field2,
          cost: slotRank(league, job.bracket, kick, day) + fi + (dayVenue && !venueHit ? 6 : 0) + fiatCampusCost(league, job, field2, iso2)
        });
      }
    }
  }
  return out;
}
function encodeDay(Z3, opt, prefix, league, dayJobs, slots, staffCenters) {
  const NONE = staffCenters.length;
  const diagnostics = [];
  const live = [];
  for (const job of dayJobs) {
    const cands = candidatesFor(league, job, slots);
    if (!cands.length) {
      diagnostics.push(`No legal (field, kickoff) for ${teamLabel(job.home)} vs ${teamLabel(job.away)} on ${job.dateIso}`);
      continue;
    }
    live.push({ job, cands });
  }
  const slotVar = live.map((row, li) => {
    const v = Z3.Int.const(`${prefix}s${li}`);
    opt.add(v.ge(0));
    const maxSi = Math.max(...row.cands.map((c) => c.si), 0) + 1;
    opt.add(v.lt(maxSi));
    return v;
  });
  const fieldVar = live.map((row, li) => {
    const v = Z3.Int.const(`${prefix}f${li}`);
    opt.add(v.ge(0));
    opt.add(v.lt(row.job.fields.length));
    return v;
  });
  const centerVar = live.map((row, li) => {
    const v = Z3.Int.const(`${prefix}c${li}`);
    opt.add(v.ge(0));
    opt.add(v.lt(NONE + 1));
    const eligible = staffCenters.map((s, ri) => s.centerOf.some((b) => norm(b) === norm(row.job.bracket)) ? ri : -1).filter((ri) => ri >= 0);
    if (!eligible.length) opt.add(v.eq(NONE));
    else opt.add(Z3.Or(v.eq(NONE), ...eligible.map((ri) => v.eq(ri))));
    return v;
  });
  for (let li = 0; li < live.length; li++) {
    opt.add(Z3.Or(...live[li].cands.map((c) => Z3.And(slotVar[li].eq(c.si), fieldVar[li].eq(c.fi)))));
  }
  for (let a = 0; a < live.length; a++) {
    for (let b = a + 1; b < live.length; b++) {
      const sharePeople = live[a].job.people.some((p) => live[b].job.people.includes(p));
      const aCamp = new Set(live[a].cands.map((c) => c.field.campus));
      const bCamp = new Set(live[b].cands.map((c) => c.field.campus));
      if (aCamp.size === 1 && bCamp.size === 1) {
        const aCampus = [...aCamp][0];
        const bCampus = [...bCamp][0];
        const travel = travelMinutes(league, aCampus, bCampus).minutes ?? 90;
        const aSlots = /* @__PURE__ */ new Map();
        const bSlots = /* @__PURE__ */ new Map();
        for (const c of live[a].cands) if (!aSlots.has(c.si)) aSlots.set(c.si, c);
        for (const c of live[b].cands) if (!bSlots.has(c.si)) bSlots.set(c.si, c);
        for (const A of aSlots.values()) {
          for (const B of bSlots.values()) {
            if (A.dateIso !== B.dateIso) continue;
            const clash = personClash(
              { ...A.occ, campus: aCampus },
              { ...B.occ, campus: bCampus },
              travel
            );
            if (!clash) continue;
            if (sharePeople) opt.add(Z3.Not(Z3.And(slotVar[a].eq(A.si), slotVar[b].eq(B.si))));
            opt.add(
              Z3.Not(
                Z3.And(
                  slotVar[a].eq(A.si),
                  slotVar[b].eq(B.si),
                  centerVar[a].eq(centerVar[b]),
                  Z3.Not(centerVar[a].eq(NONE))
                )
              )
            );
          }
        }
        for (const A of live[a].cands) {
          for (const B of live[b].cands) {
            if (A.field.name !== B.field.name || A.dateIso !== B.dateIso) continue;
            if (!windowsOverlap2(A.occ, B.occ)) continue;
            opt.add(
              Z3.Not(Z3.And(slotVar[a].eq(A.si), fieldVar[a].eq(A.fi), slotVar[b].eq(B.si), fieldVar[b].eq(B.fi)))
            );
          }
        }
        continue;
      }
      for (const A of live[a].cands) {
        for (const B of live[b].cands) {
          if (A.dateIso !== B.dateIso) continue;
          const travel = travelMinutes(league, A.field.campus, B.field.campus).minutes ?? 90;
          const clash = personClash(
            { ...A.occ, campus: A.field.campus },
            { ...B.occ, campus: B.field.campus },
            travel
          );
          const grass = A.field.name === B.field.name && windowsOverlap2(A.occ, B.occ);
          if (!grass && !(sharePeople && clash) && !clash) continue;
          const both = Z3.And(slotVar[a].eq(A.si), fieldVar[a].eq(A.fi), slotVar[b].eq(B.si), fieldVar[b].eq(B.fi));
          if (grass || sharePeople && clash) opt.add(Z3.Not(both));
          if (clash) {
            opt.add(Z3.Not(Z3.And(both, centerVar[a].eq(centerVar[b]), Z3.Not(centerVar[a].eq(NONE)))));
          }
        }
      }
    }
  }
  return { live, slotVar, fieldVar, centerVar, diagnostics };
}
async function solveJobs(league, jobs, loadZ3) {
  if (!jobs.length) return { games: [], verdict: "sat", diagnostics: [], z3Vars: 0 };
  const { Context } = await loadZ3();
  const slots = saturdaySlots(league);
  const staffCenters = league.staff.filter((s) => s.centerOf.length);
  const NONE = staffCenters.length;
  const byDay = /* @__PURE__ */ new Map();
  for (const job of jobs) {
    byDay.set(job.dateIso, [...byDay.get(job.dateIso) || [], job]);
  }
  const placedAll = [];
  const diagnostics = [];
  let verdict = "sat";
  let n = 0;
  let z3Vars = 0;
  for (const dateIso of [...byDay.keys()].sort()) {
    const Z3 = Context(`van_${dateIso.replace(/-/g, "")}_${n++}`);
    const opt = new Z3.Optimize();
    opt.set("timeout", (byDay.get(dateIso) || []).length > 8 ? 15e3 : 8e3);
    const encoded = encodeDay(Z3, opt, "g", league, byDay.get(dateIso) || [], slots, staffCenters);
    diagnostics.push(...encoded.diagnostics);
    z3Vars = Math.max(z3Vars, encoded.live.length * 3);
    const cost = [Z3.Int.val(0)];
    for (let li = 0; li < encoded.live.length; li++) {
      const bySi = /* @__PURE__ */ new Map();
      for (const c of encoded.live[li].cands) {
        const list = bySi.get(c.si) || [];
        list.push(c);
        bySi.set(c.si, list);
      }
      for (const [si, group] of bySi) {
        const best = Math.min(...group.map((c) => c.cost - c.fi));
        cost.push(Z3.If(encoded.slotVar[li].eq(si), Z3.Int.val(best), Z3.Int.val(0)));
        for (const c of group) {
          const extra = c.cost - c.fi - best;
          if (!extra) continue;
          cost.push(
            Z3.If(
              Z3.And(encoded.slotVar[li].eq(si), encoded.fieldVar[li].eq(c.fi)),
              Z3.Int.val(extra),
              Z3.Int.val(0)
            )
          );
        }
      }
      cost.push(encoded.fieldVar[li]);
      cost.push(Z3.If(encoded.centerVar[li].eq(NONE), Z3.Int.val(80), Z3.Int.val(0)));
    }
    if (encoded.live.length) opt.minimize(Z3.Sum(...cost));
    const dayVerdict = encoded.live.length ? await opt.check() : "sat";
    if (dayVerdict !== "sat") {
      verdict = dayVerdict;
      const camel = explainUnsat(league, encoded.live);
      const line = camel || `Z3 ${dayVerdict} on ${dateIso}`;
      if (!diagnostics.includes(line)) diagnostics.push(line);
      try {
        opt.release();
      } catch {
      }
      continue;
    }
    if (encoded.live.length) {
      const model = opt.model();
      for (let li = 0; li < encoded.live.length; li++) {
        const si = num2(model, encoded.slotVar[li]);
        const fi = num2(model, encoded.fieldVar[li]);
        const cand = encoded.live[li].cands.find((c) => c.si === si && c.fi === fi);
        if (!cand) throw new Error(`Z3 sat but no candidate for ${encoded.live[li].job.key}`);
        const ri = num2(model, encoded.centerVar[li]);
        placedAll.push({
          job: encoded.live[li].job,
          cand,
          center: ri === NONE ? void 0 : printName(staffCenters[ri])
        });
      }
    }
    try {
      opt.release();
    } catch {
    }
  }
  const games = toPlacedGames(league, placedAll);
  return { games, verdict, diagnostics, z3Vars };
}
function toPlacedGames(league, placedAll) {
  const games = [];
  let id = 1;
  const staffAsst = league.staff.filter((s) => s.assistantOf.length);
  const busy = [];
  const seated = [...placedAll].sort(
    (a, b) => a.job.dateIso.localeCompare(b.job.dateIso) || a.cand.kick - b.cand.kick
  );
  for (const d of seated) {
    if (d.center) busy.push({ who: d.center, ...d.cand.occ, campus: d.cand.field.campus });
  }
  for (const d of seated) {
    const assistants = [];
    const ag = league.ageGroups.find((a) => norm(a.name) === norm(d.job.bracket));
    const need = ag?.assistantPreferred || ag?.assistantMin || 0;
    const isBusy = (who) => busy.some((b) => {
      if (b.who !== who) return false;
      const travel = travelMinutes(league, b.campus, d.cand.field.campus).minutes ?? 0;
      return personClash(
        { warmup: b.warmup, vacate: b.vacate, campus: b.campus },
        { ...d.cand.occ, campus: d.cand.field.campus },
        travel
      );
    });
    for (const s of staffAsst) {
      if (assistants.length >= need) break;
      if (!s.assistantOf.some((c) => norm(c) === norm(d.job.bracket))) continue;
      const nm = printName(s);
      if (d.center === nm || isBusy(nm) || assistants.includes(nm)) continue;
      assistants.push(nm);
    }
    games.push({
      id: `g${id++}`,
      weekIso: d.job.dateIso,
      dateIso: d.cand.dateIso || d.job.dateIso,
      kickoff: fmt(d.cand.kick),
      end: fmt(d.cand.occ.end),
      warmupStart: fmt(d.cand.occ.warmup),
      vacate: fmt(d.cand.occ.vacate),
      ageGroup: d.job.bracket,
      home: teamLabel(d.job.home),
      away: teamLabel(d.job.away),
      field: fieldShort2(d.cand.field.name),
      campus: d.cand.field.campus,
      parking: d.cand.field.parking,
      center: d.center,
      assistants,
      notes: [...d.job.notes || []]
    });
    for (const who of d.job.people) busy.push({ who, ...d.cand.occ, campus: d.cand.field.campus });
    for (const who of assistants) busy.push({ who, ...d.cand.occ, campus: d.cand.field.campus });
  }
  return games;
}
function nodeProcess() {
  const g = globalThis;
  return g.process;
}
async function solveInFreshIsolate(league, name) {
  const { Worker } = await import("node:worker_threads");
  const { fileURLToPath } = await import("node:url");
  const child = fileURLToPath(new URL("../scripts/z3-node-child.bundle.mjs", import.meta.url));
  return new Promise((resolve, reject) => {
    const w = new Worker(child, {
      env: { ...nodeProcess()?.env, VAN_Z3_CHILD: "1" }
    });
    const timer = setTimeout(() => {
      void w.terminate();
      reject(new Error("Z3 child isolate timed out"));
    }, 24e4);
    w.once("message", (msg) => {
      clearTimeout(timer);
      void w.terminate();
      if (msg?.ok && msg.cfg) resolve(msg.cfg);
      else reject(new Error(msg?.error || "Z3 child isolate failed"));
    });
    w.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    w.postMessage({ league: JSON.parse(JSON.stringify(league)), name });
  });
}
async function solveLeague(league, name = "Configuration 1 \u2014 First pass \u2014 no carve-outs", loadZ3 = defaultLoadZ3) {
  const proc = nodeProcess();
  const customLoader = loadZ3 !== defaultLoadZ3;
  if (proc?.versions?.node && proc.env?.VAN_Z3_CHILD !== "1" && !customLoader) {
    return solveInFreshIsolate(league, name);
  }
  const probe = await probeZ3(loadZ3);
  if (probe !== "sat") {
    throw new Error(`Z3 probe failed (${probe}) \u2014 refusing to place games without a real solver`);
  }
  const plan = foldLeague(league);
  const seasonPairs = await optimizeSeasonMatchups(league, loadZ3);
  const { jobs, diagnostics: pre } = buildJobs(league, plan, seasonPairs);
  const { games, verdict, diagnostics: fromZ3, z3Vars } = await solveJobs(league, jobs, loadZ3);
  const diagnostics = [...pre, ...fromZ3];
  const z3Hard = diagnostics.length === 0 && verdict === "sat";
  const folding = snapshotFolding(plan, z3Vars);
  const owed = owedGames(league);
  const easy = plan.teams.find((t) => t.kind === "unit" && /super stars/i.test(t.label)) || plan.teams.find((t) => t.kind === "unit");
  const tangled = plan.households.find((h) => h.kind === "exploded" && /oreo/i.test(h.last)) || plan.households.find((h) => h.kind === "exploded") || plan.teams.find((t) => t.kind === "exploded");
  const scores = [
    {
      key: "engine",
      text: "Z3 wasm \u2014 matchups optimized across every week; soft rematch, grass, travel, household scored as one season"
    },
    {
      key: "hard",
      text: z3Hard ? (() => {
        const assocs = new Set(
          games.flatMap(
            (g) => [g.home, g.away].map((lab) => league.teams.find((t) => teamLabel(t) === lab)?.association || "")
          )
        );
        const rec = [...assocs].some((a) => /rec/i.test(a));
        const acd = [...assocs].some((a) => /academy/i.test(a));
        return rec && acd ? "hard rules: all held \u2014 Rec and Academy shared Van Complex" : "hard rules: all held";
      })() : "hard rules: strain \u2014 see diagnostics"
    },
    {
      key: "matchups",
      text: seasonPairs.pools ? `Z3 matchups: ${seasonPairs.verdict} \u2014 ${seasonPairs.pools} pools optimized across the fall (rematch extras ${seasonPairs.extras})` : `Z3 matchups: sat \u2014 season pairing in one model; two-team pools have one opponent`
    },
    { key: "owed", text: `playing weeks: ${owed} \u2014 every Van team is owed ${owed} games` },
    {
      key: "heap",
      text: `SAT heap: ${folding.foldedVars} folded units, not ${folding.naiveVars} people (bound ${folding.bound})`
    },
    {
      key: "fold",
      text: `${easy?.display || "folded units travel as a block"} \xB7 ${tangled?.display || "specials exploded"}`
    }
  ];
  const six = games.filter((g) => g.ageGroup === "6U");
  const rank1 = six.filter((g) => g.kickoff === "8:30" && weekdayName(g.dateIso) === "saturday").length;
  const { monday: rank3, total: sixN } = mondaySixCount(games);
  if (six.length) {
    scores.push({
      key: "6u-slots",
      text: `6U on rank-1 slot: ${rank1} of ${six.length}; on rank-2: ${six.length - rank1 - rank3}; on rank-3: ${rank3}`
    });
  }
  if (rank3) {
    const fieldB = games.filter((g) => g.ageGroup === "6U" && weekdayName(g.dateIso) === "monday" && /Field B/i.test(g.field)).length;
    scores.push({
      key: "6u-monday",
      text: `6U on rank-3 Monday 6:30: ${rank3} of ${sixN}${fieldB ? " \u2014 Field B" : ""}`
    });
  }
  const matchups = matchupScoreLines(league, games);
  scores.push(...matchups.scores);
  diagnostics.push(...matchups.diagnostics);
  scores.push(...carveHonorLines(league, games));
  const mondayLine = mustUseMondayDiagnostic(league, games);
  if (mondayLine) diagnostics.push(mondayLine);
  const pairs = crossClassPairs(league);
  if (pairs.length) {
    const mix = games.filter((g) => g.notes.some((n) => /cross-bracket/i.test(n)));
    if (mix.length) {
      scores.push({
        key: "cross-bracket",
        text: `cross-bracket: ${mix.map((g) => `${g.home} vs ${g.away}`).join("; ")} \u2014 ${mix[0].notes.find((n) => /clock/i.test(n)) || "mixed clock"}`
      });
    }
  }
  const rec12 = league.teams.find((t) => t.bracket === "12U" && /rec/i.test(t.association) && t.guestDesired);
  if (rec12) {
    const filled = games.filter((g) => {
      if (g.home !== teamLabel(rec12) && g.away !== teamLabel(rec12)) return false;
      const other = g.home === teamLabel(rec12) ? g.away : g.home;
      const assoc = league.teams.find((t) => teamLabel(t) === other)?.association || "";
      return /academy/i.test(assoc);
    }).length;
    scores.push({
      key: "guest-filled",
      text: `guest dates filled: Rec 12U ${filled} of ${rec12.guestDesired} against Academy (controlled)`
    });
  }
  scores.push({ key: "league-coach", text: "league-supplied coaches used: 0" });
  const coachPairs = /* @__PURE__ */ new Map();
  for (const g of games) {
    const labels = [g.home, g.away];
    for (const t of league.teams) {
      if (!t.coach || !labels.includes(teamLabel(t))) continue;
      const who = printName(t.coach);
      const key = `${who}|${g.dateIso}`;
      coachPairs.set(key, [...coachPairs.get(key) || [], g]);
    }
  }
  let kept = 0;
  let pairN = 0;
  for (const gs of coachPairs.values()) {
    if (gs.length < 2) continue;
    pairN += 1;
    const sorted = [...gs].sort((a, b) => (parseClock(a.kickoff) || 0) - (parseClock(b.kickoff) || 0));
    let ok = true;
    for (let i = 1; i < sorted.length; i++) {
      if ((parseClock(sorted[i].kickoff) || 0) < (parseClock(sorted[i - 1].end) || 0)) ok = false;
    }
    if (ok) kept += 1;
  }
  if (pairN) {
    scores.push({
      key: "shared-coach",
      text: `shared-coach pairs kept apart: ${kept} of ${pairN}`
    });
  }
  const cfg = {
    id: `cfg-${Date.now().toString(36)}`,
    name,
    createdAt: "just now",
    games,
    scores,
    hardHeld: z3Hard,
    diagnostics,
    engine: "z3",
    z3Verdict: verdict,
    z3Probe: probe,
    folding
  };
  stampSeasonScores(league, cfg);
  return applySimsJudgment(league, cfg);
}

// src/z3-node-child.ts
parentPort?.on("message", async (msg) => {
  try {
    const cfg = await solveLeague(msg.league, msg.name);
    parentPort?.postMessage({ ok: true, cfg });
  } catch (err) {
    parentPort?.postMessage({ ok: false, error: String(err?.message || err) });
  }
});
