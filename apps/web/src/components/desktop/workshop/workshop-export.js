import {
  detectWorkshopConflicts,
  migrateWorkshopProject,
  normalizeTimecycleKeyframes,
  TIMECYCLE_VALUE_FIELDS,
  unresolvedWorkshopConflicts,
  validateWorkshopProject,
  WORKSHOP_SCHEMA_VERSION,
  WORKSHOP_MODULE_MAP,
} from "./workshop-project.js";
import {
  getWorkshopAsset,
  prepareWorkshopAsset,
  validateWorkshopAsset,
  workshopBlobBytes,
} from "./workshop-assets.js";

import {
  frontendEntryRect,
  placeMinimapFrontend,
} from "@modovik/minimap-contract";
import { tr } from "../../../locales/ui.js";
import { projectMessage } from "./workshop-project/project-lang.js";

export { validateWorkshopAsset } from "./workshop-assets.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ASTRALPACK_MAX_BYTES = 192 * 1024 * 1024;
const ASTRALPACK_MAX_ENTRIES = 512;
const ASTRALPACK_CORE_FILES = new Set([
  "manifest.json",
  "project.json",
  "checksums.json",
]);
const ASTRALPACK_PREVIEW_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);
const FORBIDDEN_ARCHIVE_EXTENSIONS = new Set([
  "exe",
  "dll",
  "bat",
  "cmd",
  "ps1",
  "js",
  "mjs",
  "cjs",
  "msi",
  "scr",
  "com",
  "vbs",
  "jar",
]);
const FIVEM_PLATFORM_FIELDS = Object.freeze({
  crosshair: Object.freeze(["visibilityMode", "fadeDelaySeconds"]),
});

export const FIVEM_RUNTIME_CAPABILITIES = Object.freeze({
  minimap: Object.freeze([
    "layout",
    "effects",
    "targetViewport",
    "shape",
    "width",
    "height",
    "scale",
    "x",
    "y",
    "anchor",
    "drivingScale",
    "footScale",
    "speedZoom",
    "hideOnFoot",
    "hideInteriors",
    "rotate",
    "fixedNorth",
    "showHealthNumbers",
    "showArmorNumbers",
    "vitalsPosition",
    "healthColor",
    "armorColor",
    "barWidth",
    "barThickness",
    "healthGradient",
    "lowHealthPulse",
    "damageFlash",
    "minimapFont",
    "minimapText",
    "showRange100",
    "showRange125",
    "playerMarker",
  ]),
  timecycle: Object.freeze([
    "time",
    "profile",
    "clockMode",
    "interpolation",
    "transition",
    "weatherBinding",
    "modifierStrength",
    ...TIMECYCLE_VALUE_FIELDS,
    "keyframes",
  ]),
  weather: Object.freeze([
    "profile",
    "clouds",
    "cloudColor",
    "rain",
    "visibility",
    "fog",
    "lightningFrequency",
    "lightningBrightness",
    "reflections",
    "wind",
    "sky",
    "transition",
    "linkTimecycle",
    "weatherProfiles",
  ]),
  crosshair: Object.freeze([
    "shape",
    "showCenterDot",
    "outlineEnabled",
    "hideOutsideAiming",
    "ring",
    "topEnabled",
    "rightEnabled",
    "bottomEnabled",
    "leftEnabled",
    "color",
    "targetColor",
    "outlineColor",
    "outlineWidth",
    "length",
    "thickness",
    "gap",
    "dotSize",
    "circleSize",
    "opacity",
    "shadow",
    "shadowColor",
    "glow",
    "glowColor",
    "smoothing",
    "rotation",
    "scale",
    "dynamic",
    "movementExpansion",
    "firingExpansion",
    "recoilReaction",
    "returnSmoothness",
    "minSpread",
    "maxSpread",
    "targetColorEnabled",
    "hitmarker",
    "hitShape",
    "hitSize",
    "hitDuration",
    "hitColor",
    "criticalColor",
    "armorColor",
    "healthColor",
    "killMarker",
    "hitSound",
    "hitAnimation",
    "pistolScale",
    "smgScale",
    "rifleScale",
    "shotgunScale",
    "sniperScale",
    "machinegunScale",
    "heavyScale",
    "otherScale",
  ]),
  tracers: Object.freeze([
    "type",
    "color",
    "endColor",
    "core",
    "glow",
    "glowIntensity",
    "layers",
    "length",
    "tail",
    "noise",
    "duration",
    "delay",
    "fadeIn",
    "fade",
    "probability",
    "frequency",
    "automatic",
    "firstPerson",
    "thirdPerson",
    "nightOnly",
    "minDistance",
    "maxDistance",
    "maxActive",
  ]),
  "weapon-effects": Object.freeze([
    "flashColor",
    "flashSize",
    "intensity",
    "duration",
    "glow",
    "randomScale",
    "smoke",
    "smokeDuration",
    "smokeSize",
    "smokeColor",
    "smokeBurstBuild",
    "smokeDissipation",
    "sparks",
    "shells",
    "shellSize",
    "shellMaterial",
    "shellLifetime",
    "shellImpulse",
    "lightRadius",
    "lightIntensity",
    "lightColor",
    "lightDuration",
    "lightFalloff",
    "nightOnly",
    "suppressor",
    "overheat",
    "aftershotParticles",
    "maxActiveEffects",
    "weaponProfiles",
  ]),
  impacts: Object.freeze([
    "material",
    "particle",
    "color",
    "particles",
    "size",
    "speed",
    "sparks",
    "dust",
    "shards",
    "decal",
    "decalSize",
    "decalOpacity",
    "duration",
    "sound",
    "intensity",
    "materials",
    "maxDecals",
    "maxParticles",
    "distance",
    "cleanupTime",
    "quality",
  ]),
});

export function getFiveMRuntimeCoverage(project) {
  const migrated = migrateWorkshopProject(project);
  const exportedModules = migrated.enabledModules.filter(
    (id) =>
      !migrated.disabledModules.includes(id) &&
      WORKSHOP_MODULE_MAP[id]?.compatibility.includes("fivem"),
  );
  const modules = exportedModules.map((id) => {
    const settings = migrated.modules[id] || {};
    const platformFields = new Set(FIVEM_PLATFORM_FIELDS[id] || []);
    const allFields = Object.keys(settings).filter(
      (field) => !platformFields.has(field),
    );
    const appliedFields = (FIVEM_RUNTIME_CAPABILITIES[id] || []).filter(
      (field) => field in settings,
    );
    return {
      id,
      title: WORKSHOP_MODULE_MAP[id]?.title || id,
      appliedFields,
      declarativeFields: allFields.filter(
        (field) => !appliedFields.includes(field),
      ),
      fieldCount: allFields.length,
      mode: appliedFields.length
        ? appliedFields.length === allFields.length
          ? "runtime"
          : "partial"
        : "declarative",
    };
  });
  return {
    modules,
    runtimeModules: modules.filter((item) => item.appliedFields.length > 0),
    declarativeModules: modules.filter(
      (item) => item.declarativeFields.length > 0,
    ),
    declarativeOnlyModules: modules.filter(
      (item) => item.mode === "declarative",
    ),
    appliedFieldCount: modules.reduce(
      (total, item) => total + item.appliedFields.length,
      0,
    ),
    totalFieldCount: modules.reduce(
      (total, item) => total + item.fieldCount,
      0,
    ),
  };
}

