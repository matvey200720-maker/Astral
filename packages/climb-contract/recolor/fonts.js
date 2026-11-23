/*
 * «Шрифты» мастерской: свой шрифт в текстах самой игры.
 *
 * Как устроено в GTA V (исследовано по файлам игры, 03.10.2026): тексты
 * игры (меню паузы, подсказки, уведомления, субтитры, карта, надписи,
 * которые сервер рисует игрой) берут шрифт по имени из `fontmap.xml`
 * (`$Font2` → Chalet London, `$Font2_cond` → Chalet Comprime, `$gtaCash` →
 * Pricedown, `$Font5` → SignPainter), а сам шрифт — из библиотек Scaleform
 * `update.rpf/x64/data/cdimages/scaleform_platform_pc.rpf/font_lib_efigs_pc.gfx`
 * и `scaleform_generic.rpf/font_lib_efigs.gfx` (тег DefineCompactedFont).
 * Свой шрифт встаёт в эти записи под теми же именами (`@modovik/font-studio`),
 * поэтому его видят одиночная игра и все платформы серверов, которые грузят
 * файлы игры: alt:V (Majestic), RAGE Multiplayer (GTA 5 RP, Radmir) и другие.
 * Окна сервера в браузере (CEF/WebView) рисуются шрифтами сервера — их
 * файлы игры не меняют.
 *
 * Что настраивается — только то, что живёт в файле шрифта: размер (высота
 * заглавных относительно штатной), ширина букв, толщина (сдвиг контуров),
 * интервал между буквами, наклон, подъём и межстрочный. Обводку, тень,
 * цвет и прозрачность текста рисует игра сама у каждого текста по команде
 * сервера или скрипта — в шрифте их нет, и окно говорит это прямо.
 *
 * Свой шрифт встаёт во все шрифты игры сразу — на всех серверах (владелец,
 * 04.10.2026: выбора сервера нет, файл у всех один).
 */

export const FONTS_PROJECT_SCHEMA = 1;
const NAME_LIMIT = 60;

/*
 * Шрифты игры, на место которых встаёт свой: имя экспорта библиотеки, что
 * в нём пишется, и мерки штатного шрифта (кегль 256) — для предпросмотра
 * (установщик берёт их из файла игрока).
 */
export const GAME_FONT_TARGETS = Object.freeze([
  Object.freeze({ id: "main", export: "$Font2", label: "Основной", game: "Chalet London", note: "Меню паузы, подсказки, субтитры, карта", metrics: Object.freeze({ cap: 179, ascent: 245, descent: 64, leading: 54, nominal: 256 }) }),
  Object.freeze({ id: "condensed", export: "$Font2_cond", label: "Узкий", game: "Chalet Comprime", note: "Уведомления, интерфейс, надписи над игроками", metrics: Object.freeze({ cap: 166, ascent: 223, descent: 50, leading: 17, nominal: 256 }) }),
  Object.freeze({ id: "cash", export: "$gtaCash", label: "Деньги и заголовки", game: "Pricedown", note: "Деньги, «Миссия выполнена», крупные заголовки", metrics: Object.freeze({ cap: 202, ascent: 202, descent: 61, leading: 7, nominal: 256 }) }),
  Object.freeze({ id: "script", export: "$Font5", label: "Рукописный", game: "SignPainter", note: "Титры и подписи от руки", metrics: Object.freeze({ cap: 160, ascent: 195, descent: 100, leading: 39, nominal: 256 }) }),
]);
const TARGET_IDS = GAME_FONT_TARGETS.map((item) => item.id);

/* Пределы настроек: у каждого ползунка — поле числом с теми же пределами. */
export const FONT_LIMITS = Object.freeze({
  size: Object.freeze({ min: 60, max: 160, step: 1, unit: "%", label: "Размер" }),
  width: Object.freeze({ min: 60, max: 160, step: 1, unit: "%", label: "Ширина" }),
  weight: Object.freeze({ min: -15, max: 40, step: 1, unit: "", label: "Толщина" }),
  spacing: Object.freeze({ min: -60, max: 200, step: 1, unit: "", label: "Интервал между буквами" }),
  slant: Object.freeze({ min: -20, max: 20, step: 1, unit: "°", label: "Наклон" }),
  baseline: Object.freeze({ min: -30, max: 30, step: 1, unit: "%", label: "Подъём" }),
  leading: Object.freeze({ min: -30, max: 60, step: 1, unit: "%", label: "Межстрочный" }),
});
export const FONT_SETTING_IDS = Object.freeze(Object.keys(FONT_LIMITS));
export const DEFAULT_FONT_SETTINGS = Object.freeze({ size: 100, width: 100, weight: 0, spacing: 0, slant: 0, baseline: 0, leading: 0 });
const DEFAULT_SETTINGS = DEFAULT_FONT_SETTINGS;

/*
 * Готовые шаблоны — шрифты Windows, которые есть у каждого игрока: Astral
 * их не возит, установщик берёт файл из папки шрифтов этого компьютера.
 * У каждого — свои настройки под игру; `weight` — начертание для подписи
 * плитки в окне (тот же файл, что уедет в игру).
 */
