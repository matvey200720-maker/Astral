// Инструмент «Иконки»: выбор значка и поиск, чтение значков игры, правка
// работы значков и своя картинка на значок.
import { useCallback, useMemo } from "react";
import { tr } from "../../../../locales/ui.js";
import { applyBlipEdit as editBlips } from "../world-map/icons/blip-icons-model.js";
import { squareBlipPicture as squareOf } from "../world-map/icons/blip-picture.js";
import { useBlipIconsState as useBlipIcons } from "../world-map/icons/useBlipIconsState.js";
import { useCell as useValueCell } from "./use-cell.js";

// Постановка своей картинки на значок: всё, что нужно, лежит в ctx
class PictureJob {
  constructor(ctx) {
    this.ctx = ctx;
  }

  // Проект, в котором у значка с этим номером стоит своя картинка
  projectWith(asset, number) {
    const { config, index } = this.ctx;
    const edit = { mode: "picture", assetId: asset.id };
    const blipIcons = editBlips(index, config.blipIcons, number, edit);
    return Object.assign({}, config, { blipIcons });
  }

  async accept(picture, number) {
    await this.ctx.onAsset(picture, (asset) => this.projectWith(asset, number));
    this.ctx.notify(tr("Своя картинка встала на значок"));
  }

  async run(file, number) {
    const picture = await squareOf(file, `blip-${number}.png`);
    if (picture && this.ctx.onAsset && this.ctx.index) {
      await this.accept(picture, number);
    } else {
      this.ctx.notify(tr("Картинка не открылась — выберите PNG, WebP или JPEG"));
    }
  }
}

export function useIconsTool(input) {
  const { config, apply, notify, tool, onAsset } = input;
  const pickCell = useValueCell(null);
  const queryCell = useValueCell("");
  const model = useBlipIcons(tool === "icons");

  // Работа значков заменяется целиком, подпись и ключ склейки даёт окно значков
  function replaceWork(work, label, property) {
    return apply({ ...config, blipIcons: work }, label, property);
  }
  const onWork = useCallback(replaceWork, [config, apply]);

  const index = model.index;
  function makePicture() {
    if (!onAsset) return null;
    const job = new PictureJob({ config, index, onAsset, notify });
    return (file, number) => job.run(file, number);
  }
  const onPicture = useMemo(makePicture, [notify, onAsset, index, config]);

  return Object.assign(
    { model },
    { pick: pickCell[0], query: queryCell[0], setPick: pickCell[1], setQuery: queryCell[1] },
    { onWork, onPicture },
  );
}
