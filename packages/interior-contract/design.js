import { canonicalSha256 } from "./canonical.js";
import {
  INTERIOR_CATALOG_REVISION,
  getInteriorLocation,
  getInteriorPreset,
  getInteriorProp,
  getInteriorTemplate,
} from "./registries.js";
import {
  INTERIOR_MAX_ENTITIES,
  INTERIOR_MAX_JSON_BYTES,
  quaternionToYaw,
  validateInteriorDesign,
} from "./validation.js";

export const INTERIOR_DESIGN_FORMAT = "astral.interior-design";
/*
 * 2 — у макета появилась отделка: цвет и текстура поверхностей помещения.
 *     Версия поднята, а не поле добавлено молча: старый проект без `finish`
 *     обязан пройти через `upgradeInteriorDesign`, иначе строгая проверка
 *     полей уронила бы его же собственный сохранённый макет.
 */
export const INTERIOR_DESIGN_SCHEMA_VERSION = 2;

const safeId = (value, path) => {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._:-]{0,95}$/.test(value))
    throw new TypeError(
      `${path}: ожидался безопасный lowercase-идентификатор.`,
    );
  return value;
};
const finite = (value, path, min, max) => {
  if (!Number.isFinite(value) || value < min || value > max)
    throw new TypeError(
      `${path}: ожидалось конечное число от ${min} до ${max}.`,
    );
  return Object.is(value, -0) ? 0 : Math.round(value * 10000) / 10000;
};
const text = (value, path, min, max) => {
  if (typeof value !== "string")
    throw new TypeError(`${path}: ожидалась строка.`);
  const result = value.trim();
  if (result.length < min || result.length > max)
    throw new TypeError(`${path}: допустимо от ${min} до ${max} символов.`);
  return result;
};
const isoDate = (value, path) => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new TypeError(`${path}: ожидалась дата ISO-8601.`);
  return new Date(value).toISOString();
};
const exact = (value, fields, path) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${path}: ожидался объект.`);
  const allowed = new Set(fields);
  for (const key of Object.keys(value))
    if (!allowed.has(key))
      throw new TypeError(`${path}.${key}: неизвестное поле.`);
  for (const key of fields)
    if (!Object.hasOwn(value, key))
      throw new TypeError(`${path}.${key}: поле обязательно.`);
};

export function yawToQuaternion(yaw) {
  const radians = (finite(yaw, "yaw", -36000, 36000) * Math.PI) / 180;
  return {
    x: 0,
    y: 0,
    z: Math.round(Math.sin(radians / 2) * 1e6) / 1e6,
    w: Math.round(Math.cos(radians / 2) * 1e6) / 1e6,
  };
}

function normalizeEntity(value, index) {
  const path = `design.entities[${index}]`;
  exact(
    value,
    ["id", "propId", "position", "rotation", "surfaceId", "editor"],
    path,
  );
  exact(value.position, ["x", "y", "z"], `${path}.position`);
  exact(value.rotation, ["x", "y", "z", "w"], `${path}.rotation`);
  exact(value.editor, ["locked", "hidden", "groupId"], `${path}.editor`);
  const rotation = {
    x: finite(value.rotation.x, `${path}.rotation.x`, -1, 1),
    y: finite(value.rotation.y, `${path}.rotation.y`, -1, 1),
    z: finite(value.rotation.z, `${path}.rotation.z`, -1, 1),
    w: finite(value.rotation.w, `${path}.rotation.w`, -1, 1),
  };
  const length = Math.hypot(rotation.x, rotation.y, rotation.z, rotation.w);
  if (length < 0.999 || length > 1.001)
    throw new TypeError(
      `${path}.rotation: quaternion должен быть нормализован.`,
    );
  return {
    id: safeId(value.id, `${path}.id`),
    propId: safeId(value.propId, `${path}.propId`),
    position: {
      x: finite(value.position.x, `${path}.position.x`, -100, 100),
      y: finite(value.position.y, `${path}.position.y`, -100, 100),
      z: finite(value.position.z, `${path}.position.z`, -10, 20),
    },
    rotation,
    surfaceId:
      value.surfaceId === "floor"
        ? "floor"
        : (() => {
            throw new TypeError(
              `${path}.surfaceId: MVP поддерживает только пол.`,
            );
          })(),
    editor: {
      locked: Boolean(value.editor.locked),
      hidden: Boolean(value.editor.hidden),
      groupId:
        value.editor.groupId === null
          ? null
          : safeId(value.editor.groupId, `${path}.editor.groupId`),
    },
  };
}

/*
 * ОТДЕЛКА
 *
 * Поверхность помещения — это один материал одной его детали, и зовётся она
 * так, как её нашли в кадре: `v_66_shop711:m2` — третий материал оболочки
 * магазина, `room:m0` — пол схемы, которую редактор рисует без игры. Имя
 * приходит из модели, а не из реестра, и это не небрежность: состав помещения
 * лежит в файлах Rockstar, а не у нас, и таблица «поверхность → номер»,
 * записанная здесь, разошлась бы с игрой на первом же её обновлении.
 *
 * Отсюда и граница проверки: контракт следит за формой записи и за её
 * размером, а есть ли такая поверхность в помещении — знает только кадр.
 * Не найденную он показывает отдельной строкой, но из макета не выбрасывает:
 * человек мог покрасить магазин, а открыть редактор без установленной игры.
 *
 * Текстура записывается ссылкой, а не картинкой:
 *
 *   — `flat` — снять текстуру вовсе и оставить заливку цветом;
 *   — `room:<поверхность>` — текстура другой поверхности этого же помещения,
 *     то есть настоящая текстура Rockstar, уже приехавшая в кадр;
 *   — `asset:<sha256>` — картинка, которую человек принёс сам; сами байты
 *     лежат в хранилище файлов мастерской, а не в макете.
 *
 * Ни один из вариантов не кладёт в проект ни байта данных игры.
 */
export const INTERIOR_MAX_FINISH_SURFACES = 64;

const HEX_COLOR = /^#[0-9a-f]{6}$/;
const FINISH_TEXTURE =
  /^(?:flat|room:[a-z0-9][a-z0-9._:-]{0,95}|asset:[0-9a-f]{64})$/;

function normalizeFinish(value, index) {
  const path = `design.finish[${index}]`;
  exact(value, ["surfaceId", "color", "texture"], path);
  const color =
    typeof value.color === "string" ? value.color.toLowerCase() : "";
  if (color && !HEX_COLOR.test(color))
    throw new TypeError(`${path}.color: ожидался цвет вида #rrggbb.`);
  const texture = typeof value.texture === "string" ? value.texture : "";
  if (texture && !FINISH_TEXTURE.test(texture))
    throw new TypeError(
      `${path}.texture: ожидалось flat, room:<поверхность> или asset:<sha256>.`,
    );
  return {
    surfaceId: safeId(value.surfaceId, `${path}.surfaceId`),
    color,
    texture,
  };
}

