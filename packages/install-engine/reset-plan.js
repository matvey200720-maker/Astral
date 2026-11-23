/*
 * Что «Вернуть GTA V без модов» может не делать (сброс 12.10).
 *
 * Возврат кладёт в игру байты «до Astral» (`pristine`, иначе `original`) — и
 * до сих пор перед этим делал всё, что делает установка: принимал правки
 * снаружи в каждый архив (помощником RPF, с пересборкой update.rpf), читал
 * каждую копию целиком ради отпечатка и копировал её поверх живого файла,
 * даже если в игре уже лежали ровно эти байты. На копии игры владельца
 * (35 работ, дороги и растительность) половина сброса уходила на такую
 * работу, результат которой тут же выбрасывался.
 *
 * Здесь решается, без чего возврат даст ту же игру:
 *
 *   • архив в игре уже тот, к которому идёт возврат (`settled`), — его не
 *     нужно ни принимать в основу, ни копировать: звуковые архивы после
 *     проверки файлов, одежда, которую Astral не трогал;
 *   • update.rpf собран самим Astral — слоями движка или его же нативными
 *     правками (цепочка точек отката, `native-history.js`), — принимать его в
 *     основу незачем: возврат всё равно положит копию «до Astral», снятую
 *     раньше (так и было: `direct-update-rebase.js` для своей правки оставляет
 *     `pristine` прежним). Очистка основы от записей Astral — это пересборка
 *     двух гигабайт помощником.
 *
 * Чужая правка (обновление игры, мод через OpenIV после Astral) принимается,
 * как раньше: тогда «до Astral» — это сборка человека, и её надо снять.
 */
import fs from "node:fs/promises";
import { resolveInside } from "./manifest.js";
import { fingerprintSha256 } from "./file-fingerprint.js";
import { reachedByOwnNativeChanges } from "./native-history.js";
import { originalRestoreBaseline } from "./pristine-baseline.js";
import { throwIfAborted } from "./runtime-guard.js";

const UPDATE_TARGET = "update/update.rpf";
const hex = (value) => String(value || "").toLowerCase();

/* update.rpf собрал сам Astral: возврат к «до Astral» не зависит от того, что
   приняла бы основа. */
async function ownUpdateArchive({ target, resource, live }) {
  const base = resource.compositionBase;
  const expected = resource.layers?.at(-1)?.sha256 || base?.sha256;
  if (
    resource.pristine?.exists &&
    [expected, base?.liveSha256].some((value) => value && hex(value) === live)
  )
    return true;
  return reachedByOwnNativeChanges({
    gameRoot: target.gameRoot,
    known: [
      expected,
      base?.sha256,
      base?.liveSha256,
      resource.original?.sha256,
      resource.pristine?.sha256,
    ],
    live,
  });
}

/**
 * План возврата к «до Astral» по живым архивам цели.
 *
 * @returns {Promise<{ settled: Set<string>, skipAdoption: Set<string>, live: Map<string, string> }>}
 *   `settled` — архивы, которые уже такие, как надо (не копируются);
 *   `skipAdoption` — архивы, чьи правки снаружи принимать незачем;
 *   `live` — отпечатки живых архивов, которые пришлось узнать.
 */
export async function planOriginalRestore({
  target,
  signal = null,
  hash = fingerprintSha256,
}) {
  const settled = new Set();
  const skipAdoption = new Set();
  const live = new Map();
  for (const [relativePath, resource] of Object.entries(target?.resources || {})) {
    throwIfAborted(signal);
    const goal = originalRestoreBaseline(resource);
    if (!goal?.exists || !/^[0-9a-f]{64}$/i.test(String(goal.sha256 || ""))) continue;
    const livePath = resolveInside(target.gameRoot, relativePath);
    const stat = await fs.lstat(livePath).catch(() => null);
    if (!stat?.isFile()) continue;
    const sha256 = hex(await hash(livePath));
    live.set(relativePath, sha256);
    if (sha256 === hex(goal.sha256)) {
      settled.add(relativePath);
      skipAdoption.add(relativePath);
    } else if (
      relativePath === UPDATE_TARGET &&
      (await ownUpdateArchive({ target, resource, live: sha256 }))
    )
      skipAdoption.add(relativePath);
  }
  return { settled, skipAdoption, live };
}
