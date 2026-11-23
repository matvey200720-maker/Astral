/*
 * Файлы игры, которые раздел оптимизации умеет менять, и их места в архиве.
 *
 * Отдельный модуль, потому что адреса нужны обеим сторонам: main process
 * достаёт по ним базы и кладёт результат, а окно показывает человеку имя
 * файла в списке правок. Компилятор при этом тянет `node:crypto` и в браузер
 * не попадает — общими остаются только адреса.
 */

export const OPTIMIZER_TARGETS = Object.freeze({
  visualsettings: Object.freeze({
    id: "visualsettings",
    file: "visualsettings.dat",
    target: "update:/common/data/visualsettings.dat",
  }),
  procedural: Object.freeze({
    id: "procedural",
    file: "procedural.meta",
    target: "update:/common/data/materials/procedural.meta",
  }),
});
