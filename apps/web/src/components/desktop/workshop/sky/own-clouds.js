/*
 * «Свои облака»: что окно знает о моделях облаков игрока и о личном списке своих шаблонов.
 *
 * Пределы и сама запись — пакет (`cloud-templates.js`: `normalizeOwnCloudTemplate`, `cloudTemplateReport`); здесь только
 * то, чего пакету знать не нужно: как назвать модель человеческим словом, по каким семействам разложить сетку выбора
 * и где хранить личный список, чтобы собрать облако один раз и ставить в разные небеса (как «Мои работы»).
 */

import {
  CLOUD_HAT_TYPES,
  OWN_CLOUD_LIGHTINGS,
  normalizeOwnCloudTemplate,
} from "@modovik/timecycle";

const STORAGE_KEY = "astral.sky.own-clouds.v1";
/* Личный список шире списка проекта: проектов у человека много, а облаков, которые он держит под рукой, — десятки. */
export const PERSONAL_CLOUD_LIMIT = 24;

const lower = (value) => String(value ?? "").toLowerCase();
const isGround = (layer) => !(Number(layer?.heightTrigger) > 0);

/* Шапка → вид из выбора «Свои» (по имени шапки ванили и её запасным шапкам). */
const familyOfHat = (hatName) =>
  CLOUD_HAT_TYPES.find((type) => type.frags.some((frag) => lower(frag) === lower(hatName))) || null;

/*
 * Буква модели из имени файла: `cloudhat_cloudy_c` → «C», `cloudhat_cloudy_base` → «основа», `cloudhat_cirrus` — без
 * буквы (модель одна). Названия моделей Rockstar человеку ничего не говорят, поэтому человек читает «семейство + буква»
 * и смотрит на миниатюру.
 */
export function cloudModelVariant(file) {
  const tail = String(file ?? "")
    .toLowerCase()
    .replace(/^cloudhat_/, "")
    .split("_");
  const last = tail.length > 1 ? tail.at(-1) : "";
  if (last === "base") return "base";
  return /^[a-z]$/.test(last) ? last.toUpperCase() : "";
}

/**
 * Модели облаков из `clouds.xml` игрока, которые можно положить в свой шаблон: видимые с земли слои шапок, по
 * семействам (кучевые, башни, пряди, перистые, барашки, гряды у горизонта, грозовые, следы самолётов…). Модель одна на
 * файл: она может стоять в нескольких шапках, берётся первая. Шапки чужого мода, которых нет в списке видов, —
 * отдельным семейством по имени шапки.
 *
 * @returns {Array<{ id: string, label: string, ru: string|null, models: Array<{ hat: string, file: string, variant: string }> }>}
 */
export function cloudModelFamilies(cloudHats) {
  const families = new Map();
  const seen = new Set();
  /* Шапка-слот (`horizonband3`) носит собранный шаблон — её слои чужие, моделей в ней нет. Полосы у горизонта
     повторяют модели «Кучевых» и «Пухлых» (`horizonband1` держит `cloudhat_clear01_a`), поэтому идут последними:
     модель остаётся у семейства, чьё имя она носит. */
  const hats = (cloudHats?.hats || [])
    .filter((hat) => lower(hat.name) !== "horizonband3")
    .sort((left, right) => /^horizonband/i.test(left.name) - /^horizonband/i.test(right.name));
  for (const hat of hats) {
    const type = familyOfHat(hat.name);
    const id = type ? type.id : `hat:${lower(hat.name)}`;
    for (const layer of hat.layers || []) {
      if (!isGround(layer) || seen.has(lower(layer.file))) continue;
      seen.add(lower(layer.file));
      const family = families.get(id) || {
        id,
        /* Русское слово вида — ключ словаря; шапка мода — её имя как есть. */
        label: type ? type.label.ru : hat.name,
        ru: type ? type.label.ru : null,
        models: [],
      };
      family.models.push({ hat: hat.name, file: layer.file, variant: cloudModelVariant(layer.file) });
      families.set(id, family);
    }
  }
  /* Порядок семейств — как у выбора видов: их знает человек. */
  const order = new Map(CLOUD_HAT_TYPES.map((type, index) => [type.id, index]));
  return [...families.values()].sort((left, right) => (order.get(left.id) ?? 99) - (order.get(right.id) ?? 99));
}