export function safeArchivePath(value) {
  const path = String(value || "").replaceAll("\\", "/");
  if (!path || path.startsWith("/") || /^[a-z]:/i.test(path)) return false;
  return !path
    .split("/")
    .some((part) => !part || part === "." || part === "..");
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function checksum(value) {
  return crc32(typeof value === "string" ? encoder.encode(value) : value)
    .toString(16)
    .padStart(8, "0");
}

function parseJsonBytes(files, path, label) {
  if (!files[path]) throw new Error(projectMessage("packMissing", path));
  try {
    return JSON.parse(decoder.decode(files[path]));
  } catch {
    throw new Error(projectMessage("jsonBroken", label));
  }
}

function sameStringList(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function validatePortableManifest(
  manifest,
  project,
  sourceSchemaVersion = project.schemaVersion,
) {
  if (manifest?.format !== "astralpack" || manifest?.version !== 1)
    throw new Error(tr("Неизвестный формат manifest astralpack"));
  if (
    !Number.isInteger(sourceSchemaVersion) ||
    sourceSchemaVersion < 1 ||
    sourceSchemaVersion > WORKSHOP_SCHEMA_VERSION
  )
    throw new Error(
      tr("Версия схемы astralpack не поддерживается этой версией ASTRAL"),
    );
  if (manifest.schemaVersion !== sourceSchemaVersion)
    throw new Error(tr("Версия схемы manifest не совпадает с проектом"));
  if (
    manifest.name !== project.name ||
    manifest.author !== project.author ||
    manifest.description !== project.description
  )
    throw new Error(tr("Метаданные manifest не совпадают с проектом"));
  if (!sameStringList(manifest.targets, [project.target]))
    throw new Error(tr("Целевая платформа manifest не совпадает с проектом"));
  if (!sameStringList(manifest.modules, project.enabledModules))
    throw new Error(tr("Список модулей manifest не совпадает с проектом"));
  const minimumSchemaVersion = Number(
    manifest.requirements?.minimumSchemaVersion,
  );
  if (
    manifest.requirements?.application !== "ASTRAL" ||
    !Number.isInteger(minimumSchemaVersion) ||
    minimumSchemaVersion < 1 ||
    minimumSchemaVersion > WORKSHOP_SCHEMA_VERSION
  )
    throw new Error(
      tr("Требования astralpack не поддерживаются этой версией ASTRAL"),
    );
  if (!Array.isArray(manifest.assets))
    throw new Error(tr("Manifest не содержит список assets"));
  if (
    manifest.checksums &&
    (manifest.checksums.algorithm !== "crc32" ||
      manifest.checksums.file !== "checksums.json")
  )
    throw new Error(
      tr("Manifest объявляет неподдерживаемые контрольные суммы"),
    );
}

function validateArchivePathPolicy(path) {
  if (ASTRALPACK_CORE_FILES.has(path)) return;
  const extension = path.includes(".")
    ? path.split(".").pop().toLowerCase()
    : "";
  if (FORBIDDEN_ARCHIVE_EXTENSIONS.has(extension))
    throw new Error(projectMessage("forbiddenFile", path));
  if (path.startsWith("assets/")) return;
  if (
    path.startsWith("previews/") &&
    ASTRALPACK_PREVIEW_EXTENSIONS.has(extension)
  )
    return;
  throw new Error(projectMessage("undeclaredPath", path));
}

export function createAstralPack(project) {
  const migrated = migrateWorkshopProject(project);
  const validation = validateWorkshopProject(migrated);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  const projectJson = JSON.stringify(
    { ...migrated, appliedSnapshots: [], installations: [] },
    null,
    2,
  );
  const manifest = {
    format: "astralpack",
    version: 1,
    schemaVersion: migrated.schemaVersion,
    name: migrated.name,
    author: migrated.author,
    description: migrated.description,
    targets: [migrated.target],
    modules: migrated.enabledModules,
    assets: migrated.assets.map(({ name, size, type, hash }) => ({
      name,
      size,
      type,
      hash,
    })),
    createdAt: new Date().toISOString(),
    requirements: {
      application: "ASTRAL",
      minimumSchemaVersion: WORKSHOP_SCHEMA_VERSION,
    },
    checksums: { algorithm: "crc32", file: "checksums.json" },
  };
  const manifestJson = JSON.stringify(manifest, null, 2);
  return JSON.stringify(
    {
      format: "astralpack",
      version: 1,
      files: {
        "manifest.json": manifestJson,
        "project.json": projectJson,
        "checksums.json": JSON.stringify(
          {
            algorithm: "crc32",
            files: {
              "manifest.json": checksum(manifestJson),
              "project.json": checksum(projectJson),
            },
          },
          null,
          2,
        ),
      },
    },
    null,
    2,
  );
}

export function parseAstralPack(raw) {
  let pack;
  try {
    pack = JSON.parse(raw);
  } catch {
    throw new Error(tr("Не удалось прочитать astralpack: некорректный JSON"));
  }
  if (pack?.format !== "astralpack" || pack?.version !== 1 || !pack?.files) {
    throw new Error(tr("Неизвестный формат пакета"));
  }
  if (!Object.keys(pack.files).every(safeArchivePath)) {
    throw new Error(tr("Пакет содержит небезопасный путь"));
  }
  const checksums = JSON.parse(pack.files["checksums.json"] || "{}");
  for (const [path, expected] of Object.entries(checksums.files || {})) {
    if (checksum(pack.files[path] || "") !== expected) {
      throw new Error(projectMessage("checksumMismatch", path));
    }
  }
  const project = migrateWorkshopProject(
    JSON.parse(pack.files["project.json"]),
  );
  project.appliedSnapshots = [];
  project.installations = [];
  const validation = validateWorkshopProject(project);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  return project;
}

const CROSSHAIR_NUI_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="crosshair.css"></head>
<body><div id="crosshair" aria-hidden="true"><div class="shape"><i class="top"></i><i class="right"></i><i class="bottom"></i><i class="left"></i><b></b><u class="center-ring"></u><img alt=""></div><div id="hitmarker"><i></i><i></i><i></i><i></i><b></b></div></div><div id="minimap-hud" aria-hidden="true"><div class="rings"><i></i><i></i></div><i class="player-marker"></i><div class="vitals"><i class="health"><u></u></i><i class="armor"><u></u></i><b></b></div><em></em><span class="damage"></span></div><script src="crosshair.js"></script><script src="crosshair-shape.js"></script></body></html>`;

const CROSSHAIR_NUI_CSS = `*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent;pointer-events:none}#crosshair{--color:#fff;--outline:#101419;--outline-width:1px;--length:14px;--weight:3px;--gap:7px;--dot:3px;--circle:28px;--opacity:1;--glow:0px;--glow-color:#fff;--shadow:0px;--shadow-color:#000;--smooth-radius:99px;--rotation:0deg;--scale:1;--return:160ms;--hit-size:22px;--hit-color:#fff;--hit-duration:180ms;position:absolute;left:50%;top:50%;width:1px;height:1px;color:var(--color);opacity:0;transition:opacity 80ms ease}#crosshair.visible{opacity:var(--opacity)}.shape{position:absolute;width:1px;height:1px;transform:rotate(var(--rotation)) scale(var(--scale));transition:transform var(--return) ease}.shape>i,.shape>b{position:absolute;display:block;border-radius:var(--smooth-radius);background:currentColor;box-shadow:0 0 0 var(--outline-width) var(--outline),0 0 var(--glow) var(--glow-color),var(--shadow) var(--shadow) calc(var(--shadow) + var(--shadow)) var(--shadow-color)}.shape>.top,.shape>.bottom{left:calc(var(--weight)/-2);width:var(--weight);height:var(--length);transition:inset var(--return) ease}.shape>.top{bottom:var(--gap)}.shape>.bottom{top:var(--gap)}.shape>.left,.shape>.right{top:calc(var(--weight)/-2);width:var(--length);height:var(--weight);transition:inset var(--return) ease}.shape>.left{right:var(--gap)}.shape>.right{left:var(--gap)}.shape>b{left:calc(var(--dot)/-2);top:calc(var(--dot)/-2);width:var(--dot);height:var(--dot)}.shape>img{display:none;position:absolute;left:calc(var(--circle)/-2);top:calc(var(--circle)/-2);width:var(--circle);height:var(--circle);object-fit:contain;filter:drop-shadow(0 0 var(--glow) var(--glow-color))}.shape-dot .shape>i,.shape-circle .shape>i,.shape-ring .shape>i,.shape-custom .shape>i{display:none}.shape-lines .shape>b,.shape-t .shape>b,.shape-circle .shape>b,.shape-custom .shape>b{display:none}.shape-t .shape>.top{display:none}.shape-circle .shape{width:var(--circle);height:var(--circle);margin:calc(var(--circle)/-2);border-radius:50%;background:currentColor;box-shadow:0 0 0 var(--outline-width) var(--outline),0 0 var(--glow) var(--glow-color)}.shape-ring .shape{width:var(--circle);height:var(--circle);margin:calc(var(--circle)/-2);border:var(--weight) solid currentColor;border-radius:50%;box-shadow:inset 0 0 0 var(--outline-width) var(--outline),0 0 0 var(--outline-width) var(--outline),0 0 var(--glow) var(--glow-color)}.shape-custom .shape>img{display:block}#hitmarker{position:absolute;left:0;top:0;width:var(--hit-size);height:var(--hit-size);display:none;color:var(--hit-color);transform:translate(-50%,-50%)}#hitmarker.active{display:block;animation-duration:var(--hit-duration);animation-fill-mode:both}#hitmarker>i{position:absolute;left:50%;top:50%;width:42%;height:2px;border-radius:99px;background:currentColor;transform-origin:left center;box-shadow:0 0 0 1px #000,0 0 6px currentColor}#hitmarker>i:nth-child(1){transform:rotate(45deg) translateX(18%)}#hitmarker>i:nth-child(2){transform:rotate(135deg) translateX(18%)}#hitmarker>i:nth-child(3){transform:rotate(225deg) translateX(18%)}#hitmarker>i:nth-child(4){transform:rotate(315deg) translateX(18%)}#hitmarker.plus>i:nth-child(1){transform:rotate(0) translateX(18%)}#hitmarker.plus>i:nth-child(2){transform:rotate(90deg) translateX(18%)}#hitmarker.plus>i:nth-child(3){transform:rotate(180deg) translateX(18%)}#hitmarker.plus>i:nth-child(4){transform:rotate(270deg) translateX(18%)}#hitmarker.dot>i,#hitmarker.chevron>i:nth-child(n+3){display:none}#hitmarker.dot{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 1px #000,0 0 8px currentColor}#hitmarker.chevron>i:nth-child(1){transform:rotate(28deg) translateX(18%)}#hitmarker.chevron>i:nth-child(2){transform:rotate(152deg) translateX(18%)}#hitmarker>b{display:none;position:absolute;left:50%;top:50%;width:32%;height:32%;border:2px solid currentColor;border-radius:50%;transform:translate(-50%,-50%)}#hitmarker.kill>b{display:block}#hitmarker.anim-pop{animation-name:hitPop}#hitmarker.anim-fade{animation-name:hitFade}#hitmarker.anim-scale{animation-name:hitScale}#minimap-hud{--health:#fff;--armor:#97dcff;--bar-width:100%;--bar-height:8px;position:absolute;display:none;opacity:1;transition:opacity 180ms ease}#minimap-hud.visible{display:block}#minimap-hud.idle{opacity:var(--idle-opacity,.62)}#minimap-hud .vitals{position:absolute;left:0;bottom:0;width:var(--bar-width);display:grid;grid-template-columns:1fr 1fr;gap:2px}#minimap-hud .vitals>i{position:relative;height:var(--bar-height);overflow:hidden;border:1px solid #050609;background:rgba(5,6,9,.78)}#minimap-hud .vitals u{position:absolute;inset:0 auto 0 0;width:var(--level);background:var(--health);text-decoration:none;transition:width 160ms ease}#minimap-hud .vitals .health.gradient u{background:linear-gradient(90deg,#ff596b,var(--health) 75%)}#minimap-hud .vitals .armor u{--level:var(--armor-level);background:var(--armor)}#minimap-hud .vitals b{position:absolute;left:4px;bottom:calc(var(--bar-height) + 4px);padding:2px 4px;border-radius:3px;color:#fff;background:rgba(0,0,0,.74);font:600 9px Arial,sans-serif;white-space:nowrap}#minimap-hud.no-numbers .vitals b{display:none}#minimap-hud.vitals-top .vitals{top:0;bottom:auto}#minimap-hud.vitals-left .vitals,#minimap-hud.vitals-right .vitals{top:0;bottom:auto;width:var(--bar-height);height:100%;grid-template-columns:1fr;grid-template-rows:1fr 1fr}#minimap-hud.vitals-right .vitals{left:auto;right:0}#minimap-hud.vitals-left .vitals>i,#minimap-hud.vitals-right .vitals>i{height:auto}#minimap-hud.vitals-left .vitals u,#minimap-hud.vitals-right .vitals u{inset:auto 0 0;width:auto;height:var(--level)}#minimap-hud.vitals-left .vitals b,#minimap-hud.vitals-right .vitals b{display:none}#minimap-hud>em{position:absolute;left:6px;top:6px;max-width:70%;overflow:hidden;padding:3px 5px;border-radius:4px;color:#fff;background:rgba(0,0,0,.72);font:600 10px Arial,sans-serif;text-overflow:ellipsis;white-space:nowrap}#minimap-hud.font-compact>em{letter-spacing:-.04em}#minimap-hud.font-wide>em{letter-spacing:.12em}#minimap-hud .rings{position:absolute;inset:0}#minimap-hud .rings i{display:none;position:absolute;left:50%;top:50%;border:1px dashed rgba(255,255,255,.68);border-radius:50%;transform:translate(-50%,-50%)}#minimap-hud.range-100 .rings i:first-child{display:block;width:42%;aspect-ratio:1}#minimap-hud.range-125 .rings i:last-child{display:block;width:62%;aspect-ratio:1;border-color:rgba(151,220,255,.7)}#minimap-hud .player-marker{display:none;position:absolute;z-index:2;left:50%;top:50%;width:12px;height:15px;background:#fff;clip-path:polygon(50% 0,100% 100%,50% 76%,0 100%);transform:translate(-50%,-50%)}#minimap-hud.marker-arrow .player-marker{display:block;background:transparent;border:2px solid #fff}#minimap-hud.marker-dot .player-marker{display:block;width:10px;height:10px;border:2px solid #111;border-radius:50%;clip-path:none;background:#fff}#minimap-hud.marker-custom .player-marker{display:block;background:#85a1ff}#minimap-hud .damage{position:absolute;display:none;inset:0;background:radial-gradient(circle,transparent 42%,rgba(255,38,69,.5))}#minimap-hud.damaged .damage{display:block;animation:damageFlash .7s ease-out}#minimap-hud.low-health .vitals{animation:vitalsPulse 1.1s ease-in-out infinite}@keyframes hitPop{0%{opacity:0;transform:translate(-50%,-50%) scale(.35)}35%{opacity:1;transform:translate(-50%,-50%) scale(1.22)}100%{opacity:0;transform:translate(-50%,-50%) scale(1)}}@keyframes hitFade{0%,30%{opacity:1}100%{opacity:0}}@keyframes hitScale{0%{opacity:0;transform:translate(-50%,-50%) scale(1.8)}30%{opacity:1}100%{opacity:0;transform:translate(-50%,-50%) scale(.7)}@keyframes damageFlash{from{opacity:1}to{opacity:0}}@keyframes vitalsPulse{50%{filter:brightness(1.65);opacity:.7}}`;

const CROSSHAIR_NUI_JS_BASE = `const root=document.getElementById('crosshair'),hit=document.getElementById('hitmarker'),image=root.querySelector('img'),radar=document.getElementById('minimap-hud'),vitals=radar.querySelector('.vitals'),radarLabel=radar.querySelector('em');let config={},radarConfig={},timer=0;const px=(v,f=0)=>String(Number.isFinite(Number(v))?Number(v):f)+'px',bounded=(v,min,max,f=min)=>Math.max(min,Math.min(max,Number.isFinite(Number(v))?Number(v):f));function configure(next){config=next||{};root.className='shape-'+(config.ring?'ring':config.shape||'cross');const s=root.style;s.setProperty('--color',config.color||'#fff');s.setProperty('--outline',config.outlineColor||'#101419');s.setProperty('--outline-width',px(config.outlineEnabled===false?0:config.outlineWidth,1));s.setProperty('--length',px(config.length,14));s.setProperty('--weight',px(config.thickness,2));s.setProperty('--dot',px(config.showCenterDot===false?0:config.dotSize,3));s.setProperty('--circle',px(config.circleSize,28));s.setProperty('--opacity',String(bounded(config.opacity,0,100,100)/100));s.setProperty('--glow',px(config.glow));s.setProperty('--glow-color',config.glowColor||config.color||'#fff');s.setProperty('--shadow',px((Number(config.shadow)||0)/18));s.setProperty('--shadow-color',config.shadowColor||'#000');s.setProperty('--smooth-radius',px(bounded(config.smoothing,0,100)*.99));s.setProperty('--rotation',String(Number(config.rotation)||0)+'deg');s.setProperty('--return',String(40+(100-(Number(config.returnSmoothness)||70))*4)+'ms');s.setProperty('--hit-size',px(config.hitSize,22));s.setProperty('--hit-duration',String(Number(config.hitDuration)||180)+'ms');image.style.imageRendering=Number(config.smoothing)>50?'auto':'pixelated';if(config.customTexture){image.src=config.customTexture}else image.removeAttribute('src')}function state(data){root.classList.toggle('visible',!!data.visible);root.style.setProperty('--gap',px((Number(config.gap)||0)+(config.dynamic?Number(data.spread)||0:0)));root.style.setProperty('--scale',String((Number(config.scale)||100)/100*(Number(data.profileScale)||100)/100));root.style.setProperty('--color',data.target&&config.targetColorEnabled?(config.targetColor||config.color):config.color||'#fff')}function showHit(data){if(!config.hitmarker)return;clearTimeout(timer);hit.className='';void hit.offsetWidth;const kind=data.kind||'health';const color=kind==='critical'?config.criticalColor:kind==='armor'?config.armorColor:config.healthColor||config.hitColor;hit.style.setProperty('--hit-color',color||'#fff');hit.classList.add(config.hitShape||'x','anim-'+(config.hitAnimation||'pop'),'active');if(data.killed&&config.killMarker)hit.classList.add('kill');timer=setTimeout(()=>hit.className='',Number(config.hitDuration)||180)}function configureRadar(next){radarConfig=next||{};const scale=bounded(radarConfig.scale,60,150,100)/100,baseHeight=bounded(radarConfig.height,100,280,180),width=(radarConfig.shape==='circle'?baseHeight:bounded(radarConfig.width,160,420,260))*scale,height=baseHeight*scale,anchor=String(radarConfig.anchor||'bottom-left'),right=anchor.endsWith('right'),top=anchor.startsWith('top'),s=radar.style;s.left=right?'auto':String(bounded(radarConfig.x,0,120,28)/19.2)+'vw';s.right=right?String(bounded(radarConfig.x,0,120,28)/19.2)+'vw':'auto';s.top=top?String(bounded(radarConfig.y,0,120,28)/10.8)+'vh':'auto';s.bottom=top?'auto':String(bounded(radarConfig.y,0,120,28)/10.8)+'vh';s.width=String(width/19.2)+'vw';s.height=String(height/10.8)+'vh';s.setProperty('--health',radarConfig.healthColor||'#fff');s.setProperty('--armor',radarConfig.armorColor||'#97dcff');s.setProperty('--bar-width',String(bounded(radarConfig.barWidth,50,180,100))+'%');s.setProperty('--bar-height',px(bounded(radarConfig.barThickness,3,18,8)));s.setProperty('--idle-opacity',String(bounded(radarConfig.idleOpacity,0,100,62)/100));radarLabel.textContent=String(radarConfig.minimapText||'').slice(0,32);radarLabel.hidden=!radarLabel.textContent}function radarState(data){const classes=['visible','vitals-'+(radarConfig.vitalsPosition||'stock'),'font-'+(radarConfig.minimapFont||'stock'),'marker-'+(radarConfig.playerMarker||'stock')];if(!radarConfig.showHealthNumbers&&!radarConfig.showArmorNumbers)classes.push('no-numbers');if(radarConfig.healthGradient)classes.push('health-gradient');if(radarConfig.showRange100)classes.push('range-100');if(radarConfig.showRange125)classes.push('range-125');if(data.idle)classes.push('idle');if(data.damaged&&radarConfig.damageFlash)classes.push('damaged');if(data.health<=20&&radarConfig.lowHealthPulse)classes.push('low-health');radar.className=data.visible?classes.join(' '):'';const health=bounded(data.health,0,100,100),armor=bounded(data.armor,0,100,0);radar.style.setProperty('--level',String(health)+'%');radar.style.setProperty('--armor-level',String(armor)+'%');radar.querySelector('.health').classList.toggle('gradient',!!radarConfig.healthGradient);vitals.querySelector('b').textContent=(radarConfig.showHealthNumbers?String(Math.round(health))+' HP':'')+(radarConfig.showHealthNumbers&&radarConfig.showArmorNumbers?' · ':'')+(radarConfig.showArmorNumbers?String(Math.round(armor))+' ARMOR':'')}window.addEventListener('message',event=>{const data=event.data||{};if(data.type==='configure')configure(data.config);if(data.type==='state')state(data);if(data.type==='hit')showHit(data);if(data.type==='radar-configure')configureRadar(data.config);if(data.type==='radar-state')radarState(data)});fetch('https://'+GetParentResourceName()+'/ready',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});`;
const CROSSHAIR_NUI_JS = CROSSHAIR_NUI_JS_BASE.replace(
  /function configureRadar\(next\)\{.*?\}function radarState/s,
  `function configureRadar(next){const source=next||{},layout=source.layout||{},map=layout.map||{},effects=source.effects||{},widgets=layout.widgets||{},position=map.position||{};radarConfig={...source,healthColor:effects.healthColor||source.healthColor,armorColor:effects.armorColor||source.armorColor,barThickness:effects.barThickness||source.barThickness,healthGradient:effects.healthGradient,lowHealthPulse:effects.lowHealthPulse,lowHealthThreshold:effects.lowHealthThreshold||25,damageFlash:effects.damageFlash,showHealthNumbers:widgets.healthNumber?.visible??source.showHealthNumbers,showArmorNumbers:widgets.armorNumber?.visible??source.showArmorNumbers,minimapText:effects.playerTag??source.minimapText,minimapFont:effects.font||source.minimapFont,vitalsPosition:layout.vitalsLayout||source.vitalsPosition};const ratios={'16:9':16/9,'4:3':4/3,'1:1':1,'5:4':5/4,'5:3':5/3,'3:2':3/2},ratio=ratios[map.aspect]||1.5,size=bounded(map.size,.06,.55,.18),s=radar.style,frame=map.screen;if(frame&&Number.isFinite(Number(frame.width))){s.left=String(Number(frame.left)*100)+'vw';s.right='auto';s.top=String(Number(frame.top)*100)+'vh';s.bottom='auto';s.transform='none';s.width=String(Number(frame.width)*100)+'vw';s.height=String(Number(frame.height)*100)+'vh'}else{s.left=String(bounded(position.x,-.5,1.5,.12)*100)+'vw';s.right='auto';s.top=String(bounded(position.y,-.5,1.5,.86)*100)+'vh';s.bottom='auto';s.transform='translate(-50%,-50%)';s.width=String(size*ratio*100)+'vh';s.height=String(size*100)+'vh'}s.setProperty('--health',radarConfig.healthColor||'#fff');s.setProperty('--armor',radarConfig.armorColor||'#97dcff');s.setProperty('--bar-width','100%');s.setProperty('--bar-height',px(bounded(radarConfig.barThickness,2,24,8)));s.setProperty('--idle-opacity',String(bounded(source.idleOpacity,0,100,62)/100));radarLabel.textContent=String(radarConfig.minimapText||'').slice(0,32);radarLabel.hidden=!radarLabel.textContent}function radarState`,
)
  .replace(
    "data.health<=20&&radarConfig.lowHealthPulse",
    "data.health<=bounded(radarConfig.lowHealthThreshold,1,99,25)&&radarConfig.lowHealthPulse",
  )
  .replace(
    "radarLabel.textContent=String(radarConfig.minimapText",
    "radar.querySelector('.damage').style.backgroundImage=effects.damageAssetUrl?'url('+effects.damageAssetUrl+')':'';radarLabel.textContent=String(radarConfig.minimapText",
  );

const CROSSHAIR_NUI_SHAPE_CSS = `.shape>.center-ring{position:absolute;display:none;left:calc(var(--circle)/-2);top:calc(var(--circle)/-2);width:var(--circle);height:var(--circle);box-sizing:border-box;border:var(--weight) solid currentColor;border-radius:50%;box-shadow:inset 0 0 0 var(--outline-width) var(--outline),0 0 0 var(--outline-width) var(--outline),0 0 var(--glow) var(--glow-color);text-decoration:none}.has-ring .shape>.center-ring{display:block}`;
const MINIMAP_LAYOUT_NUI_CSS = `#minimap-hud.vitals-two-rows .vitals{grid-template-columns:1fr;grid-template-rows:1fr 1fr;gap:3px}#minimap-hud.vitals-vertical .vitals{top:10%;bottom:10%;width:calc(var(--bar-height)*2 + 3px);height:80%;grid-template-columns:1fr 1fr}#minimap-hud.vitals-vertical .vitals>i{height:auto}#minimap-hud.vitals-vertical .vitals u{inset:auto 0 0;width:auto;height:var(--level)}#minimap-hud.vitals-independent .vitals{grid-template-columns:1fr 1fr}`;
const CROSSHAIR_NUI_SHAPE_JS = `window.addEventListener('message',event=>{const data=event.data||{};if(data.type!=='configure')return;const shape=String(config.shape||'cross');root.className='shape-'+shape+(config.ring&&shape!=='ring'?' has-ring':'');root.style.setProperty('--dot',px(shape==='dot'||config.showCenterDot!==false?config.dotSize:0,3))});`;

const timecycleNumber = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const timecycleXmlValue = (value) =>
  `${timecycleNumber(value).toFixed(6)} 0.000000`;
const timecycleColor = (value) => {
  const hex = /^#[0-9a-f]{6}$/i.test(String(value || ""))
    ? String(value).slice(1)
    : "ffffff";
  return [0, 2, 4].map(
    (offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255,
  );
};

const selectedWeatherProfile = (config) =>
  config?.weatherProfiles?.[config.profile] || config || null;

const weatherCloudFields = (weather) => {
  const color = timecycleColor(weather?.cloudColor);
  const density = timecycleNumber(weather?.clouds) / 100;
  return [
    ["sky_cloud_density_mult", density],
    ["sky_cloud_mid_col_r", color[0]],
    ["sky_cloud_mid_col_g", color[1]],
    ["sky_cloud_mid_col_b", color[2]],
    ["sky_cloud_base_col_r", color[0]],
    ["sky_cloud_base_col_g", color[1]],
    ["sky_cloud_base_col_b", color[2]],
  ];
};

export function buildWeatherModifierData(
  config,
  resourceName = "astral-workshop",
) {
  const safeName =
    String(resourceName || "astral-workshop")
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .slice(0, 34) || "astral_workshop";
  const weather = selectedWeatherProfile(config);
  const sky = timecycleColor(weather?.sky);
  const fog = timecycleColor(weather?.cloudColor);
  const fogDensity =
    Math.max(
      timecycleNumber(weather?.fog),
      100 - timecycleNumber(weather?.visibility, 100),
    ) / 100;
  const fields = [
    ["sky_zenith_col_r", sky[0]],
    ["sky_zenith_col_g", sky[1]],
    ["sky_zenith_col_b", sky[2]],
    ["sky_azimuth_east_col_r", sky[0]],
    ["sky_azimuth_east_col_g", sky[1]],
    ["sky_azimuth_east_col_b", sky[2]],
    ["sky_azimuth_west_col_r", sky[0]],
    ["sky_azimuth_west_col_g", sky[1]],
    ["sky_azimuth_west_col_b", sky[2]],
    ["fog_col_r", fog[0]],
    ["fog_col_g", fog[1]],
    ["fog_col_b", fog[2]],
    ["fog_density", fogDensity],
    [
      "water_reflection_sky_intensity",
      timecycleNumber(weather?.reflections, 100) / 100,
    ],
    ...weatherCloudFields(weather),
  ];
  const name = `astral_${safeName}_weather`;
  const modifierXml = [
    `  <modifier name="${name}" numMods="${fields.length}" userFlags="0">`,
    ...fields.map(
      ([field, value]) =>
        `    <${field}>${timecycleXmlValue(value)}</${field}>`,
    ),
    "  </modifier>",
  ].join("\n");
  return {
    modifiers: [{ name, time: 0 }],
    xml: `<?xml version="1.0" encoding="UTF-8"?>\n<timecycle_modifier_data version="1.000000">\n${modifierXml}\n</timecycle_modifier_data>`,
  };
}

export function buildTimecycleModifierData(
  config,
  resourceName = "astral-workshop",
  weatherConfig = null,
) {
  const safeName =
    String(resourceName || "astral-workshop")
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .slice(0, 34) || "astral_workshop";
  const keyframes = normalizeTimecycleKeyframes(config?.keyframes, config);
  const linkedWeather =
    weatherConfig?.linkTimecycle === false
      ? null
      : selectedWeatherProfile(weatherConfig);
  const modifiers = keyframes.map((frame, index) => ({
    name: `astral_${safeName}_${String(index).padStart(2, "0")}`,
    time: frame.time,
    values: linkedWeather
      ? {
          ...frame.values,
          sky: linkedWeather.sky,
          fogColor: linkedWeather.cloudColor,
          fogDensity: Math.max(
            timecycleNumber(linkedWeather.fog),
            100 - timecycleNumber(linkedWeather.visibility, 100),
          ),
          reflectionIntensity: linkedWeather.reflections,
        }
      : frame.values,
  }));
  const modifierXml = modifiers
    .map((modifier) => {
      const value = modifier.values;
      const ambient = timecycleColor(value.ambient);
      const sky = timecycleColor(value.sky);
      const horizon = timecycleColor(value.horizon);
      const sun = timecycleColor(value.sun);
      const moon = timecycleColor(value.moon);
      const fog = timecycleColor(value.fogColor);
      const water = timecycleColor(value.waterTint);
      const fields = [
        ["postfx_exposure", (timecycleNumber(value.exposure, 100) - 100) / 100],
        ["postfx_shift_cutoff", timecycleNumber(value.gamma, 100) / 100],
        [
          "postfx_bright_pass_thresh",
          timecycleNumber(value.brightness, 100) / 100,
        ],
        ["postfx_contrast", (timecycleNumber(value.contrast, 100) - 100) / 100],
        [
          "postfx_desaturation",
          (100 - timecycleNumber(value.saturation, 100)) / 100,
        ],
        ["light_directional_amb_col_r", ambient[0]],
        ["light_directional_amb_col_g", ambient[1]],
        ["light_directional_amb_col_b", ambient[2]],
        ["sky_zenith_col_r", sky[0]],
        ["sky_zenith_col_g", sky[1]],
        ["sky_zenith_col_b", sky[2]],
        ["sky_zenith_col_inten", timecycleNumber(value.exposure, 100) / 100],
        ["sky_azimuth_east_col_r", horizon[0]],
        ["sky_azimuth_east_col_g", horizon[1]],
        ["sky_azimuth_east_col_b", horizon[2]],
        ["sky_azimuth_west_col_r", horizon[0]],
        ["sky_azimuth_west_col_g", horizon[1]],
        ["sky_azimuth_west_col_b", horizon[2]],
        ["sky_sun_col_r", sun[0]],
        ["sky_sun_col_g", sun[1]],
        ["sky_sun_col_b", sun[2]],
        ["sky_moon_col_r", moon[0]],
        ["sky_moon_col_g", moon[1]],
        ["sky_moon_col_b", moon[2]],
        [
          "light_dir_mult",
          (100 - timecycleNumber(value.shadowIntensity, 50)) / 100,
        ],
        ["fog_col_r", fog[0]],
        ["fog_col_g", fog[1]],
        ["fog_col_b", fog[2]],
        ["fog_density", timecycleNumber(value.fogDensity) / 100],
        ["postfx_intensity_bloom", timecycleNumber(value.bloom) / 100],
        [
          "water_reflection_sky_intensity",
          timecycleNumber(value.reflectionIntensity, 100) / 100,
        ],
        [
          "light_artificial_int_down_intensity",
          timecycleNumber(value.artificialLights, 100) / 100,
        ],
        [
          "light_artificial_int_up_intensity",
          timecycleNumber(value.artificialLights, 100) / 100,
        ],
        [
          "light_artificial_ext_down_intensity",
          timecycleNumber(value.streetLights, 100) / 100,
        ],
        [
          "light_artificial_ext_up_intensity",
          timecycleNumber(value.streetLights, 100) / 100,
        ],
        ["sky_intensity", (100 - timecycleNumber(value.nightDarkness)) / 100],
        ["water_ocean_r", water[0]],
        ["water_ocean_g", water[1]],
        ["water_ocean_b", water[2]],
        ["water_shallow_r", water[0]],
        ["water_shallow_g", water[1]],
        ["water_shallow_b", water[2]],
        ...(linkedWeather ? weatherCloudFields(linkedWeather) : []),
      ];
      return [
        `  <modifier name="${modifier.name}" numMods="${fields.length}" userFlags="0">`,
        ...fields.map(
          ([name, fieldValue]) =>
            `    <${name}>${timecycleXmlValue(fieldValue)}</${name}>`,
        ),
        "  </modifier>",
      ].join("\n");
    })
    .join("\n");
  return {
    modifiers: modifiers.map(({ name, time }) => ({ name, time })),
    xml: `<?xml version="1.0" encoding="UTF-8"?>\n<timecycle_modifier_data version="1.000000">\n${modifierXml}\n</timecycle_modifier_data>`,
  };
}

export function buildFiveMFiles(project) {
  const migrated = migrateWorkshopProject(project);
  if (migrated.target !== "fivem")
    throw new Error(tr("FiveM resource доступен только для проекта FiveM"));
  const validation = validateWorkshopProject(migrated);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  const unresolvedConflicts = unresolvedWorkshopConflicts(migrated);
  if (unresolvedConflicts.length)
    throw new Error(
      tr("Разрешите конфликты модулей перед экспортом FiveM resource"),
    );
  const resourceName =
    migrated.name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "astral-workshop";
  const exportedModules = migrated.enabledModules.filter(
    (id) =>
      !migrated.disabledModules.includes(id) &&
      WORKSHOP_MODULE_MAP[id]?.compatibility.includes("fivem"),
  );
  const hasCrosshair = exportedModules.includes("crosshair");
  const hasMinimap = exportedModules.includes("minimap");
  const hasNui = hasCrosshair || hasMinimap;
  const hasTimecycle = exportedModules.includes("timecycle");
  const hasWeather = exportedModules.includes("weather");
  const resolvedConflicts = Object.fromEntries(
    detectWorkshopConflicts(migrated).map((conflict) => [
      conflict.id,
      {
        strategy: conflict.strategy,
        sources: conflict.modules,
        selectedSource: conflict.selectedSource,
      },
    ]),
  );
  const resolvedModules = structuredClone(migrated.modules);
  const gpsSource = migrated.conflictResolutions["gps-style"];
  if (gpsSource && resolvedModules.minimap && resolvedModules["blips-gps"]) {
    const gpsTarget = gpsSource === "minimap" ? "blips-gps" : "minimap";
    resolvedModules[gpsTarget] = {
      ...resolvedModules[gpsTarget],
      routeWidth: resolvedModules[gpsSource].routeWidth,
      routeGlow: resolvedModules[gpsSource].routeGlow,
    };
  }
  const exportedModuleConfig = Object.fromEntries(
    exportedModules.map((id) => [id, resolvedModules[id]]),
  );
  if (hasCrosshair && exportedModuleConfig.crosshair?.shape === "custom") {
    const texture = migrated.assets.find(
      (asset) =>
        asset.moduleId === "crosshair" &&
        /\.(png|svg)$/i.test(String(asset.name || "")),
    );
    if (texture)
      exportedModuleConfig.crosshair.customTexture = `https://cfx-nui-${resourceName}/assets/${texture.name.replace(/[^a-z0-9._-]+/gi, "-")}`;
  }
  /*
   * Место мини-карты на экране. Проект хранит сдвиг и масштаб от штатных
   * записей frontend.xml; FiveM ставит мини-карту теми же записями
   * (`SetMinimapComponentPosition`), поэтому в ресурс уходят готовые записи
   * — ровно те числа, что Legacy получает в файле, — и прямоугольник кадра
   * для слоя полос NUI. Старые поля (`position`, `size`, `aspect`)
   * выводятся из того же прямоугольника: их читают ресурсы, собранные до
   * пятой схемы.
   */
  if (hasMinimap && exportedModuleConfig.minimap?.layout?.map) {
    const map = exportedModuleConfig.minimap.layout.map;
    const frontend = placeMinimapFrontend(map);
    /* Прямоугольник — в числах записи, как его читают ресурсы FiveM,
       собранные раньше (без отступа безопасной зоны игры: его ресурс
       знает сам). Место кадра на экране игры — `minimapScreenRect`. */
    const screen = frontendEntryRect(frontend.minimap);
    const ratio = (screen.width * 16) / 9 / screen.height;
    const aspects = {
      "16:9": 16 / 9,
      "5:3": 5 / 3,
      "3:2": 3 / 2,
      "4:3": 4 / 3,
      "5:4": 5 / 4,
      "1:1": 1,
    };
    const aspect = Object.entries(aspects).sort(
      ([, left], [, right]) => Math.abs(left - ratio) - Math.abs(right - ratio),
    )[0][0];
    exportedModuleConfig.minimap.layout.map = {
      ...map,
      frontend,
      screen,
      position: {
        x: screen.left + screen.width / 2,
        y: screen.top + screen.height / 2,
      },
      size: screen.height,
      aspect,
    };
  }
  if (hasMinimap && exportedModuleConfig.minimap?.effects?.damageAssetId) {
    const damageAsset = migrated.assets.find(
      (asset) =>
        asset.id === exportedModuleConfig.minimap.effects.damageAssetId &&
        /\.(png|jpe?g|webp)$/i.test(String(asset.name || "")),
    );
    if (damageAsset)
      exportedModuleConfig.minimap.effects.damageAssetUrl = `https://cfx-nui-${resourceName}/assets/${damageAsset.name.replace(/[^a-z0-9._-]+/gi, "-")}`;
  }
  const timecycleData = hasTimecycle
    ? buildTimecycleModifierData(
        exportedModuleConfig.timecycle,
        resourceName,
        hasWeather ? exportedModuleConfig.weather : null,
      )
    : null;
  const weatherData =
    hasWeather && !hasTimecycle
      ? buildWeatherModifierData(exportedModuleConfig.weather, resourceName)
      : null;
  const atmosphereData = timecycleData || weatherData;
  if (timecycleData)
    exportedModuleConfig.timecycle.runtimeModifiers = timecycleData.modifiers;
  if (weatherData)
    exportedModuleConfig.weather.runtimeModifiers = weatherData.modifiers;
  const manifestFiles = [
    "data/workshop.json",
    ...(atmosphereData ? ["data/astral_timecycle.xml"] : []),
    ...(hasNui
      ? [
          "ui/index.html",
          "ui/crosshair.css",
          "ui/crosshair.js",
          "ui/crosshair-shape.js",
        ]
      : []),
    ...(migrated.assets.length ? ["assets/*"] : []),
  ];
  const config = {
    schemaVersion: migrated.schemaVersion,
    project: migrated.name,
    palette: migrated.palette,
    runtimeCapabilities: FIVEM_RUNTIME_CAPABILITIES,
    resolvedConflicts,
    modules: exportedModuleConfig,
    assets: migrated.assets.map(({ name, hash, moduleId, extension }) => ({
      name,
      hash,
      moduleId,
      extension,
      path: `assets/${name.replace(/[^a-z0-9._-]+/gi, "-")}`,
    })),
  };
  return {
    resourceName,
    files: {
      [`${resourceName}/fxmanifest.lua`]: [
        "fx_version 'cerulean'",
        "game 'gta5'",
        "author " + JSON.stringify(migrated.author || "ASTRAL Workshop"),
        "description " + JSON.stringify(migrated.description || migrated.name),
        "version '1.0.0'",
        "client_script 'client/astral_workshop.lua'",
        ...(hasNui ? ["ui_page 'ui/index.html'"] : []),
        `files { ${manifestFiles.map((path) => `'${path}'`).join(", ")} }`,
        ...(atmosphereData
          ? ["data_file 'TIMECYCLEMOD_FILE' 'data/astral_timecycle.xml'"]
          : []),
      ].join("\n"),
      ...(hasNui
        ? {
            [`${resourceName}/ui/index.html`]: CROSSHAIR_NUI_HTML,
            [`${resourceName}/ui/crosshair.css`]: `${CROSSHAIR_NUI_CSS}\n${CROSSHAIR_NUI_SHAPE_CSS}\n${MINIMAP_LAYOUT_NUI_CSS}`,
            [`${resourceName}/ui/crosshair.js`]: CROSSHAIR_NUI_JS,
            [`${resourceName}/ui/crosshair-shape.js`]: CROSSHAIR_NUI_SHAPE_JS,
          }
        : {}),
      ...(atmosphereData
        ? { [`${resourceName}/data/astral_timecycle.xml`]: atmosphereData.xml }
        : {}),
      [`${resourceName}/client/astral_workshop.lua`]: [
        "-- Generated by ASTRAL Workshop. Runtime coverage is declared in data/workshop.json.",
        "local resourceName = GetCurrentResourceName()",
        "local weatherNames = { clear='CLEAR', sunny='EXTRASUNNY', cloudy='CLOUDS', overcast='OVERCAST', fog='FOGGY', rain='RAIN', storm='THUNDER', smog='SMOG', snow='XMAS' }",
        "local currentConfig = nil",
        "local activeTracers = {}",
        "local lastTracerAt = 0",
        "local lastTracerKey = ''",
        "local activeMuzzleFlashes = {}",
        "local lastMuzzleFlashAt = 0",
        "local weaponBurstHeat = 0",
        "local activeImpactParticles = {}",
        "local activeImpactDecals = {}",
        "local lastImpactAt = 0",
        "local lastImpactKey = ''",
        "local lastCrosshairState = ''",
        "local lastCrosshairHitAt = 0",
        "local lastRadarState = ''",
        "local lastRadarHealth = 100",
        "local lastRadarDamageAt = 0",
        "local activeTimecycleName = ''",
        "local nextLightningAt = 0",
        "local lightningGlowUntil = 0",
        "local function clamp(value, minimum, maximum)",
        "  return math.min(maximum, math.max(minimum, tonumber(value) or minimum))",
        "end",
        "local function round(value)",
        "  return math.floor((tonumber(value) or 0) + 0.5)",
        "end",
        "local function hexColor(value, alpha)",
        "  local hex = tostring(value or '#ffffff'):gsub('#', '')",
        "  if #hex ~= 6 then hex = 'ffffff' end",
        "  return tonumber(hex:sub(1, 2), 16) or 255, tonumber(hex:sub(3, 4), 16) or 255, tonumber(hex:sub(5, 6), 16) or 255, round(clamp(alpha, 0, 100) * 2.55)",
        "end",
        "local function loadConfig()",
        "  local raw = LoadResourceFile(resourceName, 'data/workshop.json')",
        "  if not raw then return nil end",
        "  local ok, value = pcall(json.decode, raw)",
        "  return ok and value or nil",
        "end",
        "local function timecycleAllowed(timecycle, weather)",
        "  local binding = tostring(timecycle.weatherBinding or 'project')",
        "  if binding == 'any' or binding == 'project' then return true end",
        "  return weather and tostring(weather.profile or '') == binding",
        "end",
        "local function selectTimecycleModifier(timecycle, hour)",
        "  local modifiers = timecycle and timecycle.runtimeModifiers",
        "  if not modifiers or #modifiers == 0 then return nil end",
        "  local selected = modifiers[#modifiers]",
        "  for index = 1, #modifiers do if tonumber(modifiers[index].time) <= hour then selected = modifiers[index] else break end end",
        "  return selected",
        "end",
        "local function updateTimecycle(timecycle, weather)",
        "  local source = timecycle or weather",
        "  if not source or (timecycle and not timecycleAllowed(timecycle, weather)) then",
        "    if activeTimecycleName ~= '' then ClearTimecycleModifier(); activeTimecycleName = '' end",
        "    return",
        "  end",
        "  local hour = timecycle and (timecycle.clockMode == 'fixed' and clamp(timecycle.time, 0, 23.99) or GetClockHours() + GetClockMinutes() / 60.0) or 0",
        "  local selected = selectTimecycleModifier(source, hour)",
        "  if not selected or not selected.name then return end",
        "  if activeTimecycleName ~= selected.name then",
        "    local transition = clamp(timecycle and timecycle.transition or weather and weather.transition, 0, 60)",
        "    if activeTimecycleName ~= '' and tostring(timecycle and timecycle.interpolation or 'smooth') ~= 'step' and transition > 0 then SetTransitionTimecycleModifier(selected.name, transition) else SetTimecycleModifier(selected.name) end",
        "    activeTimecycleName = selected.name",
        "  end",
        "  SetTimecycleModifierStrength(timecycle and clamp(timecycle.modifierStrength, 0, 100) / 100 or 1.0)",
        "end",
        "local function selectedWeather(weather)",
        "  if not weather then return nil end",
        "  return weather.weatherProfiles and weather.weatherProfiles[weather.profile] or weather",
        "end",
        "local function updateWeather(weather)",
        "  local profile=selectedWeather(weather); if not profile then return end",
        "  local now=GetGameTimer(); local frequency=clamp(profile.lightningFrequency,0,100)",
        "  if frequency>0 and (weather.profile=='storm' or weather.profile=='rain') and now>=nextLightningAt then ForceLightningFlash(); lightningGlowUntil=now+90+round(clamp(profile.lightningBrightness,0,200)); nextLightningAt=now+1200+round((100-frequency)*170+math.random()*1600) end",
        "  if now<lightningGlowUntil then local ped=PlayerPedId(); local coords=GetEntityCoords(ped); local fade=clamp((lightningGlowUntil-now)/300,0,1); local brightness=clamp(profile.lightningBrightness,0,200)/100; DrawLightWithRange(coords.x,coords.y,coords.z+22,210,225,255,80,brightness*8*fade) end",
        "end",
        "local function applyRadarLayout(minimap)",
        "  if not minimap then SendNUIMessage({ type='radar-state', visible=false }); return end",
        "  local layout=minimap.layout or {}; local map=layout.map or {}; local position=map.position or {}",
        "  SetMinimapClipType(tostring(minimap.shape)=='circle' and 1 or 0)",
        "  local frontend=map.frontend",
        "  if frontend and frontend.minimap then",
        "    for _,name in ipairs({'minimap','minimap_mask','minimap_blur'}) do local entry=frontend[name]; if entry then SetMinimapComponentPosition(name,tostring(entry.alignX or 'L'),tostring(entry.alignY or 'B'),entry.posX+0.0,entry.posY+0.0,entry.sizeX+0.0,entry.sizeY+0.0) end end",
        "    if minimap.fixedNorth or minimap.rotate==false then LockMinimapAngle(0) else UnlockMinimapAngle() end",
        "    SendNUIMessage({ type='radar-configure', config=minimap })",
        "    lastRadarState=''",
        "    return",
        "  end",
        "  local ratios={['16:9']=16/9,['4:3']=4/3,['1:1']=1,['5:4']=5/4,['5:3']=5/3,['3:2']=3/2}; local ratio=ratios[tostring(map.aspect or '3:2')] or 1.5",
        "  local height=clamp(map.size or minimap.height/1080,0.06,0.55); local width=height*ratio*1080/1920",
        "  local x=clamp(position.x or 0.12,-0.5,1.5)-width/2; local y=clamp(position.y or 0.86,-0.5,1.5)-height/2; local alignX='L'; local alignY='T'",
        "  SetMinimapComponentPosition('minimap',alignX,alignY,x,y,width,height)",
        "  SetMinimapComponentPosition('minimap_mask',alignX,alignY,x,y,width,height)",
        "  SetMinimapComponentPosition('minimap_blur',alignX,alignY,x,y,width*1.08,height*1.08)",
        "  if minimap.fixedNorth or minimap.rotate==false then LockMinimapAngle(0) else UnlockMinimapAngle() end",
        "  SendNUIMessage({ type='radar-configure', config=minimap })",
        "  lastRadarState=''",
        "end",
        "local function applyStatic(config)",
        "  if not config or not config.modules then return false end",
        "  if config.modules.crosshair then SendNUIMessage({ type='configure', config=config.modules.crosshair }); lastCrosshairState = '' else SendNUIMessage({ type='state', visible=false }) end",
        "  applyRadarLayout(config.modules.minimap)",
        "  local weather = config.modules.weather",
        "  if weather then",
        "    local profile = selectedWeather(weather)",
        "    local weatherName = weatherNames[weather.profile] or 'CLEAR'",
        "    ClearOverrideWeather()",
        "    local transition=clamp(profile.transition,0,60); if transition>0 then SetWeatherTypeOvertimePersist(weatherName,transition) else SetWeatherTypeNowPersist(weatherName) end",
        "    SetRainLevel(clamp(profile.rain, 0, 100) / 100)",
        "    SetWindSpeed(clamp(profile.wind, 0, 100) * 0.12)",
        "    SetCloudsAlpha(clamp(profile.clouds,0,100)/100)",
        "    Citizen.InvokeNative(0x7F06937B0CDCBC1A, weather.profile=='snow' and clamp(profile.rain,0,100)/100 or 0.0)",
        "    nextLightningAt=GetGameTimer()+500",
        "  end",
        "  local timecycle = config.modules.timecycle",
        "  if timecycle and timecycle.time and timecycle.clockMode == 'fixed' then",
        "    local hour = math.floor(clamp(timecycle.time, 0, 23))",
        "    local minute = math.floor((clamp(timecycle.time, 0, 23.99) - hour) * 60)",
        "    NetworkOverrideClockTime(hour, minute, 0)",
        "  elseif timecycle then",
        "    NetworkClearClockTimeOverride()",
        "  end",
        "  updateTimecycle(timecycle, weather)",
        "  return true",
        "end",
        "local function applyRadar(minimap)",
        "  if not minimap then SendNUIMessage({ type='radar-state', visible=false }); return end",
        "  local ped = PlayerPedId()",
        "  local inVehicle = IsPedInAnyVehicle(ped, false)",
        "  local visible = not IsPauseMenuActive() and not IsEntityDead(ped) and not (minimap.hideOnFoot and not inVehicle)",
        "  if minimap.hideInteriors and GetInteriorFromEntity(ped) ~= 0 then visible = false end",
        "  DisplayRadar(visible)",
        "  local health=clamp(GetEntityHealth(ped)-100,0,100); local armor=clamp(GetPedArmour(ped),0,100); local now=GetGameTimer()",
        "  if health<lastRadarHealth then lastRadarDamageAt=now end; lastRadarHealth=health",
        "  local idle=GetEntitySpeed(ped)<.08 and not IsPlayerFreeAiming(PlayerId()) and not IsPedShooting(ped)",
        "  local damaged=now-lastRadarDamageAt<700; local stateKey=tostring(visible)..':'..round(health)..':'..round(armor)..':'..tostring(idle)..':'..tostring(damaged)",
        "  if stateKey~=lastRadarState then SendNUIMessage({ type='radar-state', visible=visible, health=health, armor=armor, idle=idle, damaged=damaged }); lastRadarState=stateKey end",
        "  if visible then local contextScale=inVehicle and minimap.drivingScale or minimap.footScale; local zoom=clamp(minimap.scale,0,200)*clamp(contextScale,60,150)/100; if minimap.speedZoom and inVehicle then zoom=zoom+clamp(GetEntitySpeed(ped)*1.25,0,45) end; SetRadarZoom(round(clamp(zoom,0,200))) end",
        "end",
        "local weaponGroups = {",
        "  [GetHashKey('GROUP_PISTOL')]='pistolScale', [GetHashKey('GROUP_SMG')]='smgScale', [GetHashKey('GROUP_RIFLE')]='rifleScale',",
        "  [GetHashKey('GROUP_SHOTGUN')]='shotgunScale', [GetHashKey('GROUP_SNIPER')]='sniperScale', [GetHashKey('GROUP_MG')]='machinegunScale',",
        "  [GetHashKey('GROUP_HEAVY')]='heavyScale'",
        "}",
        "local weaponEffectGroups = {",
        "  [GetHashKey('GROUP_PISTOL')]='pistol', [GetHashKey('GROUP_SMG')]='smg', [GetHashKey('GROUP_RIFLE')]='rifle',",
        "  [GetHashKey('GROUP_SHOTGUN')]='shotgun', [GetHashKey('GROUP_SNIPER')]='sniper', [GetHashKey('GROUP_MG')]='machinegun',",
        "  [GetHashKey('GROUP_HEAVY')]='heavy'",
        "}",
        "local function updateCrosshair(crosshair)",
        "  if not crosshair then return end",
        "  local player = PlayerId()",
        "  local ped = PlayerPedId()",
        "  local aiming = IsPlayerFreeAiming(player)",
        "  local visible = not IsPauseMenuActive() and not IsEntityDead(ped) and (not crosshair.hideOutsideAiming or aiming)",
        "  if aiming then HideHudComponentThisFrame(14) end",
        "  local spread = clamp(crosshair.minSpread, 0, 30)",
        "  if crosshair.dynamic and visible then",
        "    local speed = GetEntitySpeed(ped)",
        "    if IsPedSprinting(ped) then spread = spread + clamp(crosshair.movementExpansion, 0, 24)",
        "    elseif IsPedRunning(ped) or speed > 1.2 then spread = spread + clamp(crosshair.movementExpansion, 0, 24) * 0.55 end",
        "    if GetPedStealthMovement(ped) then spread = spread * 0.65 end",
        "    if IsPedShooting(ped) then spread = spread + clamp(crosshair.firingExpansion, 0, 30) + clamp(crosshair.recoilReaction, 0, 20) end",
        "  end",
        "  spread = clamp(spread, clamp(crosshair.minSpread, 0, 30), clamp(crosshair.maxSpread, 4, 60))",
        "  local aimingAtTarget = false",
        "  if visible and crosshair.targetColorEnabled then local found, entity = GetEntityPlayerIsFreeAimingAt(player); aimingAtTarget = found and entity ~= 0 and DoesEntityExist(entity) end",
        "  local weapon = GetSelectedPedWeapon(ped)",
        "  local profileKey = weaponGroups[GetWeapontypeGroup(weapon)] or 'otherScale'",
        "  local profileScale = clamp(crosshair[profileKey], 50, 160)",
        "  local stateKey = tostring(visible)..':'..string.format('%.1f',spread)..':'..profileKey..':'..tostring(aimingAtTarget)",
        "  if stateKey ~= lastCrosshairState then",
        "    SendNUIMessage({ type='state', visible=visible, spread=spread, profileScale=profileScale, target=aimingAtTarget })",
        "    lastCrosshairState = stateKey",
        "  end",
        "end",
        "local hitSounds = { tick={'SELECT','HUD_FRONTEND_DEFAULT_SOUNDSET'}, metal={'CHECKPOINT_PERFECT','HUD_MINI_GAME_SOUNDSET'}, arcade={'PICK_UP','HUD_FRONTEND_DEFAULT_SOUNDSET'} }",
        "AddEventHandler('entityDamaged', function(victim, culprit)",
        "  local crosshair = currentConfig and currentConfig.modules and currentConfig.modules.crosshair",
        "  if not crosshair or not crosshair.hitmarker or culprit ~= PlayerPedId() or not IsEntityAPed(victim) then return end",
        "  local now = GetGameTimer()",
        "  if now - lastCrosshairHitAt < 30 then return end",
        "  lastCrosshairHitAt = now",
        "  local foundBone, bone = GetPedLastDamageBone(victim)",
        "  local killed = IsEntityDead(victim) or GetEntityHealth(victim) <= 0",
        "  local kind = foundBone and bone == 31086 and 'critical' or GetPedArmour(victim) > 0 and 'armor' or 'health'",
        "  SendNUIMessage({ type='hit', kind=kind, killed=killed })",
        "  local sound = hitSounds[tostring(crosshair.hitSound or 'none')]",
        "  if sound then PlaySoundFrontend(-1, sound[1], sound[2], true) end",
        "end)",
        "RegisterNUICallback('ready', function(_, callback)",
        "  local crosshair = currentConfig and currentConfig.modules and currentConfig.modules.crosshair",
        "  if crosshair then SendNUIMessage({ type='configure', config=crosshair }); lastCrosshairState = '' end",
        "  local minimap = currentConfig and currentConfig.modules and currentConfig.modules.minimap",
        "  if minimap then SendNUIMessage({ type='radar-configure', config=minimap }); lastRadarState = '' end",
        "  callback({ ok=true })",
        "end)",
        "local function tracerPoint(origin, impact, ratio, jitter)",
        "  return { x=origin.x + (impact.x - origin.x) * ratio, y=origin.y + (impact.y - origin.y) * ratio, z=origin.z + (impact.z - origin.z) * ratio + math.sin(ratio * 12.566) * jitter }",
        "end",
        "local function drawTracerSegment(from, target, red, green, blue, alpha, tracers, alphaScale)",
        "  local style = tostring(tracers.type or 'line')",
        "  local intensity = clamp(tracers.glowIntensity, 10, 240) / 100",
        "  local glowSize = clamp(tracers.glow, 0, 40)",
        "  local layerCount = round(clamp(tracers.layers, 1, 6))",
        "  if style == 'beam' then layerCount = math.min(layerCount, 2) end",
        "  if style == 'line' or glowSize <= 0 then layerCount = 0 end",
        "  for layer = layerCount, 1, -1 do",
        "    local spread = (layer - (layerCount + 1) / 2) * glowSize * 0.00018",
        "    local glowAlpha = round(clamp(alpha * alphaScale * intensity / (layer + 1), 0, 255))",
        "    DrawLine(from.x, from.y, from.z + spread, target.x, target.y, target.z + spread, red, green, blue, glowAlpha)",
        "  end",
        "  local corePasses = round(clamp(tracers.core, 1, 12) / 3)",
        "  for pass = 1, corePasses do",
        "    local spread = (pass - (corePasses + 1) / 2) * 0.00032",
        "    DrawLine(from.x, from.y, from.z + spread, target.x, target.y, target.z + spread, red, green, blue, round(clamp(alpha * alphaScale * intensity, 0, 255)))",
        "  end",
        "end",
        "local function drawTracerPath(tracer, tracers, alpha)",
        "  local style = tostring(tracers.type or 'line')",
        "  local segments = style == 'particles' and 11 or style == 'dashed' and 9 or style == 'comet' and 5 or 1",
        "  local startRed, startGreen, startBlue = hexColor(tracers.color, 100)",
        "  local endRed, endGreen, endBlue = hexColor(tracers.endColor, 100)",
        "  for segment = 1, segments do",
        "    local shouldDraw = style ~= 'dashed' or segment % 2 == 1",
        "    if style == 'particles' then shouldDraw = segment % 2 == 1 or segment == segments end",
        "    if shouldDraw then",
        "      local fromRatio = (segment - 1) / segments",
        "      local toRatio = segment / segments",
        "      if style == 'particles' or style == 'dashed' then toRatio = math.min(toRatio, fromRatio + 0.58 / segments) end",
        "      local midpoint = (fromRatio + toRatio) / 2",
        "      local red = round(startRed + (endRed - startRed) * midpoint)",
        "      local green = round(startGreen + (endGreen - startGreen) * midpoint)",
        "      local blue = round(startBlue + (endBlue - startBlue) * midpoint)",
        "      local alphaScale = style == 'comet' and (0.28 + midpoint * 0.72) or style == 'particles' and (0.45 + midpoint * 0.55) or 1",
        "      drawTracerSegment(tracerPoint(tracer.start, tracer.impact, fromRatio, tracer.jitter), tracerPoint(tracer.start, tracer.impact, toRatio, tracer.jitter), red, green, blue, alpha, tracers, alphaScale)",
        "    end",
        "  end",
        "end",
        "local function captureTracer(tracers)",
        "  if not tracers then return end",
        "  local ped = PlayerPedId()",
        "  if not IsPedShooting(ped) then return end",
        "  local viewMode = GetFollowPedCamViewMode()",
        "  if (viewMode == 4 and not tracers.firstPerson) or (viewMode ~= 4 and not tracers.thirdPerson) then return end",
        "  local hour = GetClockHours()",
        "  if tracers.nightOnly and hour >= 7 and hour < 19 then return end",
        "  local now = GetGameTimer()",
        "  local cooldown = round(1000 / clamp(tracers.frequency, 1, 30))",
        "  if not tracers.automatic then cooldown = math.max(cooldown, 180) end",
        "  if now - lastTracerAt < cooldown then return end",
        "  local hit, impact = GetPedLastWeaponImpactCoord(ped)",
        "  if not hit or not impact then return end",
        "  local key = ('%d:%d:%d'):format(round(impact.x * 10), round(impact.y * 10), round(impact.z * 10))",
        "  if key == lastTracerKey and now - lastTracerAt < math.max(140, cooldown) then return end",
        "  local origin = GetPedBoneCoords(ped, 57005, 0.14, 0.02, 0.0)",
        "  local dx, dy, dz = impact.x - origin.x, impact.y - origin.y, impact.z - origin.z",
        "  local distance = math.sqrt(dx * dx + dy * dy + dz * dz)",
        "  if distance < clamp(tracers.minDistance, 0, 500) or distance > clamp(tracers.maxDistance, 10, 1000) then return end",
        "  if math.random(1, 100) > round(clamp(tracers.probability, 1, 100)) then lastTracerAt = now; return end",
        "  local length = clamp(tracers.length, 20, 100) / 100",
        "  local start = { x=impact.x + (origin.x - impact.x) * length, y=impact.y + (origin.y - impact.y) * length, z=impact.z + (origin.z - impact.z) * length }",
        "  local visibleAt = now + round(clamp(tracers.delay, 0, 300))",
        "  local duration = round(clamp(tracers.duration, 80, 1200))",
        "  local jitter = (math.random() - 0.5) * clamp(tracers.noise, 0, 40) / 80",
        "  activeTracers[#activeTracers + 1] = { start=start, impact=impact, jitter=jitter, visibleAt=visibleAt, expiresAt=visibleAt + duration }",
        "  local maximum = round(clamp(tracers.maxActive, 1, 64))",
        "  while #activeTracers > maximum do table.remove(activeTracers, 1) end",
        "  lastTracerAt = now",
        "  lastTracerKey = key",
        "end",
        "local function drawTracers(tracers)",
        "  if not tracers then activeTracers = {}; return end",
        "  captureTracer(tracers)",
        "  local now = GetGameTimer()",
        "  for index = #activeTracers, 1, -1 do",
        "    local tracer = activeTracers[index]",
        "    if now >= tracer.expiresAt then",
        "      table.remove(activeTracers, index)",
        "    elseif now >= tracer.visibleAt then",
        "      local duration = math.max(1, tracer.expiresAt - tracer.visibleAt)",
        "      local age = now - tracer.visibleAt",
        "      local remaining = tracer.expiresAt - now",
        "      local fadeIn = math.min(duration, clamp(tracers.fadeIn, 0, 600))",
        "      local fadeOut = math.min(duration, clamp(tracers.fade, 40, 900))",
        "      local appearFactor = fadeIn > 0 and math.min(1, age / fadeIn) or 1",
        "      local disappearFactor = remaining < fadeOut and remaining / fadeOut or 1",
        "      local alpha = clamp(tracers.tail, 0, 100) * math.min(appearFactor, disappearFactor)",
        "      drawTracerPath(tracer, tracers, alpha)",
        "    end",
        "  end",
        "end",
        "local function weaponMuzzlePosition(ped)",
        "  local weaponEntity = GetCurrentPedWeaponEntityIndex(ped)",
        "  if weaponEntity and weaponEntity ~= 0 then",
        "    local muzzleBone = GetEntityBoneIndexByName(weaponEntity, 'gun_muzzle')",
        "    if muzzleBone and muzzleBone >= 0 then return GetWorldPositionOfEntityBone(weaponEntity, muzzleBone) end",
        "  end",
        "  return GetPedBoneCoords(ped, 57005, 0.16, 0.02, 0.0)",
        "end",
        "local function drawWeaponEffects(effects)",
        "  if not effects then activeMuzzleFlashes = {}; return end",
        "  local ped = PlayerPedId()",
        "  local now = GetGameTimer()",
        "  local hour = GetClockHours()",
        "  local allowedByTime = not effects.nightOnly or hour < 7 or hour >= 19",
        "  if now-lastMuzzleFlashAt>240 then weaponBurstHeat=math.max(0,weaponBurstHeat-.08) end",
        "  if IsPedShooting(ped) and now - lastMuzzleFlashAt >= 35 then",
        "    local weapon = GetSelectedPedWeapon(ped)",
        "    local profileKey = weaponEffectGroups[GetWeapontypeGroup(weapon)] or 'rifle'",
        "    local profile = effects.weaponProfiles and effects.weaponProfiles[profileKey] or {}",
        "    local silenced = IsPedCurrentWeaponSilenced(ped)",
        "    local suppressorScale = silenced and (1 - clamp(effects.suppressor, 0, 100) / 125) or 1",
        "    local randomRange = clamp(effects.randomScale, 0, 60) / 100",
        "    local randomScale = 1 + (math.random() * 2 - 1) * randomRange",
        "    weaponBurstHeat=math.min(1,weaponBurstHeat+.16+clamp(effects.smokeBurstBuild,0,100)/500)",
        "    local origin = weaponMuzzlePosition(ped)",
        "    local duration = round(clamp(effects.duration, 20, 350))",
        "    local smokeDuration = round(clamp(effects.smokeDuration, 100, 5000))",
        "    activeMuzzleFlashes[#activeMuzzleFlashes + 1] = { origin=origin, createdAt=now, flashExpiresAt=now+duration, lightExpiresAt=now+round(clamp(effects.lightDuration,20,500)), smokeExpiresAt=now+smokeDuration, expiresAt=now+math.max(duration,smokeDuration,round(clamp(effects.shellLifetime,1,30)*1000)), flashScale=clamp(profile.flashScale,25,200)/100*randomScale*suppressorScale, smokeScale=clamp(profile.smokeScale,0,200)/100*(1+weaponBurstHeat*clamp(effects.overheat,0,100)/100), shellScale=clamp(profile.shellScale,0,200)/100, lightScale=clamp(profile.lightScale,0,200)/100, silenced=silenced, sparkCount=round((clamp(effects.sparks,0,100)+clamp(effects.aftershotParticles,0,100))*.035), shells={} }",
        "    local flash = activeMuzzleFlashes[#activeMuzzleFlashes]",
        "    for shellIndex = 1, round(clamp(effects.shells, 0, 8) * flash.shellScale) do flash.shells[#flash.shells + 1] = { x=origin.x, y=origin.y, z=origin.z, vx=(math.random()-.25)*.032*clamp(effects.shellImpulse,0,140)/100, vy=(math.random()-.5)*.026, vz=.035+math.random()*.035, spin=math.random()*360 } end",
        "    while #activeMuzzleFlashes > round(clamp(effects.maxActiveEffects, 8, 96)) do table.remove(activeMuzzleFlashes, 1) end",
        "    lastMuzzleFlashAt = now",
        "  end",
        "  for index = #activeMuzzleFlashes, 1, -1 do",
        "    local flash = activeMuzzleFlashes[index]",
        "    if now >= flash.expiresAt then",
        "      table.remove(activeMuzzleFlashes, index)",
        "    else",
        "      if allowedByTime and now<flash.flashExpiresAt then local life=math.max(1,flash.flashExpiresAt-flash.createdAt); local fade=clamp((flash.flashExpiresAt-now)/life,0,1); local r,g,b=hexColor(effects.flashColor,100); DrawLightWithRange(flash.origin.x,flash.origin.y,flash.origin.z,r,g,b,(.25+clamp(effects.flashSize,10,160)/115)*flash.flashScale,clamp(effects.intensity,10,240)/100*(1+clamp(effects.glow,0,100)/100)*fade); for sparkIndex=1,flash.sparkCount do local angle=(sparkIndex*2.399)+now*.018; local length=.025+sparkIndex*.008; DrawLine(flash.origin.x,flash.origin.y,flash.origin.z,flash.origin.x+math.cos(angle)*length,flash.origin.y+math.sin(angle)*length,flash.origin.z+(sparkIndex%3-1)*length,r,g,b,round(210*fade)) end end",
        "      if allowedByTime and now < flash.lightExpiresAt then",
        "        local life = math.max(1, flash.lightExpiresAt - flash.createdAt)",
        "        local fade = (clamp((flash.lightExpiresAt-now)/life,0,1)) ^ (1 + clamp(effects.lightFalloff,0,100)/50)",
        "        local radius = (0.4 + clamp(effects.flashSize,10,160)/80 + clamp(effects.lightRadius,0,100)/18) * flash.flashScale * flash.lightScale",
        "        local intensity = clamp(effects.lightIntensity,0,240)/100 * clamp(effects.intensity,10,240)/100 * (1+clamp(effects.glow,0,100)/100) * fade",
        "        local r,g,b = hexColor(effects.lightColor or effects.flashColor,100)",
        "        DrawLightWithRange(flash.origin.x,flash.origin.y,flash.origin.z,r,g,b,radius,intensity)",
        "      end",
        "      if now < flash.smokeExpiresAt and clamp(effects.smoke,0,100) > 0 then",
        "        local age = (now-flash.createdAt)/math.max(1,flash.smokeExpiresAt-flash.createdAt)",
        "        local density = clamp(effects.smoke,0,100)/100 * flash.smokeScale * ((1-age) ^ (.5+clamp(effects.smokeDissipation,0,100)/65)) * (flash.silenced and 1.15 or 1)",
        "        local size = clamp(effects.smokeSize,10,160)/100 * (.08+age*.22)",
        "        local r,g,b = hexColor(effects.smokeColor,100)",
        "        DrawMarker(28,flash.origin.x,flash.origin.y,flash.origin.z+age*.08,0,0,0,0,0,0,size,size,size,r,g,b,round(90*density),false,false,2,false,nil,nil,false)",
        "      end",
        "      for _,shell in ipairs(flash.shells) do shell.vz= shell.vz-.0009; shell.x=shell.x+shell.vx; shell.y=shell.y+shell.vy; shell.z=shell.z+shell.vz; shell.spin=shell.spin+14; local shellSize=clamp(effects.shellSize,40,180)*.00011; local sr,sg,sb=effects.shellMaterial=='steel' and 165 or effects.shellMaterial=='polymer' and 95 or 214,effects.shellMaterial=='steel' and 175 or effects.shellMaterial=='polymer' and 105 or 165,effects.shellMaterial=='steel' and 185 or effects.shellMaterial=='polymer' and 110 or 72; DrawMarker(28,shell.x,shell.y,shell.z,0,0,0,shell.spin,0,0,shellSize,shellSize*.45,shellSize*.45,sr,sg,sb,210,false,false,2,false,nil,nil,false) end",
        "    end",
        "  end",
        "end",
        "local materialGroups = {",
        "  metal={ 'METAL_SOLID_SMALL','METAL_SOLID_MEDIUM','METAL_SOLID_LARGE','METAL_HOLLOW_SMALL','METAL_HOLLOW_MEDIUM','METAL_HOLLOW_LARGE' },",
        "  wood={ 'WOOD_SOLID_SMALL','WOOD_SOLID_MEDIUM','WOOD_SOLID_LARGE','WOOD_HOLLOW_SMALL','WOOD_HOLLOW_MEDIUM','WOOD_HOLLOW_LARGE' },",
        "  glass={ 'GLASS_SUPER_THIN','GLASS_THIN','GLASS_MEDIUM','GLASS_THICK' }, stone={ 'STONE','PAVING_SLAB','GRAVEL_SMALL','GRAVEL_LARGE' },",
        "  earth={ 'SAND_LOOSE','SAND_COMPACT','DIRT_DRY','DIRT_TRACK','MUD_HARD','MUD_SOFT' }, water={ 'WATER','WATER_SHALLOW','WATER_DEEP' }",
        "}",
        "local materialLookup = {}",
        "for kind,names in pairs(materialGroups) do for _,name in ipairs(names) do materialLookup[GetHashKey(name)] = kind end end",
        "local impactDecalTypes = { bullet=1010, crack=1020, scorch=1030, blood=1110 }",
        "local impactSounds = { impact={'CHECKPOINT_NORMAL','HUD_MINI_GAME_SOUNDSET'}, metal={'CHECKPOINT_PERFECT','HUD_MINI_GAME_SOUNDSET'}, concrete={'CHECKPOINT_NORMAL','HUD_MINI_GAME_SOUNDSET'}, stone={'CHECKPOINT_NORMAL','HUD_MINI_GAME_SOUNDSET'}, wood={'SELECT','HUD_FRONTEND_DEFAULT_SOUNDSET'}, glass={'CHECKPOINT_MISSED','HUD_MINI_GAME_SOUNDSET'}, earth={'SELECT','HUD_FRONTEND_DEFAULT_SOUNDSET'}, water={'SELECT','HUD_FRONTEND_DEFAULT_SOUNDSET'}, flesh={'ERROR','HUD_AMMO_SHOP_SOUNDSET'} }",
        "local function classifyImpact(materialHash, entity)",
        "  if entity and entity ~= 0 then if IsEntityAVehicle(entity) then return 'vehicle' end; if IsEntityAPed(entity) then return 'character' end end",
        "  return materialLookup[materialHash] or 'concrete'",
        "end",
        "local function captureImpact(impacts)",
        "  if not impacts then return end",
        "  local ped=PlayerPedId(); if not IsPedShooting(ped) then return end",
        "  local now=GetGameTimer(); if now-lastImpactAt<35 then return end",
        "  local hit,impact=GetPedLastWeaponImpactCoord(ped); if not hit or not impact then return end",
        "  local key=('%d:%d:%d'):format(round(impact.x*10),round(impact.y*10),round(impact.z*10)); if key==lastImpactKey and now-lastImpactAt<180 then return end",
        "  local origin=weaponMuzzlePosition(ped); local dx,dy,dz=impact.x-origin.x,impact.y-origin.y,impact.z-origin.z; local distance=math.sqrt(dx*dx+dy*dy+dz*dz); if distance>clamp(impacts.distance,20,500) then return end",
        "  local ray=StartExpensiveSynchronousShapeTestLosProbe(origin.x,origin.y,origin.z,impact.x+dx*.02,impact.y+dy*.02,impact.z+dz*.02,511,ped,4)",
        "  local _,rayHit,endCoords,normal,materialHash,entity=GetShapeTestResultIncludingMaterial(ray); if not rayHit then endCoords=impact; normal=vector3(0,0,1) end",
        "  local kind=classifyImpact(materialHash,entity); local profile=impacts.materials and impacts.materials[kind] or impacts; if not profile then return end",
        "  local quality=tostring(impacts.quality or 'high'); local qualityScale=quality=='low' and .35 or quality=='medium' and .65 or 1; local count=round(clamp(profile.particles,0,120)*qualityScale); local r,g,b=hexColor(profile.color,100); local particleType=tostring(profile.particle or 'debris'); local sparkChance=math.max(clamp(profile.sparks,0,100),particleType=='sparks' and 100 or 0); local dustScale=math.max(clamp(profile.dust,0,100)/100,particleType=='dust' and 1 or 0); local shardScale=clamp(profile.shards,0,100)/100",
        "  for particleIndex=1,count do local speed=clamp(profile.speed,0,140)/100*(.006+math.random()*.022)*(1+shardScale*.5); activeImpactParticles[#activeImpactParticles+1]={ x=endCoords.x,y=endCoords.y,z=endCoords.z,vx=normal.x*speed+(math.random()-.5)*(.012+shardScale*.018),vy=normal.y*speed+(math.random()-.5)*(.012+shardScale*.018),vz=math.abs(normal.z)*speed+math.random()*.018,createdAt=now,expiresAt=now+300+round(clamp(profile.duration,1,120)*12),r=r,g=g,b=b,size=clamp(profile.size,2,100)/100,spark=math.random()*100<sparkChance,dust=dustScale } end",
        "  while #activeImpactParticles>round(clamp(impacts.maxParticles,100,2000)) do table.remove(activeImpactParticles,1) end",
        "  local decalType=impactDecalTypes[tostring(profile.decal or 'none')]; if decalType and clamp(profile.decalOpacity,0,100)>0 then local decal=AddDecal(decalType,endCoords.x,endCoords.y,endCoords.z,normal.x,normal.y,normal.z,0,1,0,clamp(profile.decalSize,4,100)/50,clamp(profile.decalSize,4,100)/50,r/255,g/255,b/255,clamp(profile.decalOpacity,0,100)/100,clamp(profile.duration,1,120),distance>120,false,false); activeImpactDecals[#activeImpactDecals+1]={id=decal,expiresAt=now+round(math.min(clamp(profile.duration,1,120),clamp(impacts.cleanupTime,5,120))*1000)}; while #activeImpactDecals>round(clamp(impacts.maxDecals,20,500)) do local old=table.remove(activeImpactDecals,1); if old and old.id then RemoveDecal(old.id) end end end",
        "  local sound=impactSounds[tostring(profile.sound or 'none')]; if sound and clamp(profile.intensity,0,160)>0 then PlaySoundFromCoord(-1,sound[1],endCoords.x,endCoords.y,endCoords.z,sound[2],false,math.floor(clamp(profile.intensity,0,160)*20),false) end",
        "  lastImpactAt=now; lastImpactKey=key",
        "end",
        "local function drawImpacts(impacts)",
        "  if not impacts then activeImpactParticles={}; return end; captureImpact(impacts); local now=GetGameTimer()",
        "  for index=#activeImpactParticles,1,-1 do local p=activeImpactParticles[index]; if now>=p.expiresAt then table.remove(activeImpactParticles,index) else local px,py,pz=p.x,p.y,p.z; p.vz=p.vz-.0007; p.x=p.x+p.vx; p.y=p.y+p.vy; p.z=p.z+p.vz; local alpha=round(255*clamp((p.expiresAt-now)/math.max(1,p.expiresAt-p.createdAt),0,1)); if p.spark then DrawLine(px,py,pz,p.x,p.y,p.z,p.r,p.g,p.b,alpha) else local scale=.012+p.size*.035; DrawMarker(28,p.x,p.y,p.z,0,0,0,0,0,0,scale,scale,scale,p.r,p.g,p.b,round(alpha*(.35+p.dust*.45)),false,false,2,false,nil,nil,false) end end end",
        "  for index=#activeImpactDecals,1,-1 do local decal=activeImpactDecals[index]; if now>=decal.expiresAt then if decal.id then RemoveDecal(decal.id) end; table.remove(activeImpactDecals,index) end end",
        "end",
        "local function reloadWorkshop()",
        "  currentConfig = loadConfig()",
        "  return applyStatic(currentConfig)",
        "end",
        "CreateThread(function()",
        "  Wait(750)",
        "  if reloadWorkshop() then print(('[ASTRAL] Applied supported runtime settings for %s'):format(resourceName)) end",
        "  while true do Wait(30000); reloadWorkshop() end",
        "end)",
        "CreateThread(function()",
        "  while true do",
        "    Wait(500)",
        "    local modules = currentConfig and currentConfig.modules",
        "    if modules then updateTimecycle(modules.timecycle, modules.weather) end",
        "  end",
        "end)",
        "CreateThread(function()",
        "  while true do",
        "    local modules = currentConfig and currentConfig.modules",
        "    if modules and (modules.minimap or modules.crosshair or modules.tracers or modules['weapon-effects'] or modules.impacts or modules.weather) then",
        "      Wait(0)",
        "      applyRadar(modules.minimap)",
        "      updateCrosshair(modules.crosshair)",
        "      drawTracers(modules.tracers)",
        "      drawWeaponEffects(modules['weapon-effects'])",
        "      drawImpacts(modules.impacts)",
        "      updateWeather(modules.weather)",
        "    else",
        "      Wait(250)",
        "    end",
        "  end",
        "end)",
        "AddEventHandler('onResourceStop', function(stoppedResource)",
        "  if stoppedResource ~= resourceName then return end",
        "  DisplayRadar(true)",
        "  UnlockMinimapAngle()",
        "  SetMinimapClipType(0)",
        "  SetMinimapComponentPosition('minimap','L','B',-0.0045,-0.022,0.150,0.188888)",
        "  SetMinimapComponentPosition('minimap_mask','L','B',0.020,-0.022,0.111,0.159)",
        "  SetMinimapComponentPosition('minimap_blur','L','B',-0.030,-0.010,0.266,0.237)",
        "  ClearOverrideWeather()",
        "  ClearWeatherTypePersist()",
        "  SetRainLevel(-1.0)",
        "  SetWindSpeed(-1.0)",
        "  SetCloudsAlpha(1.0)",
        "  Citizen.InvokeNative(0x7F06937B0CDCBC1A, 0.0)",
        "  NetworkClearClockTimeOverride()",
        "  ClearTimecycleModifier()",
        "  activeTracers = {}",
        "  activeMuzzleFlashes = {}",
        "  activeImpactParticles = {}",
        "  for _,decal in ipairs(activeImpactDecals) do if decal.id then RemoveDecal(decal.id) end end",
        "  activeImpactDecals = {}",
        "  SendNUIMessage({ type='state', visible=false })",
        "  SendNUIMessage({ type='radar-state', visible=false })",
        "end)",
        "RegisterCommand('astralworkshop_reload', function() reloadWorkshop() end, false)",
      ].join("\n"),
      [`${resourceName}/data/workshop.json`]: JSON.stringify(config, null, 2),
      [`${resourceName}/README.txt`]: [
        `ASTRAL Workshop export: ${migrated.name}`,
        "",
        "1. Copy this folder into your server resources directory.",
        `2. Add ensure ${resourceName} to server.cfg.`,
        "3. Review data/workshop.json before enabling the resource.",
        "",
        "Runtime: weather profiles and transitions, cloud/rain/snow intensity, lightning, clock and generated atmosphere modifiers, contextual radar layout/scale/visibility with HUD states, crosshair, tracers, weapon effects, material particles and bounded decals.",
        "Every other field remains available as validated declarative configuration for compatible client scripts.",
        "The exact field-level coverage is stored in data/workshop.json under runtimeCapabilities.",
      ].join("\n"),
    },
  };
}

function pushUint16(target, value) {
  target.push(value & 0xff, (value >>> 8) & 0xff);
}

function pushUint32(target, value) {
  target.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  );
}

export function createStoredZip(files) {
  const output = [];
  const central = [];
  let offset = 0;
  let count = 0;
  for (const [path, raw] of Object.entries(files)) {
    if (!safeArchivePath(path))
      throw new Error(projectMessage("unsafeExportPath", path));
    const name = encoder.encode(path);
    const data = raw instanceof Uint8Array ? raw : encoder.encode(String(raw));
    const crc = crc32(data);
    const local = [];
    pushUint32(local, 0x04034b50);
    pushUint16(local, 20);
    pushUint16(local, 0x0800);
    pushUint16(local, 0);
    pushUint16(local, 0);
    pushUint16(local, 0);
    pushUint32(local, crc);
    pushUint32(local, data.length);
    pushUint32(local, data.length);
    pushUint16(local, name.length);
    pushUint16(local, 0);
    const localBytes = new Uint8Array([...local, ...name, ...data]);
    output.push(localBytes);

    const entry = [];
    pushUint32(entry, 0x02014b50);
    pushUint16(entry, 20);
    pushUint16(entry, 20);
    pushUint16(entry, 0x0800);
    pushUint16(entry, 0);
    pushUint16(entry, 0);
    pushUint16(entry, 0);
    pushUint32(entry, crc);
    pushUint32(entry, data.length);
    pushUint32(entry, data.length);
    pushUint16(entry, name.length);
    pushUint16(entry, 0);
    pushUint16(entry, 0);
    pushUint16(entry, 0);
    pushUint16(entry, 0);
    pushUint32(entry, 0);
    pushUint32(entry, offset);
    central.push(new Uint8Array([...entry, ...name]));
    offset += localBytes.length;
    count += 1;
  }
  const centralOffset = offset;
  const centralSize = central.reduce((size, entry) => size + entry.length, 0);
  const end = [];
  pushUint32(end, 0x06054b50);
  pushUint16(end, 0);
  pushUint16(end, 0);
  pushUint16(end, count);
  pushUint16(end, count);
  pushUint32(end, centralSize);
  pushUint32(end, centralOffset);
  pushUint16(end, 0);
  return new Blob([...output, ...central, new Uint8Array(end)], {
    type: "application/zip",
  });
}

export function parseStoredZip(raw) {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  if (bytes.length > ASTRALPACK_MAX_BYTES)
    throw new Error(tr("astralpack превышает безопасный размер 192 МБ"));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  let offset = 0;
  let totalSize = 0;
  while (
    offset + 4 <= bytes.length &&
    view.getUint32(offset, true) === 0x04034b50
  ) {
    if (Object.keys(files).length >= ASTRALPACK_MAX_ENTRIES)
      throw new Error(tr("astralpack содержит слишком много файлов"));
    if (offset + 30 > bytes.length)
      throw new Error(tr("Повреждённый ZIP-заголовок"));
    const flags = view.getUint16(offset + 6, true);
    const compression = view.getUint16(offset + 8, true);
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    if ((flags & 0x01) !== 0)
      throw new Error(tr("Зашифрованные astralpack не поддерживаются"));
    if (flags & 0x08 || compression !== 0)
      throw new Error(tr("astralpack использует неподдерживаемое сжатие"));
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length)
      throw new Error(tr("Файл в astralpack обрезан"));
    const path = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    if (!safeArchivePath(path))
      throw new Error(tr("Пакет содержит небезопасный путь"));
    if (Object.hasOwn(files, path))
      throw new Error(projectMessage("duplicatePath", path));
    totalSize += size;
    if (totalSize > ASTRALPACK_MAX_BYTES)
      throw new Error(
        tr("Распакованный astralpack превышает безопасный размер 192 МБ"),
      );
    files[path] = bytes.slice(dataStart, dataEnd);
    offset = dataEnd;
  }
  if (!Object.keys(files).length)
    throw new Error(tr("astralpack не содержит файлов"));
  if (offset + 4 <= bytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x02014b50 && signature !== 0x06054b50)
      throw new Error(
        tr("astralpack содержит повреждённые данные после файлов"),
      );
  }
  return files;
}

