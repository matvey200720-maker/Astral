/*
 * Сборка пользователя помнит, на что ставить вещи одежды (16.11.2026, решение ведущей).
 *
 * Вещь вида «одна вещь на замену» (причёска, борода, усы, ногти, перчатки, штатная вещь) без выбора, «на что поставить», не ставится (`features/clothing/needs-choice.js`), и сборка называла такие вещи
 * словом «не ставятся сами: откройте их карточки». Теперь выбор можно задать у самой сборки: то, что отдаёт окно «Сделать заменёнку» (`clothingChoice`), лежит в записи сборки полем
 * `choices: { [id мода]: clothingChoice }`, и план установки (`install-plan.js`) ставит вещь с выбором так же, как «Повторить» у строки «Загрузок» (`saved-choice.js`).
 *
 * Только локально, у этой сборки и этого ПК: места игры (папка, номер, имя) у каждого человека свои, поэтому выбор не едет ни в код переноса (`portable-code.js`), ни в облачные `items`
 * (строгая форма `{ mod_id, release_id }`), ни в чужие сборки. Запись без поля читается как раньше. Модуль без зависимостей: его берёт план сборки.
 */

const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Выборы записи сборки: `{ [id мода]: clothingChoice }`; пусто, если поля нет или оно не словарь. */
export const choicesOf = (build) =>
  isRecord(build?.choices) ? build.choices : {};

/** Выбор для этого мода или `null`. */
export const choiceFor = (build, modId) => choicesOf(build)[modId] || null;

/* Картинки, которые на другом запуске не откроются или раздули бы хранилище (`blob:` живёт до перезапуска окна, `data:` — сотни килобайт на выбор). */
const volatileUrl = (value) =>
  typeof value === "string" && /^(?:blob|data):/i.test(value);

/** Выбор в том виде, в каком его кладут в запись сборки: без картинок, которых после перезапуска нет. Остальное — как отдало окно. */
export function storableChoice(choice) {
  if (!isRecord(choice)) return choice;
  const next = { ...choice };
  if (volatileUrl(next.cover)) delete next.cover;
  const clean = (target) => {
    if (!isRecord(target)) return target;
    const copy = { ...target };
    if (volatileUrl(copy.picture)) delete copy.picture;
    return copy;
  };
  if (isRecord(next.target)) next.target = clean(next.target);
  if (Array.isArray(next.targets)) next.targets = next.targets.map(clean);
  return next;
}

/** Запись сборки без выборов для модов, которых в ней больше нет (`modIds`): снятый мод не оставляет места, на которое ставил. Пустой словарь убирает поле. */
export function pruneChoices(build) {
  const kept = new Set(build?.modIds || []);
  const rest = Object.fromEntries(
    Object.entries(choicesOf(build)).filter(([id]) => kept.has(id)),
  );
  const others = { ...build };
  delete others.choices;
  return Object.keys(rest).length ? { ...others, choices: rest } : others;
}

/**
 * Запись сборки с новыми выборами: `picked` — `{ [id мода]: clothingChoice }`. Выбор для мода, которого в сборке нет, не записывается (парные вещи окна — чужие моды, их
 * место в этой сборке ничего не значит). `null` вместо выбора снимает его.
 */
export function withChoices(build, picked) {
  const kept = new Set(build?.modIds || []);
  const next = { ...choicesOf(build) };
  for (const [id, choice] of Object.entries(picked || {})) {
    if (!kept.has(id)) continue;
    if (choice) next[id] = storableChoice(choice);
    else delete next[id];
  }
  return pruneChoices({ ...build, choices: next });
}

/** Моды из списка, у которых в записи сборки уже есть выбор. */
export const choiceCount = (build, mods) =>
  (mods || []).filter((mod) => choiceFor(build, mod?.id)).length;
