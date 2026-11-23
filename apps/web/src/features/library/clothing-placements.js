import { getLocalInstallProfile } from "../../api.js";
import { categoryOfComponent, shelfOfCategory as shelfOf } from "@modovik/clothing/taxonomy";
import { installedClothingItems } from "../workshop/install-queue/tasks/clothing-paint-slots.js";
import { useEffect, useMemo, useState } from "react";
import { engineModId } from "./engine-ids.js";
import { coverUrlOf, modPicture as pictureOf } from "./mod-picture.js";
import { itemName } from "@modovik/clothing/assortment";
import { cleanGameNames, pickGameName } from "@modovik/clothing/game-names";
import { currentUiLanguage, tr } from "../../locales/ui.js";

// Мод одежды ставится пакетом на вещь сервера со своим id движка (решение 14.10.2026), карточки берутся из записей установки.
const REPLACE_ID = new RegExp("^local-clothing-replace-[\\da-f]{12}$");
// clothing-<пол>-[<коллекция>-]<вид>-<три цифры>[-majestic]; слот с цветом и любой другой — не слот.
const SLOT = /^clothing-(?<gender>male|female)-(?:(?<collection>[\da-z_]+)-)?(?<component>(?:p_)?[a-z]{3,6})-(?<number>\d{3})(?:-majestic)?$/;
const CHARACTER_FOLDER = { male: "mp_m_freemode_01", female: "mp_f_freemode_01" };
const words = (list) => list.split(" ");
const LANGS = words("ru uk en de pl fr");

// Не строка читается как пустая; строка обрезается по краям.
const text = (v) => String(typeof v === "string" ? v : "").trim();
const NONE = Object.freeze([]);
// Объект «ключ -> значение» в порядке списка ключей.
const byKeys = (keys, valueOf) => keys.reduce((all, key) => ({ ...all, [key]: valueOf(key) }), {});
function isReplaceId(id) {
  return REPLACE_ID.test(id);
}

export function shotItemOfSlot(slot) {
  const found = SLOT.exec(text(slot))?.groups;
  if (!found) return null;
  const { gender, component, number, collection = "" } = found;
  const prop = component.startsWith("p_") ? "_p" : "";
  const ownFolder = ["mp_m_freemode_01", "mp_f_freemode_01"].some((own) => collection.startsWith(own));
  const folder = ownFolder ? collection : [CHARACTER_FOLDER[gender] + prop, collection].filter(Boolean).join("_");
  return { gender, component, folder, drawable: +number };
}

// Пара «вещь игры → заменёнка» для работы покраски мастерской (01.11.2026); у тату пары нет.
export function paintPairOf(item, mods = []) {
  const [first] = item?.targets || [];
  if (!(first && item.slot !== "tattoos")) return null;
  const read = (key) => text(first[key]);
  const folder = read("folder").toLowerCase();
  const gender = ["female", "male"].find((sex) => folder.startsWith(`mp_${sex[0]}_`)) ?? "";
  const [component, picture, server] = words("component picture server").map(read);
  const { drawable } = first;
  const { kind, modId } = item.source ?? {};
  const sourceId = kind === "catalog" ? text(modId) : "";
  const mod = sourceId && mods.find((m) => [m?.id, m?.slug, m?.manifest?.id].includes(sourceId));
  const where = { gender, component, folder, drawable };
  const located = Boolean(gender && component);
  const game = located && Number.isInteger(drawable) ? where : null;
  const lookup = located && server && !picture ? { server, ...where } : null;
  const modImage = text(item.cover) || pictureOf(mod || null);
  return { item: read("name"), itemImage: picture, game, modImage, more: Math.max(item.targets.length - 1, 0), lookup };
}

export const paintModIds = (storage = globalThis.localStorage) =>
  new Set(installedClothingItems(storage).flatMap(({ modIds }) => modIds));

function placementOf(record, modId) {
  const { origin, slots, installedAt } = record;
  const slot = String((slots || []).find((s) => String(s).startsWith("clothing-")) ?? "");
  const game = shotItemOfSlot(slot);
  const server = text(origin?.server) || (slot.endsWith("-majestic") ? "majestic" : "");
  const fromOrigin = byKeys(words("catalogModId title item itemPicture cover"), (key) => text(origin?.[key]));
  const itemNames = cleanGameNames(origin?.itemNames);
  return { id: `clothing-placed:${modId}`, modId, ...fromOrigin, ...(itemNames ? { itemNames } : {}), server, slot, component: game?.component ?? "", game, installedAt: text(installedAt) };
}

/*
 * Вещь под заменёнкой на языке окна (17.11.2026). Запись установки хранит русское имя (`item`) и, у вещи игры, названия на языках игры (`itemNames`): окно берёт строку по цепочке языка
 * (`@modovik/clothing/game-names`; у украинского игры нет — английская). У вещи игры без названий (поставлена до этой правки или у игры строки нет) нерусское окно называет её по типу и номеру
 * на своём языке, а не русской строкой; русское окно и вещи серверов — имя, как запомнено.
 */