/**
 * Поднять макет прошлой версии до текущей.
 *
 * Единственный переход, который умеет быть: 1 → 2, добавление пустой отделки.
 * Всё остальное отдаётся как есть — строгая нормализация сама скажет, что
 * версия не поддерживается, и скажет это точнее, чем догадка здесь.
 */
export function upgradeInteriorDesign(value) {
  if (!value || typeof value !== "object") return value;
  if (value.schemaVersion !== 1) return value;
  return { ...value, schemaVersion: 2, finish: [] };
}

export function normalizeInteriorDesign(input) {
  /*
   * Формат и версия проверяются ПЕРВЫМИ, до состава полей.
   *
   * Макет прошлой версии отличается от нынешнего ровно составом полей, и
   * проверка состава сообщала бы про него «design.finish: поле обязательно» —
   * то есть про следствие вместо причины. Тот, кто открывает вчерашний проект,
   * должен услышать, что проект вчерашний, и позвать `upgradeInteriorDesign`.
   */
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("design: ожидался объект.");
  if (input.format !== INTERIOR_DESIGN_FORMAT)
    throw new TypeError("design.format: формат проекта не поддерживается.");
  if (input.schemaVersion !== INTERIOR_DESIGN_SCHEMA_VERSION)
    throw new TypeError(
      "design.schemaVersion: версия проекта не поддерживается.",
    );
  exact(
    input,
    [
      "format",
      "schemaVersion",
      "id",
      "name",
      "templateRef",
      "catalogRevision",
      "locationBinding",
      "revision",
      "createdAt",
      "updatedAt",
      "settings",
      "entities",
      "finish",
    ],
    "design",
  );
  exact(input.templateRef, ["id", "version"], "design.templateRef");
  exact(input.locationBinding, ["locationId"], "design.locationBinding");
  exact(input.settings, ["snap", "rotationSnap"], "design.settings");
  const locationId = safeId(
    input.locationBinding.locationId,
    "design.locationBinding.locationId",
  );
  const location = getInteriorLocation(locationId);
  const templateId = safeId(input.templateRef.id, "design.templateRef.id");
  const templateVersion = finite(
    input.templateRef.version,
    "design.templateRef.version",
    1,
    1000,
  );
  if (
    !Number.isInteger(templateVersion) ||
    !getInteriorTemplate(templateId, templateVersion)
  )
    throw new TypeError("design.templateRef: шаблон не найден.");
  if (
    !location ||
    location.templateId !== templateId ||
    location.templateVersion !== templateVersion
  )
    throw new TypeError(
      "design.locationBinding: локация не соответствует шаблону.",
    );
  if (
    !Array.isArray(input.entities) ||
    input.entities.length > INTERIOR_MAX_ENTITIES
  )
    throw new TypeError(
      `design.entities: допускается не более ${INTERIOR_MAX_ENTITIES} объектов.`,
    );
  if (
    !Array.isArray(input.finish) ||
    input.finish.length > INTERIOR_MAX_FINISH_SURFACES
  )
    throw new TypeError(
      `design.finish: допускается не более ${INTERIOR_MAX_FINISH_SURFACES} поверхностей.`,
    );
  const entities = input.entities.map(normalizeEntity);
  const ids = new Set();
  for (const entity of entities) {
    if (ids.has(entity.id))
      throw new TypeError(`design.entities: дубликат ${entity.id}.`);
    ids.add(entity.id);
    if (!getInteriorProp(entity.propId))
      throw new TypeError(`design.entities.${entity.id}: неизвестный propId.`);
  }
  const result = {
    format: INTERIOR_DESIGN_FORMAT,
    schemaVersion: INTERIOR_DESIGN_SCHEMA_VERSION,
    id: safeId(input.id, "design.id"),
    name: text(input.name, "design.name", 1, 100),
    templateRef: { id: templateId, version: templateVersion },
    catalogRevision: safeId(input.catalogRevision, "design.catalogRevision"),
    locationBinding: { locationId },
    revision: finite(input.revision, "design.revision", 0, 2_147_483_647),
    createdAt: isoDate(input.createdAt, "design.createdAt"),
    updatedAt: isoDate(input.updatedAt, "design.updatedAt"),
    settings: {
      snap: finite(input.settings.snap, "design.settings.snap", 0.05, 0.5),
      rotationSnap: finite(
        input.settings.rotationSnap,
        "design.settings.rotationSnap",
        15,
        90,
      ),
    },
    entities,
    /*
     * Порядок задаётся здесь, а не тем, в каком порядке человек красил.
     * Хэш макета считается по канонической записи, и две одинаковые отделки,
     * набранные разными путями, обязаны дать один хэш — иначе подготовленный
     * план установки протухал бы от перестановки двух кисточек.
     *
     * Пустая запись выбрасывается по той же причине: «цвет снят и текстура
     * снята» — это отсутствие отделки, а не отделка «ничем».
     */
    finish: input.finish
      .map(normalizeFinish)
      .filter((item) => item.color || item.texture)
      .sort((left, right) => (left.surfaceId < right.surfaceId ? -1 : 1)),
  };
  const painted = new Set();
  for (const item of result.finish) {
    if (painted.has(item.surfaceId))
      throw new TypeError(`design.finish: дубликат ${item.surfaceId}.`);
    painted.add(item.surfaceId);
  }
  if (
    !Number.isInteger(result.revision) ||
    ![0.05, 0.1, 0.25, 0.5].includes(result.settings.snap) ||
    ![15, 45, 90].includes(result.settings.rotationSnap)
  )
    throw new TypeError("design.settings: неподдерживаемый шаг привязки.");
  /*
   * Лимит проверяется сначала оценкой, а кодированием — только если оценка не
   * прошла.
   *
   * Кодировать весь макет в UTF-8 ради одной длины стоило половины времени всей
   * нормализации (0.10 мс из 0.22 на ста двадцати восьми предметах), а
   * нормализация зовётся по четыре раза на каждую правку. Оценка верхняя и
   * потому безопасная: в UTF-8 одна кодовая единица UTF-16 занимает не больше
   * трёх байт, а суррогатная пара — четыре байта на две единицы, то есть по
   * два. Не прошла оценка — считаем точно, и только тогда.
   */
  const json = JSON.stringify(result);
  if (
    json.length * 3 > INTERIOR_MAX_JSON_BYTES &&
    utf8Bytes(json) > INTERIOR_MAX_JSON_BYTES
  )
    throw new TypeError("design: проект превышает лимит 512 КиБ.");
  return result;
}

