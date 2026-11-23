/*
 * Что из программ сцены уже заказано видеочипу (14.11.2026, «Astral быстрее», круг 3 этапа 1).
 *
 * Прогрев (`orbit-stage.js: warm`) идёт кусками, а каждый новый заказ — `setObjects`, `setInstances`, новая сцена — вытесняет прежний и начинает с первого куска. Пока главный поток
 * свободен, прогрев успевает за 1–1,5 с; пока занят (чтение ответов, разбор сцены, кадры редактора), каждый заказ обрывался на первых кусках, и кадр сцены, что ждёт конца прогрева
 * (`warming` держит отрисовку), вставал только после ПОСЛЕДНЕГО, ничем не прерванного заказа — у «Мегамолла» и «Ашана» это конец загрузки (замер 14.11.2026: первая отрисовка сцены на 9,3–11,8 с
 * вместо ~4,5 с; весь прогрев и вся сборка программ — после последнего листа, около секунды в хвосте заставки).
 *
 * Книга запоминает, какие материалы уже заказаны при какой версии (`material.version` растёт, когда программа материала сменилась) и каком окружении (огни, тени, окружение зала — всё,
 * что three кладёт в ключ программы вместе с материалом). Новый заказ берёт у книги только то, что ещё не заказано; уже заказанное он лишь ждёт (`shader-warmup.js: waitPrograms`).
 * Прогрев, вытесненный новым, теперь не теряет сделанного. Программы от этого не меняются — меняется только, когда они заказаны.
 *
 * Чистый модуль без three и DOM: его читает `orbit-stage.js`, а тест гоняет на подставных материалах.
 */

const materialsOf = (object) => (Array.isArray(object.material) ? object.material : [object.material]).filter(Boolean);

export function createProgramLedger() {
  const ordered = new WeakMap();
  const stampOf = (material, context) => `${material.version}|${context}`;
  return {
    /** Делит объекты: `fresh` — что ещё не заказано при нынешней версии материалов и окружении `context`; `already` — материалы того, что заказано раньше. */
    split(objects, context) {
      const fresh = [];
      const already = [];
      for (const object of objects) {
        const list = materialsOf(object);
        if (list.length && list.every((material) => ordered.get(material) === stampOf(material, context))) already.push(...list);
        else fresh.push(object);
      }
      return { fresh, already };
    },
    /** Объекты заказаны: версия материала берётся после заказа (`renderer.compile` сам поднимает её у двусторонних прозрачных). */
    mark(objects, context) {
      for (const object of objects) for (const material of materialsOf(object)) ordered.set(material, stampOf(material, context));
    },
    /** Заказана ли программа материала при этой версии и окружении. */
    isOrdered(material, context) {
      return ordered.get(material) === stampOf(material, context);
    },
  };
}
