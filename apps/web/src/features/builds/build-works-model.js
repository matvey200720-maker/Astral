import { tr } from "../../locales/ui.js";

export const MAX_BUILD_WORKS = 24;
function clean(raw) {
  return String(raw ?? "").trim();
}
export const MAX_WORK_CODE_CHARS = 600000;
const MIMES = ["image/png", "image/webp", "image/jpeg"];
export const MAX_BUILD_WORKS_CHARS = 1500000;
export const MAX_BUILD_CODE_CHARS = 3000000;

export function normalizeBuildPictures(value) {
  const frames = Object.entries(value && typeof value === "object" ? value : {}).flatMap(([slot, frame]) => {
    const base64 = clean(frame?.base64);
    if (!/^[a-z]+:\d{1,2}$/.test(slot) || !base64 || base64.length > 380000) return [];
    const name = clean(frame.name).slice(0, 80) || tr("картинка");
    const mime = MIMES.find((known) => known === clean(frame.mime)) ?? MIMES[0];
    return [[slot, { name, mime, base64, key: clean(frame.key) }]];
  });
  return frames.length ? Object.fromEntries(frames) : null;
}

export function normalizeBuildWork(entry) {
  const work = Object.fromEntries(["name", "workKind", "slotId", "section", "code"].map((field) => [field, clean(entry?.[field])]));
  if (!work.code || !work.workKind) return null;
  work.name = work.name.slice(0, 80);
  work.section ||= "redux";
  const pictures = normalizeBuildPictures(entry.pictures);
  return pictures ? { pictures, ...work } : work;
}

export function normalizeBuildWorksReport(entries) {
  const seen = new Set();
  const fresh = (Array.isArray(entries) ? entries : []).map(normalizeBuildWork).filter((work) => work && !seen.has(work.code) && seen.add(work.code));
  let spent = 0;
  let taken = 0;
  const works = fresh.filter((work) => {
    const weight = Object.values(work.pictures ?? {}).reduce((sum, frame) => sum + frame.base64.length, work.code.length);
    const fits = work.code.length <= MAX_WORK_CODE_CHARS && !/[\s.]/.test(work.code) && taken < MAX_BUILD_WORKS && spent + weight <= MAX_BUILD_WORKS_CHARS;
    if (fits) {
      spent += weight;
      taken += 1;
    }
    return fits;
  });
  return { works, dropped: fresh.length - works.length };
}

export function normalizeBuildWorks(entries) {
  return normalizeBuildWorksReport(entries).works;
}
