/*
 * «Ухудшение текстур» — ступени ползунка (задача 9, 05.10.2026; на всю
 * карту — задача 1 ТЗ 05.10.2026, вечер).
 *
 * Как устроен мод `retexture.rpf`: плоский архив из двух тысяч словарей
 * .ytd игры с теми же именами и теми же текстурами, только каждая текстура
 * — 8×8 и одна ступень mip. Игра берёт их вместо своих по имени, и город с
 * природой становятся однотонными. Ползунок делает то же постепенно и на
 * всю карту: ступени 128 … 8 px Astral собирает из словарей самой игры
 * игрока (перепись карты — около двадцати тысяч словарей, с дальними
 * планами LOD и SLOD) — у каждой текстуры срезаются верхние ступени mip,
 * пока большая сторона не станет не больше предела (нативный хост,
 * `downscale-textures`).
 *
 * Ступень ставится своим пакетом дополнения `astral_textures`
 * (`@modovik/install-engine/textures-dlc.js`), а не в update.rpf: ступень
 * 128 px на всю карту — около гигабайта, а update.rpf держит не больше
 * 4 ГБ; к тому же пакеты Rockstar грузятся после update.rpf, и их словари
 * (дороги, остров, казино) слой в нём не перекрыл бы.
 *
 * `layer` — слой набора оптимизации, которым ступень ставилась до 06.10.2026:
 * по нему окно узнаёт прежнюю установку и переносит её в пакет.
 *
 * `megabytes` — сколько ступень весит в пакете со словарями и моделями карты
 * (замер на игре владельца 06.10.2026: 128, 64 и 8 px — пробой на копии игры,
 * 32 и 16 px — между ними); у других сборок игры число того же порядка, окно
 * пишет его с «около». Вес — почти весь геометрия моделей со своими
 * текстурами; у 128 px он упирается в предел пакета (3 600 МиБ).
 */

/*
 * Сборка моделей карты в пакете текстур (ТЗ 19.10.2026). 2 — хост меняет в файле модели только описания и байты
 * текстур, остальное байт в байт как в игре; модели сборки 1 пересохранял CodeWalker целиком, и игра падала на их
 * столкновениях (GTA5.exe+0x6186AF). Число одно на кэш хоста (`apps/desktop/src/texture-levels.js`), манифест пакета
 * (`textures.modelBuild`) и окно: по нему «Ухудшение текстур», «ЧБ-мир» и «Стиль мира» узнают пакет прежней сборки.
 *
 * `TEXTURE_MODEL_BUILD_SINCE` — когда сборка 2 появилась в main: запись установки без `modelBuild` (прежних версий
 * окна), сделанная позже, — уже сборкой 2; сделанная раньше — прежней.
 */
export const TEXTURE_MODEL_BUILD = 2;
export const TEXTURE_MODEL_BUILD_SINCE = "2026-10-19T08:05:37Z";

/*
 * Дальние планы в мире со стилем или ЧБ (ТЗ 24.10.2026, п. 2: «вдали все текстуры сильно размыты»).
 *
 * Словари LOD, SLOD и `_children` — то, что видно издалека, а при малой «Дальности прорисовки» игры — почти везде.
 * Предел чёткости мира (128 или 256 px) был рассчитан на ближние текстуры и резал их так же: по индексу ступеней на игре
 * владельца дальних планов 13 735 словарей и 1 829 МБ, предел 256 px ужимал 2 321 из них с 1 174 МБ до 430 МБ.
 * Теперь им в мире со стадиями остаётся не меньше `FAR_PLANE_CAP` px: больше пакет не весит ни на сколько
 * (верхняя граница — 743 МБ при 256 px, около гигабайта при 128 px) и не меняет, что уезжает в игру остальное.
 * «Ухудшение текстур» без стадий — срез всей карты по замыслу, дальние планы режутся им вместе со всем.
 * Вариант в описи по-прежнему называется по чёткости мира (`256+style-comic`): собран ли дальний словарь по
 * этому правилу, говорит поле описи `farCap`.
 */
export const FAR_PLANE_CAP = 512;

/** Словарь дальнего плана по имени (`cs3_03_lod+hi.ytd`, `cs3_lod_slod2.ytd`, `ap1_lod_01_b_children.ytd`). */
export const isFarPlaneDictionary = (name) => /(?:^|_)s?lod|_children/.test(String(name ?? "").toLowerCase());

export const TEXTURE_LEVELS = Object.freeze([
  Object.freeze({ step: 0, layer: null, cap: null, megabytes: 0 }),
  Object.freeze({ step: 1, layer: "textures-128", cap: 128, megabytes: 3720 }),
  Object.freeze({ step: 2, layer: "textures-64", cap: 64, megabytes: 3610 }),
  Object.freeze({ step: 3, layer: "textures-32", cap: 32, megabytes: 3230 }),
  Object.freeze({ step: 4, layer: "textures-16", cap: 16, megabytes: 3110 }),
  Object.freeze({ step: 5, layer: "retexture", cap: 8, megabytes: 3060, mod: true }),
]);

/** Пределы ступеней, px: от мягкой к самой грубой. */
export const TEXTURE_CAPS = Object.freeze(TEXTURE_LEVELS.map((level) => level.cap).filter(Boolean));

/** Прежние слои набора оптимизации со ступенями: в наборе — не больше одного. */
export const TEXTURE_LEVEL_LAYERS = Object.freeze(
  TEXTURE_LEVELS.map((level) => level.layer).filter(Boolean),
);

/** Прежние слои, которые Astral собирал из игры игрока (не файлы мода). */
export const GENERATED_TEXTURE_LAYERS = Object.freeze(
  TEXTURE_LEVELS.filter((level) => level.layer && !level.mod).map((level) => level.layer),
);

export const TEXTURE_MAX_STEP = TEXTURE_LEVELS.length - 1;

/** Предел стороны прежнего слоя: `textures-64` → 64, `retexture` → 8. */
export const textureCapOf = (layerId) =>
  TEXTURE_LEVELS.find((level) => level.layer === layerId)?.cap ?? null;

/** Ступень по номеру (за краями — ближайшая). */
export const textureLevelAt = (step) =>
  TEXTURE_LEVELS[Math.max(0, Math.min(TEXTURE_MAX_STEP, Math.round(Number(step) || 0)))];

/** Ступень по пределу стороны пакета: 64 → 2; нет такой — «Как в игре». */
export const textureStepOfCap = (cap) => TEXTURE_LEVELS.find((level) => level.cap && level.cap === Number(cap))?.step ?? 0;

/** Ступень, что стоит прежним слоем набора: ни одного — «Как в игре». */
export function textureStepOfLayers(layers) {
  const has = (layerId) =>
    typeof layers?.has === "function" ? layers.has(layerId) : Array.isArray(layers) && layers.includes(layerId);
  return TEXTURE_LEVELS.find((level) => level.layer && has(level.layer))?.step ?? 0;
}
