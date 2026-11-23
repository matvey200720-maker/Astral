import { tr, useTr } from "../../../../locales/ui.js";
import Button from "../../../ui/Button.jsx";

/*
 * «Красить только вещь» (16.11.2026): полоса над кадром мастерской одежды, когда на листе вещи лежит и кожа (ногти: кожа рук и торса с тёмными пятнами ногтей; `item-mask.js`).
 *   • `closed` — догадка не уверена (цвета ногтей и кожи близки), вещь не отмечена: кисть и заливка ничего не меняют, догадка показана розовым; «Принять догадку» (одна кнопка) или «Отметить вручную»;
 *   • `auto` — граница нашлась по мешам или по чистому разрыву цветов: красится только вещь, можно поправить;
 *   • `marked` — красится то, что отметил человек;
 *   • `marking` — режим отметки: щелчок по части модели переключает её; розовым показана кожа; «Похожие части», «Сбросить отметку», «Закончить отметку».
 * Слова — на шести языках (`locales/ui-text/zone-install-showcase-1611.js`).
 */
export default function ItemOnlyBar({ state, marking = false, hint = false, onStart, onAccept, onFinish, onSimilar, onReset }) {
  useTr();
  if (!state) return null;
  let text = tr("Красится только вещь, кожа на листе закрыта.");
  if (marking) text = tr("Нажимайте на части вещи: розовым показана кожа, её красить нельзя.");
  else if (state === "closed") text = tr("Кожа этой вещи лежит на том же листе, а цвета слишком близки, чтобы отделить её уверенно. Розовым показано, где, скорее всего, кожа. Примите догадку или отметьте вещь вручную: пока этого нет, кисть и заливка ничего не меняют.");
  else if (state === "marked") text = tr("Красится только то, что вы отметили.");
  return (
    <div className={`gun-item-only${state === "closed" && !marking ? " is-closed" : ""}`} role="status">
      <p>{text}</p>
      {/* Одна строка после первого «пустого» мазка по закрытому (кожа листа вещи), пока отметку не поправили: у закрытого листа свои кнопки и текст, поэтому — только у «auto» и «marked», где кнопка «Поправить отметку». */}
      {hint && !marking && state !== "closed" ? <p className="gun-item-only-hint">{tr("Это место отмечено как кожа и закрыто. Если это часть вещи, нажмите «Поправить отметку».")}</p> : null}
      <div className="gun-item-only-actions">
        {marking ? (
          <>
            <Button variant="secondary" size="sm" onClick={onSimilar}>
              {tr("Похожие части")}
            </Button>
            <Button variant="secondary" size="sm" onClick={onReset}>
              {tr("Сбросить отметку")}
            </Button>
            <Button variant="primary" size="sm" onClick={onFinish}>
              {tr("Закончить отметку")}
            </Button>
          </>
        ) : state === "closed" ? (
          <>
            <Button variant="primary" size="sm" onClick={onAccept}>
              {tr("Принять догадку")}
            </Button>
            <Button variant="secondary" size="sm" onClick={onStart}>
              {tr("Отметить вручную")}
            </Button>
          </>
        ) : (
          <Button variant="secondary" size="sm" onClick={onStart}>
            {tr("Поправить отметку")}
          </Button>
        )}
      </div>
    </div>
  );
}
