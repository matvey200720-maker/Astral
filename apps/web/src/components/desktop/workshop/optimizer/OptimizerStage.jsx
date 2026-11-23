import { HandGrabbing } from "../../../ui/icons.jsx";
import "./optimizer-film.css";

/*
 * Сцена раздела «Оптимизации» (дизайн 15.11.2026, вариант A «Сцена и плёнка»): кадр в рамке и под ним подпись на своей тёмной полосе —
 * метка ступени, название кадра, подсказка «Зажмите кадр — оригинал» и пояснение. Текст на самом кадре не лежит.
 *
 * Зажатие кадра («показать оригинал») ведёт вкладка: сюда приходят только обработчики нажатия.
 */
export default function OptimizerStage({
  kind,
  data = {},
  hold = null,
  frame,
  position = "",
  pill,
  title,
  soft = "",
  hint = "",
  desc,
}) {
  return (
    <figure
      className="texture-downgrade-stage opf-stage"
      data-kind={kind}
      {...data}
      onPointerDown={hold?.start}
      onPointerUp={hold?.stop}
      onPointerLeave={hold?.stop}
      onPointerCancel={hold?.stop}
    >
      <div
        className="opf-stage-frame"
        style={position ? { "--opf-pos": position } : undefined}
      >
        {frame}
      </div>
      <figcaption className="opf-cap">
        <span className="opf-cap-pill">{pill}</span>
        <b className="opf-cap-title">{title}</b>
        {soft ? <span className="opf-cap-pill is-soft">{soft}</span> : null}
        {hint ? (
          <span className="opf-cap-hint">
            <HandGrabbing />
            {hint}
          </span>
        ) : null}
        <span className="opf-cap-desc">{desc}</span>
      </figcaption>
    </figure>
  );
}

/* Заглушка кадра: подписанное место с именем файла, как у остальных кадров оптимизации. */
export function StageMissing({ title, files }) {
  return (
    <span className="opf-stage-missing optimization-shot-placeholder draw-distance-missing">
      <b>{title}</b>
      <code>{files}</code>
    </span>
  );
}
