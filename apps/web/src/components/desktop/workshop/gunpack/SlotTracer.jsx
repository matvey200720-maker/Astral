import { tr, useTr } from "../../../../locales/ui.js";
import Button from "../../../ui/Button.jsx";
import { tracerStreakThumb } from "../effects-preview.js";
import { slotTracer } from "./gunpack-tracers.js";
import { createElement as h, Fragment } from "react";

export default function SlotTracer({ heading = "h3", onTracer = null, tracers, weaponId }) {
  useTr();
  const found = slotTracer(tracers, weaponId);
  return found ? trailBlock(found, heading, onTracer, weaponId) : null;
}

function trailBlock(found, heading, onTracer, weaponId) {
  const { action, name, note, thumb } = describeTrail(found);
  const toStudio = () => onTracer(weaponId);

  return h(
    Fragment,
    null,
    h(heading, null, tr("Трейсер")),
    h("div", { className: "gunpack-tracer" }, streakCell(thumb), copyCell(name, note)),
    // пустое значение onTracer возвращается как есть: `0` остаётся текстом в корне
    onTracer ? h(Button, { variant: "secondary", size: "sm", onClick: toStudio }, action) : onTracer
  );
}

const describeTrail = ({ tracer, inGame }) => (tracer ? customTrail(tracer, inGame) : stockTrail());

const stockTrail = () => ({
  thumb: null,
  name: tr("Штатный след"),
  note: tr("В наборе эффектов этому стволу трейсер не задан"),
  action: tr("Задать трейсер"),
});

function customTrail(tracer, inGame) {
  const thumb = tracer.off ? null : tracerStreakThumb(tracer.profile, { ...THUMB_BOX });
  return {
    thumb,
    name: joinedName(tracer),
    note: inGame ? tr("Стоит в игре") : tr("В игру — по «Применить» в студии трейсеров"),
    action: tr("Настроить трейсер"),
  };
}

function joinedName({ everything, off, title }) {
  const parts = [off && `${tr("Без трассера")} · `, String(title), everything && tr(" · всё остальное оружие")];
  return parts.filter(Boolean).join("");
}

function streakCell(url) {
  const picture = url ? h("img", { alt: "", src: url }) : h("i");
  return h("span", { className: "gunpack-tracer-streak", "aria-hidden": "true" }, picture);
}

function copyCell(name, note) {
  return h("span", { className: "gunpack-weapon-copy" }, h("b", null, name), h("small", null, note));
}

const THUMB_BOX = Object.freeze({ width: 76, height: 22 });
