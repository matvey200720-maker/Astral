import { createContext, useEffect, useContext, useState } from "react";
import {
  ArrowFatLineUp,
  Clock,
  CloudRain,
  Crosshair,
  CrosshairSimple,
  Gauge,
  Lightning,
  MapPinLine,
  MapTrifold,
  RadioButton,
  ShieldCheck,
  Sparkle,
  SquaresFour,
  Stack,
  Target,
  Tree,
} from "../../../ui/icons.jsx";

import { getWorkshopAsset } from "../workshop-assets.js";
import { createWorkshopLocalization } from "../workshop-localization.js";
import { tr } from "../../../../locales/ui.js";

/*
 * Общее для всей студии: локализация, иконки, наборы значений и несколько
 * мелких помощников.
 *
 * Три из них — formatWorkshopHour, formatWorkshopBytes и projectMemoryKey —
 * стояли в исходном листе на границах между компонентами, у каждого своего
 * случайного соседа, хотя звали их из трёх-четырёх мест сразу.
 */

const WorkshopLocalizationContext = createContext(
  createWorkshopLocalization("ru"),
);
const useWorkshopLocalization = () => useContext(WorkshopLocalizationContext);

const ICONS = {
  minimap: MapPinLine,
  "world-map": MapTrifold,
  timecycle: Clock,
  arenas: SquaresFour,
  "weapon-effects": Lightning,
  tracers: Sparkle,
  interiors: Stack,
  crosshair: Crosshair,
  "sniper-scope": CrosshairSimple,
  vegetation: Tree,
  hud: Gauge,
  "blips-gps": Target,
  weather: CloudRain,
  impacts: RadioButton,
  "street-lights": Sparkle,
  climbs: ArrowFatLineUp,
};

const TEMPLATE_OPTIONS = [
  ["clean", "Чистый проект", "Только выбранные модули"],
  ["dark", "Тёмный минимализм", "Холодная палитра и компактный HUD"],
  ["competitive", "Competitive", "Читаемый прицел и быстрый радар"],
  ["cinematic", "Cinematic", "Мягкий свет и выразительные эффекты"],
  ["realistic", "Realistic", "Сдержанные естественные цвета"],
  ["neon", "Neon", "Ночной контраст и цветные акценты"],
  ["gta4", "GTA IV Style", "Холодный городской профиль"],
];

const PREVIEW_SCENES = [
  ["dark", "Тёмная сцена"],
  ["light", "Светлая сцена"],
  ["night", "Город ночью"],
  ["day", "Город днём"],
  ["interior", "Интерьер"],
  ["range", "Стрельбище"],
  ["transparent", "Прозрачный фон"],
];
const PREVIEW_RESOLUTIONS = [
  ["1280x720", "HD · 1280 × 720"],
  ["1920x1080", "Full HD · 1920 × 1080"],
  ["2560x1440", "QHD · 2560 × 1440"],
  ["3840x2160", "4K · 3840 × 2160"],
];
const MEGA_MALL_DASHBOARD_MODULE = Object.freeze({
  id: "mega-mall",
  title: "Davis Mega Mall",
  description: "Независимые фасады, эмблемы, изображения и цветовые темы",
  compatibility: ["gta5-legacy-story"],
  controls: [],
  defaults: {},
});
const YOU_TOOL_DASHBOARD_MODULE = Object.freeze({
  id: "you-tool",
  title: "Ашан / You Tool",
  description: "Стены, узоры, свои эмблемы и отдельный Story Mode overlay",
  compatibility: ["gta5-legacy-story"],
  controls: [],
  defaults: {},
});
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const fingerprint = (project) => JSON.stringify(project);

function notify(onNotice, message, type = "success") {
  onNotice?.(message, type);
}

/* Escape, замок прокрутки, ловушка фокуса и возврат его на место живут в общем
   окне (`components/ui/Dialog.jsx`): своих `useEscape` и `keepDialogFocus`
   студия больше не держит — последние три окна переехали туда же. */

function localizedModuleLabel(moduleMap, id) {
  return moduleMap[id]?.title || id;
}

function WorkshopCompatibilityBadge({ targets }) {
  return (
    <span className="studio-compatibility">
      <ShieldCheck />
      {targets.includes("gta5-legacy-story")
        ? "Majestic / GTA5RP"
        : "GTA V Legacy"}
    </span>
  );
}

function useWorkshopAssetUrl(asset) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    if (!asset?.storageKey) {
      setUrl("");
      return undefined;
    }
    getWorkshopAsset(asset.storageKey)
      .then((blob) => {
        if (!active || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(""));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset?.storageKey]);
  return url;
}

const formatWorkshopHour = (value) => {
  const hour = ((Number(value) % 24) + 24) % 24;
  const minutes = Math.round((hour % 1) * 60);
  return `${String(Math.floor(hour)).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const formatWorkshopBytes = (value, language = "ru") => {
  const bytes = Number(value || 0);
  const units =
    language === "ru"
      ? [tr("КБ"), tr("МБ"), tr("ГБ")]
      : language === "fr"
        ? ["Ko", "Mo", "Go"]
        : ["KB", "MB", "GB"];
  if (bytes <= 0) return `0 ${units[0]}`;
  if (bytes >= 1024 ** 3)
    return `${(bytes / 1024 ** 3).toFixed(1)} ${units[2]}`;
  if (bytes >= 1024 ** 2)
    return `${(bytes / 1024 ** 2).toFixed(1)} ${units[1]}`;
  return `${Math.max(1, Math.ceil(bytes / 1024))} ${units[0]}`;
};

/*
 * Память правки живёт под своим именем проекта — рядом, но отдельно от памяти
 * «чем мастерскую открыли». Иначе `forgetSection` по закрытому проекту уносил
 * бы заодно и то, где человек стоял в самой мастерской.
 */
const projectMemoryKey = (projectId) => `workshop:studio:project:${projectId}`;

export {
  WorkshopLocalizationContext,
  useWorkshopLocalization,
  ICONS,
  TEMPLATE_OPTIONS,
  PREVIEW_SCENES,
  PREVIEW_RESOLUTIONS,
  MEGA_MALL_DASHBOARD_MODULE,
  YOU_TOOL_DASHBOARD_MODULE,
  clamp,
  fingerprint,
  notify,
  localizedModuleLabel,
  WorkshopCompatibilityBadge,
  useWorkshopAssetUrl,
  formatWorkshopHour,
  formatWorkshopBytes,
  projectMemoryKey,
};
