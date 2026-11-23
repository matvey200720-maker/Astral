import React from "react";
import { workshopMediaPriority } from "./workshop-media-policy.js";
import { useTileThumb } from "./utils/tile-thumb.js";

export const WorkshopImage = React.memo(function WorkshopImage({
  index = 0,
  selected = false,
  hero = false,
  eagerCount,
  fallbackSrc,
  onError,
  /* Раскладка плитки (`utils/tile-thumb.js`): облачная картинка идёт превью по её ширине, а не оригиналом. */
  tile = null,
  src,
  ...imageProps
}) {
  const shown = useTileThumb(src, tile);
  const priority = workshopMediaPriority({
    index,
    selected,
    hero,
    eagerCount,
  });

  const handleError = (event) => {
    const image = event.currentTarget;
    if (fallbackSrc && image.dataset.fallbackApplied !== "true") {
      image.dataset.fallbackApplied = "true";
      image.src = fallbackSrc;
      return;
    }
    onError?.(event);
  };

  return <img {...priority} {...imageProps} src={shown} onError={handleError} />;
});
