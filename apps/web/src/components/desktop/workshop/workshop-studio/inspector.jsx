import { useEffect, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowLineLeft,
  ArrowLineRight,
  CaretDown,
  Check,
  DotsThree,
  Image as ImageIcon,
  MagicWand,
  Trash,
  UploadSimple,
} from "../../../ui/icons.jsx";
import {
  IMPACT_MATERIAL_KEYS,
  WEATHER_PROFILE_KEYS,
  WEAPON_EFFECT_PROFILE_KEYS,
  WORKSHOP_RETICLE_MODULE_IDS,
} from "../workshop-project.js";

import { useWorkshopLocalization } from "./shared.jsx";
import Button from "../../../ui/Button.jsx";
import ColorField from "../../../ui/ColorField.jsx";
import Select from "../../../ui/Select.jsx";
import Slider from "../../../ui/Slider.jsx";
import Switch from "../../../ui/Switch.jsx";
import { tr, useTr } from "../../../../locales/ui.js";
import ColorInput from "../../../ui/ColorInput.jsx";

/*
 * Инспектор модуля: органы из его определения и редактор профилей.
 *
 * Органы — общие, из словаря продукта. Своих здесь было пять: ползунок,
 * список, поле, выключатель и цвет, — и все пятеро отличались от тех же
 * пятерых в студии эффектов, в прицеле и в килл-эффекте. Человек, который
 * правил прицел, а потом открыл мини-карту, попадал в другой прибор: другая
 * высота строки, другой выключатель, другая колонка значений. Это и есть
 * «мастерская выглядит по-разному» — не цвета, а органы.
 */

/*
 * Возврат к значению по умолчанию.
 *
 * Стоит в подписи и появляется только у тронутой настройки: пока значение
 * стандартное, возвращать нечего, и постоянная стрелка у каждой строки была бы
 * шумом. Нажатие не доходит до `label`, иначе возврат заодно открывал бы
 * системный выбор цвета, в подписи которого стоит.
 */
