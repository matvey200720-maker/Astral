import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import MinimapPreview, {
  MINIMAP_COVER_DEMO,
  useMinimapAssetUrls,
} from "../../../components/desktop/workshop/MinimapPreview.jsx";
import {
  DEMO_ARMOR_MAX,
  nextDemoTick,
  restedDemo,
  useDemoDecay,
} from "../../../components/desktop/workshop/minimap-demo.js";
import Button from "../../../components/ui/Button.jsx";
import SegmentedControl from "../../../components/ui/SegmentedControl.jsx";
import SwitchLine from "../../../components/ui/SwitchLine.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { useArrived } from "./use-arrived.js";

/*
 * Предпросмотр миникарты (Каталог 2.0, часть 2, доска `Preview-mm`): два вида одной и той же карты, переключатель «Стандартная / Увеличенная» (до 21.11.2026 — «Обычная / Большая») — «В игре, 1:1» и «Крупно, без пикселей»; полосы, цифры и буква N —
 * из `minimap.gfx` автора (`look`), без демо-значений редактора. Рисует готовый `MinimapPreview` мастерской: векторно, в размер окна. Органы — «Получение урона» (тот же ход, что демонстрация в
 * редакторе, `minimap-demo.js`: тик за тиком уходит сначала броня, потом здоровье, с хвостом, вспышкой хита и цифрой, как в игре), «Восстановить», «С бронёй» и «Хит-маркер» (вспышка стоит, пока её рассматривают).
 *
 * «В игре, 1:1»: сцена мини-карты — 191×136 точек экрана 720p, на мониторе высотой H она занимает 191 × H / 720 пикселей.
 * «Крупно, без пикселей» — не увеличенная малая карта, а развёрнутый радар, как в игре по клавише Z (владелец, 16.11.2026): радар 115×120 точек в (38, 8),
 * полосы и значки встают по правилу большой карты (`view="big"` у `MinimapPreview`, `@modovik/minimap-contract/big-map`). Из `minimap.gfx` автора читается
 * только малый радар, его полос на большой карте нет, поэтому у мода с видом из файла (`look`) на большом радаре стоят карта, буква N и метка игрока —
 * без чужих полос на неверных местах.
 */

const SCENE_WIDTH = 191;
const REFERENCE_HEIGHT = 720;
/* Хвост и вспышка, если у мода своих длительностей нет: те же, что у редактора по умолчанию (`DEFAULT_MINIMAP_EFFECTS`). */
const DEFAULT_TRAIL_MS = 620;
const DEFAULT_FLASH_MS = 2100;
/** Ширина мини-карты в пикселях монитора: как она встаёт на экране игры. */
export const gameWidth = (monitorHeight = globalThis.screen?.height) =>
  Math.round(
    (SCENE_WIDTH * (Number(monitorHeight) || 1080)) / REFERENCE_HEIGHT,
  );

export default function MinimapView({ data, slot, onReady }) {
  useTr();
  useArrived(onReady);
  const { config, look } = data;
  const [armor, setArmor] = useState(true);
  const [hit, setHit] = useState(false);
  /* Вид: «Стандартная» — малая карта в размер экрана игры; «Увеличенная» — развёрнутый радар, как в игре по Z (владелец, 16.11.2026: «малая — обычная,
     а большая — когда ты её увеличиваешь функционально в игре»). Один вид за раз. */
  const [view, setView] = useState("small");
  /* Урон — тот же ход, что в мастерской (`minimap-demo.js`): сначала уходит броня, потом здоровье, по три тика на запас, у каждого
     хвост, вспышка с начала и вылетающая цифра. «Получение урона» делает один тик, «Восстановить» возвращает запас. */
  const startArmor = armor ? DEMO_ARMOR_MAX : 0;
  const [state, setState] = useState(() =>
    restedDemo({ armor: DEMO_ARMOR_MAX, armorStart: DEMO_ARMOR_MAX }),
  );
  useDemoDecay(state, setState, {
    damageTrailDurationMs:
      config?.effects?.damageTrailDurationMs ?? DEFAULT_TRAIL_MS,
    damageFlashDurationMs:
      config?.effects?.damageFlashDurationMs ?? DEFAULT_FLASH_MS,
  });
  const restDemo = (nextArmor) =>
    setState((current) =>
      restedDemo({
        armor: nextArmor,
        armorStart: nextArmor,
        flashId: current.flashId || 0,
      }),
    );
  const chooseArmor = (on) => {
    setArmor(on);
    restDemo(on ? DEMO_ARMOR_MAX : 0);
  };
  const project = useMemo(
    () => ({ modules: { minimap: config }, minimapLook: look }),
    [config, look],
  );
  const [assetUrls] = useMinimapAssetUrls(project, config);
  const bigLook = useMemo(
    () => (look ? { ...look, layers: [], bars: [], digits: [] } : null),
    [look],
  );
  const demo = useMemo(
    () => ({ ...MINIMAP_COVER_DEMO, ...(look?.state || {}), ...state }),
    [look, state],
  );
  /* Покой — пока ничего не происходит; удар и «Хит-маркер» оживляют кадр (вспышка, счёт полосы вниз), хвост и вспышка гаснут — кадр снова стоит. */
  const common = {
    config,
    demo,
    look,
    assetUrls,
    still: !state.flash && !(state.trail > 0) && !hit,
    holdFlash: hit,
  };
  const controls = (
    <div className="pv-switches">
      <SegmentedControl
        label={tr("Вид карты в предпросмотре")}
        size="md"
        options={[
          { value: "small", label: tr("Стандартная") },
          { value: "big", label: tr("Увеличенная") },
        ]}
        value={view}
        onChange={setView}
      />
      <Button
        variant="ghost"
        size="sm"
        title={tr("Один тик урона")}
        onClick={() => setState(nextDemoTick)}
      >
        {tr("Получение урона")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        title={tr("Восстановить здоровье и броню")}
        onClick={() => restDemo(startArmor)}
      >
        {tr("Восстановить")}
      </Button>
      <SwitchLine
        label={tr("С бронёй")}
        checked={armor}
        onChange={chooseArmor}
      />
      <SwitchLine label={tr("Хит-маркер")} checked={hit} onChange={setHit} />
    </div>
  );
  return (
    <>
      {slot && createPortal(controls, slot)}
      <div className="pv-minimap" data-view={view}>
        {view === "big" ? (
          <figure className="pv-minimap-big">
            <MinimapPreview {...common} look={bigLook} view="big" />
            <figcaption>
              {tr("Крупно, без пикселей: развёрнутый радар, как в игре по Z")}
            </figcaption>
          </figure>
        ) : (
          <figure className="pv-minimap-game" style={{ width: gameWidth() }}>
            <MinimapPreview {...common} compact />
            <figcaption>{tr("В игре, 1:1")}</figcaption>
          </figure>
        )}
      </div>
    </>
  );
}
