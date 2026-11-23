import { createElement as h, memo } from "react";
import ModName from "./ModName.jsx";
import StockCoverNote from "./StockCoverNote.jsx";
import MediaCard from "../../ui/MediaCard.jsx";
import SpriteIcon from "../../ui/SpriteIcon.jsx";
import { catalogMediaPresentation } from "../../../utils/catalogMedia.js";

const CARD_CLASS = "astral-store-card is-store is-poster";

// Запись для вида и адреса: метки берутся у лидера, а идентификатор и картинка — у группы.
const faceRecord = (group, lead) => ({ ...lead, id: group.leadId || group.id, cover: group.cover });

// Угол карточки: число компонентов редукса, если оно истинное (владелец 13.11.2026: не «части на полках», а компоненты сборки).
const componentsFact = (components, words) =>
  components ? h("span", { className: "poster-fact", "data-fact": "contents" }, h(SpriteIcon, { name: "layers" }), words.components(components)) : null;

function ReduxGroupCard({ group, lead, components, words, onOpen }) {
  const { className, style } = catalogMediaPresentation(faceRecord(group, lead), CARD_CLASS);
  const shell = {
    className: `${className} redux-group-card`,
    mediaStyle: style,
    frameClassName: "astral-store-art",
    copyClassName: "astral-store-copy",
    trailingClassName: "astral-store-size",
    title: h(ModName, { name: group.name }),
    trailing: componentsFact(components, words),
    onClick: () => {
      onOpen(group.id);
    },
    "data-redux-group": group.id,
  };
  const note = group.cover ? null : h(StockCoverNote, { language: words.language });
  return h(MediaCard, shell, note);
}

export default memo(ReduxGroupCard);