async function archiveFilesForProject(project) {
  const migrated = migrateWorkshopProject(project);
  const assetFiles = {};
  const assets = [];
  for (const [index, asset] of migrated.assets.entries()) {
    const validation = validateWorkshopAsset(asset);
    if (!validation.valid || !asset.storageKey) continue;
    const blob = await getWorkshopAsset(asset.storageKey);
    if (!blob) continue;
    const archivePath = `assets/${String(index + 1).padStart(3, "0")}-${asset.name.replace(/[^a-z0-9._-]+/gi, "-")}`;
    assetFiles[archivePath] = await workshopBlobBytes(blob);
    assets.push({ ...asset, archivePath });
  }
  const portableProject = {
    ...migrated,
    appliedSnapshots: [],
    installations: [],
    assets: assets.map((asset) => {
      const portableAsset = { ...asset };
      delete portableAsset.storageKey;
      return portableAsset;
    }),
  };
  const projectJson = JSON.stringify(portableProject, null, 2);
  const manifest = {
    format: "astralpack",
    version: 1,
    schemaVersion: migrated.schemaVersion,
    name: migrated.name,
    author: migrated.author,
    description: migrated.description,
    targets: [migrated.target],
    modules: migrated.enabledModules,
    assets: assets.map(({ name, size, type, hash, archivePath }) => ({
      name,
      size,
      type,
      hash,
      archivePath,
    })),
    createdAt: new Date().toISOString(),
    requirements: {
      application: "ASTRAL",
      minimumSchemaVersion: WORKSHOP_SCHEMA_VERSION,
    },
    checksums: { algorithm: "crc32", file: "checksums.json" },
  };
  const manifestJson = JSON.stringify(manifest, null, 2);
  const checksummed = {
    "manifest.json": manifestJson,
    "project.json": projectJson,
    ...assetFiles,
  };
  const checksums = Object.fromEntries(
    Object.entries(checksummed).map(([path, value]) => [path, checksum(value)]),
  );
  return {
    ...checksummed,
    "checksums.json": JSON.stringify(
      { algorithm: "crc32", files: checksums },
      null,
      2,
    ),
  };
}

