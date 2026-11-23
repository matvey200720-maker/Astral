/*
 * Доп. модели вещи: `hair_003_u_1.ydd`, `hair_003_u_2.ydd`, `hand_000_u_1…26.ydd` (TASK-targets-5 / TASK-targets-4, находка 14.11.2026).
 *
 * У вещи свободного персонажа кроме основной модели `<вид>_<номер>_<u|r>.ydd` бывают доп. `<вид>_<номер>_<u|r>_<N>.ydd`. Игра подставляет их вместо основной по правилам `pedalternatevariations.meta` дополнений
 * («если надета вещь X — вещь Y берётся в варианте N»): причёска — при маске, капюшоне, бусах (≈ 3 400 правил из 5 995 в игре владельца), сумка — при куртке и броне (ступени наполнения),
 * маска, верх, низ, подкладка — при других вещах. Заменёнка, что пишет только основную модель, в этих состояниях показывает штатную вещь.
 *
 * Правило замены (слова ведущей 14.11.2026): каждая доп. модель цели получает доп. модель источника с тем же номером, если она у источника есть, иначе — основную модель источника.
 * Листы (`_diff_`) — как раньше. Чистый JS: окно, главный процесс, движок и тесты.
 */

/** Доп. модель: компонент, номер вещи, суффикс, номер варианта. Основная модель (`…_u.ydd`) и пропсы (у них суффикса нет) сюда не попадают. */
export const ALTERNATE_MODEL = /^([a-z]{3,6})_(\d{3})_([ur])_(\d{1,2})\.ydd$/;

/** `{ component, drawable, suffix, number }` или `null`: имя — не доп. модель. */
export function parseAlternate(name) {
  const match = ALTERNATE_MODEL.exec(String(name || "").toLowerCase());
  return match
    ? {
        component: match[1],
        drawable: Number(match[2]),
        suffix: match[3],
        number: Number(match[4]),
      }
    : null;
}

/**
 * Доп. модели вещи среди имён файлов одной папки: `[{ name, number }]` по возрастанию номера варианта (а не по алфавиту: `_10` после `_9`).
 * `suffix` — суффикс основной модели вещи; доп. модель с другим суффиксом той же вещи — чужая и не берётся.
 */
export function alternatesOf(names, component, drawable, suffix = null) {
  const number = Number(drawable);
  const found = [];
  const seen = new Set();
  for (const name of names || []) {
    const parsed = parseAlternate(name);
    if (!parsed || parsed.component !== component || parsed.drawable !== number)
      continue;
    if (suffix && parsed.suffix !== suffix) continue;
    if (seen.has(parsed.number)) continue;
    seen.add(parsed.number);
    found.push({ name: String(name), number: parsed.number });
  }
  return found.sort((left, right) => left.number - right.number);
}

/**
 * План доп. моделей: для каждой доп. модели цели — какой файл источника в неё ляжет. `target` — `[{ name, number }]` (`alternatesOf` по оглавлению игры); `source` — `Map(номер → файл источника)`
 * доп. моделей пакета; `main` — основная модель источника. Ответ — `[{ name, number, source, own }]`: `own` — у источника был свой вариант с этим номером, иначе легла основная.
 */
export function alternatePlan(target, source, main) {
  return (target || []).map(({ name, number }) => {
    const own = source?.get?.(number) ?? null;
    return { name, number, source: own || main, own: Boolean(own) };
  });
}
