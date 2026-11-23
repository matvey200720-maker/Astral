/*
 * «Щёлкнул по лого — правишь его» в кадре «Летающего лого» (ТЗ 18.10.2026,
 * Session 2, задача 2). Править в кадре есть что одно — само лого: объёмная
 * фигура, нарисованная кодом (`floatLogoObject`), без сетки сцены. Площадка и
 * статуя орла под ним — штатные, правке не поддаются, их щелчок не выбирает.
 *
 * Фигура называется правимой через `object.userData.pick` и приходит в
 * попадании кадра как `hit.pick`. Чистые данные, без React и three.
 */

/** Что фигура лого говорит о себе кадру (`userData.pick`). */
export const FLOAT_LOGO_PICK = Object.freeze({ kind: "logo" });

/* Инструменты, которыми правится само лого; «Шаблоны» — готовые виды, не правка фигуры. */
export const FLOAT_LOGO_TOOLS = Object.freeze(["content", "motion", "look"]);

/** Попало ли попадание кадра в лого. */
export const floatLogoAimTarget = (hit) => hit?.pick?.kind === FLOAT_LOGO_PICK.kind;

/**
 * Инструмент по щелчку: тот, что уже взят, если им правится лого (человек
 * правит движение — щелчок по лого не уводит его в «Лого»), иначе «Лого»:
 * картинка или надпись — то, что человек видит в кадре.
 */
export const floatLogoToolFor = (current) => (FLOAT_LOGO_TOOLS.includes(current) ? current : "content");
