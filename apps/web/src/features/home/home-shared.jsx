// Общее у героя, «Продолжить» и ленты Главной: вид кадра по виду мода, адрес обложки, факты (загрузки, вес).
import { DownloadSimple, HardDrives } from "../../components/ui/icons.jsx";
import { sizeEstimateNote } from "../catalog/size-estimate.js";
import {
  hasOwnCover,
  usesClothingMedia,
  usesMapMedia,
  usesSoundMedia,
  usesWeaponMedia,
} from "../../utils/catalogMedia.js";

export const FALLBACK_COVER = "/media/gta-city-night.jpg";
export const NO_MODS = [];
export const keep = (mod) => mod;
const OWN_LOCALES = ["ru", "uk", "de", "pl", "fr"];

export const cx = (...parts) => parts.filter(Boolean).join(" ");
export const coverOf = (mod) =>
  mod.resolvedCover || mod.cover || mod.image || FALLBACK_COVER;

// Вид кадра: первое подошедшее правило. Карта главнее одежды и звука, а те два считаются только со своей обложкой.
export function heroKindOf(mod) {
  if (!mod) return "photo";
  if (usesWeaponMedia(mod)) return "weapon";
  if (usesMapMedia(mod)) return "map";
  const own = hasOwnCover(mod);
  if (own && usesClothingMedia(mod)) return "clothing";
  return own && usesSoundMedia(mod) ? "sound" : "photo";
}

// Что делает кнопка «Установить» мода: свободно, ставится сейчас, уже стоит.
export const stateOf = (mod, installed, queue) =>
  installed.includes(mod.id)
    ? "installed"
    : queue.some(
          (item) =>
            item.id === mod.id && !item.failed && item.operation !== "remove",
        )
      ? "busy"
      : "free";

// Одна реакция на сломанную картинку у кадра, миниатюры и карточки.
export function swapBroken({ currentTarget: img }) {
  const { dataset } = img;
  if (dataset.fallbackApplied) return;
  dataset.fallbackApplied = "true";
  img.src = FALLBACK_COVER;
}

// Готовые форматы чисел: создание формата на каждую карточку стоило 22 мс худшего кадра на старте окна (30.10.2026).
const formats = new Map();
function countText(value, language) {
  // en и незнакомые языки — en-GB; у остальных пяти язык без региона даёт тот же формат
  const locale = OWN_LOCALES.includes(language) ? language : "en-GB";
  const notation = value >= 10_000 ? "compact" : "standard";
  const id = locale + notation;
  if (!formats.has(id))
    formats.set(
      id,
      new Intl.NumberFormat(locale, { notation, maximumFractionDigits: 1 }),
    );
  return formats.get(id).format(value);
}

// Загрузки и вес готовыми <span>; attrs(имя) даёт атрибуты места. Нуль в downloads числом считается; счётчик — только у конечного числа больше нуля.
export function factsOf(mod, language, attrs = () => null) {
  const loads = Number(mod.downloads ?? mod.downloadCount);
  const downloadsFact =
    Number.isFinite(loads) && loads > 0 ? (
      <span key="downloads" {...attrs("downloads")}>
        <DownloadSimple />
        {countText(loads, language)}
      </span>
    ) : null;
  const approximate =
    mod.formattedSize && mod.sizeApproximate
      ? { "data-approximate": "", title: sizeEstimateNote() }
      : null;
  const sizeFact = mod.formattedSize ? (
    <span key="size" {...attrs("size")} {...approximate}>
      <HardDrives />
      {mod.formattedSize}
    </span>
  ) : null;
  return [downloadsFact, sizeFact].filter(Boolean);
}
