/*
 * Покраска мастерской в игру — скин ствола и покраска вещи одежды.
 *
 * Окно отдаёт покраску развёртками PNG, главный процесс запекает их в
 * текстуры из игры игрока и ставит строгим локальным пакетом в Astral
 * Weapons DLC или Astral Clothing DLC (`apps/desktop/src/weapon-skin.js`,
 * `clothing-skin.js`). Отката по точке восстановления здесь нет — покраска
 * снимается как пакет, по `modId`. Поэтому у неё своя память об установке:
 * по предмету, потому что на каждом стволе и каждой вещи стоит своя, и
 * снятие с револьвера не должно трогать карабин.
 */

import { locateLegacyTarget } from "../game-root.js";
import { sameInstalledWork, workModIds, workWithoutMods } from "./clothing-paint-slots.js";

/* Пакеты записи: у копящей памяти — по работам, у прочей — modIds. */
const modIdsOf = (record) =>
  record
    ? record.works?.length
      ? record.works.flatMap(workModIds)
      : record.modIds?.length
        ? record.modIds
        : [record.modId]
    : [];

/* Работы записи; запись о работе без своих полей (до 07.10) — сама запись. */
const worksOf = (record) => (record ? (record.works?.length ? record.works : [{ ...record, works: undefined }]) : []);

/**
 * @param {{
 *   storageKey: string,
 *   idPattern: RegExp,
 *   apply: (input: object) => Promise<object>,
 *   remove: (input: object) => Promise<object>,
 *   accumulate?: boolean,
 *   after?: (report?: Function) => Promise<unknown>,
 * }} kind
 *
 * `accumulate` — у предмета копятся работы (тату на теле, задача 3 ТЗ
 * 06.10.2026, вечер): другая работа сменяет только то, что движок сменил сам
 * (те же тату), остальные остаются в игре и в записи (`works`). Эта же работа
 * (`memo.workId`, разбор 01.11.2026) сменяет свои прежние пакеты целиком:
 * цель сменили с X на Y, тату сняли с тела или вернули к исходному — на X в
 * игре правки больше нет. Без него новая покраска предмета сменяет прежнюю
 * целиком.
 *
 * `after` — что сделать, когда покраска встала или снялась: у оружия — пересобрать
 * ступень текстур без штатного оружия (`refreshTexturesAfterWeaponWork`).
 */
