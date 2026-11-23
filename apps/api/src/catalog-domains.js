// Привязка проверок доменных блоков карточки к именам доменов (побочное действие при подключении).
import { normalizeClothingCard } from "@modovik/clothing";
import { catalogV2Limits } from "@modovik/contracts/catalog-v2";
import { normalizeWeaponDomain } from "@modovik/gunpack";
import { normalizeOptimizationDomain } from "@modovik/optimizer/bundle-domain.js";
import {
  normalizeEffectsDomain,
  normalizeOptionDomain,
  normalizeVariantDomain,
} from "@modovik/publishing";
import { normalizeSoundDomain } from "@modovik/weapon-sound-pack";
import { registerDomain } from "./publishing-domains.js";

const isObject = (value) => typeof value === "object" && value !== null;
const isSha256 = (value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const whole = (min, max) => (value) => Number.isInteger(value) && value >= min && value <= max;
const oneOf = (...allowed) => (value) => allowed.includes(value);

// Проверка вида «в блоке есть вложенный объект part с нужными полями»: лишнее отбрасывается,
// порядок ключей берётся из схемы. Схема строится заново на каждый вызов, чтобы читать пределы свежими.
function nested(part, schema) {
  return (block) => {
    const source = block?.[part];
    if (!isObject(source)) return null;
    const copy = {};
    for (const [key, accepts] of schema()) {
      if (!accepts(source[key])) return null;
      copy[key] = source[key];
    }
    return { [part]: copy };
  };
}

const checkClip = nested("clip", () => [
  ["sha256", isSha256],
  ["bytes", whole(1, catalogV2Limits.clipBytes)],
  ["media_type", oneOf("video/webm", "video/mp4")],
]);

const isRefusalName = (value) => typeof value === "string" && /^[a-z][a-z-]{0,31}$/.test(value);

const OWN_CHECKS = {
  frontend: (block) => (isObject(block) && typeof block.moved === "boolean" ? { moved: block.moved } : null),
  workshop: (block) => (isRefusalName(block?.refused) ? { refused: block.refused } : null),
  timecycle: nested("cycle", () => [
    ["sha256", isSha256],
    ["frames", whole(2, 96)],
    ["columns", whole(1, 16)],
    ["startHour", whole(0, 23)],
    ["stepMinutes", whole(5, 180)],
  ]),
  sky: checkClip,
  fx: checkClip,
  minimap: nested("clip", () => [
    ["sha256", isSha256],
    ["bytes", whole(1, catalogV2Limits.videoBytes)],
    ["media_type", oneOf("video/webm")],
    ["width", whole(1, 16384)],
    ["height", whole(1, 16384)],
    ["duration_ms", whole(1, catalogV2Limits.videoMilliseconds)],
  ]),
};

const NEIGHBOR_CHECKS = {
  clothing: normalizeClothingCard,
  weapon: normalizeWeaponDomain,
  sound: normalizeSoundDomain,
  variant: normalizeVariantDomain,
  option: normalizeOptionDomain,
  optimization: normalizeOptimizationDomain,
  effects: normalizeEffectsDomain,
};

Object.entries({ ...NEIGHBOR_CHECKS, ...OWN_CHECKS }).forEach(([name, check]) => registerDomain(name, check));
