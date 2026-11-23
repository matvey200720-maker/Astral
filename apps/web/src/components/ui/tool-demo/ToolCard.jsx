import "./tool-demo.css";
import { createElement as h } from "react";
import { tr, useTr } from "../../../locales/ui.js";
import ToolDemo from "./ToolDemo.jsx";
import { paintTarget, demoVariant, demoKind, demoFocus, demoGround } from "./tool-demo-kinds.js";

// Подпись полоски по виду действия (слово за словом для чтения с экрана); переводится при каждой отрисовке.
const CAPTIONS = new Map([
  ["paint", "Инструмент перекрашивает поверхность"],
  ["zone", "Зона: цвет, прозрачность и граница"],
  ["move", "Перемещение предмета или холста"],
  ["marquee", "Выделение области"],
  ["picker", "Пипетка берёт цвет с листа"],
  ["shape", "Фигура растягивается от угла"],
  ["pattern", "Узор ложится на поверхность по щелчку"],
  ["picture", "Своя картинка встаёт в рамку"],
  ["text", "Щёлкните — и печатайте надпись"],
  ["emblem", "Эмблема ставится щелчком"],
  ["light", "Свет и его цвет"],
  ["model", "Своя модель встаёт в кадр, её можно двигать"],
  ["parts", "Деталь можно спрятать и вернуть"],
  ["select", "Щелчок по предмету в кадре выбирает его"],
  ["templates", "Шаблон меняет облик целиком"],
  ["standard", "«Стандарт» снимает правки — как в игре"],
  ["size", "Размер и положение"],
  ["effect", "Эффект в момент попадания"],
  ["tune", "Вид прицела и элементов экрана"],
  ["draw", "Кисть рисует по листу"],
  ["eraser", "Ластик стирает нарисованное"],
  ["sound", "Звук и громкость"],
]);

// Свойства полоски в порядке, который она видит; контур ствола отдаётся только сцене «weapon».
function demoProps({ tool, editorKey, scene, ground, kind }, shape) {
  return {
    ground,
    kind,
    toolId: tool.id,
    variant: demoVariant(editorKey, scene),
    target: paintTarget(tool.id, editorKey),
    focus: demoFocus(tool.id, editorKey),
    shape: ground === "weapon" ? shape : null,
    label: tr(CAPTIONS.get(kind)),
  };
}

// Что показывает карточка: сцена места и действие инструмента; нет одного из двух — карточки нет.
function useDemoPick({ editorKey = "", scene = "", tool }) {
  useTr();
  const ground = demoGround(editorKey, scene, tool.id);
  const kind = demoKind(tool, ground, editorKey);
  if (!kind) return null;
  return { editorKey, ground, kind, scene, tool };
}

export default function ToolCard(props) {
  const pick = useDemoPick(props);
  if (pick === null) return null;
  const hint = [pick.tool.hint, pick.tool.note].find(Boolean);
  const frame = { className: "ui-tool-card", "aria-label": tr("Как работает инструмент"), title: hint ? tr(hint) : undefined };
  return h("section", frame, h(ToolDemo, demoProps(pick, props.shape ?? null)));
}
