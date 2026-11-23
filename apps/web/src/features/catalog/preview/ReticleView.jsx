import { useMemo, useState } from "react";
import { ORDINARY_RETICLE_DEFAULTS } from "@modovik/reticle-contract";
import ReticleStage from "../../../components/desktop/workshop/reticle/ReticleStage.jsx";
import { useTr } from "../../../locales/ui.js";
import { useArrived } from "./use-arrived.js";

/*
 * Предпросмотр прицела (Каталог 2.0, часть 2, доска `Preview-cr`): те же фигуры, что уйдут в `hud_reticle.gfx`, рисует готовая сцена мастерской (`ReticleStage`) на весь кадр.
 * «В размер игры» — точка в точку, как на мониторе (масштаб монитора считает сцена), «Крупно» разглядывает толщину и зазор, «Весь экран» — в размер кадра. Состояние «На цели» —
 * прицеливание. Подложка у сцены одна — матовая: кадра игры под прицелом нет (решение мастерской 07.09.2026), поэтому «Улицы, неба и стены» здесь нет.
 */
export default function ReticleView({ data, onReady }) {
  useTr();
  useArrived(onReady);
  const config = useMemo(
    () => ({ ...ORDINARY_RETICLE_DEFAULTS, ...data.config }),
    [data.config],
  );
  const [view, setView] = useState("game");
  const [state, setState] = useState("plain");
  return (
    <div className="pv-reticle">
      <ReticleStage
        kind="ordinary"
        config={config}
        view={view}
        onView={setView}
        state={state}
        onState={setState}
        hit={state === "target"}
        scope="sniper"
        onScope={() => {}}
      />
    </div>
  );
}
