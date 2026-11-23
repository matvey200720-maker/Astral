import { createElement as h, useEffect, useMemo } from "react";
import EditorCover from "../../workshop/covers/EditorCover.jsx";

// Адрес картинки части: создаётся при отрисовке, один на объект cover.
const pictureUrl = (cover) => (cover && cover.image ? URL.createObjectURL(new Blob([cover.image], { type: "image/png" })) : "");

// Что рисовать, по порядку: слот с работой, картинка самой части, стандартный слот, ничего.
const VARIANTS = [
  { when: ({ cover }) => cover && cover.slotId, draw: ({ cover }) => h(EditorCover, { slotId: cover.slotId, state: cover.state }) },
  {
    when: ({ url }) => url,
    draw: ({ cover, url }) =>
      h(
        "span",
        { className: "workshop-cover", "data-cover": "part", "aria-hidden": "true" },
        h("img", { className: `workshop-cover-image part-cover-image is-${cover.fit || "cover"}`, alt: "", draggable: "false", src: url }),
      ),
  },
  { when: ({ slotId }) => slotId, draw: ({ slotId }) => h(EditorCover, { slotId }) },
];

export default function PartCover({ cover = null, slotId = "" }) {
  const url = useMemo(() => pictureUrl(cover), [cover]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  const input = { cover, url, slotId };
  const variant = VARIANTS.find((one) => one.when(input));
  return variant ? variant.draw(input) : null;
}
