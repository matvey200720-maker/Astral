import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  MagicWand,
  PencilSimple,
  Tree,
} from "../../../ui/icons.jsx";

import { tr, useTr } from "../../../../locales/ui.js";
import { PhotoSkeleton } from "../../../ui/Skeleton.jsx";
import {
  ICONS,
  WorkshopCompatibilityBadge,
  clamp,
  useWorkshopAssetUrl,
  useWorkshopLocalization,
} from "./shared.jsx";

/*
 * Карточка модуля на витрине мастерской и её живой предпросмотр.
 */

function WorkshopMiniPreview({
  module,
  config = module.defaults,
  compact = false,
  compare = false,
  assets = [],
  previewState = "idle",
  crosshairWeaponProfile = "all",
}) {
  const { translate: t } = useWorkshopLocalization();
  const previewHour = Number(config.time ?? 12);
  const timecycleSource =
    module.id !== "timecycle"
      ? null
      : previewHour < 6 || previewHour >= 19
        ? module.timePreviews?.night
        : previewHour >= 17
          ? module.timePreviews?.sunset
          : module.timePreviews?.day;
  const previewSource =
    module.profilePreviews?.[config.material || config.profile] ||
    timecycleSource ||
    module.cardPreview;
  const [sourceState, setSourceState] = useState(
    previewSource ? "loading" : "missing",
  );
  useEffect(
    () => setSourceState(previewSource ? "loading" : "missing"),
    [previewSource],
  );
  const weaponProfile = config.weaponProfiles?.[config.weaponClass] || {};
  const weaponScenarioScale =
    { single: 1, burst: 1.3, suppressed: 0.45, overheat: 1.5 }[previewState] ||
    1;
  const accent =
    module.id === "crosshair" &&
    config.targetColorEnabled &&
    previewState === "target"
      ? config.targetColor
      : module.id === "sniper-scope"
        ? config.reticle
        : config.color ||
          config.routeColor ||
          config.accent ||
          config.flashColor ||
          config.sky ||
          module.accent;
  const isNight = [
    "timecycle",
    "weather",
    "tracers",
    "weapon-effects",
  ].includes(module.id);
  const sceneColorGrading = ["timecycle", "weather"].includes(module.id);
  const sourceFilters = [
    "timecycle",
    "weather",
    "world-map",
    "weapon-effects",
    "impacts",
  ].includes(module.id);
  const mapAnchor = config.anchor || "bottom-left";
  const mapOffsetX = `${clamp(Number(config.x ?? 28), 0, 120) / 5}%`;
  const mapOffsetY = `${clamp(Number(config.y ?? 28), 0, 120) / 5}%`;
  const customCrosshairAsset =
    module.id === "crosshair" && config.shape === "custom"
      ? assets.find(
          (asset) =>
            asset.moduleId === "crosshair" &&
            /\.(png|svg)$/i.test(String(asset.name || "")),
        )
      : null;
  const customCrosshairUrl = useWorkshopAssetUrl(customCrosshairAsset);
  const baseSpread = Number(config.minSpread ?? config.gap ?? 7);
  const crosshairSpread = clamp(
    baseSpread +
      ({
        walking: Number(config.movementExpansion || 0) * 0.55,
        running: Number(config.movementExpansion || 0),
        crouching: -baseSpread * 0.35,
        single:
          Number(config.firingExpansion || 0) +
          Number(config.recoilReaction || 0) * 0.45,
        burst: Number(config.maxSpread || 24),
        hit: 0,
        critical: 0,
      }[previewState] || 0),
    Number(config.minSpread || 0),
    Number(config.maxSpread || 60),
  );
  const showHitmarker =
    module.id === "crosshair" &&
    config.hitmarker &&
    ["hit", "armor", "critical"].includes(previewState);
  const minimapInVehicle = ["vehicle", "speed"].includes(previewState);
  const minimapContextScale =
    Number(minimapInVehicle ? config.drivingScale : config.footScale) || 100;
  const minimapSpeedScale =
    previewState === "speed" && config.speedZoom ? 1.16 : 1;
  const minimapHidden =
    module.id === "minimap" &&
    ((previewState === "foot" && config.hideOnFoot) ||
      (previewState === "interior" && config.hideInteriors));
  const minimapOpacity =
    previewState === "idle"
      ? Number(config.idleOpacity ?? config.opacity ?? 100)
      : Number(config.opacity ?? 100);
  const minimapHealth =
    previewState === "low-health" ? 12 : previewState === "damage" ? 61 : 100;
  const minimapArmor = previewState === "damage" ? 38 : 100;
  const minimapRotation =
    config.fixedNorth || !config.rotate
      ? 0
      : { foot: -5, vehicle: 13, speed: 24, damage: -12 }[previewState] || 0;
  const style = {
    "--studio-accent": accent,
    "--studio-accent-two": config.endColor || config.horizon || module.accent,
    "--studio-preview-opacity":
      module.id === "minimap"
        ? minimapOpacity / 100
        : Number(config.opacity || 100) / 100,
    "--studio-cross-gap": `${Number(config.gap || 0) + (config.dynamic ? crosshairSpread : 0)}px`,
    "--studio-cross-size": `${config.length || 14}px`,
    "--studio-cross-weight": `${config.thickness || 2}px`,
    "--studio-cross-dot": `${config.shape === "dot" || config.showCenterDot !== false ? (config.dotSize ?? config.dot ?? 3) : 0}px`,
    "--studio-cross-circle": `${config.circleSize || 28}px`,
    "--studio-cross-outline": `${config.outlineEnabled === false ? 0 : (config.outlineWidth ?? 1)}px`,
    "--studio-cross-outline-color":
      config.outlineColor || config.outline || "#101419",
    "--studio-cross-glow": `${config.glow || 0}px`,
    "--studio-cross-glow-color": config.glowColor || accent,
    "--studio-cross-shadow": `${Number(config.shadow || 0) / 18}px`,
    "--studio-cross-shadow-color": config.shadowColor || "#000000",
    "--studio-cross-rotation": `${config.rotation || 0}deg`,
    "--studio-cross-scale": Number(config.scale || 100) / 100,
    "--studio-cross-smooth-radius": `${clamp(Number(config.smoothing ?? 100), 0, 100) * 0.99}px`,
    "--studio-cross-smoothing": `${40 + (100 - Number(config.returnSmoothness ?? config.smoothing ?? 70)) * 4}ms`,
    "--studio-scope-diameter": `${clamp(Number(config.diameter || 76), 40, 100)}%`,
    "--studio-scope-lens": config.lensColor || "#101a24",
    "--studio-scope-lens-opacity": Number(config.lensOpacity ?? 48) / 100,
    "--studio-scope-lens-mix": `${Number(config.lensOpacity ?? 48)}%`,
    "--studio-scope-vignette": Number(config.vignette ?? 82) / 100,
    "--studio-scope-vignette-soft": Number(config.vignette ?? 82) * 0.0072,
    "--studio-scope-vignette-strong": Number(config.vignette ?? 82) * 0.0082,
    "--studio-scope-reticle-opacity": Number(config.opacity ?? 92) / 100,
    "--studio-scope-thickness": `${Number(config.thickness || 2)}px`,
    "--studio-scope-horizontal": `${clamp(Number(config.horizontalLength || 92), 20, 100)}%`,
    "--studio-scope-vertical": `${clamp(Number(config.verticalLength || 92), 20, 100)}%`,
    "--studio-scope-gap": `${Number(config.centerGap || 0)}px`,
    "--studio-scope-dot": `${Number(config.dotSize || 0)}px`,
    "--studio-scope-circle": `${Number(config.circleSize || 24)}px`,
    "--studio-scope-tick": `${Number(config.tickSize || 7)}px`,
    "--studio-scope-rotation": `${Number(config.rotation || 0)}deg`,
    "--studio-scope-glow": `${Number(config.glow || 0)}px`,
    "--studio-scope-glow-color":
      config.glowColor || config.reticle || "#b9d7ff",
    "--studio-scope-sway": `${Number(config.sway || 0) / 16}px`,
    "--studio-scope-sway-negative": `${Number(config.sway || 0) / -16}px`,
    "--studio-scope-sway-soft": `${Number(config.sway || 0) * 0.021875}px`,
    "--studio-scope-sway-soft-negative": `${Number(config.sway || 0) * -0.021875}px`,
    "--studio-hit-size": `${config.hitSize || 22}px`,
    "--studio-hit-color":
      previewState === "critical"
        ? config.criticalColor
        : previewState === "armor"
          ? config.armorColor
          : config.healthColor || config.hitColor,
    "--studio-hit-duration": `${config.hitDuration || 180}ms`,
    "--studio-map-radius":
      config.shape === "circle" ? "50%" : `${config.radius ?? 18}px`,
    "--studio-map-left": mapAnchor.endsWith("left") ? mapOffsetX : "auto",
    "--studio-map-right": mapAnchor.endsWith("right") ? mapOffsetX : "auto",
    "--studio-map-top": mapAnchor.startsWith("top") ? mapOffsetY : "auto",
    "--studio-map-bottom": mapAnchor.startsWith("bottom") ? mapOffsetY : "auto",
    "--studio-map-x": mapOffsetX,
    "--studio-map-y": mapOffsetY,
    "--studio-map-width": `${(clamp(Number(config.width ?? 260), 160, 420) / 7) * (Number(config.scale || 100) / 100) * (minimapContextScale / 100) * minimapSpeedScale}%`,
    "--studio-map-ratio":
      config.shape === "circle"
        ? "1"
        : `${Math.max(1, Number(config.width || 260) / Math.max(1, Number(config.height || 180)))}`,
    "--studio-map-rotation": `${minimapRotation}deg`,
    "--studio-rotation-smoothness": `${clamp(Number(config.rotationSmoothness || 0), 0, 100) * 4}ms`,
    "--studio-map-water": config.waterColor || config.water || "#163654",
    "--studio-map-land": config.landColor || config.land || "#24443e",
    "--studio-map-background": config.backgroundColor || "#0a1221",
    "--studio-map-border": `${Number(config.border ?? 2)}px`,
    "--studio-map-border-color": config.borderColor || "#eaf0ff",
    "--studio-map-crop": `${Number(config.crop || 0)}%`,
    "--studio-map-softness": `${Number(config.edgeSoftness || 0)}px`,
    "--studio-map-shadow": `${Number(config.shadow ?? 40) / 100}`,
    "--studio-map-inner-glow": `${Number(config.innerGlow || 0)}px`,
    "--studio-map-brightness": `${Number(config.brightness || 100) / 100}`,
    "--studio-map-saturation": `${Number(config.saturation ?? 100) / 100}`,
    "--studio-map-contrast": `${Number(config.contrast || 100) / 100}`,
    "--studio-route-width": `${Number(config.routeWidth || 6)}px`,
    "--studio-route-opacity": `${Number(config.routeOpacity ?? 100) / 100}`,
    "--studio-route-glow": `${Number(config.routeGlow ?? 14)}px`,
    "--studio-blip-size": `${Number(config.blipSize || 100) / 100}`,
    "--studio-blip-opacity": `${Number(config.blipOpacity ?? 100) / 100}`,
    "--studio-blip-color": config.blipColor || "#ff5d72",
    "--studio-ally-color": config.allyColor || "#69d891",
    "--studio-enemy-color": config.enemyColor || "#ff557b",
    "--studio-target-color": config.targetColor || "#ffd36d",
    "--studio-route-active-color": config.routeActiveColor || "#ffffff",
    "--studio-missed-turn-color": config.missedTurnColor || "#ff596d",
    "--studio-health-level": `${minimapHealth}%`,
    "--studio-armor-level": `${minimapArmor}%`,
    "--studio-health-color": config.healthColor || "#ffffff",
    "--studio-armor-color": config.armorColor || "#97dcff",
    "--studio-vitals-width": `${Number(config.barWidth || 100)}%`,
    "--studio-vitals-thickness": `${Number(config.barThickness || 8)}px`,
    "--studio-sky": config.sky || (isNight ? "#171b38" : "#708db4"),
    "--studio-horizon": config.horizon || config.sky || "#d98272",
    "--studio-ambient": config.ambient || config.sky || "#7583ad",
    "--studio-sun": config.sun || "#ffe0b3",
    "--studio-moon": config.moon || "#e3ebff",
    "--studio-fog-color": config.fogColor || "#8990a7",
    "--studio-water-tint": config.waterTint || "#27496d",
    "--studio-bloom": `${Number(config.bloom || 0) / 3}px`,
    "--studio-shadow-intensity": Number(config.shadowIntensity ?? 50) / 100,
    "--studio-muzzle-size": `${(Number(config.flashSize || 70) * Number(weaponProfile.flashScale || 100) * weaponScenarioScale) / 100}px`,
    "--studio-muzzle-intensity": Number(config.intensity || 100) / 100,
    "--studio-smoke-opacity":
      (Number(config.smoke || 0) *
        Number(weaponProfile.smokeScale || 100) *
        (previewState === "overheat" ? 1.6 : 1)) /
      10000,
    "--studio-smoke-size": `${Number(config.smokeSize || 60) * weaponScenarioScale}px`,
    "--studio-smoke-color": config.smokeColor || "#b9bdc4",
    "--studio-impact-size": `${Number(config.size || 42)}px`,
    "--studio-impact-particles": Number(config.particles || 24) / 30,
    "--studio-impact-dust": Number(config.dust || 0) / 100,
    "--studio-impact-sparks": Number(config.sparks || 0) / 100,
    "--studio-impact-decal": Number(config.decalOpacity || 0) / 100,
    "--studio-cloud-opacity": Number(config.clouds || 0) / 100,
    "--studio-cloud-color": config.cloudColor || "#a8b4c6",
    "--studio-cloud-duration": `${Math.max(5, 42 - Number(config.cloudSpeed || 0) * 0.32)}s`,
    "--studio-rain-opacity": Number(config.rain || 0) / 100,
    "--studio-rain-size": Number(config.rainDropSize || 100) / 100,
    "--studio-weather-fog":
      Math.max(
        Number(config.fog || 0),
        100 - Number(config.visibility || 100),
      ) / 100,
    "--studio-weather-sky": config.sky || "#6f9bc5",
    "--studio-lightning": Number(config.lightningBrightness || 0) / 200,
    "--studio-lightning-frequency": `${Math.max(1.2, 12 - Number(config.lightningFrequency || 0) * 0.1)}s`,
    "--studio-wetness": Number(config.wetness || 0) / 100,
    "--studio-fog": `${config.fog || config.fogDensity || 0}%`,
    "--studio-tracer-core": `${config.core || config.thickness || 3}px`,
    "--studio-tracer-glow": `${(Number(config.glow ?? 18) * clamp(Number(config.glowIntensity || 100), 10, 240)) / 100}px`,
    "--studio-tracer-glow-soft": `${(Number(config.glow ?? 18) * clamp(Number(config.glowIntensity || 100), 10, 240)) / 300}px`,
    "--studio-tracer-glow-wide": `${(Number(config.glow ?? 18) * clamp(Number(config.glowIntensity || 100), 10, 240)) / 200}px`,
    "--studio-tracer-duration": `${clamp(Number(config.duration || 420), 80, 1200)}ms`,
    "--studio-tracer-delay": `${clamp(Number(config.delay || 0), 0, 300)}ms`,
    "--studio-tracer-length": clamp(Number(config.length || 72), 20, 100) / 100,
    "--studio-tracer-right": `${12 + (100 - clamp(Number(config.length || 72), 20, 100)) * 0.83}%`,
    "--studio-tracer-tail": clamp(Number(config.tail ?? 68), 0, 100) / 100,
    "--studio-tracer-noise": `${clamp(Number(config.noise || 0), 0, 40) / 8}px`,
    "--studio-scene-brightness": `${sourceFilters ? Number(config.brightness || config.exposure || config.intensity || 100) / 100 : 1}`,
    "--studio-scene-contrast": `${sourceFilters ? Number(config.contrast || 100) / 100 : 1}`,
    "--studio-scene-saturation": `${sourceFilters ? Number(config.saturation ?? 100) / 100 : 1}`,
  };
  const scopeDivisionCount = Math.min(
    20,
    Math.max(0, Math.round(Number(config.divisions || 0))),
  );
  const scopeTicks = Array.from({ length: scopeDivisionCount }, (_, index) => ({
    id: index + 1,
    offset: `${((index + 1) / (scopeDivisionCount + 1) - 0.5) * 72}%`,
  }));
  return (
    <div
      className={`studio-preview-scene studio-preview-${module.id} scenario-${previewState} material-${config.material || "default"} weather-${config.profile || "default"}${compact ? " is-compact" : ""}${compare ? " is-before" : ""}${sourceState === "loaded" ? " has-source-media" : ""}`}
      style={style}
      data-module={module.id}
      data-weapon-profile={
        module.id === "crosshair" ? crosshairWeaponProfile : undefined
      }
      aria-label={`${t("Предпросмотр")}: ${module.title}`}
    >
      {previewSource && sourceState !== "failed" && (
        <img
          className="studio-preview-source"
          src={previewSource}
          alt=""
          decoding="async"
          draggable="false"
          onLoad={() => setSourceState("loaded")}
          onError={() => setSourceState("failed")}
        />
      )}
      {sourceState === "loaded" && sceneColorGrading && (
        <span className="studio-preview-colorwash" />
      )}
      <span className="studio-scene-sky" />
      <span className="studio-scene-moon" />
      <span className="studio-scene-city studio-scene-city-back" />
      <span className="studio-scene-city studio-scene-city-front" />
      <span className="studio-scene-road" />
      {(module.id === "minimap" || module.id === "blips-gps") && (
        <span
          className={`studio-mini-map shape-${config.shape || "rounded"}${minimapHidden ? " is-context-hidden" : ""}${config.routeAnimation ? " route-animated" : ""}${config.lowHealthPulse && previewState === "low-health" ? " is-low-health" : ""}`}
        >
          {module.id === "minimap" && previewSource && (
            <img
              className="studio-minimap-map-texture"
              src={previewSource}
              alt=""
              draggable="false"
            />
          )}
          <span className="studio-minimap-map-layer">
            <i className="studio-map-route">
              <b />
            </i>
            <i
              className={`studio-map-player marker-${config.playerMarker || "stock"}`}
            />
            <i
              className={`studio-map-gps marker-${config.gpsMarker || "stock"}`}
            />
            <i
              className={`studio-map-blip one set-${config.iconSet || "standard"}`}
            />
            <i
              className={`studio-map-blip two set-${config.iconSet || "standard"}`}
            />
            <i
              className={`studio-map-blip three set-${config.iconSet || "standard"}`}
            />
            {config.fixedNorth && (
              <strong className="studio-minimap-north">N</strong>
            )}
          </span>
          {module.id === "minimap" && (
            <>
              <span
                className={`studio-minimap-vitals is-${config.vitalsPosition || "stock"}${config.lowHealthPulse && previewState === "low-health" ? " is-pulsing" : ""}`}
              >
                <i
                  className={
                    config.healthGradient ? "health is-gradient" : "health"
                  }
                >
                  <u />
                </i>
                <i className="armor">
                  <u />
                </i>
                {(config.showHealthNumbers || config.showArmorNumbers) && (
                  <b>
                    {config.showHealthNumbers ? `${minimapHealth} HP` : ""}
                    {config.showHealthNumbers && config.showArmorNumbers
                      ? " · "
                      : ""}
                    {config.showArmorNumbers ? `${minimapArmor} ARMOR` : ""}
                  </b>
                )}
              </span>
              {config.minimapText && (
                <em
                  className={`studio-minimap-label font-${config.minimapFont || "stock"}`}
                >
                  {config.minimapText}
                </em>
              )}
              {config.showRange100 && (
                <i className="studio-minimap-range range-100" />
              )}
              {config.showRange125 && (
                <i className="studio-minimap-range range-125" />
              )}
              {config.damageFlash && previewState === "damage" && (
                <i className="studio-minimap-damage" />
              )}
            </>
          )}
        </span>
      )}
      {module.id === "crosshair" && (
        <span
          className={`studio-crosshair is-${config.shape || "cross"}${config.ring && config.shape !== "ring" ? " has-ring" : ""} state-${previewState}${config.hideOutsideAiming && previewState === "holstered" ? " is-hidden" : ""}`}
        >
          <span className="studio-crosshair-shape">
            <i className="top" />
            <i className="right" />
            <i className="bottom" />
            <i className="left" />
            <b />
            <u className="studio-crosshair-ring" />
            <em>
              {customCrosshairUrl && <img src={customCrosshairUrl} alt="" />}
            </em>
          </span>
          {showHitmarker && (
            <span
              className={`studio-hitmarker is-${config.hitShape || "x"} animation-${config.hitAnimation || "pop"}`}
            >
              <i />
              <i />
              <i />
              <i />
              {config.killMarker && previewState === "critical" && <b />}
            </span>
          )}
        </span>
      )}
      {module.id === "sniper-scope" && (
        <span
          className={`studio-sniper-scope${config.lensEnabled === false ? " is-lens-hidden" : ""}${config.showCircle ? " has-circle" : ""}`}
        >
          <span className="studio-sniper-lens" />
          <span className="studio-sniper-reticle">
            <i className="horizontal left" />
            <i className="horizontal right" />
            <i className="vertical top" />
            <i className="vertical bottom" />
            <b className="center-dot" />
            <b className="center-circle" />
            <span className="studio-sniper-ticks horizontal">
              {scopeTicks.map((tick) => (
                <i
                  key={`h-${tick.id}`}
                  style={{ "--studio-tick-offset": tick.offset }}
                />
              ))}
            </span>
            <span className="studio-sniper-ticks vertical">
              {scopeTicks.map((tick) => (
                <i
                  key={`v-${tick.id}`}
                  style={{ "--studio-tick-offset": tick.offset }}
                />
              ))}
            </span>
          </span>
          <em>{Number(config.zoom || 6)}×</em>
        </span>
      )}
      {module.id === "tracers" && (
        <span className="studio-shot">
          <i className="studio-muzzle" />
          <i className={`studio-tracer is-${config.type || "line"}`} />
          <i className="studio-impact" />
        </span>
      )}
      {module.id === "weapon-effects" && (
        <span className="studio-weapon-detail">
          <i className="studio-weapon-smoke one" />
          <i className="studio-weapon-smoke two" />
          <i className="studio-shell one" />
          <i className="studio-shell two" />
        </span>
      )}
      {module.id === "impacts" && (
        <span className="studio-impact-detail">
          <b />
        </span>
      )}
      {module.id === "hud" && (
        <span className="studio-hud">
          <i className="health" />
          <i className="armor" />
          <b>30 / 120</b>
          <em>N&nbsp;&nbsp; 024° &nbsp;&nbsp;NE</em>
        </span>
      )}
      {module.id === "arenas" && (
        <span className="studio-arena">
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
      {module.id === "interiors" && (
        <span className="studio-interior">
          <i />
          <i />
          <i />
        </span>
      )}
      {module.id === "vegetation" && (
        <span className="studio-trees">
          <Tree />
          <Tree />
          <Tree />
          <Tree />
        </span>
      )}
      {(module.id === "timecycle" || module.id === "weather") && (
        <span className="studio-atmosphere">
          {module.id !== "weather" && (
            <>
              <i className="cloud one" />
              <i className="cloud two" />
            </>
          )}
          {module.id !== "weather" && Number(config.rain || 0) > 0 && (
            <i className={config.profile === "snow" ? "snow" : "rain"} />
          )}
          {module.id === "weather" && (
            <>
              <i className="weather-fog" />
              <i className="weather-lightning" />
              <i className="weather-wetness" />
            </>
          )}
          <b>
            {module.id === "timecycle"
              ? `${String(Math.floor(config.time || 0)).padStart(2, "0")}:00`
              : config.profile || "cloudy"}
          </b>
        </span>
      )}
      <span className="studio-preview-vignette" />
    </div>
  );
}

function WorkshopCard({ module, project, onOpen, index }) {
  useTr();
  const { translate: t } = useWorkshopLocalization();
  const Icon = ICONS[module.id] || MagicWand;
  const enabled = project?.enabledModules?.includes(module.id);
  const usage = project?.usage?.[module.id];
  const hasPreset = project?.userPresets?.some(
    (preset) => preset.modules?.[module.id],
  );
  const [mediaLoaded, setMediaLoaded] = useState(false);
  const [mediaFailed, setMediaFailed] = useState(false);
  const editBuildingAction = ["mega-mall", "you-tool"].includes(module.id)
    ? `edit-${module.id}`
    : null;
  return (
    <article className="studio-module-card">
      <button
        type="button"
        className="studio-module-open"
        onClick={onOpen}
        aria-label={`${t("Открыть")} ${module.title}`}
      >
        <WorkshopMiniPreview
          module={module}
          config={project?.modules?.[module.id]}
          compact
        />
        {module.cardPreview && !mediaFailed && (
          <span
            className={`studio-card-media${mediaLoaded ? " is-loaded" : ""}`}
            data-fit={module.cardFit || "cover"}
            aria-hidden="true"
          >
            <PhotoSkeleton />
            <img
              data-photo=""
              src={module.cardPreview}
              alt=""
              loading={index < 4 ? "eager" : "lazy"}
              decoding="async"
              fetchPriority={index < 2 ? "high" : "auto"}
              onLoad={() => setMediaLoaded(true)}
              onError={() => setMediaFailed(true)}
            />
          </span>
        )}
        <span className="studio-card-shade" />
        <span className="studio-card-icon">
          <Icon />
        </span>
        <span className="studio-card-copy">
          <strong>{tr(module.title)}</strong>
          <small>{tr(module.description)}</small>
          <span className="studio-card-badges">
            <WorkshopCompatibilityBadge targets={module.compatibility} />
            {enabled && (
              <em>
                <Check /> {t("В проекте")}
              </em>
            )}
            {usage?.dirty && (
              <em className="is-dirty">{t("Есть изменения")}</em>
            )}
            {hasPreset && (
              <em className="is-preset">
                <MagicWand /> {t("Есть пресет")}
              </em>
            )}
          </span>
        </span>
        {editBuildingAction ? (
          <PencilSimple
            className="studio-card-arrow studio-card-edit-icon"
            data-card-action={editBuildingAction}
            aria-hidden="true"
          />
        ) : (
          <ArrowRight className="studio-card-arrow" aria-hidden="true" />
        )}
      </button>
    </article>
  );
}

export { WorkshopMiniPreview, WorkshopCard };
