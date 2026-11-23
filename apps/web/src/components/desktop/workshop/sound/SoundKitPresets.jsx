import { memo } from "react";
import {
  Alien,
  Anchor,
  ArrowFatLineUp,
  Atom,
  Bell,
  Bone,
  Broadcast,
  Circle,
  CirclesThree,
  CloudLightning,
  Coin,
  Crosshair,
  CursorClick,
  Diamond,
  Disc,
  Door,
  Drop,
  FilmSlate,
  GameController,
  Gift,
  HandFist,
  HandPalm,
  Lightning,
  MaskHappy,
  Mountains,
  MusicNotes,
  PaintBrush,
  Planet,
  Pulse,
  Robot,
  Rocket,
  Shield,
  ShieldCheck,
  ShootingStar,
  Skull,
  SmileyXEyes,
  Sparkle,
  SpeakerLow,
  Spiral,
  Star,
  Sword,
  Target,
  Wall,
  WaveSine,
  Waveform,
  Wind,
  Wrench,
} from "../../../ui/icons.jsx";
import ChoiceTile from "../../../ui/ChoiceTile.jsx";
import PresetShelf from "../../../ui/PresetShelf.jsx";
import { useTr } from "../../../../locales/ui.js";

/*
 * Готовые звуки — общей полкой (`PresetShelf`) в панели инструмента
 * «Шаблоны», как готовые виды неба, прицелы и пресеты эффектов: сеткой без
 * переключателя, видны сразу — с них начинают.
 *
 * Плитка ставит источник и ручки и тут же играет то, что получилось, —
 * звук выбирают на слух, а не по названию. Выбранной плитка остаётся, пока
 * ручки не тронуты: поправил одну — это уже свой звук, и подсветка врала бы.
 *
 * Знак на плитке — что за звук, а не картинка ради картинки: у шестнадцати
 * вариантов одного выстрела нет своих кадров, а знак читается быстрее
 * названия.
 */

/*
 * Знаки фантазий — из тех, что уже есть в окне. Каждый знак Phosphor несёт
 * все шесть начертаний и ложится в общий кусок React, который грузится при
 * старте: полтора десятка новых знаков ради одной полки перевесили бы его
 * бюджет (`verify-web-architecture.js`). В пределах одной полки знаки не
 * повторяются.
 */
const ICONS = Object.freeze({
  quiet: SpeakerLow,
  muffled: Wall,
  suppressed: Waveform,
  distant: Mountains,
  punchy: Lightning,
  crisp: Sparkle,
  cinematic: FilmSlate,
  blaster: Alien,
  laser: ShootingStar,
  plasma: Atom,
  railgun: Rocket,
  pulse: Pulse,
  chiptune: GameController,
  toy: Gift,
  tesla: Spiral,
  water: Drop,
  cannon: Anchor,
  thunder: CloudLightning,
  crossbow: Target,
  confetti: MaskHappy,
  airgun: Wind,
  "space-ray": Planet,
  sonic: Broadcast,
  paintball: PaintBrush,
  nailgun: Wrench,
  robot: Robot,
  "shield-break": Shield,
  crit: Star,
  "double-ding": MusicNotes,
  bonk: SmileyXEyes,
  anvil: Sword,
  sparkle: ShootingStar,
  "level-up": ArrowFatLineUp,
  "laser-hit": Lightning,
  "shield-hit": Shield,
  armor: ShieldCheck,
  punch: HandFist,
  blip: Circle,
  zap: Lightning,
  bubble: CirclesThree,
  "chip-hit": GameController,
  whip: Wind,
  bell: Bell,
  helmet: ShieldCheck,
  headshot: Skull,
  marker: Crosshair,
  glass: Diamond,
  coin: Coin,
  sonar: Broadcast,
  gong: Disc,
  click: CursorClick,
  thud: Drop,
  slap: HandPalm,
  crunch: Bone,
  pop: WaveSine,
  knock: Door,
  boom: Waveform,
});

function PresetIcon({ id }) {
  const Icon = ICONS[String(id).split(":").pop()] || Waveform;
  return (
    <span className="snd-preset-icon" aria-hidden="true">
      <Icon weight="duotone" />
    </span>
  );
}

function SoundKitPresets({
  title,
  presets,
  selectedId = "",
  onApply,
  disabled = false,
}) {
  const tr = useTr();
  return (
    <PresetShelf
      title={title}
      count={presets.length}
      className="snd-presets"
      collapsible={false}
    >
      {presets.map((preset) => (
        <ChoiceTile
          key={preset.id}
          className="fx-preset snd-preset"
          media={<PresetIcon id={preset.id} />}
          title={tr(preset.title)}
          description={tr(preset.hint)}
          selected={preset.id === selectedId}
          disabled={disabled}
          onClick={() => onApply(preset)}
        />
      ))}
    </PresetShelf>
  );
}

export default memo(SoundKitPresets);