/** Все модели плоским списком — для счёта и поиска. */
export const cloudModelsOf = (families) => families.flatMap((family) => family.models.map((model) => ({ ...model, family })));

/** Какая из шапок игрока «ходит» как описанная человеком: шапки, у которых есть высотные слои, — шапка движения шаблона. */
export function cloudMotionChoices(cloudHats) {
  return (cloudHats?.hats || [])
    .filter((hat) => lower(hat.name) !== "horizonband3" && (hat.layers || []).some((layer) => !isGround(layer)))
    .map((hat) => {
      const type = familyOfHat(hat.name);
      return { hat: hat.name, ru: type ? type.label.ru : null, hint: type ? type.hint.ru : "" };
    });
}

/* --- Личный список --- */

const storage = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

/** Личный список своих облаков: тот, что собран в этом окне и ставится в любое небо. */
export function readPersonalClouds() {
  const memory = storage();
  if (!memory) return [];
  try {
    const raw = JSON.parse(memory.getItem(STORAGE_KEY) || "[]");
    const list = [];
    for (const item of Array.isArray(raw) ? raw : []) {
      const { template } = normalizeOwnCloudTemplate(item);
      if (template && !list.some((known) => known.id === template.id)) list.push(template);
      if (list.length >= PERSONAL_CLOUD_LIMIT) break;
    }
    return list;
  } catch {
    return [];
  }
}

const writePersonal = (list) => {
  const memory = storage();
  if (!memory) return false;
  try {
    /* Только то, из чего шаблон собирается заново (`normalizeOwnCloudTemplate`): подписи и метки он выводит сам. */
    memory.setItem(
      STORAGE_KEY,
      JSON.stringify(list.map(({ id, name, lighting, motion, layers, style }) => ({ id, name, lighting, motion, layers, style }))),
    );
    return true;
  } catch {
    return false;
  }
};

/** Положить шаблон в личный список (замена по номеру). Не вошёл — `false`; список полон — `false`. */
export function rememberPersonalCloud(rawTemplate) {
  const { template } = normalizeOwnCloudTemplate(rawTemplate);
  if (!template) return false;
  const list = readPersonalClouds();
  const exists = list.some((item) => item.id === template.id);
  if (!exists && list.length >= PERSONAL_CLOUD_LIMIT) return false;
  return writePersonal(exists ? list.map((item) => (item.id === template.id ? template : item)) : [...list, template]);
}

/** Убрать шаблон из личного списка. */
export function forgetPersonalCloud(id) {
  return writePersonal(readPersonalClouds().filter((item) => item.id !== id));
}

/**
 * Что показывает ряд «Мои»: шаблоны проекта и личного списка вместе, по номеру; при совпадении — проектный (он
 * ушёл в проект последним и едет с работой).
 */
export function mergeOwnClouds(projectOwn, personal) {
  const merged = [...(projectOwn || [])];
  for (const item of personal || []) if (!merged.some((known) => known.id === item.id)) merged.push(item);
  return merged;
}

/** Отпечаток шаблона для ключа миниатюры: изменился слой, свет или стиль — кадр рисуется заново. */
export function ownCloudSignature(template) {
  return JSON.stringify([template.layers, template.lighting, template.motion, template.style]);
}

/** Свет шаблона словом: какой набор `cloudkeyframes.xml` освещает облака. */
export const CLOUD_LIGHTING_CHOICES = Object.freeze(
  OWN_CLOUD_LIGHTINGS.map((id) => ({
    id,
    label: { LIGHTclouds: "Как у ясного неба", MEDIUMclouds: "Как у облачного", HEAVYclouds: "Как у пасмурного", STORMclouds: "Как у грозового" }[id],
  })),
);

/** Шесть ползунков стиля — человеческими словами, в порядке пакета. */
export const CLOUD_STYLE_CONTROLS = Object.freeze([
  { key: "diffuse", label: "Свет солнца", hint: "Сильнее — у облака светлый бок и тёмное брюхо" },
  { key: "fill", label: "Заливка от неба", hint: "Сколько света облако берёт у неба" },
  { key: "ambient", label: "Свет окружения", hint: "Меньше — облако контрастнее" },
  { key: "edges", label: "Рваные края", hint: "Выше — края резче, облако рваное" },
  { key: "lining", label: "Кайма против солнца", hint: "Серебряная кайма на облаках у солнца" },
  { key: "relief", label: "Рельеф", hint: "Насколько видны клубы" },
]);
