import { createHash } from "node:crypto";
import { isWeaponLeaf, routeWeaponEntries } from "@modovik/install-engine/weapon-update-route.js";

/*
 * Победители имён оружия для режима «оружие через update.rpf» (19.11.2026, `docs/RP-WEAPONS-UPDATE.md`): по переписи игры
 * (`texture-census.js: censusMapTextures({ weapons: true })`, ранги базы, корня `update.rpf`, пакетов и `dlc_patch`) говорит, в какой вложенный архив
 * `update.rpf` писать каждый файл ствола (`weapon-update-route.js`).
 *
 * Перепись и отпечаток игры подаёт вызывающий (`census`, `identityOf`): модуль сам игру не читает. Перепись берёт 1–2 с, поэтому готовая держится в памяти,
 * пока отпечаток (`update.rpf`, `dlclist.xml`, размеры пакетов — как его соберёт вызывающий) тот же; параллельные вызовы ждут одну перепись.
 *
 * Известный пробел: перепись видит оружие только в `…/models/cdimages/weapons.rpf` (`texture-census.js: WEAPON_RESOURCE`), а тяжёлый пистолет живёт
 * ещё и в `…/dlc_weapons_patch.rpf` пака `mpbusiness2`. Пока перепись этого не знает, такие имена остаются без победителя и идут за семьёй или отказом.
 */

/**
 * Строка переписи — файл оружия, а не плитка карты: по имени (`w_*`, `p_w_*`). Победитель в чужом архиве (карта) остаётся в ответе, и маршрут
 * отказывает ему (`nested-not-allowed`), а не молча отдаёт имя семье.
 */
const isWeaponItem = (item) => isWeaponLeaf(item?.name);

/** Отпечаток маршрута запрошенных имён: меняется, когда у какого-нибудь имени сменился победитель или его ранг (после обновления игры). */
function digestOf(names, winners) {
  const hash = createHash("sha256");
  for (const name of [...new Set(names)].sort()) {
    const winner = winners.get(name);
    hash.update(`${name}\t${winner?.at ?? ""}\t${winner?.rank ?? ""}\n`);
  }
  return hash.digest("hex");
}

function summaryOf(routes) {
  const count = (kind) => routes.filter((route) => route.kind === kind).length;
  return {
    total: routes.length,
    ready: routes.filter((route) => route.ready).length,
    pack: count("pack"),
    root: count("root"),
    rootNested: count("root-nested"),
    refused: count("refused"),
  };
}

/**
 * `census({ gameRoot, keys, weapons: true })` → `{ items: [{ name, at, rank }] }`; `identityOf(gameRoot)` → строка отпечатка игры.
 * `routesFor({ gameRoot, keys, names })` → `{ routes, summary, digest, empty }`; `invalidate(gameRoot)` — забыть перепись.
 */
export function createWeaponRouteCensus({ census, identityOf } = {}) {
  if (typeof census !== "function" || typeof identityOf !== "function") {
    throw new TypeError("Перепись оружия: нужны функции census и identityOf.");
  }
  const cache = new Map();

  async function winnersOf({ gameRoot, keys }) {
    const identity = String(await identityOf(gameRoot));
    const stored = cache.get(gameRoot);
    if (stored?.identity === identity) return stored.work;
    const work = (async () => {
      /* `hostedWeapons`: зарегистрированный `astral_weapons` перепись не опустошает (иначе у человека с готовым хостом маршрут молчал). */
      const result = await census({ gameRoot, keys, weapons: true, hostedWeapons: true });
      const winners = new Map();
      for (const item of result?.items || []) {
        if (isWeaponItem(item)) winners.set(String(item.name).toLowerCase(), { at: item.at, rank: item.rank });
      }
      return winners;
    })();
    const entry = { identity, work };
    cache.set(gameRoot, entry);
    /* Сбой не кэшируется: следующий вызов пробует снова. */
    work.catch(() => {
      if (cache.get(gameRoot) === entry) cache.delete(gameRoot);
    });
    return work;
  }

  return {
    async routesFor({ gameRoot, keys, names } = {}) {
      if (!gameRoot) throw new TypeError("Перепись оружия: не названа папка игры (gameRoot).");
      if (!Array.isArray(names) || names.length === 0) throw new TypeError("Перепись оружия: нет имён для маршрута.");
      const winners = await winnersOf({ gameRoot, keys });
      const routes = routeWeaponEntries({ names, winners });
      return { routes, summary: summaryOf(routes), digest: digestOf(names, winners), empty: winners.size === 0 };
    },
    invalidate(gameRoot) {
      if (gameRoot === undefined) cache.clear();
      else cache.delete(gameRoot);
    },
  };
}
