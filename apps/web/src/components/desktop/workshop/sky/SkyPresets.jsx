import { memo, useMemo } from "react";
import { AURORA_AVAILABLE, SKY_TEMPLATE_GROUPS, SPACE_TEMPLATES_AVAILABLE, lookPresetsOfGroup, normalizeLook } from "@modovik/timecycle";
import ChoiceTile from "../../../ui/ChoiceTile.jsx";
import PresetShelf from "../../../ui/PresetShelf.jsx";
import useBodyMoon from "../useBodyMoon.js";
import { SKY_ASSETS_CREDIT_RU } from "./sky-credit.js";
import { previewProject } from "./sky-preview.js";
import { thumbnailClouds, useSkyThumbnail } from "./sky-thumbnails.js";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Готовые виды и шаблоны неба — сеткой в панели инструмента «Шаблоны» (мастерская «как в
 * Photoshop»), без переключателя: с них начинают, и выбирают их глазами.
 * Плитка — кадр того же шейдера, что и большой кадр: день слева, ночь справа.
 *
 * Три полки (21.11.2026): «Готовые виды» как раньше, «Шаблоны неба: реальные небеса» и «Шаблоны неба: космос». У шаблона с Луной, планетой
 * или настоящими звёздами в плитке стоит ЕГО тело и ЕГО лист звёзд (рисуются тем же кодом, что ляжет в игру), а не луна текущего вида.
 *
 * Выбранной плитки нет: вид — отправная точка, а не состояние. Поправил одну
 * ручку — это уже своё небо, и подсвеченная плитка врала бы.
 */

function ReadyTile({ preset, look, document, baseKey, textures, own, cloudScene, onApply }) {
  useTr();
  const thumb = useSkyThumbnail(
    `${preset.id}:${baseKey}:${textures ? "tex" : "notex"}${own}:${cloudScene?.key || "noclouds"}`,
    () => ({
      document,
      project: previewProject(document, look),
      hours: preset.cover,
      textures,
      cloudScene,
      ...thumbnailClouds(cloudScene, look, [preset.cover.day, preset.cover.night]),
    }),
  );
  return (
    <ChoiceTile
      className="sky-preset"
      media={thumb ? <img src={thumb} alt="" draggable="false" /> : <span className="sky-preset-pending" />}
      title={tr(preset.label.ru)}
      description={tr(preset.hint.ru)}
      onClick={() => onApply(preset)}
    />
  );
}

function PresetTile(props) {
  const { preset, textures, onApply } = props;
  const look = useMemo(() => normalizeLook(preset.look), [preset]);
  const wanted = Boolean(look.moonBody || look.starSheet?.real);
  /* Своё тело и свой лист звёзд шаблона: плитка ждёт, пока они нарисуются, чтобы кадр не запомнился с чужой луной. */
  const own = useBodyMoon(textures, look.moonBody, look.starSheet);
  if (wanted && own === textures)
    return (
      <ChoiceTile
        className="sky-preset"
        media={<span className="sky-preset-pending" />}
        title={tr(preset.label.ru)}
        description={tr(preset.hint.ru)}
        onClick={() => onApply(preset)}
      />
    );
  return <ReadyTile {...props} look={look} textures={own} own={wanted ? `:own${look.moonBody?.kind || ""}${look.starSheet?.real ? "r" : ""}` : ""} onApply={onApply} />;
}

function SkyPresets({ document, baseKey, textures, cloudScene, onApply }) {
  useTr();
  return (
    <>
      {SKY_TEMPLATE_GROUPS.filter((group) => SPACE_TEMPLATES_AVAILABLE || group.id !== "space").map((group) => {
        /* Полка «Шаблоны неба: космос» скрыта в этой альфе (SPACE_TEMPLATES_AVAILABLE = false в space-templates.js): планета в слоте Луны режется маской фазы. */
        /* Шаблон «Северное сияние» скрыт в этой альфе (AURORA_AVAILABLE = false в aurora.js): в игре сияния на кадре нет. */
        const presets = lookPresetsOfGroup(group.id).filter((item) => AURORA_AVAILABLE || item.id !== "real-aurora");
        return (
          <PresetShelf
            key={group.id}
            title={tr(group.ru)}
            label={group.id === "views" ? tr("Готовые виды неба") : tr(group.ru)}
            count={presets.length}
            className="sky-presets"
            collapsible={false}
          >
            {presets.map((preset) => (
              <PresetTile
                key={preset.id}
                preset={preset}
                document={document}
                baseKey={baseKey}
                textures={textures}
                cloudScene={cloudScene}
                onApply={onApply}
              />
            ))}
          </PresetShelf>
        );
      })}
      <p className="fx-hint">{tr(SKY_ASSETS_CREDIT_RU)}</p>
    </>
  );
}

export default memo(SkyPresets);
