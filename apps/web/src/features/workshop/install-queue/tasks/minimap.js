/*
 * Мини-карта в игру.
 *
 * Раньше это была разметка окна на пятьсот восемьдесят строк: сводка, шаги,
 * полоса, предупреждения, итог и кнопка «Повторить установку» после успеха.
 * Здесь осталась только работа — собрать картинки проекта, поставить пакет и
 * записать установку. Всё, что окно рассказывало, рассказывает строка на
 * экране «В процессе», и рассказывает одинаково для всех редакторов.
 *
 * ПОЧЕМУ БОЛЬШЕ НЕТ ПЛАНА
 *
 * Окно сначала звало `planMinimapCustomization`, потом `applyMinimap…`. План
 * собирает пакет целиком — читает базу из архива игрока, компилирует
 * `minimap.gfx`, считает SHA-256 — и установка после него собирает то же
 * самое второй раз. Показывать человеку эти числа было ради чего, пока он
 * стоял перед кнопкой «Создать backup и применить»; кнопки больше нет, и
 * второй сборки тоже. Проверкой пакета это не жертвует: `install-rpf-patch`
 * сам зовёт `ValidatePatchAsync` до первой записи в архив.
 */

import {
  describeGameScreen,
  HUD_SCREEN_FORMULA,
} from "@modovik/minimap-contract";
import {
  applyMinimapCustomization,
  readGameSettings,
} from "../../../../api.js";
import { tr } from "../../../../locales/ui.js";
import { MINIMAP_BUILTIN_ICONS } from "../../../../components/desktop/workshop/minimap-layout.js";
import {
  getWorkshopAsset,
  workshopBlobBytes,
} from "../../../../components/desktop/workshop/workshop-assets.js";
import { locateLegacyGame } from "../game-root.js";
import { recordNativeInstall } from "../native-record.js";
import { journalReconcile } from "../reconcile-journal.js";

export const MINIMAP_INSTALL_KIND = "native-minimap";

/* Килобайт на картинку — столько же, сколько принимал компилятор. */
const MAX_ASSET_BYTES = 1024 * 1024;

/* Картинки — так, как их зовут поля редактора, а не ключами пакета. */
const SLOT_LABELS = Object.freeze({
  damage: "Своя картинка урона",
  healthIcon: "Свой значок HP",
  armorIcon: "Свой значок брони",
  playerMarker: "Своя стрелка",
  othersMarker: "Своя метка других игроков",
  healthFill: "Видео заливки HP",
  armorFill: "Видео заливки брони",
});

/* Фраза со вставкой — шаблоном словаря: целиком её слой перевода не узнаёт. */
const fill = (text, value) => tr(text).replace("{0}", () => value);

function bytesToBase64(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return globalThis.btoa(binary);
}

