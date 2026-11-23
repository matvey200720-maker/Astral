/*
 * Плитка породы в «Цвете пород»: 3D-снимок дерева этой породы, а не значок.
 * Снимок берётся из хранилища обложек и снимается один раз на цвет (маленький WebP), поэтому плитки
 * показываются быстро; игры нет — лист нарисован и снимок временный (в хранилище не кладётся).
 * У породы без модели в сцене рощ (клёны, мескиты, оливы, растения) — значок дерева.
 *
 * Цвет плитки — только свой цвет породы (или «как в игре»): цвет и густота общей листвы на неё не влияют,
 * иначе каждый шаг палитры «Свой цвет листвы» снимал бы заново все двенадцать плиток (замер 22.10: ~0,5–1 с
 * главного потока на шаг при ×4). Что породе достанется от общей листвы, видно в кадре, а не на плитке.
 */

import { useMemo } from "react";
import { Tree } from "../../../components/ui/icons.jsx";
import { useCoverPending } from "../covers/cover-bake-context.js";
import SceneThumb from "../model-stage/SceneThumb.jsx";
import OakArt from "./OakArt.jsx";
import { speciesModel, speciesThumbFrame, tileProject, useSpeciesLeaves } from "./species-art.js";

function ModelThumb({ model, species, project }) {
  const tree = useSpeciesLeaves(model, species, project);
  /* Печь обложек ждёт лист игры, а не снимает дерево с нарисованным листом. */
  useCoverPending(!tree.settled);
  const frame = useMemo(() => speciesThumbFrame(model), [model]);
  return <SceneThumb scene={model.url} parts={tree.parts} look={tree.look} lookKey={tree.lookKey} frame={frame} />;
}

export default function SpeciesArt({ species, project }) {
  const model = useMemo(() => speciesModel(species), [species]);
  /* Работа плитки: только свой цвет этой породы — по нему плитка и пересоздаётся. */
  const own = project?.trees?.species?.[species] || "";
  const alone = useMemo(() => tileProject(species, own), [species, own]);
  if (species === "oak") return <OakArt project={alone} />;
  if (!model)
    return (
      <span className="vegetation-species-glyph" aria-hidden="true">
        <Tree />
      </span>
    );
  return <ModelThumb model={model} species={species} project={alone} />;
}
