/*
 * Колонка правок цветных интерьеров «Интерьеров Majestic RP» (Хелпер 7, 25.10.2026): «Цвет и блеск» и «Шаблоны» десяти интерьеров
 * — ЛСПД, больниц, правительства, Weazel News, ФБР, шерифов, тюрьмы и армии.
 *
 * Поверхности, цвет и блеск — те же, что в «Интерьерах проектов» (`SurfacesTool` оттуда): работа такая же, `{ interiors: { <номер>: облик } }`
 * (часть `colour` корня, `majestic-colour.js`). Отличие одно: «поставить в игру» нет — установка перекрывает файлы пака по именам, и облик
 * либо задан, либо нет; поэтому здесь нет ни переключателя установки, ни слов «в одиночную игру как мод». Шаблоны — те же готовые облики
 * (`PROJECT_INTERIORS_PRESETS`), «Как в игре» — для этого интерьера и для всех.
 */

import {
  PROJECT_INTERIORS_PRESETS,
  applyProjectInteriorsPreset,
  createProjectInteriors,
  interiorLookIsStock,
  interiorLookOf,
  matchingProjectInteriorsPreset,
} from "@modovik/climb-contract/recolor/project-interiors";
import ActionRows from "../../../components/ui/ActionRows.jsx";
import ChoiceTile from "../../../components/ui/ChoiceTile.jsx";
import PresetShelf from "../../../components/ui/PresetShelf.jsx";
import ShopRoomArt from "../shops-editor/ShopRoomArt.jsx";
import { SurfacesTool } from "../project-interiors-editor/ProjectInteriorsInspector.jsx";
import { fill } from "../project-interiors-editor/project-interiors-text.js";
import { tr, useTr } from "../../../locales/ui.js";

/* Схема шаблона: у схемы комнаты «мебель» — это стеллажи у дальней стены. */
const artLook = (look) => ({ surfaces: { ...look.surfaces, shelves: look.surfaces.furniture } });

function TemplatesTool({ work, unit, onPreset, onInteriorStandard, onAllStandard }) {
  useTr();
  if (!unit) return <p className="fx-hint">{tr("Выберите интерьер над кадром.")}</p>;
  const look = interiorLookOf(work, unit.id);
  const current = matchingProjectInteriorsPreset(work, unit.id);
  return (
    <>
      <PresetShelf title={tr("Готовые облики")} label={tr("Готовые облики интерьера")} className="recolor-presets" collapsible={false}>
        {PROJECT_INTERIORS_PRESETS.map((preset) => (
          <ChoiceTile
            key={preset.id}
            className="recolor-preset shops-preset"
            selected={preset.id === current}
            media={<ShopRoomArt look={artLook(interiorLookOf(applyProjectInteriorsPreset(createProjectInteriors(), unit.id, preset.id), unit.id))} label={fill(tr("Схема шаблона «{0}»"), tr(preset.label))} />}
            title={tr(preset.label)}
            tooltip={tr(preset.description)}
            onClick={() => onPreset(preset)}
          />
        ))}
      </PresetShelf>
      {/* «Как в игре» — строками внизу (`ActionRows`), без заголовка над ними: «Этот интерьер» — только когда он изменён; что вернётся — подсказкой строки. */}
      <div data-majestic-section="standard">
        <ActionRows
          label={tr("Как в игре")}
          actions={[
            !interiorLookIsStock(look) && { id: "this", label: tr("Этот интерьер как в игре"), title: tr("Стены, пол, потолок и мебель — цвета и блеск файлов интерьера. Свои цвета панель помнит."), onClick: onInteriorStandard },
            { id: "all", label: tr("Все интерьеры как в игре"), title: tr("Стены, пол, потолок и мебель — цвета и блеск файлов интерьера. Свои цвета панель помнит."), onClick: onAllStandard },
          ]}
        />
      </div>
    </>
  );
}

/**
 * `tool` — `"surfaces"` или `"templates"`; `work` — `{ interiors }` (часть `colour` работы); `unit` — интерьер каталога (`id`, `label`);
 * `sceneInfo` — сцена помещения (`useProjectScene`: сколько листов у поверхностей); `note` — пометка реестра об открытом вопросе к владельцу
 * (у больницы Лос-Сантоса — «Предположение: Artex»); `focus` — поверхность, взятая в кадре.
 */
export default function MajesticColourInspector({ tool, work, unit, sceneInfo, note = "", focus = null, onSurface, onSurfacesStandard, onPreset, onInteriorStandard, onAllStandard }) {
  return (
    <div className="fx-inspector recolor-inspector majestic-inspector">
      {/* Пометка реестра об открытом вопросе («Предположение: Artex — подтвердить у владельца»): он виден там, где правят. */}
      {note ? <p className="fx-hint majestic-open">{note}</p> : null}
      {tool === "templates" ? (
        <TemplatesTool work={work} unit={unit} onPreset={onPreset} onInteriorStandard={onInteriorStandard} onAllStandard={onAllStandard} />
      ) : (
        <SurfacesTool work={work} unit={unit} sceneInfo={sceneInfo} focus={focus} onSurface={onSurface} onSurfacesStandard={onSurfacesStandard} />
      )}
    </div>
  );
}
