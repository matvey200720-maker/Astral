// Какое место мастерской несёт контейнер редукса: по именам файлов внутри
// и (для зон автора) по размерам и цвету листа моделей.
import { CLIMB_SLOT_IDS } from "@modovik/climb-contract";
import { HANGAR_INVENTORY } from "@modovik/climb-contract/recolor/hangar";
import { ZONES } from "@modovik/climb-contract/recolor/zones";
import { CAPT_ZONES_INVENTORY } from "@modovik/climb-contract/recolor/capt-zones";
import { MSL_ZONES_INVENTORY } from "@modovik/climb-contract/recolor/msl-zones";
import SCHEDULE from "@modovik/climb-contract/recolor/inventory/schedule";
import { identifyPlace } from "./place-fingerprints.js";

// ---------- откуда брать имена файлов каждого места (читается один раз) ----------

const ydr = (name) => `${name}.ydr`;
// файл (строчными) -> пометка; при повторе файла побеждает последняя строка описи
const catalogue = (entries) => new Map(entries.map(([file, tag]) => [file.toLowerCase(), tag]));

const FILES = {
  hangar: catalogue((HANGAR_INVENTORY.hangar?.placements ?? []).map((p) => [ydr(p.model), "hangar"])),
  zones: catalogue(ZONES.map((zone) => [zone.file, zone.kind])),
  capt: catalogue((CAPT_ZONES_INVENTORY.zones ?? []).map((zone) => [ydr(zone.model), "capt"])),
  msl: catalogue((MSL_ZONES_INVENTORY.districts ?? []).map((district) => [ydr(district.model), "msl"])),
  climbs: catalogue(CLIMB_SLOT_IDS.map((id) => [ydr(id), "climb"])),
  schedule: catalogue([[ydr(SCHEDULE.model), "schedule"]]),
};

const KIND_LABELS = {
  green: "зелёные",
  forbidden: "запретные",
  bizwar: "бизвар",
  vzh: "ВЗХ",
  port: "порт",
  capt: "зоны каптов",
  msl: "МСЛ-зоны",
};

const MIN_HITS = { hangar: 3, zones: 3, capt: 3, msl: 3, climbs: 4 };
const SCHEDULE_PREFIX = "yoopiyo_";

// Порядок ключей находки зависит от её вида.
const SHAPES = {
  plain: ["place", "matched", "evidence"],
  kinds: ["place", "matched", "kinds", "evidence"],
  server: ["place", "server", "matched", "evidence"],
  look: ["place", "kinds", "matched", "evidence"],
};
const finding = (shape, fields) => Object.fromEntries(SHAPES[shape].map((key) => [key, fields[key]]));

const hitsIn = (names, place) => names.filter((name) => FILES[place].has(name));

// ---------- поиск по именам файлов ----------

const ZONE_GROUPS = [
  { files: "zones", caption: "модели зон мастерской" },
  { files: "capt", caption: "модели зон каптов мастерской" },
  { files: "msl", caption: "модели МСЛ-зон мастерской" },
];

// Каждый детектор отдаёт поля находки (без place) или null.
const DETECTORS = [
  {
    place: "hangar",
    shape: "plain",
    detect(names) {
      const hits = hitsIn(names, "hangar");
      if (hits.length < MIN_HITS.hangar) return null;
      const shown = hits.slice(0, 3).join(", ") + (hits.length > 3 ? "…" : "");
      return {
        matched: hits.length,
        evidence: `модели ангара мастерской: ${shown} (${hits.length} из ${FILES.hangar.size})`,
      };
    },
  },
  {
    place: "zones",
    shape: "kinds",
    detect(names) {
      const found = ZONE_GROUPS.map((group) => ({ ...group, hits: hitsIn(names, group.files) })).filter(
        (group) => group.hits.length >= MIN_HITS.zones,
      );
      if (found.length === 0) return null;
      const kinds = [...new Set(found.flatMap((group) => group.hits.map((name) => FILES[group.files].get(name))))].sort();
      const parts = found.map((group) => `${group.caption}: ${group.hits.length} из ${FILES[group.files].size}`);
      return {
        matched: found.reduce((sum, group) => sum + group.hits.length, 0),
        kinds,
        evidence: `${parts.join("; ")} (${kinds.map((kind) => KIND_LABELS[kind] ?? kind).join(", ")})`,
      };
    },
  },
  {
    place: "schedule",
    shape: "server",
    detect(names) {
      const [board] = FILES.schedule.keys();
      if (hitsIn(names, "schedule").length === 0) return null;
      return {
        server: "majestic",
        matched: names.filter((name) => name.startsWith(SCHEDULE_PREFIX)).length,
        evidence: `табло расписания Majestic: ${board}`,
      };
    },
  },
  {
    place: "climbs",
    shape: "plain",
    detect(names) {
      const marks = hitsIn(names, "climbs");
      if (marks.length < MIN_HITS.climbs || !names.some((name) => name.endsWith(".ymap"))) return null;
      return {
        matched: marks.length,
        evidence: `метки залазов мастерской: ${marks.map((mark) => mark.slice(0, -4)).join(", ")}`,
      };
    },
  },
  {
    // сосед вызывается всегда, даже когда другие места уже найдены
    place: "arenas",
    shape: "server",
    detect(names) {
      const answer = identifyPlace("arena", { names });
      if (answer.status !== "known") return null;
      return { server: answer.server, matched: answer.matched, evidence: answer.evidence };
    },
  },
];

