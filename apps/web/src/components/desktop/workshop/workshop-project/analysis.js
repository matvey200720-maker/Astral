/*
 * Оценки поверх готового проекта: как часто открывали модуль, во что набор
 * обойдётся по производительности и какие модули конфликтуют между собой.
 * Ничего не меняют — только считают.
 */
import { WORKSHOP_CONFLICT_DEFINITIONS } from "./catalog.js";
import { tr } from "../../../../locales/ui.js";

export function moduleUsageScore(project, id, now = Date.now()) {
  const usage = project?.usage?.[id] || {};
  const ageDays = usage.lastOpened
    ? Math.max(0, (now - new Date(usage.lastOpened).getTime()) / 86400000)
    : 180;
  return (
    Number(usage.opens || 0) * 3 +
    Math.max(0, 24 - ageDays) +
    (usage.pinned ? 60 : 0) +
    (usage.favorite ? 24 : 0) +
    (project?.enabledModules?.includes(id) ? 18 : 0)
  );
}

export function performanceEstimate(project) {
  let score = 0;
  const warnings = [];
  const map = project?.modules?.["world-map"];
  const impacts = project?.modules?.impacts;
  const tracers = project?.modules?.tracers;
  const weaponEffects = project?.modules?.["weapon-effects"];
  const weather = project?.modules?.weather;
  const crosshair = project?.modules?.crosshair;
  const vegetation = project?.modules?.vegetation;
  if (Number(map?.export?.resolution) >= 8192) {
    score += 35;
    warnings.push(tr("Карта 8K заметно увеличивает размер пакета"));
  }
  if ((impacts?.maxDecals || 0) > 250 || (impacts?.maxParticles || 0) > 1000) {
    score += 30;
    warnings.push(tr("Превышен рекомендуемый лимит decals и частиц"));
  }
  if (
    (tracers?.maxActive || 0) > 32 ||
    (tracers?.duration || 0) > 800 ||
    (tracers?.layers || 0) > 4 ||
    (tracers?.glowIntensity || 0) > 180
  ) {
    score += 20;
    warnings.push(tr("Слишком много долгоживущих трейсеров"));
  }
  if (
    (weaponEffects?.maxActiveEffects || 0) > 64 ||
    (weaponEffects?.smokeDuration || 0) > 3000 ||
    (weaponEffects?.shells || 0) > 5
  ) {
    score += 24;
    warnings.push(tr("Слишком много долгоживущих эффектов оружия"));
  }
  if (
    (weather?.reflections || 0) > 105 ||
    (weather?.lightningFrequency || 0) > 80 ||
    ((weather?.rain || 0) > 90 && (weather?.fog || 0) > 70)
  ) {
    score += 14;
    warnings.push(
      tr("Плотные осадки, туман и частые молнии могут снизить FPS"),
    );
  }
  if ((crosshair?.glow || 0) > 22 || (crosshair?.shadow || 0) > 80) {
    score += 4;
    warnings.push(tr("Интенсивные эффекты прицела увеличивают нагрузку NUI"));
  }
  if ((vegetation?.density || 0) > 95 || (vegetation?.distance || 0) > 95) {
    score += 30;
    warnings.push(tr("Высокая плотность растительности"));
  }
  score += Math.max(0, (project?.enabledModules?.length || 0) - 6) * 3;
  return {
    score,
    label:
      score < 22
        ? tr("Лёгкий")
        : score < 46
          ? tr("Средний")
          : score < 75
            ? tr("Тяжёлый")
            : tr("Очень тяжёлый"),
    warnings,
  };
}

export function detectWorkshopConflicts(project) {
  const disabled = new Set(project?.disabledModules || []);
  const active = new Set(
    (project?.enabledModules || []).filter((id) => !disabled.has(id)),
  );
  return Object.entries(WORKSHOP_CONFLICT_DEFINITIONS)
    .filter(([, definition]) =>
      definition.modules.every((id) => active.has(id)),
    )
    .map(([id, definition]) => {
      const selectedSource = definition.options.includes(
        project?.conflictResolutions?.[id],
      )
        ? project.conflictResolutions[id]
        : null;
      const safeMerge = definition.strategy === "safe-merge";
      return {
        id,
        modules: [...definition.modules],
        message: tr(definition.message),
        strategy: definition.strategy,
        options: [...definition.options],
        selectedSource,
        resolved: safeMerge || Boolean(selectedSource),
        resolution: safeMerge
          ? "safe-merge"
          : selectedSource
            ? "user-choice"
            : "choice-required",
      };
    });
}

export function unresolvedWorkshopConflicts(project) {
  return detectWorkshopConflicts(project).filter(
    (conflict) => !conflict.resolved,
  );
}

export function resolveWorkshopConflict(project, conflictId, source) {
  const definition = WORKSHOP_CONFLICT_DEFINITIONS[conflictId];
  if (
    !definition ||
    definition.strategy !== "choose-source" ||
    !definition.options.includes(source)
  ) {
    throw new Error(tr("Недопустимый вариант разрешения конфликта"));
  }
  const activeConflict = detectWorkshopConflicts(project).find(
    (conflict) => conflict.id === conflictId,
  );
  if (!activeConflict) throw new Error(tr("Конфликт больше не активен"));
  return {
    ...project,
    conflictResolutions: {
      ...(project.conflictResolutions || {}),
      [conflictId]: source,
    },
  };
}