export function createSkinInstalls({ storageKey, idPattern, apply, remove, accumulate = false, after = null }) {
  const listeners = new Set();

  function readAll() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(storageKey) || "null");
      return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    } catch {
      return {};
    }
  }

  function writeAll(records) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(records));
    } catch {
      /* приватный режим: покраска в игре, теряется только кнопка «Снять» */
    }
    for (const listener of listeners) listener();
  }

  /** Что стоит в игре на этом предмете, или `null`. */
  function installOf(key) {
    const record = readAll()[key];
    return record && idPattern.test(record.modId || "") ? record : null;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /**
   * `key` — предмет (модель ствола, вещь «masks-12»), `request` — то, что
   * нужно главному процессу кроме папки игры, `state` — снимок проекта:
   * по нему «Мои работы» узнают, какая из сохранённых работ сейчас в игре.
   */
  async function install({ key, request, memo = null, state, report }) {
    const previous = installOf(key);
    const game = await locateLegacyTarget();
    report?.({ step: "prepare" });
    /* Своя прежняя установка этого предмета сменяется без вопросов; чужую
       заменёнку на вещи сервера — только если человек сам выбрал «Заменить
       её» (`request.replace`, задача 4 ТЗ 05.10.2026). */
    const own = accumulate ? [] : modIdsOf(previous).filter(Boolean);
    const replace = [...new Set([...(request.replace || []), ...own])];
    const installed = await apply({
      ...request,
      ...(replace.length ? { replace } : {}),
      gameRoot: game.path,
      targetId: game.id,
    });
    /* Развёртки в память не кладутся: это мегабайты PNG, и они уже в игре.
       `memo` — что помнить вместо запроса (манифест пакета каталога не
       нужен, чтобы снять покраску). */
    const { textures: _textures, ...kept } = memo || request;
    const replaced = new Set(
      (installed.results || [installed]).flatMap((item) => item.replaced || []),
    );
    const installedAt = new Date().toISOString();
    let record = {
      ...kept,
      modId: installed.modId,
      /* Покраска одежды ложится и на несколько вещей сервера (броня всех
         фракций) — у каждой свой пакет, снимаются все. */
      modIds: (installed.results || [installed])
        .map((item) => item.modId)
        .filter(Boolean),
      gameRoot: game.path,
      targetId: game.id,
      installedAt,
      archive: installed.archive || "",
      baked: installed.baked || [],
      skipped: installed.skipped || [],
      installedState: state,
    };
    if (accumulate) {
      /* Что на каком тату: Desktop отвечает по пакету на тату; прежний Desktop (обновление одного окна) — одним пакетом, тогда цели — из запроса. */
      const landed = (installed.results || []).filter((item) => item.modId && item.target);
      const { works: _works, ...own } = record;
      const work = landed.length
        ? {
            ...own,
            targets: landed.map((item) => item.target),
            packages: landed.map((item) => ({ modId: item.modId, key: item.target.key, title: item.target.title })),
          }
        : own;
      const gone = new Set([...replaced, ...work.modIds]);
      const identity = { workId: work.workId, name: work.name };
      const earlier = worksOf(previous).filter((item) => workModIds(item).length);
      const same = work.workId ? earlier.filter((item) => sameInstalledWork(item, identity)) : [];
      /* Чужие работы теряют только то, что движок сменил. О том, что снято, итог говорит словами (`displaced`). */
      const others = earlier.filter((item) => !same.includes(item));
      const displaced = displacedTitles(others, replaced);
      const kept = others.map((item) => workWithoutMods(item, gone)).filter(Boolean);
      const save = (leftover) => {
        const works = [...kept, ...leftover, work];
        record = { ...record, ...work, modIds: works.flatMap(workModIds), works };
        writeAll({ ...readAll(), [key]: record });
      };
      /* Сначала память: пока прежний пакет не снят, он остаётся строкой работы — сорвётся снятие, и «Снять» до него дотянется. */
      const pending = same.map((item) => workWithoutMods(item, gone)).filter(Boolean);
      save(pending);
      const removed = new Set();
      for (const modId of new Set(pending.flatMap(workModIds)))
        await remove({
          modId,
          gameRoot: previous.gameRoot,
          targetId: previous.targetId,
        })
          .then(() => removed.add(modId))
          .catch(() => {});
      save(pending.map((item) => workWithoutMods(item, removed)).filter(Boolean));
      await after?.(report);
      return { record, installed, displaced };
    }
    writeAll({ ...readAll(), [key]: record });
    /* Та же работа поставлена на другие вещи: прежние пакеты, которые новая
       установка не сменила сама (другой слот), снимаются — иначе они
       остались бы в игре без кнопки «Снять». */
    for (const modId of modIdsOf(previous))
      if (!replaced.has(modId) && !record.modIds.includes(modId))
        await remove({
          modId,
          gameRoot: previous.gameRoot,
          targetId: previous.targetId,
        }).catch(() => {});
    await after?.(report);
    return { record, installed };
  }

  /**
   * Снимает только пакеты этой работы (`identity` — `{ workId, name }`): на теле не осталось ничего, что она ставила. Прочие работы предмета остаются.
   * Сорвавшееся снятие оставляет пакет в записи — «Снять» до него дотянется — и отказывает словами.
   */
  async function retireWork(key, identity) {
    const record = installOf(key);
    if (!record) return null;
    const works = worksOf(record);
    const same = works.filter((work) => sameInstalledWork(work, identity));
    const removed = new Set();
    let failure = null;
    for (const modId of same.flatMap(workModIds)) {
      try {
        await remove({ modId, gameRoot: record.gameRoot, targetId: record.targetId });
        removed.add(modId);
      } catch (error) {
        failure ||= error;
      }
    }
    const left = works.map((work) => (same.includes(work) ? workWithoutMods(work, removed) : work)).filter(Boolean);
    const records = readAll();
    if (left.length) {
      const last = left.at(-1);
      records[key] = { ...record, ...last, modIds: left.flatMap(workModIds), works: left };
    } else delete records[key];
    writeAll(records);
    await after?.();
    if (failure) throw failure;
    return { record: records[key] || null, removed: [...removed] };
  }

  /** Снимает покраску предмета из игры. */
  async function uninstall(key) {
    const record = installOf(key);
    if (!record) return null;
    let result = null;
    for (const modId of modIdsOf(record))
      result = await remove({
        modId,
        gameRoot: record.gameRoot,
        targetId: record.targetId,
      });
    const records = readAll();
    delete records[key];
    writeAll(records);
    await after?.();
    return result;
  }

  return { installOf, subscribe, install, uninstall, retireWork };
}

/* Названия тату чужих работ, которые движок снял вместе с новой установкой. */
function displacedTitles(works, replaced) {
  const titles = [];
  for (const work of works) {
    const lost = workModIds(work).filter((modId) => replaced.has(modId));
    if (!lost.length) continue;
    const named = (work.packages || []).filter((item) => lost.includes(item.modId)).map((item) => item.title);
    /* Пакет до 01.11.2026 — один на всю работу: снялись все её тату. */
    titles.push(...(named.length ? named : (work.targets || []).map((target) => target.title || target.key)));
  }
  return [...new Set(titles.filter(Boolean))];
}
