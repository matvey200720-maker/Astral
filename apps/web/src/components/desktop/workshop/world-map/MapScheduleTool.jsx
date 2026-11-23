import { CalendarBlank } from "../../../ui/icons.jsx";
import { scheduleBoardOf } from "@modovik/vector-map";
import Button from "../../../ui/Button.jsx";
import { patchObject, removeObject } from "../world-map-editing.js";
import { PanelSection } from "./MapPanelParts.jsx";
import MapSchedule from "./MapSchedule.jsx";
import { hideScheduleBoard } from "./schedule-board-editing.js";
import { tr, useTr } from "../../../../locales/ui.js";

/*
 * Инструмент «Расписание» (задача 36 ТЗ 19.10.2026): табло событий сервера — в колонке инструментов, под «Подписями», а
 * не выключателем внутри «Карты». Взял инструмент — табло на карте (в море у левого нижнего угла штата, как на
 * картинке владельца) и выбрано: тянется мышью, размер — за уголки, поворот — за ручку сверху, текст правится двойным
 * щелчком прямо на нём, под строками — плюс для новой строки. Здесь — то же табло списком: строки, колонки, значки,
 * готовые виды, цвета, шрифт, картинка. Убрали табло с карты — правки остаются, вернуть — одной кнопкой.
 */

export default function MapScheduleTool({ config, focus, onConfig, onShow, onFocus, onImage, onRow }) {
  useTr();
  const board = scheduleBoardOf(config.emblems);
  if (!board || board.enabled === false)
    return (
      <PanelSection
        title={tr("Расписание")}
        icon={<CalendarBlank aria-hidden="true" />}
        hint={
          board
            ? tr("Табло убрано с карты, но его строки и вид сохранены. Верните его — всё будет на месте.")
            : tr("Табло событий сервера: строки «значок · название · время» лежат прямо на карте и уезжают в игру вместе с ней.")
        }
      >
        <Button variant="primary" size="sm" block icon={<CalendarBlank />} onClick={onShow}>
          {board ? tr("Вернуть табло на карту") : tr("Поставить табло на карту")}
        </Button>
      </PanelSection>
    );
  const target = { kind: "emblem", id: board.id };
  return (
    <MapSchedule
      emblem={board}
      focus={focus}
      onObject={(patch, label, property) => onConfig(patchObject(config, target, patch), label, property)}
      onImage={onImage}
      onFocus={() => onFocus(target)}
      onRemove={() => onConfig(removeObject(config, target), tr("Табло удалено"), "schedule.remove")}
      onHide={() => {
        onConfig(hideScheduleBoard(config), tr("Расписание скрыто"), "schedule.hide");
        onRow(-1);
      }}
    />
  );
}
