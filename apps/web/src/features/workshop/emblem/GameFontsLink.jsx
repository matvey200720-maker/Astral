import Button from "../../../components/ui/Button.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { openWorkshopEditor } from "../editor-links.js";

/*
 * Свой шрифт там, где текст рисует сама игра (ТЗ 23.10.2026, п. F): цифры HUD, счётчик патронов, цифры полоски HP и
 * надписи на мини-карте — это шрифты игры, а не картинка, которую рисует окно. Свой файл туда попадает одним путём —
 * раздел «Шрифты»: он встаёт на место шрифтов игры, и эти тексты берут его. Кнопка ведёт туда сразу, а не оставляет
 * человека искать раздел самому; обещать «свой шрифт» на самом выборе было бы нечестно — игра выберет из своих.
 */
export default function GameFontsLink() {
  useTr();
  return (
    <div className="recolor-actions font-sources">
      <Button size="sm" variant="ghost" onClick={() => openWorkshopEditor({ slotId: "fonts" })}>
        {tr("Свой шрифт — в разделе «Шрифты»")}
      </Button>
    </div>
  );
}