export function placedItemName(placement) {
  const language = currentUiLanguage();
  const game = pickGameName(placement?.itemNames, language);
  if (game) return game;
  const item = text(placement?.item);
  const place = placement?.game;
  if (language !== "ru" && item && !placement?.server && !placement?.itemNames && place?.component && Number.isInteger(place.drawable))
    return itemName({ component: place.component, drawable: place.drawable }, tr, language);
  return item;
}

// Перчатка — одна вещь (29.10.2026): пакеты набора сводятся в первую по времени запись с общим списком modIds.
const foldGloves = (entries) => {
  const heads = {};
  return entries.filter((entry) => {
    const { component, catalogModId, item, server, modId } = entry;
    if (component !== "uppr" || !catalogModId || !item) return true;
    const key = JSON.stringify([catalogModId, item, server]);
    const first = heads[key];
    if (first) first.modIds.push(modId);
    else {
      entry.modIds = [modId];
      heads[key] = entry;
    }
    return !first;
  });
};

export function clothingPlacements(records = [], settings = {}) {
  const { paintIds = new Set(), targetId = "" } = settings;
  const wanted = [...(records || [])]
    .map((record) => [record, text(record?.modId)])
    .filter(([, modId]) => isReplaceId(modId) && !paintIds.has(modId))
    .filter(([record]) => !([targetId, record.targetId].every(Boolean) && targetId !== record.targetId));
  const placed = wanted.map(([record, modId]) => placementOf(record, modId));
  return foldGloves(placed.sort(({ installedAt: a }, { installedAt: b }) => a.localeCompare(b)));
}

const captionOf = (item) => {
  const inGame = tr("в игре");
  return item ? `${tr("вместо «{item}»").replace("{item}", item)} | ${inGame}` : inGame;
};

export function clothingLibraryCards(options = {}) {
  const { categories = [], faces = {}, modsById = new Map(), placements = [], installedMods = [] } = options;
  const tiles = new Map();
  for (const tile of categories) tiles.set(tile.id, tile);

  const own = [...installedMods].filter((mod) => mod?.catalogSection === "clothing" && !isReplaceId(engineModId(mod.id)));
  const sources = own.map((mod) => ({ packs: [mod.id], name: text(mod.name) || mod.id, mod, id: `clothing-mod:${mod.id}`, caption: "", installedAt: "" }));
  for (const from of placements) {
    const mod = modsById.get(from.catalogModId) || null;
    const name = text(mod?.name) || from.title || tr("Одежда");
    sources.push({ ...from, mod, name, caption: captionOf(placedItemName(from)), faceId: from.catalogModId, packs: from.modIds || [from.modId], from });
  }
  // Карточка и её единицы для корзины: общая для модов «своим пакетом» и замен.
  const buildCard = ({ mod, name, id, from, packs, cover, caption, installedAt, component, faceId }) => {
    const slot = text(mod?.catalogSlot);
    const tile = tiles.get(shelfOf(slot || categoryOfComponent(component)?.id || ""));
    const picture = pictureOf(mod) || text(faces?.[faceId]?.cover) || coverUrlOf(cover);
    const card = { id };
    card.category = tile?.id ?? (slot || categories[0]?.id || "");
    card.placed = true;
    card.mod = mod;
    card.title = byKeys(LANGS, () => name);
    card.description = caption ? byKeys(LANGS, () => caption) : tile?.title ?? byKeys(LANGS, () => "");
    card.image = picture || tile?.image || "";
    card.fallbackImage = tile?.fallbackImage;
    if (from) {
      card.pair = { itemImage: from.itemPicture, item: placedItemName(from), game: from.game, modImage: coverUrlOf(cover) || picture || "" };
    }
    const units = [...packs].map((modId) => ({
      kind: "mod",
      key: `mod:${modId}`,
      modId,
      name,
      slots: [id],
      installedAt: installedAt || "",
      origin: { type: "clothing-placed" },
    }));
    return { card, units };
  };
  const built = sources.map(buildCard);
  return { cards: built.map((b) => b.card), units: built.flatMap((b) => b.units) };
}

// Профиль читается заново только при смене состава id; targetId и хранилище покраски эффект не запускают.
const readRecords = () =>
  Promise.resolve()
    .then(getLocalInstallProfile)
    .then((profile) => (Array.isArray(profile?.installed) ? profile.installed : NONE), () => NONE);

export function useClothingPlacements(installed = [], targetId = "") {
  const key = installed.join(",");
  const [records, setRecords] = useState(() => NONE);
  const placed = useMemo(() => clothingPlacements(records, { targetId, paintIds: paintModIds() }), [records, targetId]);

  useEffect(() => {
    let stale = false;
    if (installed.some(isReplaceId)) {
      readRecords().then((next) => {
        if (!stale) setRecords(next);
      });
    } else {
      setRecords(NONE);
    }
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return placed;
}

const SHORT = words("id item itemNames itemPicture game cover server installedAt");

export function placementsOfMod(placements = [], modIds = []) {
  const wanted = new Set(modIds);
  const mine = placements.filter(({ catalogModId }) => catalogModId && wanted.has(catalogModId));
  return mine.map((placement) => byKeys(SHORT, (key) => placement[key]));
}
