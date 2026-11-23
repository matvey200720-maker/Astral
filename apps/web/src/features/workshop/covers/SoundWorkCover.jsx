import { SlidersHorizontal } from "../../../components/ui/icons.jsx";
import { WEAPON_SOUND_MAP } from "@modovik/sound-studio";
import SoundHitCover from "./SoundHitCover.jsx";
import SoundWeaponsCover from "./SoundWeaponsCover.jsx";

/*
 * Обложка работы звуков в «Моих работах» — то, что в ней звучит.
 *
 * Работа со стволами — её первый ствол с полки оружия и число стволов в
 * углу; работа из одних попаданий — мишень с отметкой там, где звучит звук;
 * работа из одного окружения — ползунки пульта.
 * Без этого все работы звуков в списке были одним и тем же динамиком.
 *
 * Модель ствола на полке — из таблицы голоса (`WEAPON_SOUND_MAP`). Таблица
 * едет отдельным куском, только когда в списке есть работа звуков.
 */

function parse(state) {
  try {
    const value = typeof state === "string" ? JSON.parse(state) : state;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export default function SoundWorkCover({ state }) {
  const work = parse(state);
  const models = Object.keys(work?.weapons || {})
    .map((id) => WEAPON_SOUND_MAP[id]?.model)
    .filter(Boolean);
  if (models.length) return <SoundWeaponsCover models={models} />;
  const part = ["head", "body"].find((id) => work?.hits?.[id]);
  if (!part && Object.keys(work?.mix?.levels || {}).length)
    return (
      <span className="workshop-cover-glyph">
        <SlidersHorizontal weight="fill" />
      </span>
    );
  return (
    <SoundHitCover
      slotId={part === "body" ? "hit-sounds-body" : "hit-sounds-head"}
    />
  );
}
