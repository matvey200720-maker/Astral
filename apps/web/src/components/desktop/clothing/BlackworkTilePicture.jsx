import { readBodyZoneShot } from "../../../api.js";
import { blackworkFacesBack, blackworkPixels } from "../../../features/clothing/blackwork.js";
import BlackworkFigure from "./BlackworkFigure.jsx";
import { useItemShot } from "./item-shots.js";

/*
 * Картинка плитки блэкворка (02.11.2026, владелец: «чтобы отображалась рука человека, а не моделька, собранная непонятно как»): настоящая часть тела из игры игрока, снятая тем же съёмщиком, что вещи, и на ней чернила этой плитки.
 * Чернила — те же пиксели, что поедут на тело, поэтому плитка показывает ровно то, что получится. Сменились маски — поднять `SHOT_BUILD`: готовые снимки лежат в хранилище мастерской (2 — 03.11.2026: швы без мягкого края, новые варианты, голова с лицом, спина снимается сзади).
 */
const SHOT_BUILD = 2;
const INK_SIZE = 256;

async function inkedShot(item, gender, gameRoot) {
  const answer = await readBodyZoneShot({ gameRoot, gender, zone: item.zone, back: blackworkFacesBack(item) });
  const { width, height, data } = blackworkPixels(item, INK_SIZE);
  const ink = { width, height, rgba: data };
  return { ...answer, shot: { ...answer.shot, meshes: answer.shot.meshes.map((mesh) => (mesh.overlay ? { ...mesh, texture: ink } : mesh)) } };
}

const shotItem = (item, gender) => ({
  gender,
  component: "blackwork",
  folder: `${item.key}@${SHOT_BUILD}`,
  drawable: 0,
  readShot: (gameRoot) => inkedShot(item, gender, gameRoot),
});

export default function BlackworkTilePicture({ item, gender }) {
  const shot = useItemShot(shotItem(item, gender), true);
  if (shot.status === "ready") return <img className="wear-black-shot" src={shot.url} alt="" draggable={false} />;
  /* Снимок ещё едет: схема на эти доли секунды только мелькала бы. */
  if (shot.status === "pending") return null;
  return <BlackworkFigure item={item} />;
}