const asName = (value) => (value ? String(value) : "").toLowerCase();

// При равном весе побеждает более ранний детектор.
export function workshopPlaceOf(names = []) {
  const lowered = names.map(asName);
  const found = DETECTORS.map(({ place, shape, detect }) => {
    const fields = detect(lowered);
    return fields && finding(shape, { place, ...fields });
  });
  return found.reduce((best, current) => (current && (!best || current.matched > best.matched) ? current : best), null);
}

// ---------- зоны автора по содержимому моделей ----------

const MIN_CONTOURS = 5;
const CONTOUR = { minSide: 5, lowCeiling: 2.5, ceilingShare: 0.15 };
const TINY_SHEET = 16;

// Плоский контур участка на земле: сторона от 5 м, высота мала относительно стороны.
function isFlatContour({ size }) {
  const [a, b, height] = Array.from(size);
  const side = Math.max(a, b);
  return side >= CONTOUR.minSide && height <= Math.max(CONTOUR.lowCeiling, side * CONTOUR.ceilingShare);
}

function surveyModels(models) {
  const read = models.filter((model) => model?.size);
  return { read, contours: read.filter(isFlatContour) };
}

const substantial = (count, total, minShare) => count >= MIN_CONTOURS && count / total >= minShare;

// Канал `at` не ниже floor и превосходит оба других не меньше чем на margin.
function dominates(colour, at, floor, margin) {
  const [r, g, b] = colour;
  const channels = [r, g, b];
  const lead = channels[at];
  return lead >= floor && channels.every((value, index) => index === at || lead >= value + margin);
}

export function greenZonesOf(models = [], { placed = false } = {}) {
  if (!placed) return null;
  const { read, contours } = surveyModels(models);
  if (!substantial(contours.length, read.length, 0.7)) return null;

  const painted = contours.filter((model) => model.colour);
  const greens = painted.filter((model) => dominates(model.colour, 1, 120, 40));
  if (painted.length === 0 || greens.length / painted.length < 0.6) return null;
  return finding("look", {
    place: "zones",
    kinds: ["green"],
    matched: contours.length,
    evidence:
      `зелёные зоны: ${contours.length} плоских контуров участков на земле из ${read.length} моделей, ` +
      `лист зелёный (${greens.length} из ${painted.length} с листом)`,
  });
}

// Облик контура: свой цвет (если лист крошечный) или общий лист словаря контейнера.
function lookOf(model, sharedSheet) {
  if (!model.colour) return sharedSheet || null;
  const tiny = Boolean(model.sheet) && Math.max(...model.sheet) <= TINY_SHEET;
  return tiny ? model.colour : null;
}

// Самый частый цвет облика; цвета, отличающиеся меньше шага 16, считаются одним.
function commonestColour(looks) {
  const tally = looks.reduce((counts, look) => {
    const trio = look.slice(0, 3);
    const bucket = trio.map((channel) => channel >> 4).join(",");
    const known = counts.get(bucket);
    return counts.set(bucket, known ? { ...known, count: known.count + 1 } : { trio, count: 1 });
  }, new Map());
  return [...tally.values()].reduce((best, next) => (next.count > best.count ? next : best)).trio;
}

const SHEET_KINDS = [
  ["forbidden", 0],
  ["green", 1],
];

export function zonesByLookOf(models = [], { placed = false, sheet = null } = {}) {
  const { read, contours } = surveyModels(models);
  if (!substantial(contours.length, read.length, 0.5)) return null;

  const looks = contours.map((model) => lookOf(model, sheet)).filter(Boolean);
  if (looks.length / contours.length < 0.6) return null;

  const trio = commonestColour(looks);
  const kind = SHEET_KINDS.find(([, at]) => dominates(trio, at, 150, 80))?.[0] ?? "zones";
  const tail = placed ? "карта мода ставит их по местам" : "своей карты нет — места ставит сервер";
  return finding("look", {
    place: "zones",
    kinds: [kind],
    matched: contours.length,
    evidence:
      `зоны: ${contours.length} плоских контуров участков из ${read.length} моделей, ` +
      `лист ровный ${trio.join(",")}, ${tail}`,
  });
}