/* Кодировщик заводится один раз: он не хранит состояния, а новый на каждый
   вызов — это объект на каждую нормализацию. */
const encoder = new TextEncoder();
const utf8Bytes = (value) => encoder.encode(value).length;

const randomId = () => {
  const values = new Uint32Array(2);
  globalThis.crypto?.getRandomValues?.(values);
  if (values.every((value) => value === 0))
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return [...values]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
};

export function createInteriorDesign({
  id = `interior-${randomId()}`,
  name = "Мой интерьер",
  locationId = "shop-247-sc1-03",
  presetId = "blank",
  now = new Date().toISOString(),
} = {}) {
  const location = getInteriorLocation(locationId);
  const preset = getInteriorPreset(presetId);
  if (!location || !preset)
    throw new TypeError("Неизвестная локация или пресет.");
  const entities = preset.entities.map(([propId, x, y, yaw], index) => ({
    id: `entity-${index + 1}`,
    propId,
    position: { x, y, z: 0 },
    rotation: yawToQuaternion(yaw),
    surfaceId: "floor",
    editor: { locked: false, hidden: false, groupId: null },
  }));
  return normalizeInteriorDesign({
    format: INTERIOR_DESIGN_FORMAT,
    schemaVersion: INTERIOR_DESIGN_SCHEMA_VERSION,
    id,
    name,
    templateRef: { id: location.templateId, version: location.templateVersion },
    catalogRevision: INTERIOR_CATALOG_REVISION,
    locationBinding: { locationId },
    revision: 0,
    createdAt: now,
    updatedAt: now,
    settings: { snap: 0.25, rotationSnap: 45 },
    entities,
    finish: [],
  });
}

