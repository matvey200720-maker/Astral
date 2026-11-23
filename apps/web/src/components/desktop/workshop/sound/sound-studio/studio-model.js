import { useMemo } from "react";
import {
  RADIO_STATION_MAP,
  SOUND_SECTIONS,
  SOUND_SECTION_MAP,
  isWeaponBank,
  weaponLayers,
} from "@modovik/sound-studio";
import { normalizeAssignment, soundBankKey } from "../sound-model.js";
import { layerTarget, targetBankKey } from "../sound-targets.js";
import { tr } from "../../../../../locales/ui.js";

export const ADVANCED_STORE_KEY = "astral.sound-studio.advanced";
export const SAVE_DELAY_MS = 250;
export const LOOP_WAIT_MS = 5000;

const SIMPLE_PATH = new Set(["weapons", "loading-music", "radio"]);

export const hasSimplePath = (sectionId) => SIMPLE_PATH.has(sectionId);

// В пакете таблица разделов бывает и Map, и объектом: читаем оба вида.
export function tableGet(table, key) {
  if (!table) return undefined;
  return typeof table.get === "function" ? table.get(key) : table[key];
}

export const knownSection = (id) => Boolean(id) && Boolean(tableGet(SOUND_SECTION_MAP, id));
export const sectionOf = (id) => tableGet(SOUND_SECTION_MAP, id) || SOUND_SECTIONS[0];

export const bankKeyOf = (bank) => `${bank.archive}:${bank.bank}`;
export const stateKeyOf = (bank) => soundBankKey(bank.archive, bank.bank);
export const feedbackKeyOf = (target) => `${targetBankKey(target)}|${target.key}`;

export const hasFile = (assignment) => Boolean(assignment && assignment.assetHash);

export const hashesOf = (target) =>
  target.streams.map((one) => (one && typeof one === "object" ? one.hash : one));

export const firstStreamOf = (target) => (target ? target.streams[0] : undefined);

/* ---------- разделы и подписи ---------- */

export function tabOptionsFor(list) {
  return list.map((one) => ({
    value: one.id,
    label: tr(one.short || one.title),
    title: tr(one.title),
  }));
}

export const simpleSections = () => SOUND_SECTIONS.filter((one) => hasSimplePath(one.id));

export function shelfTitle(section, station) {
  if (section.id === "radio" && station) {
    const found = tableGet(RADIO_STATION_MAP, station);
    return found ? found.title : tr("Станция");
  }
  return tr(section.rail || section.title);
}

export function chooseHint(section, station) {
  if (section.id !== "radio") {
    return tr("Выберите в «Звуках игры», что заменить: музыку экрана загрузки или меню паузы.");
  }
  return station
    ? tr("Выберите песню в «Звуках игры»: её место займёт ваш трек той же длины.")
    : tr("Выберите станцию в «Звуках игры», потом песню — её место займёт ваш трек той же длины.");
}

export function pickLabelFor(target, assignment, layered) {
  if (!target) return "";
  if (assignment) return tr("Другой файл");
  if (target.kind !== "stream") return tr("Выбрать файл");
  return layered ? tr("Заменить только эту дорожку") : tr("Заменить своим файлом");
}

export function emptyEditHint(unavailable) {
  return unavailable
    ? tr("Свой звук ставится на звуки вашей игры — их читает приложение Astral.")
    : tr(
        "Выберите в кадре слой, дорожку или банк — здесь появится их правка: " +
          "файл, громкость, обрезка и сравнение с оригиналом.",
      );
}

/* ---------- банки полки ---------- */

export function openBankOf(shelf, wantedKey, bankSection) {
  const keyed = shelf.find((one) => bankKeyOf(one) === wantedKey);
  if (keyed || bankSection) return keyed || null;
  const open = (one) => !one.readOnly;
  return (
    shelf.find((one) => open(one) && isWeaponBank(one.archive)) ||
    shelf.find(open) ||
    shelf[0] ||
    null
  );
}

export function weaponTargets(bank) {
  return weaponLayers(bank.streams).map((layer) => layerTarget(bank, layer));
}

/* ---------- назначения ---------- */

export function indexAssignments(list) {
  const index = new Map();
  list.forEach((one) => {
    if (one && one.archive && one.bank) {
      index.set(`${soundBankKey(one.archive, one.bank)}:${one.stream}`, one);
    }
  });
  return index;
}

export function assignmentsOfBank(list, bank) {
  const wanted = stateKeyOf(bank);
  const found = new Map();
  list.forEach((one) => {
    if (one && one.archive && one.bank && soundBankKey(one.archive, one.bank) === wanted) {
      found.set(one.stream, one);
    }
  });
  return found;
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// create: заводить ли назначения там, где их ещё нет (ввоз файла) или править только имеющиеся.
export function rewriteForTarget(list, target, patch, create) {
  const bank = target.bank;
  const wanted = stateKeyOf(bank);
  const result = list.slice();
  let touched = false;
  hashesOf(target).forEach((hash) => {
    const at = result.findIndex(
      (one) =>
        one && one.stream === hash && one.archive && one.bank &&
        soundBankKey(one.archive, one.bank) === wanted,
    );
    if (at < 0 && !create) return;
    if (at >= 0 && !create && !hasFile(result[at])) return;
    const base = at >= 0 ? result[at] : { stream: hash, archive: bank.archive, bank: bank.bank };
    const next = normalizeAssignment({ ...base, ...patch });
    if (at < 0) {
      result.push(next);
      touched = true;
    } else if (!sameJson(next, base)) {
      result[at] = next;
      touched = true;
    }
  });
  return touched ? result : list;
}

export function withoutTargets(list, targets) {
  const doomed = new Set();
  targets.forEach((target) => {
    const prefix = stateKeyOf(target.bank);
    hashesOf(target).forEach((hash) => doomed.add(`${prefix}:${hash}`));
  });
  const kept = list.filter(
    (one) =>
      !(one && one.archive && one.bank &&
        doomed.has(`${soundBankKey(one.archive, one.bank)}:${one.stream}`)),
  );
  return kept.length === list.length ? list : kept;
}

export function patchGlue(target, patch) {
  return `patch:${feedbackKeyOf(target)}|${Object.keys(patch).sort().join(",")}`;
}

/* ---------- мелкие помощники ---------- */

export const without = (record, key) => {
  if (!(key in record)) return record;
  const rest = { ...record };
  delete rest[key];
  return rest;
};

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Подписи собираются заново только при смене языка окна.
export function useByLanguage(lang, build) {
  // lang не читается в build: язык выбирает перевод через tr
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(build, [lang]);
}