function ResetMark({ label, onReset }) {
  const { translate: t } = useWorkshopLocalization();
  return (
    <Button
      className="studio-control-reset"
      variant="ghost"
      size="sm"
      icon={<ArrowCounterClockwise />}
      title={t("Вернуть значение по умолчанию")}
      aria-label={`${t("Сбросить")} ${label}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onReset();
      }}
    />
  );
}

function InspectorControl({
  definition,
  value,
  defaultValue,
  onChange,
  onReset,
  palette,
}) {
  const inheritedColor = definition.palette
    ? palette?.[definition.palette]
    : null;
  const changed = JSON.stringify(value) !== JSON.stringify(defaultValue);
  const label = (
    <>
      {definition.label}
      {changed && <ResetMark label={definition.label} onReset={onReset} />}
    </>
  );
  const shared = {
    label,
    hint: definition.tooltip || undefined,
    ariaLabel: definition.label,
    className: `studio-control studio-control-${definition.type}`,
  };

  if (definition.type === "range")
    return (
      <Slider
        {...shared}
        value={value}
        min={definition.min}
        max={definition.max}
        step={definition.step || 1}
        unit={definition.unit || ""}
        onChange={onChange}
      />
    );

  if (definition.type === "select")
    return (
      <Select
        {...shared}
        value={value}
        options={definition.options}
        onChange={onChange}
      />
    );

  if (definition.type === "text")
    return (
      <label className={`ui-field ${shared.className} studio-control-text`}>
        <span className="studio-control-copy">
          {label}
          {definition.tooltip && <small>{definition.tooltip}</small>}
        </span>
        <input
          className="studio-text-input"
          aria-label={definition.label}
          value={value || ""}
          maxLength={definition.maxLength || 80}
          placeholder={definition.placeholder || ""}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    );

  if (definition.type === "toggle")
    return (
      <div className={`ui-field ${shared.className}`}>
        <span className="studio-control-copy">
          {label}
          {definition.tooltip && <small>{definition.tooltip}</small>}
        </span>
        <Switch
          checked={Boolean(value)}
          label={definition.label}
          onChange={onChange}
        />
      </div>
    );

  if (definition.type === "color")
    return (
      <ColorField
        {...shared}
        value={value}
        editable
        /* Цвет из общей палитры проекта — быстрым образцом под полем, а не
           отдельной кнопкой с пипеткой: это то же «взять готовый цвет», что и
           остальные образцы, и выглядеть должно так же. */
        swatches={inheritedColor ? [inheritedColor] : []}
        onChange={onChange}
      />
    );

  return null;
}

const weaponProfileLabels = {
  pistol: "Пистолеты",
  smg: "ПП",
  rifle: "Автоматы",
  shotgun: "Дробовики",
  sniper: "Снайперские",
  machinegun: "Пулемёты",
  heavy: "Тяжёлое",
};
const impactMaterialLabels = {
  metal: "Металл",
  concrete: "Бетон",
  stone: "Камень",
  wood: "Дерево",
  glass: "Стекло",
  earth: "Земля",
  water: "Вода",
  vehicle: "Транспорт",
  character: "Персонаж",
};
const weatherProfileLabels = {
  clear: "Ясно",
  sunny: "Солнечно",
  cloudy: "Облачно",
  overcast: "Пасмурно",
  fog: "Туман",
  rain: "Дождь",
  storm: "Гроза",
  smog: "Смог",
  snow: "Снег",
};

function WorkshopProfileEditor({ module, config, onChange }) {
  useTr();
  const { translate: t } = useWorkshopLocalization();
  if (module.id === "weather")
    return (
      <section
        className="studio-profile-editor"
        aria-label={t("Погодные профили")}
      >
        <header>
          <b>{t("Погодные состояния")}</b>
          <small>
            {t("Каждое состояние хранит собственную атмосферу и переход")}
          </small>
        </header>
        <div className="studio-weather-tabs">
          {WEATHER_PROFILE_KEYS.map((key) => (
            <button
              type="button"
              key={key}
              className={config.profile === key ? "is-active" : ""}
              aria-pressed={config.profile === key}
              onClick={() =>
                onChange("profile", key, weatherProfileLabels[key])
              }
            >
              {t(weatherProfileLabels[key])}
            </button>
          ))}
        </div>
      </section>
    );
  if (module.id === "impacts")
    return (
      <section
        className="studio-profile-editor"
        aria-label={t("Профили материалов")}
      >
        <header>
          <b>{t("Материал попадания")}</b>
          <small>
            {t("Каждый материал хранит собственные частицы, decal и звук")}
          </small>
        </header>
        <div className="studio-material-tabs">
          {IMPACT_MATERIAL_KEYS.map((key) => (
            <button
              type="button"
              key={key}
              className={config.material === key ? "is-active" : ""}
              aria-pressed={config.material === key}
              onClick={() =>
                onChange("material", key, impactMaterialLabels[key])
              }
            >
              {t(impactMaterialLabels[key])}
            </button>
          ))}
        </div>
      </section>
    );
  if (module.id !== "weapon-effects") return null;
  const active = config.weaponClass || "rifle";
  const profile = config.weaponProfiles?.[active] || {};
  const changeScale = (key, value) =>
    onChange(
      "weaponProfiles",
      { ...config.weaponProfiles, [active]: { ...profile, [key]: value } },
      `${weaponProfileLabels[active]} · ${key}`,
    );
  return (
    <section
      className="studio-profile-editor"
      aria-label={t("Профили классов оружия")}
    >
      <header>
        <b>{t("Профили оружия")}</b>
        <small>{t("Масштабируйте эффект отдельно для каждого класса")}</small>
      </header>
      <div className="studio-weapon-tabs">
        {WEAPON_EFFECT_PROFILE_KEYS.map((key) => (
          <button
            type="button"
            key={key}
            className={active === key ? "is-active" : ""}
            aria-pressed={active === key}
            onClick={() =>
              onChange("weaponClass", key, weaponProfileLabels[key])
            }
          >
            {t(weaponProfileLabels[key])}
          </button>
        ))}
      </div>
      <div className="studio-profile-scales">
        {[
          ["flashScale", tr("Дульная вспышка")],
          ["smokeScale", tr("Дым")],
          ["shellScale", tr("Гильзы")],
          ["lightScale", tr("Свет")],
        ].map(([key, label]) => (
          <label key={key}>
            <span>
              {t(label)} <output>{profile[key] ?? 100}%</output>
            </span>
            <input
              aria-label={`${t(label)} · ${t(weaponProfileLabels[active])}`}
              type="range"
              min="0"
              max="200"
              value={profile[key] ?? 100}
              onChange={(event) => changeScale(key, Number(event.target.value))}
            />
          </label>
        ))}
      </div>
    </section>
  );
}

function WorkshopInspector({
  module,
  config,
  project,
  advanced,
  setAdvanced,
  onChange,
  onRename,
  onPaletteChange,
  onPreset,
  onManagePresets,
  onAsset,
  onDeleteAsset,
  collapsed,
  onCollapsed,
}) {
  useTr();
  const { translate: t } = useWorkshopLocalization();
  const featuredControlKey =
    module.id === "minimap"
      ? "showHealthNumbers"
      : module.id === "crosshair"
        ? "showCenterDot"
        : "";
  const firstControlGroup =
    module.controls.find((item) => item.key === featuredControlKey)?.group ||
    module.controls[0]?.group ||
    "";
  const [openGroups, setOpenGroups] = useState(() =>
    firstControlGroup ? [firstControlGroup] : [],
  );
  const [assetDragActive, setAssetDragActive] = useState(false);
  const [confirmAssetDelete, setConfirmAssetDelete] = useState("");
  useEffect(() => {
    setOpenGroups(firstControlGroup ? [firstControlGroup] : []);
    setConfirmAssetDelete("");
  }, [module.id, firstControlGroup]);
  /* Колонку рисует каркас, а `studio-inspector` и `is-collapsed` приезжают в
     неё через `inspectorClassName`: лист инспектора написан на эти имена, и
     свёрнутое состояние по ним же ловит сетка тела. */
  if (collapsed)
    return (
      <button
        type="button"
        onClick={() => onCollapsed(false)}
        title={t("Открыть инспектор")}
      >
        <ArrowLineLeft />
      </button>
    );
  const controls = module.controls.filter((item) => advanced || !item.advanced);
  const groups = [...new Set(controls.map((item) => item.group))];
  return (
    <>
      <header>
        <div>
          <span>{t("Свойства")}</span>
          <b>{module.title}</b>
        </div>
        <button
          type="button"
          onClick={() => onCollapsed(true)}
          title={t("Свернуть инспектор")}
        >
          <ArrowLineRight />
        </button>
      </header>
      <div className="studio-inspector-mode">
        <button
          type="button"
          className={!advanced ? "is-active" : ""}
          onClick={() => setAdvanced(false)}
        >
          {t("Основные")}
        </button>
        <button
          type="button"
          className={advanced ? "is-active" : ""}
          onClick={() => setAdvanced(true)}
        >
          {t("Расширенные")}
        </button>
      </div>
      <section className="studio-preset-strip">
        <span>{t("Пресеты")}</span>
        <div>
          {module.presets.map(([name, values]) => (
            <button
              type="button"
              key={name}
              onClick={() => onPreset(name, values)}
            >
              {name}
            </button>
          ))}
          {project.userPresets
            .filter((preset) => preset.modules?.[module.id])
            .map((preset) => (
              <button
                type="button"
                className="is-user"
                key={preset.id}
                onClick={() => onPreset(preset.name, preset.modules[module.id])}
              >
                <MagicWand /> {preset.name}
              </button>
            ))}
          <button type="button" className="is-manage" onClick={onManagePresets}>
            <DotsThree /> {t("Управление")}
          </button>
        </div>
      </section>
      <section className="studio-global-palette">
        <span>{t("Глобальная палитра")}</span>
        <div>
          {Object.entries(project.palette).map(([key, color]) => (
            <label key={key} title={`${key}: ${color}`}>
              <ColorInput
                className="ui-color-chip"
                value={color}
                aria-label={`${t("Цвет палитры")} ${key}`}
                onChange={(event) => onPaletteChange(key, event.target.value)}
              />
              <i style={{ background: color }} />
            </label>
          ))}
        </div>
      </section>
      <div className="studio-inspector-scroll">
        {/*
         * Имя проекта. В полосе сверху оно было заголовком комнаты и менялось
         * под руками — по нему нельзя было понять, в каком ты редакторе. Здесь
         * оно поле среди полей: то же, что цвет прицела или радиус карты, —
         * часть работы, а не название места, где её делают.
         */}
        <label className="studio-project-field">
          <span>{tr("Имя проекта")}</span>
          <input
            className="studio-text-input"
            value={project.name}
            onChange={(event) => onRename(event.target.value)}
          />
        </label>
        <WorkshopProfileEditor
          module={module}
          config={config}
          onChange={onChange}
        />
        {groups.map((group) => {
          const open = openGroups.includes(group);
          return (
            <section className="studio-control-group" key={group}>
              <button
                type="button"
                className="studio-group-heading"
                onClick={() =>
                  setOpenGroups((current) =>
                    open
                      ? current.filter((item) => item !== group)
                      : [...current, group],
                  )
                }
                aria-expanded={open}
              >
                <span>{group}</span>
                <CaretDown className={open ? "is-rotated" : ""} />
              </button>
              {open && (
                <div>
                  {controls
                    .filter((item) => item.group === group)
                    .map((definition) => (
                      <InspectorControl
                        key={definition.key}
                        definition={definition}
                        value={config[definition.key]}
                        defaultValue={module.defaults[definition.key]}
                        palette={project.palette}
                        onChange={(value) =>
                          onChange(definition.key, value, definition.label)
                        }
                        onReset={() =>
                          onChange(
                            definition.key,
                            module.defaults[definition.key],
                            `${t("Сброшено")}: ${definition.label}`,
                          )
                        }
                      />
                    ))}
                </div>
              )}
            </section>
          );
        })}
        {!WORKSHOP_RETICLE_MODULE_IDS.includes(module.id) && (
          <section className="studio-assets">
            <span>ASSETS</span>
            <label
              className={assetDragActive ? "is-dragging" : ""}
              onDragEnter={(event) => {
                event.preventDefault();
                setAssetDragActive(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setAssetDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setAssetDragActive(false);
                const file = event.dataTransfer.files?.[0];
                if (file) onAsset(file);
              }}
            >
              <UploadSimple />
              <b>{t("Импортировать или перетащить файл")}</b>
              <small>PNG, WEBP, DDS, SVG, WAV, OGG · {t("до")} 64 MB</small>
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.dds,.svg,.wav,.ogg,.json,.xml,.ytd,.ydr,.ydd,.ymap,.ytyp"
                hidden
                onChange={onAsset}
              />
            </label>
            {project.assets
              .filter((asset) => asset.moduleId === module.id)
              .map((asset) => (
                <div key={asset.id}>
                  <ImageIcon />
                  <span>
                    <b>{asset.name}</b>
                    <small>
                      {Math.ceil(asset.size / 1024)} KB · SHA-256{" "}
                      {asset.hash?.slice(0, 8)}
                    </small>
                  </span>
                  <button
                    type="button"
                    className={
                      confirmAssetDelete === asset.id ? "is-confirm" : ""
                    }
                    onClick={() => {
                      if (confirmAssetDelete !== asset.id)
                        return setConfirmAssetDelete(asset.id);
                      onDeleteAsset(asset);
                      setConfirmAssetDelete("");
                    }}
                    title={t(
                      confirmAssetDelete === asset.id
                        ? tr("Подтвердить удаление файла")
                        : tr("Удалить файл"),
                    )}
                    aria-label={`${t(confirmAssetDelete === asset.id ? tr("Подтвердить удаление файла") : tr("Удалить файл"))} ${asset.name}`}
                  >
                    {confirmAssetDelete === asset.id ? <Check /> : <Trash />}
                  </button>
                </div>
              ))}
          </section>
        )}
      </div>
    </>
  );
}

export { InspectorControl, WorkshopProfileEditor, WorkshopInspector };