export async function parseAstralPackFile(file) {
  const bytes = await workshopBlobBytes(file);
  if (bytes.length > ASTRALPACK_MAX_BYTES)
    throw new Error(tr("astralpack превышает безопасный размер 192 МБ"));
  if (!beginsWithZip(bytes)) {
    const project = parseAstralPack(decoder.decode(bytes));
    return {
      project,
      manifest: null,
      assets: [],
      review: {
        legacy: true,
        legacyKind: "json",
        fileCount: 1,
        totalBytes: bytes.length,
        checksumCount: 0,
        moduleIds: project.enabledModules,
        assetCount: 0,
        assetBytes: 0,
        conflicts: detectWorkshopConflicts(project),
      },
    };
  }
  const files = parseStoredZip(bytes);
  for (const path of Object.keys(files)) validateArchivePathPolicy(path);
  for (const path of ASTRALPACK_CORE_FILES)
    if (!files[path]) throw new Error(projectMessage("packMissing", path));

  const manifest = parseJsonBytes(files, "manifest.json", "Manifest");
  const checksums = parseJsonBytes(
    files,
    "checksums.json",
    tr("Список контрольных сумм"),
  );
  if (
    checksums?.algorithm !== "crc32" ||
    !checksums.files ||
    typeof checksums.files !== "object" ||
    Array.isArray(checksums.files)
  )
    throw new Error(tr("Некорректный список контрольных сумм astralpack"));
  const payloadPaths = Object.keys(files)
    .filter((path) => path !== "checksums.json")
    .sort();
  const checksummedPaths = Object.keys(checksums.files).sort();
  if (!sameStringList(payloadPaths, checksummedPaths))
    throw new Error(tr("Контрольные суммы покрывают не все файлы astralpack"));
  for (const path of payloadPaths) {
    const expected = checksums.files[path];
    if (
      !/^[0-9a-f]{8}$/i.test(String(expected)) ||
      checksum(files[path]) !== expected
    )
      throw new Error(projectMessage("checksumMismatch", path));
  }

  const sourceProject = parseJsonBytes(files, "project.json", tr("Проект"));
  const sourceSchemaVersion = Number(sourceProject.schemaVersion || 1);
  const project = migrateWorkshopProject(sourceProject);
  project.appliedSnapshots = [];
  project.installations = [];
  const validation = validateWorkshopProject(project);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  validatePortableManifest(manifest, project, sourceSchemaVersion);

  const manifestAssets = manifest.assets;
  if (manifestAssets.length !== project.assets.length)
    throw new Error(tr("Список assets manifest не совпадает с проектом"));
  const assets = [];
  const declaredAssetPaths = new Set();
  for (const asset of project.assets) {
    const assetValidation = validateWorkshopAsset(asset);
    if (!assetValidation.valid)
      throw new Error(
        projectMessage("badAsset", asset.name, assetValidation.error),
      );
    if (
      !asset.archivePath ||
      !files[asset.archivePath] ||
      !asset.archivePath.startsWith("assets/")
    )
      throw new Error(projectMessage("assetNotInPack", asset.name));
    if (declaredAssetPaths.has(asset.archivePath))
      throw new Error(projectMessage("assetPathTwice", asset.archivePath));
    declaredAssetPaths.add(asset.archivePath);
    const manifestAsset = manifestAssets.find(
      (item) => item?.archivePath === asset.archivePath,
    );
    if (
      !manifestAsset ||
      manifestAsset.name !== asset.name ||
      manifestAsset.hash !== asset.hash ||
      Number(manifestAsset.size) !== Number(asset.size) ||
      manifestAsset.type !== asset.type
    )
      throw new Error(projectMessage("assetMeta", asset.name));
    const assetBytes = files[asset.archivePath];
    if (assetBytes.length !== Number(asset.size))
      throw new Error(projectMessage("assetSize", asset.name));
    const prepared = await prepareWorkshopAsset({
      name: asset.name,
      size: assetBytes.length,
      type: asset.type,
      arrayBuffer: async () =>
        assetBytes.buffer.slice(
          assetBytes.byteOffset,
          assetBytes.byteOffset + assetBytes.byteLength,
        ),
    });
    if (prepared.metadata.hash !== asset.hash)
      throw new Error(projectMessage("assetSha", asset.name));
    assets.push({ asset, blob: prepared.blob });
  }
  for (const path of Object.keys(files).filter((path) =>
    path.startsWith("assets/"),
  ))
    if (!declaredAssetPaths.has(path))
      throw new Error(projectMessage("undeclaredAsset", path));
  for (const path of Object.keys(files).filter((path) =>
    path.startsWith("previews/"),
  )) {
    if (files[path].length > 16 * 1024 * 1024)
      throw new Error(projectMessage("previewSize", path));
  }
  return {
    project,
    manifest,
    assets,
    review: {
      legacy:
        sourceSchemaVersion < WORKSHOP_SCHEMA_VERSION || !manifest.checksums,
      legacyKind:
        sourceSchemaVersion < WORKSHOP_SCHEMA_VERSION
          ? "schema"
          : manifest.checksums
            ? null
            : "manifest",
      sourceSchemaVersion,
      fileCount: Object.keys(files).length,
      totalBytes: bytes.length,
      checksumCount: payloadPaths.length,
      moduleIds: project.enabledModules,
      assetCount: assets.length,
      assetBytes: assets.reduce((total, item) => total + item.asset.size, 0),
      conflicts: detectWorkshopConflicts(project),
    },
  };
}