export function createInteriorModuleConfiguration({
  projectId = `workshop-${randomId()}`,
  projectName = "Мой интерьер",
  locationId,
  presetId,
  now,
} = {}) {
  return {
    design: createInteriorDesign({
      id: `interior-${String(projectId)
        .replace(/[^a-z0-9._:-]/gi, "-")
        .toLowerCase()}`,
      name: projectName,
      locationId,
      presetId,
      now,
    }),
    legacyPreviewSettings: null,
  };
}

export function migrateInteriorModuleConfiguration(value, options = {}) {
  if (value?.design)
    return {
      design: normalizeInteriorDesign(upgradeInteriorDesign(value.design)),
      legacyPreviewSettings: value.legacyPreviewSettings || null,
    };
  const legacyKeys = [
    "lighting",
    "temperature",
    "propScale",
    "snap",
    "doors",
    "timecycle",
  ];
  const legacyPreviewSettings =
    value && legacyKeys.some((key) => Object.hasOwn(value, key))
      ? Object.fromEntries(
          legacyKeys
            .filter((key) => Object.hasOwn(value, key))
            .map((key) => [key, value[key]]),
        )
      : null;
  return {
    ...createInteriorModuleConfiguration(options),
    legacyPreviewSettings,
  };
}

/*
 * Правки записей идут поверхностной пересборкой, а не глубокой копией.
 *
 * `structuredClone` всего макета стоил половины всей правки (0.27 мс из 0.53 на
 * ста двадцати восьми предметах), и обе половины делали одно и то же: копию
 * дерева. Нормализация ниже всё равно строит каждый объект заново, поэтому
 * копия до неё нужна ровно для одного — не тронуть вход. Собрать новой одну
 * изменённую запись дешевле в двести раз.
 *
 * Мутировать найденную запись при этом нельзя: тот же объект лежит в стеке
 * отмены студии, и правка на месте испортила бы прошлый шаг истории.
 */
