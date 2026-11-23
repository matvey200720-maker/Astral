/*
 * Цель по умолчанию: штатная вещь игры, на которую вещь проекта (карточка `addon`) встаёт по нажатию «Установить», без обязательного окна «Сделать заменёнку»
 * (TASK-targets-5, слова владельца 14.11.2026: «я выбрал, устанавливаю, у меня ногти устанавливаются на ногти, то есть на дефолтные просто»).
 *
 * Правило цели — пять условий, и четыре из них проверяются здесь по оглавлению игры игрока:
 *   (а) вещь есть в файлах игры игрока (`items` — вещи игры нужных пола и вида);
 *   (б) она ставится «на месте» в пак из белого списка Majestic: у вещи есть модель и листы в белом паке (`local`, `majesticLocalSet`) — заменёнка работает и на RAGE MP, и на Majestic;
 *   (в) она продаётся в обычном магазине: у вещи есть название магазина (`name`), а в списке данных — вещи без марок и номеров (правило отбора — `scripts/build-default-targets.mjs`);
 *   (г) расцветок у неё не меньше, чем у вещи (`colours`): иначе лишние цвета вещи останутся без пары; нет такой — берётся с наибольшим числом расцветок и это говорится (`shortfall`);
 *   (д) она не занята другой заменёнкой (`occupantOf`) и не взята другой вещью той же установки (`taken`: комплект из нескольких вещей не садится на одну цель).
 * Кандидаты — явный короткий список в данных (`default-targets-data.js`, три записи на пол, вид и крой: главная и две запасные), а не «первая попавшаяся». Занята или недоступна главная — берётся
 * следующая, и человеку говорится, какая (`skipped`). Нет ни одной — `item: null` и честная причина: окно открывает обычный выбор.
 *
 * Чистый JS: работает в окне и в тестах. Ничего не читает и не пишет.
 */

import { DEFAULT_TARGETS } from "./default-targets-data.js";
import { GARMENT_KINDS } from "./garment-kinds.js";
import { majesticLocalKey } from "./game-assortment.js";

/** Группа кроя вида вещи (`GARMENT_KINDS`); у видов без кроя и у неузнанного кроя — `any`. */
export function kindGroup(component, kind) {
  return (
    GARMENT_KINDS[component]?.find((entry) => entry.id === kind)?.group || "any"
  );
}

/**
 * Кандидаты по умолчанию на этот пол, вид и крой: `[{ folder, drawable, name }]` в порядке предпочтения. Нет списка для узнанного кроя — пусто (вещь другого кроя ляжет криво, `garment-kinds.js`);
 * крой не узнан — общий список вида (`any`).
 */
export function defaultCandidates(gender, component, kind = null) {
  const byGroup = DEFAULT_TARGETS[gender]?.[component];
  if (!byGroup) return [];
  const list = byGroup[kindGroup(component, kind)] || [];
  return list.map(([folder, drawable, name]) => ({ folder, drawable, name }));
}

const keyOf = (gender, component, folder, drawable) =>
  majesticLocalKey({ gender, component, folder, drawable });

/**
 * Выбрать цель по умолчанию.
 * @param {{
 *   gender: "male"|"female", component: string, kind?: string|null,
 *   items: object[], local: Set<string>|null, colours?: number,
 *   occupantOf?: (item: object) => object|null, taken?: Set<string>
 * }} input `items` — вещи игры этих пола и вида (`gameItemsOf`); `local` — вещи белых паков (`null` — игра не прочитана); `colours` — расцветок у вещи проекта;
 *   `occupantOf(item)` — кто уже стоит на вещи (`null` — свободна); `taken` — ключи вещей, уже взятых другими вещами этой установки.
 * @returns {{ item: object|null, why: string, candidate: object|null, skipped: object[], shortfall: {have:number, need:number}|null }}
 *   `why` при `item: null`: `no-list` (на этот вид и крой списка нет), `unread` (игра не прочитана), `none` (ни одна из записей не подошла).
 */
export function pickDefaultTarget({
  gender,
  component,
  kind = null,
  items = [],
  local = null,
  colours = 0,
  occupantOf = () => null,
  taken = new Set(),
}) {
  const candidates = defaultCandidates(gender, component, kind);
  if (!candidates.length)
    return {
      item: null,
      why: "no-list",
      candidate: null,
      skipped: [],
      shortfall: null,
    };
  if (!local)
    return {
      item: null,
      why: "unread",
      candidate: null,
      skipped: [],
      shortfall: null,
    };
  const byKey = new Map(
    items.map((item) => [
      keyOf(item.gender, item.component, item.folder, item.drawable),
      item,
    ]),
  );
  const skipped = [];
  const usable = [];
  for (const candidate of candidates) {
    const key = keyOf(gender, component, candidate.folder, candidate.drawable);
    const item = byKey.get(key);
    if (!item) skipped.push({ candidate, why: "absent" });
    else if (item.hidden) skipped.push({ candidate, item, why: "hidden" });
    else if (!local.has(key))
      skipped.push({ candidate, item, why: "not-local" });
    else if (!item.name) skipped.push({ candidate, item, why: "unnamed" });
    else if (taken.has(item.key))
      skipped.push({ candidate, item, why: "taken" });
    else {
      const occupant = occupantOf(item);
      if (occupant)
        skipped.push({ candidate, item, why: "occupied", occupant });
      else usable.push({ candidate, item });
    }
  }
  if (!usable.length)
    return {
      item: null,
      why: "none",
      candidate: null,
      skipped,
      shortfall: null,
    };
  /* Первая запись с достаточным числом расцветок; нет такой — с наибольшим числом, и это говорится. */
  const need = Math.max(0, Number(colours) || 0);
  const enough = usable.find(({ item }) => item.textures >= need);
  const best =
    enough ||
    usable.reduce((top, one) =>
      one.item.textures > top.item.textures ? one : top,
    );
  return {
    item: best.item,
    why: "default",
    candidate: best.candidate,
    skipped,
    shortfall: enough || !need ? null : { have: best.item.textures, need },
  };
}

/**
 * Цели по умолчанию для нескольких вещей установки (комплект): каждая берёт свою, уже взятые не повторяются. `cards` — `[{ id, gender, component, kind, colours, items }]`;
 * `shared` — общие `local` и `occupantOf`. Ответ — `Map(id → итог pickDefaultTarget)` в порядке вещей.
 */
export function assignDefaultTargets(
  cards,
  { local, occupantOf = () => null, taken = new Set() } = {},
) {
  const used = new Set(taken);
  const answers = new Map();
  for (const card of cards) {
    const answer = pickDefaultTarget({
      ...card,
      local,
      occupantOf,
      taken: used,
    });
    if (answer.item) {
      used.add(answer.item.key);
      /* Плитка одинаковых вещей (`together`) занимает все свои места. */
      for (const place of answer.item.together || []) used.add(place.key);
    }
    answers.set(card.id, answer);
  }
  return answers;
}

/* Слова про модель бороды живут отдельно (`beard.js`): окну они нужны до загрузки списка. */
export { looksLikeBeard } from "./beard.js";