const beginsWithZip = (bytes) =>
  bytes[0] === 0x50 &&
  bytes[1] === 0x4b &&
  bytes[2] === 0x03 &&
  bytes[3] === 0x04;

export async function createAstralPackArchive(project) {
  return createStoredZip(await archiveFilesForProject(project));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadAstralPack(project) {
  const safeName =
    project.name.replace(/[\\/:*?"<>|]+/g, "-") || "AstralProject";
  downloadBlob(
    await createAstralPackArchive(project),
    `${safeName}.astralpack`,
  );
}

export async function downloadFiveMResource(project) {
  const { resourceName, blob } = await createFiveMResourceArchive(project);
  downloadBlob(blob, `${resourceName}.zip`);
}

export async function createFiveMResourceArchive(project) {
  const { resourceName, files } = buildFiveMFiles(project);
  for (const asset of project.assets || []) {
    if (!asset.storageKey)
      throw new Error(projectMessage("noStorageKey", asset.name || "asset"));
    const blob = await getWorkshopAsset(asset.storageKey);
    if (!blob)
      throw new Error(projectMessage("localMissing", asset.name || "asset"));
    files[
      `${resourceName}/assets/${asset.name.replace(/[^a-z0-9._-]+/gi, "-")}`
    ] = await workshopBlobBytes(blob);
  }
  return { resourceName, blob: createStoredZip(files) };
}

export function decodeTextAsset(bytes) {
  return decoder.decode(bytes);
}