export async function collectMinimapImageAssets(project, configuration) {
  const widgets = configuration.layout?.widgets || {};
  /* Значки нужны не только свободным значкам: сердце и щит на самих полосах
     — те же картинки. Выключатель выключен, пока его не включили, — как в
     редакторе и в компиляторе. */
  const barIcons =
    configuration.effects?.barIcons === true &&
    (widgets.healthBar?.visible !== false ||
      widgets.armorBar?.visible !== false);
  const wantsIcons =
    widgets.healthIcon?.visible === true ||
    widgets.armorIcon?.visible === true ||
    barIcons;
  /* Стрелку и картинку урона компилятор берёт только у видимой карты, а
     стрелку — только «Свою»: номер прежней картинки остаётся в проекте и
     после «Как в игре», и требовать её файл установка не должна. */
  const mapShown = configuration.layout?.map?.hidden !== true;
  const fields = {
    damage: mapShown ? configuration.effects?.damageAssetId : "",
    healthIcon:
      wantsIcons && configuration.effects?.healthIconPreset === "custom"
        ? configuration.effects?.healthIconAssetId
        : "",
    armorIcon:
      wantsIcons && configuration.effects?.armorIconPreset === "custom"
        ? configuration.effects?.armorIconAssetId
        : "",
    playerMarker:
      mapShown && configuration.effects?.playerMarkerMode === "custom"
        ? configuration.effects?.playerMarkerAssetId
        : "",
    /* Своя метка других игроков (задача 1 ТЗ 17.10.2026) — у видимой карты. */
    othersMarker:
      mapShown && configuration.effects?.othersMode === "custom"
        ? configuration.effects?.othersAssetId
        : "",
    /* Своё видео заливки — лист кадров, только у видимой полосы. */
    healthFill:
      widgets.healthBar?.visible !== false &&
      configuration.effects?.healthFill?.mode === "video"
        ? configuration.effects.healthFill.video?.assetId
        : "",
    armorFill:
      widgets.armorBar?.visible !== false &&
      configuration.effects?.armorFill?.mode === "video"
        ? configuration.effects.armorFill.video?.assetId
        : "",
  };
  const result = {};
  if (wantsIcons) {
    for (const [slot, kind, preset] of [
      [
        "healthIcon",
        "health",
        configuration.effects?.healthIconPreset || "heart",
      ],
      [
        "armorIcon",
        "armor",
        configuration.effects?.armorIconPreset || "shield",
      ],
    ]) {
      if (preset === "custom") continue;
      const source = MINIMAP_BUILTIN_ICONS[kind].find(
        (item) => item.id === preset,
      )?.src;
      if (!source) throw new Error(`Шаблон значка «${preset}» не найден.`);
      const response = await fetch(source);
      if (!response.ok)
        throw new Error(`Не удалось загрузить шаблон «${preset}».`);
      result[slot] = bytesToBase64(
        new Uint8Array(await response.arrayBuffer()),
      );
    }
  }
  for (const [slot, assetId] of Object.entries(fields)) {
    if (!assetId) continue;
    const asset = project.assets?.find((item) => item.id === assetId);
    /* Подпись и фраза переводятся при сборке сообщения: оно уходит в уведомление как есть. */
    const label = tr(SLOT_LABELS[slot] || slot);
    if (!asset?.storageKey)
      throw new Error(
        fill("Файл «{0}» отсутствует в проекте. Загрузите его заново.", label),
      );
    const blob = await getWorkshopAsset(asset.storageKey);
    if (!blob)
      throw new Error(
        fill("Файл «{0}» не найден в локальном хранилище.", label),
      );
    const bytes = await workshopBlobBytes(blob);
    if (bytes.byteLength > MAX_ASSET_BYTES)
      throw new Error(fill("Файл «{0}» больше 1 МБ.", asset.name || slot));
    result[slot] = bytesToBase64(bytes);
  }
  /* Свои картинки на карте (задача 1 ТЗ 17.10.2026): лист кадров каждой,
     под номером элемента. */
  const pictures = (
    Array.isArray(configuration.overlays) ? configuration.overlays : []
  ).filter(
    (item) =>
      item?.visible !== false && item?.kind === "image" && item.image?.assetId,
  );
  if (pictures.length) result.overlays = {};
  for (const overlay of pictures) {
    const label = overlay.image.name || overlay.id;
    const asset = project.assets?.find(
      (item) => item.id === overlay.image.assetId,
    );
    if (!asset?.storageKey)
      throw new Error(
        `${tr("Картинки на карте нет в проекте — загрузите её заново")}: ${label}`,
      );
    const blob = await getWorkshopAsset(asset.storageKey);
    if (!blob)
      throw new Error(
        `${tr("Картинки на карте нет в локальном хранилище")}: ${label}`,
      );
    const bytes = await workshopBlobBytes(blob);
    if (bytes.byteLength > MAX_ASSET_BYTES)
      throw new Error(`Файл «${label}» больше 1 МБ.`);
    result.overlays[overlay.id] = bytesToBase64(bytes);
  }
  /* Своя картинка метки GPS (задача 10 ТЗ 10.10.2026, вечер) — квадрат PNG
     в хранилище мастерской под отпечатком, как у прежних «Меток и GPS». */
  const gpsMarker = configuration.gps?.marker;
  if (gpsMarker?.icon === "custom" && gpsMarker.assetId) {
    const { gpsIconPicturePng } = await import("../../gps-editor/gps-icons.js");
    const png = await gpsIconPicturePng(gpsMarker.assetId).catch(() => null);
    if (!png)
      throw new Error(
        "Своей картинки метки GPS нет на этом компьютере — выберите её заново в «Метке GPS».",
      );
    result.gpsMarker = png;
  }
  return result;
}

/** Метка и маршрут GPS, что ушли с мини-картой, — словами для «В процессе». */
export function minimapGpsNote(installed) {
  const summary = installed?.gps?.summary;
  return summary ? `метка и маршрут: ${summary}` : "";
}

/* Что из проекта в игру не уходит — ключи `unsupportedFeatures` в
   apps/desktop/src/minimap-gfx-compiler.js. Длительность вспышки и
   вылетающие цифры урона с задачи 8 ТЗ 10.10.2026 уходят в игру. */
const UNSUPPORTED_LABELS = {
  "bar-style": "свой фон и скругление полос",
  "vitals-animation": "градиент и пульс полосы HP",
  "player-tag": "подпись под картой",
  "transparent-background": "прозрачный фон карты",
};