export function updateInteriorEntity(
  design,
  entityId,
  patch,
  now = new Date().toISOString(),
) {
  if (!design.entities.some((item) => item.id === entityId))
    throw new TypeError(`Объект ${entityId} не найден.`);
  const next = {
    ...design,
    updatedAt: now,
    revision: design.revision + 1,
    entities: design.entities.map((item) =>
      item.id === entityId
        ? {
            ...item,
            position: patch.position
              ? { ...item.position, ...patch.position }
              : item.position,
            rotation:
              patch.yaw !== undefined
                ? yawToQuaternion(patch.yaw)
                : item.rotation,
            editor: patch.editor
              ? { ...item.editor, ...patch.editor }
              : item.editor,
          }
        : item,
    ),
  };
  return normalizeInteriorDesign(next);
}

export function addInteriorEntity(
  design,
  propId,
  {
    x = 0,
    y = 0,
    z = 0,
    yaw = 0,
    id = `entity-${randomId()}`,
    now = new Date().toISOString(),
  } = {},
) {
  if (!getInteriorProp(propId))
    throw new TypeError("Объект отсутствует в безопасном каталоге.");
  const next = {
    ...design,
    updatedAt: now,
    revision: design.revision + 1,
    entities: [
      ...design.entities,
      {
        id,
        propId,
        position: { x, y, z },
        rotation: yawToQuaternion(yaw),
        surfaceId: "floor",
        editor: { locked: false, hidden: false, groupId: null },
      },
    ],
  };
  return normalizeInteriorDesign(next);
}

export function removeInteriorEntity(
  design,
  entityId,
  now = new Date().toISOString(),
) {
  const entities = design.entities.filter((item) => item.id !== entityId);
  if (entities.length === design.entities.length)
    throw new TypeError(`Объект ${entityId} не найден.`);
  const next = {
    ...design,
    updatedAt: now,
    revision: design.revision + 1,
    entities,
  };
  return normalizeInteriorDesign(next);
}

export function duplicateInteriorEntity(
  design,
  entityId,
  now = new Date().toISOString(),
) {
  const source = design.entities.find((item) => item.id === entityId);
  if (!source) throw new TypeError(`Объект ${entityId} не найден.`);
  return addInteriorEntity(design, source.propId, {
    x: source.position.x + design.settings.snap,
    y: source.position.y + design.settings.snap,
    z: source.position.z,
    yaw: quaternionToYaw(source.rotation),
    now,
  });
}

/**
 * Покрасить поверхность помещения или снять с неё краску.
 *
 * Патч частичный: `{ color }` меняет цвет и не трогает текстуру, `{ texture }`
 * — наоборот. Пустая строка в поле означает «вернуть, как в игре», и запись,
 * у которой не осталось ни цвета, ни текстуры, уходит из макета сама
 * (`normalizeInteriorDesign`) — иначе проект копил бы следы от каждой
 * поверхности, к которой человек однажды прикоснулся.
 *
 * Поверхность не проверяется по списку: помещение лежит в файлах игры, а не в
 * реестре, и единственный, кто знает его состав, — кадр. Форму записи и
 * потолок в шестьдесят четыре поверхности контракт проверяет сам.
 */
export function updateInteriorFinish(
  design,
  surfaceId,
  patch,
  now = new Date().toISOString(),
) {
  const current = design.finish.find(
    (item) => item.surfaceId === surfaceId,
  ) || {
    surfaceId,
    color: "",
    texture: "",
  };
  const painted = {
    surfaceId,
    color: patch?.color === undefined ? current.color : patch.color || "",
    texture:
      patch?.texture === undefined ? current.texture : patch.texture || "",
  };
  const next = {
    ...design,
    updatedAt: now,
    revision: design.revision + 1,
    finish: [
      ...design.finish.filter((item) => item.surfaceId !== surfaceId),
      painted,
    ],
  };
  return normalizeInteriorDesign(next);
}

/** Снять всю отделку разом: вернуть помещению вид из игры. */
export function clearInteriorFinish(design, now = new Date().toISOString()) {
  if (!design.finish.length) return design;
  return normalizeInteriorDesign({
    ...design,
    updatedAt: now,
    revision: design.revision + 1,
    finish: [],
  });
}

export function hashInteriorDesign(design) {
  return canonicalSha256(normalizeInteriorDesign(design));
}

export function inspectInteriorDesign(design) {
  const normalized = normalizeInteriorDesign(design);
  return {
    design: normalized,
    report: validateInteriorDesign(normalized),
    hash: hashInteriorDesign(normalized),
  };
}
