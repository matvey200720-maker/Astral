/*
 * Выбор щелчком в кадре «Вайнвуда» (18.10.2026, Session 2, задача 2): что
 * правится под курсором на холме. Без React и three.
 *
 * В кадре три разные вещи:
 *   — штатная надпись из сцены (буквы, леса, прожекторы) — «Как в игре»; её
 *     сетки сцена знает по группе листа (`info.group`);
 *   — свои буквы, леса и логотип работы — сетки, нарисованные кодом
 *     (`vinewood-art.js`), сетки сцены под ними нет, поэтому они называются
 *     кадру (`userData.pick`): каждая буква — номером своего знака в слове;
 *   — склон: править нечего.
 * Точка попадания для букв не нужна и не годится: кадр отдаёт точку склона за
 * буквами, а не самих букв, — на косом взгляде она уходит на соседнюю букву.
 */

/** Части штатной надписи в сцене (группы листов описи). */
export const VINEWOOD_SIGN_GROUPS = Object.freeze(["letters", "scaffold", "lights"]);

/** Названия вещей кадра (`userData.pick.kind`). */
export const VINEWOOD_PICK = Object.freeze({ word: "vinewood-word", scaffold: "vinewood-scaffold", logo: "vinewood-logo" });

/**
 * Что открыть по попаданию: `{ tool, kind, letter? }` или `null` (склон,
 * мимо надписи).
 *   — буква своего слова: «Цвет» и эта буква (`letter` — место знака в слове,
 *     как у цвета отдельной буквы);
 *   — логотип: «Логотип»;
 *   — леса и прожекторы: инструмент, что ставит надпись («Надпись»; при логотипе
 *     вместо букв — «Логотип»); штатная надпись из сцены — «Надпись».
 * `project` — нормализованная работа (от неё режим).
 */
export function vinewoodAimTarget(project, hit) {
  if (!hit) return null;
  const pick = hit.pick;
  if (pick?.kind === VINEWOOD_PICK.word) return Number.isInteger(pick.letter) ? { tool: "colour", kind: "letter", letter: pick.letter } : { tool: "colour", kind: "word" };
  if (pick?.kind === VINEWOOD_PICK.logo) return { tool: "logo", kind: "logo" };
  if (pick?.kind === VINEWOOD_PICK.scaffold) return project?.mode === "logo" ? { tool: "logo", kind: "logo" } : { tool: "word", kind: "sign" };
  const group = hit.info?.group;
  return VINEWOOD_SIGN_GROUPS.includes(group) ? { tool: "word", kind: "sign" } : null;
}

/** Подсветка штатной надписи в сцене: все её группы листов. */
export const vinewoodSignSpec = () => ({ where: (info) => VINEWOOD_SIGN_GROUPS.includes(info?.group) });