/** Чего человек не увидит в игре из того, что видел в предпросмотре. */
export function minimapWarnings(installed) {
  const notes = [];
  const unsupported = (installed?.unsupported || [])
    .map((key) => UNSUPPORTED_LABELS[key] || key)
    .join(" · ");
  if (unsupported)
    notes.push(`только в предпросмотре осталось: ${unsupported}`);
  /* Размытие убирается третьим файлом — маской в graphics.ytd игрока. Не
     вышло — мини-карта всё равно встала, но знать об этом человек должен. */
  if (installed?.blur?.mode === "none" && !installed.blur.removed)
    notes.push("размытие вокруг карты осталось штатным");
  /* Слова расстояния (задача 1 ТЗ 17.10.2026) — таблицы текста игры. */
  if (installed?.distance?.active && !installed.distance.languages)
    notes.push(
      tr("слова расстояния остались игры: таблицы текста не прочитались"),
    );
  /* Непрозрачность карты — та же маска (задача 1 ТЗ 17.10.2026). */
  if (
    installed?.blur?.opacity !== null &&
    installed?.blur?.opacity !== undefined &&
    !installed.blur.removed
  )
    notes.push(tr("непрозрачность карты осталась как в игре"));
  /* Дальность радара пишется поверх таблицы ступеней самого игрока. Её не
     прочитать — дальность всё равно записана, но поверх чисел Rockstar, и
     чужое отдаление большой карты из этого файла могло не пережить. */
  if (installed?.zoom?.active && installed.zoom.base === "built-in")
    notes.push(
      "таблица ступеней радара собрана из штатных чисел: файл игры не прочитался",
    );
  return notes;
}

/** Дальность радара словами для строки «В процессе» и уведомления. */
export function minimapZoomNote(installed) {
  const zoom = installed?.zoom;
  if (!zoom?.active) return "";
  const parts = [];
  if (zoom.onFoot !== 1) parts.push(`пешком ×${zoom.onFoot}`);
  if (zoom.inVehicle !== 1) parts.push(`в машине ×${zoom.inVehicle}`);
  return parts.length ? `дальность радара ${parts.join(", ")}` : "";
}

/*
 * Под какой экран поставлена карта — `tasks/minimap-screen-apply.js`: сменилось что-то в игре, и карта при запуске встаёт
 * заново. Метка (ТЗ H1, 14.11.2026) — три части через «|»: форма экрана (с точностью, которой хватает отличить форматы друг от
 * друга), безопасная зона (отступ игры) и версия формулы расчёта места (`HUD_SCREEN_FORMULA`). Прежняя метка была одной формой
 * («1.778»): её читаем как метку без отступа и формулы — при первом запуске карта встанет заново и метка станет полной.
 * Пишет любая удачная установка.
 */
const SCREEN_MARK_KEY = "modovik-minimap-game-aspect";

export function readMinimapScreenMark() {
  try {
    return globalThis.localStorage?.getItem(SCREEN_MARK_KEY) || "";
  } catch {
    return "";
  }
}

export function writeMinimapScreenMark(value) {
  try {
    globalThis.localStorage?.setItem(SCREEN_MARK_KEY, value);
  } catch {
    /* Без метки проверка повторится при следующем запуске. */
  }
}

/** Метка экрана из объекта экрана игры (`gameScreen` ответа `readGameSettings`); экран неизвестен — пусто. */
export function minimapScreenMark(gameScreen) {
  const screen = describeGameScreen(gameScreen);
  if (!screen.known || !(screen.aspect > 0)) return "";
  return [
    screen.aspect.toFixed(3),
    screen.inset.toFixed(4),
    HUD_SCREEN_FORMULA,
  ].join("|");
}

/**
 * Что изменилось между прежней меткой и нынешней: `{ form, safeZone, formula }`. У метки прежнего вида (одна форма)
 * известна только форма; безопасная зона и формула у неё «не те» — карта встанет заново, но как смена формата это не говорится.
 */
export function minimapScreenMarkChange(stored, current) {
  const [oldForm = "", oldInset = "", oldFormula = ""] = String(
    stored || "",
  ).split("|");
  const [form = "", inset = "", formula = ""] = String(current || "").split(
    "|",
  );
  return {
    form: oldForm !== form,
    safeZone: Boolean(oldInset) && oldInset !== inset,
    formula: oldFormula !== formula,
  };
}

export async function currentMinimapScreenMark() {
  const settings = await readGameSettings();
  return minimapScreenMark(settings?.gameScreen);
}

/**
 * Собрать и поставить мини-карту. Возвращает запись установки.
 *
 * @param {{project: object, configuration: object, report?: Function, trigger?: "apply"|"remap"|"repair"}} input
 *   `trigger` — что запустило установку: «Применить» (`apply`), перестановка при запуске (`remap`) или автопересборка
 *   работы после починки фильма (`repair`).
 */
export async function installMinimap({
  project,
  configuration,
  report,
  trigger = "apply",
}) {
  const gameRoot = await locateLegacyGame(project.gamePath);
  const imageAssets = await collectMinimapImageAssets(project, configuration);
  const applied = await applyMinimapCustomization({
    gameRoot,
    configuration,
    imageAssets,
  });
  /* Запись сверки с игрой: работа, версия Astral, что запустило установку — в запись установки и в журнал приложения. */
  const installed = await journalReconcile({
    installed: applied,
    project,
    trigger,
  });
  const record = await recordNativeInstall({
    projectId: project.id,
    kind: MINIMAP_INSTALL_KIND,
    installed,
    gameRoot,
    report,
  });
  const mark = await currentMinimapScreenMark().catch(() => "");
  if (mark) writeMinimapScreenMark(mark);
  return { record, installed };
}
