// Отметки поверх сцены в порядке разметки: контуры дорисовки, подсветка, остальные выбранные,
// рамка выбранного, табло, подписи донора и вики, рамка выделения, призрак, след, мазок, кольцо, черновик.
import { createElement } from "react";
import { drawOnContours, marqueeMark, shapeGhost, eraseTrail, wetStroke, eraserRing, draftZone } from "./marks-draw.js";
import { meshMarks, majesticMarks, boardMarks } from "./marks-extra.js";
import { HoverMark, PickedMark, SelectionMark } from "./marks-select.js";

const h = createElement;
const sameTarget = (a, b) => Boolean(a) && Boolean(b) && a.kind === b.kind && a.id === b.id;

export function collectMarks({ p, env, geo, handles, motion, hovering, pointer, text, ghosts }) {
  const { config, selection, tool } = p;
  const { textAdvance } = env;
  const { unit, projector } = geo;
  const hoverHit = hovering.hover?.hit;
  const rest = p.picked.length > 1 ? p.picked.filter((one) => !sameTarget(one, selection)) : [];

  const donors = {
    labels: () =>
      meshMarks({
        ghosts: ghosts.mesh,
        hover: hovering.meshHover,
        picked: p.meshPick,
        projector,
        unit,
      }),
    majestic: () =>
      majesticMarks({
        ghosts: ghosts.majestic,
        hover: hovering.majesticHover,
        picked: p.majesticPick,
        majestic: config.majestic,
        projector,
        unit,
      }),
  };
  const donor = Object.hasOwn(donors, tool) ? donors[tool]() : [];

  return [
    ...drawOnContours(motion.fresh, unit),
    hoverHit && hoverHit.id !== selection?.id
      ? h(HoverMark, { key: "hover", config, hit: hoverHit, projector, unit })
      : null,
    ...rest.map((target) =>
      h(PickedMark, { key: `picked-${target.kind}-${target.id}`, config, target, projector, unit }),
    ),
    h(SelectionMark, {
      key: "selection",
      config,
      selection,
      scene: p.scene,
      projector,
      unit,
      handleGap: geo.handleGap,
      textAdvance,
      typingId: p.textEdit?.emblem?.id,
      shapeHandles: handles.kind === "shape",
      vertexHandles: handles.kind === "vertex",
    }),
    tool === "schedule"
      ? boardMarks({
          board: text.board,
          row: p.boardRow,
          canAdd: Boolean(p.onBoardAdd),
          projector,
          unit,
        })
      : null,
    ...donor,
    marqueeMark(pointer.marquee, projector, unit),
    shapeGhost({
      stretch: pointer.stretch,
      shape: p.shape,
      shapeLook: p.shapeLook,
      config,
      projector,
      unit,
      zoom: geo.frame.zoom,
    }),
    eraseTrail(pointer.trail, pointer.nodes),
    ...wetStroke(pointer.wet, pointer.nodes),
    eraserRing({
      tool,
      brush: p.brush,
      eraserSize: p.eraserSize,
      projector,
      unit,
      nodes: pointer.nodes,
    }),
    draftZone({ draft: p.draft, aim: pointer.aim, projector, unit }),
  ];
}