export const FONT_TEMPLATES = Object.freeze(
  [
    { id: "modern", label: "Современный", family: "Segoe UI", file: "segoeui.ttf", weight: 400, settings: { size: 98, weight: 2, spacing: 4 } },
    { id: "bold", label: "Жирный", family: "Segoe UI", file: "segoeuib.ttf", weight: 700, settings: { size: 98, weight: 0, spacing: 6 } },
    { id: "strict", label: "Строгий", family: "Bahnschrift", file: "bahnschrift.ttf", weight: 400, settings: { size: 100, weight: 4, spacing: 8 } },
    { id: "narrow", label: "Узкий", family: "Arial Narrow", file: "ARIALN.TTF", weight: 400, settings: { size: 104, weight: 4, spacing: 6 } },
    { id: "poster", label: "Плакатный", family: "Impact", file: "impact.ttf", weight: 400, settings: { size: 96, weight: 0, spacing: 10 } },
    { id: "newspaper", label: "Газетный", family: "Franklin Gothic Medium", file: "framd.ttf", weight: 400, settings: { size: 100, weight: 0, spacing: 4 } },
    { id: "serif", label: "С засечками", family: "Georgia", file: "georgia.ttf", weight: 400, settings: { size: 96, weight: 6, spacing: 6 } },
    { id: "mono", label: "Моноширинный", family: "Consolas", file: "consola.ttf", weight: 400, settings: { size: 100, weight: 4, spacing: 0 } },
    { id: "comic", label: "Комикс", family: "Comic Sans MS", file: "comic.ttf", weight: 400, settings: { size: 96, weight: 0, spacing: 4 } },
    { id: "hand", label: "От руки", family: "Segoe Print", file: "segoepr.ttf", weight: 400, settings: { size: 92, weight: 0, spacing: 0 } },
  ].map((item) => Object.freeze({ ...item, settings: Object.freeze({ ...DEFAULT_SETTINGS, ...item.settings }) })),
);
const TEMPLATE_IDS = FONT_TEMPLATES.map((item) => item.id);

const plain = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

function clampSetting(id, value, fallback) {
  const limit = FONT_LIMITS[id];
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.min(limit.max, Math.max(limit.min, number)));
}

export function normalizeFontsProject(input) {
  const source = plain(input);
  const from = plain(source.source);
  const file = plain(from.file);
  const kind = from.kind === "file" ? "file" : "template";
  const settings = plain(source.settings);
  return {
    schema: FONTS_PROJECT_SCHEMA,
    name: String(source.name ?? "")
      .trim()
      .slice(0, NAME_LIMIT),
    enabled: source.enabled === true,
    source: {
      kind,
      template: TEMPLATE_IDS.includes(from.template) ? from.template : FONT_TEMPLATES[0].id,
      file: {
        asset: /^font-file:[a-f0-9]{64}$/.test(String(file.asset || "")) ? file.asset : "",
        name: String(file.name ?? "").slice(0, 120),
        family: String(file.family ?? "").slice(0, 120),
      },
    },
    /* Все шрифты игры — у всех серверов файл один, выбора нет. */
    targets: Object.fromEntries(TARGET_IDS.map((id) => [id, true])),
    settings: Object.fromEntries(FONT_SETTING_IDS.map((id) => [id, clampSetting(id, settings[id], DEFAULT_SETTINGS[id])])),
  };
}

export const createFontsProject = () => normalizeFontsProject({});
export const serializeFontsProject = (project) => JSON.stringify(normalizeFontsProject(project));

export function parseFontsProject(text) {
  try {
    return normalizeFontsProject(typeof text === "string" ? JSON.parse(text) : text);
  } catch {
    return createFontsProject();
  }
}

/** Выбранные шрифты игры (ids по порядку). */
export const fontTargetsOf = (input) => {
  const project = normalizeFontsProject(input);
  return TARGET_IDS.filter((id) => project.targets[id]);
};

/** Свой файл выбран, но его нет — ставить нечем. */
export const fontsSourceMissing = (input) => {
  const project = normalizeFontsProject(input);
  return project.source.kind === "file" && !project.source.file.asset;
};

/** Шрифты как в игре: ставить нечего, «Применить» снимает свои. */
export function fontsProjectIsVanilla(input) {
  const project = normalizeFontsProject(input);
  return !project.enabled || !fontTargetsOf(project).length || fontsSourceMissing(project);
}

/** Отпечаток для очереди «Применить»: тот же облик — тот же отпечаток. */
export function fontsProjectSignature(input) {
  const project = normalizeFontsProject(input);
  if (fontsProjectIsVanilla(project)) return JSON.stringify({ vanilla: true });
  return JSON.stringify({
    source: project.source.kind === "file" ? { file: project.source.file.asset } : { template: project.source.template },
    targets: fontTargetsOf(project),
    settings: project.settings,
  });
}

/** Работа для кода другу: свой файл шрифта не едет — у друга будет шаблон. */
export function shareableFontsProject(input) {
  const project = normalizeFontsProject(input);
  if (project.source.kind !== "file") return project;
  return { ...project, source: { ...project.source, kind: "template", file: { asset: "", name: "", family: "" } } };
}

export const fontsLostInCode = (input) => {
  const project = normalizeFontsProject(input);
  return project.source.kind === "file" && project.source.file.asset ? "свой файл шрифта — у друга будет шаблон" : "";
};

/** Шаблон по id (или первый). */
export const fontTemplate = (id) => FONT_TEMPLATES.find((item) => item.id === id) || FONT_TEMPLATES[0];

/** Работа со своим шаблоном: шрифт и его настройки, остальное — как было. */
export function applyFontTemplate(input, templateId) {
  const project = normalizeFontsProject(input);
  const template = fontTemplate(templateId);
  return normalizeFontsProject({ ...project, enabled: true, source: { ...project.source, kind: "template", template: template.id }, settings: { ...template.settings } });
}
