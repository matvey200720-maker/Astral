/*
 * «Интерьеры проектов» — что такое пак.
 *
 * Пак — папка, которую автор выложил целиком: `Гараж 100 [map_garage_100]`,
 * `Rancho [q_rancho_full]/файлы/q_rancho_full`, у GTA 5 РП — папка верхнего уровня
 * (`Animal_shelter`). Сканер каталога (`scan.js`) ищет имена моделей, словарей и
 * определений вещей сначала внутри пака интерьера и только потом в общих файлах
 * источника; бандл паков для облака (`scripts/lib/project-interiors-bundle.mjs`)
 * режет папку проекта на моды по тому же правилу. Правило одно на двоих: иначе
 * номер и полнота интерьера в папке игрока разошлись бы с теми же паками из облака
 * (17.10.2026: у 12 паков GTA 5 РП и 8 паков Majestic они расходились).
 */

export const ROOT_SEGMENT = new Set(["interiors", "интерьеры", "dlcpacks", "dlc_паки"]);
export const LAYOUT_SEGMENT = /^(файлы|dlc_паки)$/i;
export const BRACKET = /\[([^\]]+)\]\s*$/;

/**
 * Папка пака по папке интерьера (`unit.dir` каталога): папка с id пака в
 * скобках (`Гараж 100 [map_garage_100]`), иначе `файлы/<пак>` или `dlc_паки/<пак>`
 * (несколько паков в одной папке-локации), иначе сама папка. Интерьеры одного
 * пака (Rancho — три `.rpf`, Хэллоуин — три) сходятся в один ключ.
 */
export function packKeyOf(dir) {
  const segments = String(dir || "").split("/").filter(Boolean);
  const bracket = segments.findIndex((segment) => BRACKET.test(segment));
  if (bracket >= 0) return segments.slice(0, bracket + 1).join("/");
  const layout = segments.findIndex((segment) => LAYOUT_SEGMENT.test(segment));
  if (layout >= 0) return segments.slice(0, Math.min(segments.length, layout + 2)).join("/");
  return segments.join("/");
}

/**
 * Пак файла — по одному его пути, когда папки интерьера ещё нет (сканер сначала
 * читает типы и карты, и лишь потом собирает из них интерьеры). Нужен, чтобы
 * отличить копии одного интерьера (россыпь `файлы/<пак>` и `dlc_паки/<пак>/dlc.rpf`
 * того же пака — один пак) от одноимённых интерьеров разных паков. Скобки с id пака
 * и раскладка — как у `packKeyOf`, но слово раскладки в ключ не входит, иначе две
 * копии одного пака разошлись бы; когда нет ни скобок, ни раскладки, пак — первая
 * папка выше корневых (`Интерьеры/Арена/…` → `Интерьеры/Арена`, `Animal_shelter/…`
 * → `Animal_shelter`). Для групп вроде `Здания и бизнес/maj_fish` это грубее, чем
 * знает бандл, — но грубо только тогда, когда у двух разных паков одной группы
 * совпало имя MLO, а такое бывает у копий одного интерьера, не у разных.
 */
export function packOfFile(filePath) {
  const segments = String(filePath || "").split("/").filter(Boolean).slice(0, -1);
  const bracket = segments.findIndex((segment) => BRACKET.test(segment));
  if (bracket >= 0) return segments.slice(0, bracket + 1).join("/");
  const layout = segments.findIndex((segment) => LAYOUT_SEGMENT.test(segment));
  if (layout >= 0) return [...segments.slice(0, layout), segments[layout + 1]].filter(Boolean).join("/");
  const first = segments.findIndex((segment) => !ROOT_SEGMENT.has(segment.toLowerCase()));
  return first < 0 ? segments.join("/") : segments.slice(0, first + 1).join("/");
}

/**
 * Настоящая папка пака для файла — потолок, выше которого папка интерьера не
 * поднимается (иначе интерьер из `dlc_паки/<пак>` проглотил бы соседей по
 * локации). Правила те же, что у `packOfFile`, но слово раскладки остаётся в пути:
 * `Интерьеры/ЛССД/файлы/tk_mj_hosp_sherif`.
 */
export function packRootOf(filePath) {
  const segments = String(filePath || "").split("/").filter(Boolean).slice(0, -1);
  const bracket = segments.findIndex((segment) => BRACKET.test(segment));
  if (bracket >= 0) return segments.slice(0, bracket + 1).join("/");
  const layout = segments.findIndex((segment) => LAYOUT_SEGMENT.test(segment));
  if (layout >= 0) return segments.slice(0, Math.min(segments.length, layout + 2)).join("/");
  const first = segments.findIndex((segment) => !ROOT_SEGMENT.has(segment.toLowerCase()));
  return first < 0 ? segments.join("/") : segments.slice(0, first + 1).join("/");
}
