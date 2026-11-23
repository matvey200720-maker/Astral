/*
 * Кастомизатор уличных фонарей.
 *
 * Рамка редактора общая (`components/ui/EditorShell.jsx`): шапка с названием и
 * действиями, сцена по центру, колонка ручек справа. Своя шапка здесь была, и
 * она была четвёртой в мастерской — со своей высотой, своей кнопкой «назад» и
 * своим представлением о том, где стоит «Сохранить».
 *
 * Кадр рисует общее окно предпросмотра (см. `StreetLightPreview3D.jsx`), а с
 * ним приходят настоящие сутки из таймцикла игры. Для фонаря это не украшение:
 * его настраивают по тому, как он выглядит в темноте, и час суток здесь —
 * главный орган управления, а не фон.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowClockwise, FloppyDisk } from "../../../components/ui/icons.jsx";
import {
  STREET_LIGHT_BINDING_SCHEMA,
  STREET_LIGHT_PRESET_SCHEMA,
  applyStreetLightPreset,
  createDefaultStreetLightDesign,
  normalizeStreetLightModule,
} from "@modovik/street-light-contract";
import Button from "../../../components/ui/Button.jsx";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import StreetLightApplyDialog from "./StreetLightApplyDialog.jsx";
import StreetLightPreview3D from "./StreetLightPreview3D.jsx";
import { getStreetLightCapabilities } from "../../../api.js";
import Checkbox from "../../../components/ui/Checkbox.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import ColorInput from "../../../components/ui/ColorInput.jsx";

const PRESETS = [
  ["Натриевый город", { mode: "temperature", kelvin: 2700 }, 1.05, 1],
  ["Нейтральный LED", { mode: "temperature", kelvin: 4300 }, 1.15, 1.05],
  ["Холодная луна", { mode: "rgb", rgb: "#86CFFF" }, 0.95, 1.15],
  ["Неоновая ночь", { mode: "rgb", rgb: "#9B6CFF" }, 1.35, 1.2],
];

function Range({
  label,
  value,
  min,
  max,
  step = 0.05,
  onChange,
  suffix = "×",
}) {
  return (
    <label className="street-light-range">
      <span>
        <b>{label}</b>
        <output>
          {Number(value).toFixed(step < 0.1 ? 2 : 1)}
          {suffix}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export default function StreetLightCustomizer({
  config: configInput,
  project,
  dirty,
  canUndo,
  canRedo,
  onChange,
  onUndo,
  onRedo,
  onSave,
  onCancel,
  onInstallationChange,
}) {
  useTr();
  const config = useMemo(
    () => normalizeStreetLightModule(configInput, project.target),
    [configInput, project.target],
  );
  const [applyOpen, setApplyOpen] = useState(false);
  const [coverage, setCoverage] = useState({
    phase: "loading",
    profileId: null,
    families: [],
    message: tr("Проверяем build…"),
  });
  const design = config.design;
  useEffect(() => {
    let active = true;
    if (project.target !== "gta5-legacy-story") {
      setCoverage({
        phase: "preview",
        profileId: null,
        families: [],
        message: tr("Apply доступен после отдельной проверки этой платформы."),
      });
      return () => {
        active = false;
      };
    }
    void getStreetLightCapabilities()
      .then((capabilities) => {
        if (!active) return;
        setCoverage({
          phase: capabilities.applyReady ? "ready" : "blocked",
          profileId: capabilities.profileId || null,
          families: capabilities.families || [],
          message: capabilities.applyReady
            ? tr("Точный Legacy build и coverage подтверждены.")
            : capabilities.reason || tr("Этот build не прошёл Apply-gate."),
        });
      })
      .catch((error) => {
        if (active)
          setCoverage({
            phase: "blocked",
            profileId: null,
            families: [],
            message: error.message,
          });
      });
    return () => {
      active = false;
    };
  }, [project.target]);
  const selectedFamilyId = config.binding?.familyIds[0] || "";
  const selectedFamily = coverage.families.find(
    (family) => family.familyId === selectedFamilyId,
  );
  const timecycleStreetLights = Number(
    project.modules?.timecycle?.streetLights,
  );
  const previewContextMultiplier =
    project.enabledModules?.includes("timecycle") &&
    !project.disabledModules?.includes("timecycle") &&
    Number.isFinite(timecycleStreetLights)
      ? Math.min(1.6, Math.max(0, timecycleStreetLights / 100))
      : 1;
  const commitDesign = (nextDesign, label, path) =>
    onChange({ ...config, design: nextDesign }, label, path);
  const patchSection = (section, patch, label, path) =>
    commitDesign(
      { ...design, [section]: { ...design[section], ...patch } },
      label,
      path,
    );
  const applyPreset = (preset) => {
    const [, color, intensityMultiplier, rangeMultiplier] = preset;
    commitDesign(
      applyStreetLightPreset(design, {
        schema: STREET_LIGHT_PRESET_SCHEMA,
        values: {
          light: {
            ...design.light,
            color,
            intensityMultiplier,
            rangeMultiplier,
          },
          corona: design.corona,
          volumetric: design.volumetric,
          decoration: design.decoration,
        },
      }),
      `Применён пресет «${preset[0]}»`,
      "design",
    );
  };
  const reset = () => {
    const defaults = createDefaultStreetLightDesign(
      design.designId,
      design.name,
    );
    commitDesign(defaults, "Сброшены параметры фонарей", "design");
  };
  const bindCandidate = (familyId) => {
    if (
      coverage.phase !== "ready" ||
      !coverage.profileId ||
      !coverage.families.some((family) => family.familyId === familyId)
    )
      return;
    onChange(
      {
        ...config,
        binding: {
          schema: STREET_LIGHT_BINDING_SCHEMA,
          bindingId: `binding:street-lights:${project.id}`,
          designId: design.designId,
          profileId: coverage.profileId,
          familyIds: [familyId],
        },
      },
      "Выбрано проверенное семейство фонарей",
      "binding",
    );
  };

  return (
    <EditorShell
      className="street-light-editor"
      inspectorClassName="street-light-controls"
      onBack={onCancel}
      kicker={tr("Мастерская")}
      title={tr("Уличные фонари")}
      status={dirty ? tr("Есть несохранённые изменения") : tr("Проект сохранён")}
      actions={
        <EditorActions
          onUndo={onUndo}
          canUndo={canUndo}
          onRedo={onRedo}
          canRedo={canRedo}
          more={[
            {
              value: "save",
              label: tr("Сохранить проект"),
              icon: <FloppyDisk />,
            },
            { value: "reset", label: tr("Сбросить"), icon: <ArrowClockwise /> },
          ]}
          onMore={(action) => (action === "save" ? onSave() : reset())}
          onCancel={onCancel}
          apply={{
            label: tr("Применить"),
            disabled: coverage.phase !== "ready" || !selectedFamily,
            onClick: () => setApplyOpen(true),
          }}
        />
      }
      inspector={
        <>
          <section className="ui-panel">
            <h2>{tr("Быстрый стиль")}</h2>
            <div className="street-light-presets">
              {PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset[0]}
                  onClick={() => applyPreset(preset)}
                >
                  {preset[0]}
                </button>
              ))}
            </div>
          </section>
          <section className="ui-panel">
            <h2>{tr("Цвет и свет")}</h2>
            <div className="street-light-color-row">
              <button
                type="button"
                className={
                  design.light.color.mode === "temperature" ? "is-active" : ""
                }
                onClick={() =>
                  patchSection(
                    "light",
                    { color: { mode: "temperature", kelvin: 3200 } },
                    "Изменён режим цвета",
                    "design.light.color",
                  )
                }
              >
                {tr("Температура")}
              </button>
              <button
                type="button"
                className={design.light.color.mode === "rgb" ? "is-active" : ""}
                onClick={() =>
                  patchSection(
                    "light",
                    { color: { mode: "rgb", rgb: "#FFD09A" } },
                    "Изменён режим цвета",
                    "design.light.color",
                  )
                }
              >
                RGB
              </button>
              {design.light.color.mode === "rgb" ? (
                <ColorInput
                  className="ui-color-chip"
                  value={design.light.color.rgb}
                  aria-label={tr("Цвет света")}
                  onChange={(event) =>
                    patchSection(
                      "light",
                      { color: { mode: "rgb", rgb: event.target.value } },
                      "Изменён цвет света",
                      "design.light.color.rgb",
                    )
                  }
                />
              ) : (
                <input
                  type="number"
                  min="1000"
                  max="20000"
                  step="100"
                  value={design.light.color.kelvin}
                  aria-label={tr("Температура света")}
                  onChange={(event) =>
                    patchSection(
                      "light",
                      {
                        color: {
                          mode: "temperature",
                          kelvin: Number(event.target.value),
                        },
                      },
                      "Изменена температура света",
                      "design.light.color.kelvin",
                    )
                  }
                />
              )}
            </div>
            <Range
              label={tr("Яркость")}
              value={design.light.intensityMultiplier}
              min={0}
              max={4}
              onChange={(value) =>
                patchSection(
                  "light",
                  { intensityMultiplier: value },
                  "Изменена яркость",
                  "design.light.intensityMultiplier",
                )
              }
            />
            <Range
              label={tr("Радиус света")}
              value={design.light.rangeMultiplier}
              min={0.25}
              max={2.5}
              onChange={(value) =>
                patchSection(
                  "light",
                  { rangeMultiplier: value },
                  "Изменена дальность",
                  "design.light.rangeMultiplier",
                )
              }
            />
            <Range
              label={tr("Кривая затухания")}
              value={design.light.falloffExponentMultiplier}
              min={0.25}
              max={2}
              onChange={(value) =>
                patchSection(
                  "light",
                  { falloffExponentMultiplier: value },
                  "Изменено затухание",
                  "design.light.falloffExponentMultiplier",
                )
              }
            />
          </section>
          <section className="ui-panel">
            <div className="street-light-section-heading">
              <h2>Corona</h2>
              <Checkbox
                checked={design.corona.enabled}
                ariaLabel={tr("Включить corona")}
                onChange={(enabled) =>
                  patchSection(
                    "corona",
                    { enabled },
                    "Переключена corona",
                    "design.corona.enabled",
                  )
                }
              />
            </div>
            <Range
              label={tr("Интенсивность")}
              value={design.corona.intensityMultiplier}
              min={0}
              max={3}
              onChange={(value) =>
                patchSection(
                  "corona",
                  { intensityMultiplier: value },
                  "Изменена corona",
                  "design.corona.intensityMultiplier",
                )
              }
            />
            <Range
              label={tr("Размер")}
              value={design.corona.sizeMultiplier}
              min={0}
              max={3}
              onChange={(value) =>
                patchSection(
                  "corona",
                  { sizeMultiplier: value },
                  "Изменён размер corona",
                  "design.corona.sizeMultiplier",
                )
              }
            />
          </section>
          <section className="ui-panel">
            <div className="street-light-section-heading">
              <h2>{tr("Локальная дымка")}</h2>
              <Checkbox
                checked={design.volumetric.enabled}
                ariaLabel={tr("Включить локальную дымку")}
                onChange={(enabled) =>
                  patchSection(
                    "volumetric",
                    { enabled },
                    "Переключена локальная дымка",
                    "design.volumetric.enabled",
                  )
                }
              />
            </div>
            <Range
              label={tr("Плотность")}
              value={design.volumetric.intensityMultiplier}
              min={0}
              max={3}
              onChange={(value) =>
                patchSection(
                  "volumetric",
                  { intensityMultiplier: value },
                  "Изменена плотность дымки",
                  "design.volumetric.intensityMultiplier",
                )
              }
            />
            <Range
              label={tr("Размер объёма")}
              value={design.volumetric.sizeScaleMultiplier}
              min={0.25}
              max={3}
              onChange={(value) =>
                patchSection(
                  "volumetric",
                  { sizeScaleMultiplier: value },
                  "Изменён объём дымки",
                  "design.volumetric.sizeScaleMultiplier",
                )
              }
            />
            <p className="street-light-hint">
              {tr("Эффект зависит от игровой настройки Lighting_FogVolumes. Кастомизатор не меняет graphics settings скрытно.")}
            </p>
            {selectedFamily &&
              !selectedFamily.capabilities.supportsVolumetric && (
                <p className="street-light-hint is-warning">
                  {tr("У выбранной модели нет baseline-флага Draw Volume. Дымка сохранится в дизайне, но не будет записана в эту family.")}
                </p>
              )}
          </section>
          <section className="ui-panel">
            <h2>{tr("Бабочки и мотыльки")}</h2>
            <p className="street-light-hint">
              {tr("Для этого проверенного Legacy family декор пока отключён: placement/YPT lifecycle не прошёл capability gate.")}
            </p>
          </section>
        </>
      }
    >
      <StreetLightPreview3D
        design={design}
        contextMultiplier={previewContextMultiplier}
      />
      <section className="street-light-coverage-card">
        <div>
          <small>Build coverage</small>
          <h3>{config.binding ? tr("Семейство выбрано") : tr("Только preview")}</h3>
        </div>
        <p>
          {selectedFamily
            ? `${selectedFamily.label} · ${selectedFamily.effectiveOccurrenceCount} effective placements`
            : coverage.message}
        </p>
        {project.target === "gta5-legacy-story" &&
          coverage.families.length > 0 && (
            <label className="street-light-family-select">
              <span>{tr("Семейство моделей")}</span>
              <select
                aria-label={tr("Семейство фонарей")}
                value={selectedFamilyId}
                onChange={(event) =>
                  event.target.value
                    ? bindCandidate(event.target.value)
                    : onChange(
                        { ...config, binding: null },
                        "Очищена привязка фонарей",
                        "binding",
                      )
                }
              >
                <option value="">{tr("Только preview")}</option>
                {coverage.families.map((family) => (
                  <option key={family.familyId} value={family.familyId}>
                    {family.label} · {family.effectiveOccurrenceCount}
                  </option>
                ))}
              </select>
            </label>
          )}
        {config.binding && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange(
                { ...config, binding: null },
                "Очищена привязка фонарей",
                "binding",
              )
            }
          >
            {tr("Очистить выбор")}
          </Button>
        )}
      </section>
      {applyOpen && (
        <StreetLightApplyDialog
          project={project}
          config={config}
          onClose={() => setApplyOpen(false)}
          onInstallationChange={onInstallationChange}
        />
      )}
    </EditorShell>
  );
}
