/*
 * Лента «Все» вперемешку по видам (29.10.2026, владелец: «чтобы не шло одно
 * подряд, а разновидности: прицел, потом два ганпака, потом одежда, потом
 * редукс, мини-карты… особенно вкладку „Все“»).
 *
 * После массовой выкладки пятьсот ганпаков стояли подряд, а прицелы и
 * мини-карты тонули после них. Порядок «Новые» (`newestFirst`) остаётся
 * порядком внутри вида, а виды чередуются: плавный взвешенный круг
 * (smooth weighted round-robin). Вес вида — корень из числа его карточек:
 * большой вид (одежда, ганпаки) идёт чаще, но не заглушает редкие, а редкие
 * (прицел, мини-карта, редукс, таймцикл) поднимаются вверх, а не ждут конца.
 *
 * Детерминированно: тот же ответ каталога даёт тот же порядок при каждом
 * заходе, без случайности на отрисовку; страницы сетки режут один и тот же
 * список. Подряд не больше двух карточек одного вида, пока другие виды не
 * кончились, и не две подряд из одного поста.
 */
import { postKeyOf } from "../../catalog-utils.js";
import { catalogSectionOfMod } from "../../components/desktop/catalog/catalogSections.js";

/** Сколько карточек одного вида могут идти подряд, пока есть другие виды. */
export const MAX_RUN = 2;

/** Часть редукса и его пак стоят не ближе, чем через столько плиток (окно, 29.10.2026): иначе «Что внутри» дублирует соседа. */
export const PACK_GAP = 6;

/** Редукс карточки: `{ group, lead }` — группа (`reduxGroup`) и она ли пак; без группы — `null`. */
export function reduxRelationOf(mod) {
  return mod?.reduxGroup ? { group: mod.reduxGroup, lead: Boolean(mod.reduxLead) } : null;
}

/**
 * Вид карточки в ленте: из каталога, а не придуманный. Пак редукса, пак
 * ганпака и одежда — по разделу; часть редукса — по редактору мастерской
 * (`catalogEditor`: прицел, мини-карта, таймцикл, килл-эффект…).
 */
export function feedKindOf(mod) {
  if (mod?.reduxLead) return "redux";
  const section = catalogSectionOfMod(mod);
  if (section === "skins") return "gunpack";
  if (section === "for-redux") return `part:${mod.catalogEditor || "other"}`;
  return section || "other";
}

/** Сколько первых карточек вида просматривается, когда головная нельзя ставить из-за пака (порядок вида почти прежний). */
export const LOOKAHEAD = 30;

/**
 * Перемешать `mods` (уже по порядку «Новые») по видам. Внутри вида порядок
 * прежний, кроме частей редуксов, которые уступают место своему паку. Список
 * без второго вида возвращается как есть.
 *
 * Правила (29.10.2026, ведущая): одна карточка дважды не встаёт (по id); часть
 * не стоит ближе `PACK_GAP` плиток к паку своего редукса (`relationOf`) — и
 * раньше пака, и позже; до пака встаёт не больше одной части редукса, остальные
 * ждут его: иначе части одного поста с одной датой каждый раз не пускали бы пак.
 * Если выбрать больше не из чего (хвост ленты), правила снимаются.
 */
export function mixByKind(mods, kindOf = feedKindOf, relationOf = reduxRelationOf) {
  const seen = new Set();
  const queues = new Map();
  for (const mod of mods) {
    if (seen.has(mod.id)) continue;
    seen.add(mod.id);
    const kind = kindOf(mod);
    if (!queues.has(kind)) queues.set(kind, []);
    queues.get(kind).push(mod);
  }
  if (queues.size < 2) return seen.size === mods.length ? mods : [...queues.values()].flat();
  /* Порядок видов при равных очках — по размеру, потом по имени: без случайности. */
  const kinds = [...queues.keys()].sort(
    (left, right) =>
      queues.get(right).length - queues.get(left).length ||
      (left < right ? -1 : 1),
  );
  const weight = new Map(
    kinds.map((kind) => [kind, Math.sqrt(queues.get(kind).length)]),
  );
  const credit = new Map(kinds.map((kind) => [kind, 0]));
  /* Редуксы, у которых в ленте есть пак: только их части ждут пак. */
  const packed = new Set(
    mods.map(relationOf).filter((own) => own?.lead).map((own) => own.group),
  );
  const leadAt = new Map(); // группа → место пака в ленте
  const early = new Map(); // группа → сколько частей встало до пака
  const mixed = [];
  const total = seen.size;
  let runKind = "";
  let run = 0;
  let lastPost = "";
  /* Нельзя ставить рядом с паком своего редукса (и до него, и после). */
  const packBlocks = (next) => {
    const own = relationOf(next);
    if (!own) return false;
    if (own.lead)
      return mixed.slice(-(PACK_GAP - 1)).some((placed) => {
        const other = relationOf(placed);
        return other && !other.lead && other.group === own.group;
      });
    if (!packed.has(own.group)) return false;
    if (!leadAt.has(own.group)) return (early.get(own.group) || 0) >= 1;
    return mixed.length - leadAt.get(own.group) < PACK_GAP;
  };
  /* Место в очереди вида, с которого можно ставить, или -1. */
  const spot = (kind, { post, pack }) => {
    const queue = queues.get(kind);
    for (let at = 0; at < Math.min(queue.length, LOOKAHEAD); at += 1) {
      if (pack && packBlocks(queue[at])) continue;
      if (post && lastPost && postKeyOf(queue[at]) === lastPost) continue;
      return at;
    }
    return -1;
  };
  while (mixed.length < total) {
    const active = kinds.filter((kind) => queues.get(kind).length);
    let sum = 0;
    for (const kind of active) {
      credit.set(kind, credit.get(kind) + weight.get(kind));
      sum += weight.get(kind);
    }
    const ranked = [...active].sort(
      (left, right) => credit.get(right) - credit.get(left),
    );
    /* Подряд не больше MAX_RUN одного вида, не два подряд из одного поста и
       часть не рядом со своим паком — пока есть из чего выбрать. */
    const allowed = ranked.filter(
      (kind) => !(kind === runKind && run >= MAX_RUN && active.length > 1),
    );
    let kind = "";
    let at = -1;
    for (const relax of [
      { post: true, pack: true },
      { post: false, pack: true },
      { post: false, pack: false },
    ]) {
      for (const candidate of allowed) {
        at = spot(candidate, relax);
        if (at >= 0) {
          kind = candidate;
          break;
        }
      }
      if (kind) break;
    }
    if (!kind) {
      kind = ranked[0];
      at = 0;
    }
    const [mod] = queues.get(kind).splice(at, 1);
    credit.set(kind, credit.get(kind) - sum);
    const own = relationOf(mod);
    if (own?.lead) leadAt.set(own.group, mixed.length);
    else if (own && packed.has(own.group) && !leadAt.has(own.group))
      early.set(own.group, (early.get(own.group) || 0) + 1);
    run = kind === runKind ? run + 1 : 1;
    runKind = kind;
    lastPost = postKeyOf(mod);
    mixed.push(mod);
  }
  return mixed;
}
