// Доменный блок `sound` заявки: пропускаем только то, что сервер каталога готов хранить.
import { LAYER_ARCHIVES } from "./groups.js";

const MAX = { weapons: 64, banks: 32, streams: 64 };

const WEAPON_NAME = /^WEAPON_[A-Z0-9_]{1,40}$/;
const BANK_NAME = /^[a-z0-9][a-z0-9_]{0,59}$/;
const STREAM_NAME = /^0X[0-9A-F]{8}$/;

// Флаги блока: любое истинное значение превращается в true.
const FLAGS = ["pack", "partial"];
// Поля предпросмотра и их верхние границы.
const PREVIEW_CAPS = [["sampleRate", 192000], ["seconds", 10]];

// Предел длины действует до проверки элементов; читается только настоящий массив.
const head = (list, limit) => (Array.isArray(list) ? list.slice(0, limit) : []);
const textsMatching = (list, limit, pattern) => head(list, limit)
  .map((item) => String(item))
  .filter((text) => pattern.test(text));

const textOf = (item, field) => String(item?.[field] ?? "");

function acceptBank(item) {
  const [archive, bank] = ["archive", "bank"].map((field) => textOf(item, field));
  const known = LAYER_ARCHIVES.includes(archive) && BANK_NAME.test(bank);
  const streams = known ? textsMatching(item.streams, MAX.streams, STREAM_NAME) : [];
  return known && streams.length > 0 ? { archive, bank, streams } : null;
}

function boundedNumber(raw, cap) {
  const number = Number(raw);
  return Math.min(Math.max(Number.isNaN(number) ? 0 : number, 0), cap);
}

const isObject = (value) => typeof value === "object" && value !== null;

export function normalizeSoundDomain(value) {
  if (!isObject(value)) return null;

  const weapons = textsMatching(value.weapons, MAX.weapons, WEAPON_NAME);
  const banks = head(value.banks, MAX.banks).map(acceptBank).filter(Boolean);
  if (weapons.length === 0 && banks.length === 0) return null;

  const flags = FLAGS.filter((flag) => value[flag]).map((flag) => [flag, true]);
  const block = { weapons, banks, ...Object.fromEntries(flags) };
  if (!isObject(value.preview)) return block;
  const preview = PREVIEW_CAPS.map(([key, cap]) => [key, boundedNumber(value.preview[key], cap)]);
  return { ...block, preview: Object.fromEntries(preview) };
}
