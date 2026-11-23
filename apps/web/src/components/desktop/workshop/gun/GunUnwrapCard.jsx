import { useEffect, useRef } from "react";
import { tr, useTr } from "../../../../locales/ui.js";
import { tl } from "./gun-copy.js";
import "./gun-unwrap-card.css";

/*
 * «Развёртка» (ТЗ 29.10.2026-d, п. 3; образец — «Вид → Развёртка» у конкурента): плоская текстура выбранной детали в углу кадра —
 * та самая, что мастерская кладёт на модель и запекает в игру: заводская текстура и все слои поверх, без дополнительной прорисовки.
 *
 * Холст детали живёт в `useGunSurfaces` (`surfaceOf(имя).canvas`). Здесь он копируется в маленький холст карточки и только когда
 * проект изменился (`version` — сам проект): мазок идёт по большому холсту, а копировать его на каждый кадр ради угла экрана не
 * нужно (`docs/3D.md`: ползунок и мазок не лагают). Копия — одним `drawImage` через два кадра после правки: сборку холста после правки
 * мастерская откладывает на ближайший кадр (`scheduleRender`), и копия раньше неё взяла бы прежнюю текстуру.
 */

const SIDE = 224;

export default function GunUnwrapCard({ canvasOf, name, version }) {
  useTr();
  const target = useRef(null);
  useEffect(() => {
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(copy);
    });
    function copy() {
      const view = target.current;
      const source = canvasOf?.();
      if (!view || !source?.width || !source?.height) return;
      const scale = Math.min(SIDE / source.width, SIDE / source.height);
      const width = Math.max(1, Math.round(source.width * scale));
      const height = Math.max(1, Math.round(source.height * scale));
      if (view.width !== width) view.width = width;
      if (view.height !== height) view.height = height;
      const context = view.getContext("2d");
      if (!context) return;
      context.clearRect(0, 0, width, height);
      context.drawImage(source, 0, 0, width, height);
    }
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [canvasOf, name, version]);
  return (
    <aside className="gun-unwrap-card" aria-label={tl("Развёртка")}>
      <small>{`${tl("Развёртка")} · ${name}`}</small>
      <canvas ref={target} width={SIDE} height={SIDE} role="img" aria-label={tr("Плоская текстура детали")} />
    </aside>
  );
}
