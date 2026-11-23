/*
 * Что окно знает о человеке — для страницы «Профиль»: моды, что стоят в игре,
 * сборки, избранное, ветки Astral. Всё — чистые функции на данных оболочки,
 * сервера они не касаются.
 *
 * Чего окну не присылают (и чего здесь нет): значки с сервера, контакты,
 * выбранная обложка, дата регистрации. Их читает код ниже только из самого
 * аккаунта и только если облако однажды положит поле в сессию (`contacts`);
 * пока полей нет — страница показывает пустое состояние, ничего не выдумывая.
 */
import { formatSize, modSizeBytes } from "../../catalog-utils.js";
import { modPicture } from "../library/mod-picture.js";
import { isWorkshopEngineId, workKindTitle } from "../library/my-mods.js";
import { CONTACT_KINDS } from "./profile-icons.jsx";

/* Разделы вкладки «В игре»: ключ раздела каталога (`catalogSection`) → группа. */
export const GAME_GROUPS = Object.freeze([
  "gunpacks",
  "redux",
  "clothing",
  "other",
]);

export function gameGroupOf(mod) {
  const section = String(mod?.catalogSection || "");
  return GAME_GROUPS.includes(section) && section !== "other"
    ? section
    : "other";
}

/**
 * Моды каталога и работы мастерской, что стоят в игре, — плитками «В игре».
 * Плитка: `{ key, group, name, kind, size, picture, mod? }`.
 * `kind` у мода — ключ раздела (`gunpacks`, `redux`, `clothing`, `other`), у работы — `work`.
 */
export function installedTiles({
  installed = [],
  modsById,
  mods = [],
  workItems = [],
}) {
  const tiles = [];
  const seen = new Set();
  for (const id of installed) {
    if (seen.has(id) || isWorkshopEngineId(id, modsById)) continue;
    seen.add(id);
    const mod = modsById.get(id);
    if (!mod || mod.pending || mod.missing) continue;
    const group = gameGroupOf(mod);
    tiles.push({
      key: `mod:${id}`,
      group,
      name: String(mod.name || mod.title || "").trim(),
      kind: group,
      bytes: modSizeBytes(mod, mods) || 0,
      picture: modPicture(mod),
      mod,
    });
  }
  for (const item of workItems) {
    tiles.push({
      key: item.key,
      group: "other",
      name: item.name,
      kind: "work",
      workKind: item.workKind,
      bytes: 0,
      picture: "",
      workTitle: workKindTitle(item.workKind),
    });
  }
  return tiles;
}

export function tileCounts(tiles) {
  const counts = {
    total: tiles.length,
    gunpacks: 0,
    redux: 0,
    clothing: 0,
    other: 0,
  };
  for (const tile of tiles) counts[tile.group] += 1;
  return counts;
}

export const totalBytes = (tiles) =>
  tiles.reduce((sum, tile) => sum + tile.bytes, 0);

export const sizeText = (bytes, language) =>
  bytes > 0 ? formatSize(bytes, language) : "";

/* Порядок, в котором моды годятся в обложку шапки: ганпак и редукс раньше одежды; у звуков нет настоящей картинки. */
const COVER_ORDER = ["gunpacks", "redux", "other", "clothing"];

/** Моды, чьи картинки годятся в обложку, от лучших к худшим. */
export function coverCandidates(tiles) {
  return COVER_ORDER.flatMap((group) =>
    tiles.filter(
      (tile) =>
        tile.group === group &&
        tile.mod &&
        tile.picture &&
        tile.mod.catalogCategory !== "sounds",
    ),
  );
}

/** Обложка шапки — картинка первого подходящего мода; нечего показать — шапка без картинки. */
export const coverTile = (tiles) => coverCandidates(tiles)[0] || null;

/* ---------- ветки Astral: «Доступ» ---------- */

const BRANCH_ORDER = ["alpha", "beta", "release"];

/**
 * Строки карточки «Доступ» по снимку веток (`features/updates/channels-store.js`):
 * `{ channel, state, version }`. `state`: `open` — ветка открыта человеку, `closed` — нет
 * (доступа не было или его сняли), `soon` — релиза ещё нет. Нет снимка (окно не в бете) — пусто.
 * Бета (слова ведущей 18.11.2026: владелец бету убирает, остаются alpha и release): закрытая бета в карточке не показывается
 * вовсе, строка «Бета» есть только у того, у кого она открыта.
 */
export function accessRows(channels) {
  if (!channels?.enabled) return [];
  return BRANCH_ORDER.map((channel) => {
    const branch = channels.branches.find((item) => item.channel === channel);
    const open =
      Boolean(branch) &&
      branch.access !== "denied" &&
      (branch.access === "ok" || Boolean(branch.current || branch.installed));
    if (!open)
      return {
        channel,
        state: channel === "release" ? "soon" : "closed",
        version: "",
      };
    return {
      channel,
      state: "open",
      version: branch.installed?.version || branch.available?.version || "",
    };
  }).filter((row) => row.channel !== "beta" || row.state === "open");
}

/* Ранг в шапке: администратор, затем самая ранняя открытая ветка, иначе игрок. */
export function rankOf(account, rows) {
  if (account?.role === "admin") return "admin";
  const open = (channel) =>
    rows.some((row) => row.channel === channel && row.state === "open");
  if (open("alpha")) return "alpha";
  if (open("beta")) return "beta";
  return "player";
}

/* ---------- аккаунт ---------- */

/* Вход через Discord создаёт учётку без почты, а его аватар приходит с `cdn.discordapp.com`: любое из двух — Discord уже привязан. */
export const hasDiscord = (account) =>
  Boolean(account) && (Boolean(account.avatarUrl) || !account.email);

/* Контакты: облако пока не присылает; читаем поле аккаунта, если оно когда-нибудь появится, и режем по форме. */
export function accountContacts(account) {
  const list = Array.isArray(account?.contacts) ? account.contacts : [];
  return list
    .filter(
      (item) =>
        item &&
        CONTACT_KINDS.includes(item.kind) &&
        typeof item.text === "string" &&
        item.text.trim(),
    )
    .slice(0, 6)
    .map((item) => ({
      kind: item.kind,
      text: item.text.trim().slice(0, 60),
      url: typeof item.url === "string" ? item.url : "",
    }));
}
