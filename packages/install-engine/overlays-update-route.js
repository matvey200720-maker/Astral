/*
 * Наложения тела (тату, бороды, макияж) через контейнер в `update.rpf` (GTA 5 RP, 20.11.2026, `docs/RP-OVERLAYS-CONTAINER.md`): куда писать картинку наложения,
 * чтобы её увидела игра, у которой не открыт пакет `astral_clothing` (клиент RAGE MP пакеты Astral не монтирует, запись в `update.rpf` видна).
 *
 * Сегодня картинка наложения лежит плоским именем у корня потокового архива пакета одежды: `astral_stream_00.rpf/<txd>.ytd` (покраска тату игры, тату сервера,
 * паки тату каталога, бороды игры). Штатные листы — словари с уникальными именами (`mp_fm_faov_beard_000.ytd`, `mp_bea_tat_f_000.ytd`) в `ped_mp_overlay_txds.rpf` и
 * `<пак>_ped_mp_overlay_txds.rpf` (опись `qa/append/idxp`), игра берёт их по имени из коллекции наложений (`*_overlays.xml`) — как словари оружия и дорог,
 * которые контейнер Astral перекрывает по имени (E8, E9). Поэтому путь записи — плоское имя в СВОЁМ контейнере: `x64/astral/astral_rp_overlays.rpf/<txd>.ytd`.
 * ГИПОТЕЗА: для наложений в сюжете не снималось; плоское имя одежды (X2) не перекрыло, но у одежды имя общее у всех педов и ищется по папке педа.
 *
 * Модуль чистый: ввода-вывода нет, окружение подаёт вызывающий.
 */

export const OVERLAYS_VIA_UPDATE_ENV = "ASTRAL_OVERLAYS_VIA_UPDATE";
export const OVERLAYS_UPDATE_TARGET = "update/update.rpf";
/** Свой контейнер наложений: отдельный от одежды, оружия и дорог — ставится и снимается порознь. */
export const OVERLAYS_CONTAINER = "x64/astral/astral_rp_overlays.rpf";
export const OVERLAYS_HOST_TARGET = "update/x64/dlcpacks/astral_clothing/dlc.rpf";

const HOST_ARCHIVE = /^astral_stream_(?:00|01)\.rpf\/([^/]+)$/;
const LEAF = /^[a-z0-9][a-z0-9_]{0,63}\.ytd$/;
/* Те же запреты, что у замка покраски тату (`tattoo-paint-manifest-trust.js`): не ствол, не одежда, не пед. */
const NOT_AN_OVERLAY = /^w_|^(?:p_)?[a-z]{3,6}_(?:diff|norm(?:al)?|spec)_\d{3}|^(?:p_)?[a-z]{3,6}_\d{3}(?:_|$)|^mp_[mf]_freemode_01/;

/** Включён ли режим: `1`, `true` или `container` (любой регистр). Без окружения — выключен. */
export function overlaysUpdateRouteEnabled(env = {}) {
  return ["1", "true", "container"].includes(String(env?.[OVERLAYS_VIA_UPDATE_ENV] ?? "").trim().toLowerCase());
}

/**
 * Запись пакета → запись контейнера. Ответ: `{ ready: true, entry, leaf }` или `{ ready: false, reason }`; причины: `not-host-entry`, `has-folder`
 * (запись с папкой — это одежда, не наложение), `bad-name`, `not-overlay`.
 */
export function overlayContainerRoute(entry) {
  const text = String(entry ?? "").toLowerCase();
  const match = HOST_ARCHIVE.exec(text);
  if (!match) return { ready: false, reason: text.startsWith("astral_stream_") ? "has-folder" : "not-host-entry" };
  const leaf = match[1];
  if (!LEAF.test(leaf)) return { ready: false, reason: "bad-name" };
  if (NOT_AN_OVERLAY.test(leaf)) return { ready: false, reason: "not-overlay" };
  return { ready: true, entry: `${OVERLAYS_CONTAINER}/${leaf}`, leaf };
}

const isHost = (file) => file?.target?.toLowerCase() === OVERLAYS_HOST_TARGET && String(file.entry || "").toLowerCase().startsWith("astral_stream_");

/** Имена записей хоста одежды в пакете. */
export const overlayHostEntries = (files = []) => files.filter(isHost).map((file) => String(file.entry));

/**
 * Перевод файлов пакета в контейнер наложений. Готовые (`import`, плоское имя картинки) уходят в `update.rpf`, остальные остаются с причиной.
 * Ответ: `{ files, moved, kept: [{ entry, reason }], all }`; `all` — все файлы хоста переведены.
 */
export function translateOverlayFiles({ files = [] } = {}) {
  let moved = 0;
  const kept = [];
  const taken = new Set();
  const next = files.map((file) => {
    if (!isHost(file)) return file;
    if (file.action !== "import") {
      kept.push({ entry: String(file.entry), reason: "not-import" });
      return file;
    }
    const route = overlayContainerRoute(file.entry);
    if (!route.ready) {
      kept.push({ entry: String(file.entry), reason: route.reason });
      return file;
    }
    if (taken.has(route.entry)) {
      kept.push({ entry: String(file.entry), reason: "duplicate" });
      return file;
    }
    taken.add(route.entry);
    moved += 1;
    return { ...file, target: OVERLAYS_UPDATE_TARGET, entry: route.entry, action: "import" };
  });
  return { files: next, moved, kept, all: moved > 0 && kept.length === 0 };
}
