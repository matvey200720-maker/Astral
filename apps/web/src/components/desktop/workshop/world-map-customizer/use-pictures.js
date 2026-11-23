// Файлы, которые кладут на карту: картинки, шрифты, текстура подложки.
// Каждый файл сначала уходит в проект (onAsset), потом ложится правкой.
import { useEffect, useMemo, useRef } from "react";
import { scheduleBoardOf } from "@modovik/vector-map";
import { tr } from "../../../../locales/ui.js";
import { addEmblem, findObject, patchObject } from "../world-map-editing.js";
import { GIF_NOTE } from "../world-map-picture.js";
import { mapText } from "../world-map/map-copy.js";
import { pictureSpot } from "./frame-math.js";
import { fontNameOf } from "./map-helpers.js";
import { imageAspect, isFontFile, isPictureFile, readyPicture } from "./picture-helpers.js";

// Подсказка после постановки картинки: у GIF — про первый кадр
function noteAfter(prepared) {
  if (!prepared.gif) {
    return tr("Картинка на карте — тяните её мышью, размер за уголки, поворот за ручку сверху");
  }
  return tr(GIF_NOTE) + " " + tr("Тяните картинку мышью, размер — за уголки.");
}

// Цель правки картинки: табло расписания, иначе выбранная эмблема
function emblemTargetOf(board, selection) {
  const onBoard = board ? { kind: "emblem", id: board.id } : null;
  const onPicked = selection?.kind === "emblem" ? selection : null;
  return onBoard ?? onPicked;
}

function fontPatchOf(asset) {
  return { font: "custom", fontAssetId: asset.id, fontName: fontNameOf(asset) };
}

// Команды с файлами этой отрисовки. fresh — ячейка с картинкой, которую надо выбрать, когда она появится.
class PictureDesk {
  constructor(deps, fresh) {
    this.d = deps;
    this.fresh = fresh;
  }

  // Файл готов к проекту: перевод в PNG и пропорция; null, если готовить нечего.
  // warnGif — сразу предупредить про GIF.
  async prepare(file, warnGif) {
    const prepared = await readyPicture(file, this.d.notify);
    if (!prepared) return null;
    if (warnGif && prepared.gif) this.d.notify(tr(GIF_NOTE));
    const aspect = await imageAspect(prepared.file);
    return { prepared, aspect };
  }

  // Готовая картинка уходит в проект и встаёт на карту: в точку at или в центр кадра
  place(job, at) {
    const d = this.d;
    const spot = pictureSpot(d.viewRef.current, d.sceneSize, d.atlas);
    const lay = (asset) => {
      const made = addEmblem(d.config, at || spot.centre, { kind: "image", assetId: asset.id, width: spot.width });
      if (!made.selection) return null;
      this.fresh.current = made.selection;
      return patchObject(made.config, made.selection, { aspect: job.aspect });
    };
    d.onAsset?.(job.prepared.file, lay);
    d.notify(noteAfter(job.prepared));
  }

  addPicture = async (file, at) => {
    if (!file) return;
    const job = await this.prepare(file, false);
    if (job) this.place(job, at);
  };

  // Свой шрифт: выбранной надписи или следующей
  addFont = async (file) => {
    const d = this.d;
    if (!d.onAsset) return null;
    const picked = d.selection?.kind === "emblem" ? findObject(d.config, d.selection) : null;
    const target = picked?.kind === "text" ? d.selection : null;
    const asset = await d.onAsset(
      file,
      target ? (made) => patchObject(d.config, target, fontPatchOf(made)) : undefined,
    );
    if (!asset) return null;
    if (!target) {
      const fontName = fontNameOf(asset);
      d.setTextStyle({ ...d.textStyle, ...fontPatchOf(asset), fontName });
    }
    d.notify(mapText("Шрифт «{name}» добавлен в проект", { name: fontNameOf(asset) }));
    return asset;
  };

  // Бросок файлов на карту: шрифты и картинки, без ожидания друг друга
  onDropFiles = (list, world) => {
    for (const file of Array.from(list)) {
      if (isFontFile(file)) this.addFont(file);
      else if (isPictureFile(file)) this.addPicture(file, world);
    }
  };

  // Картинка выбранной надписи с панели справа
  onEmblemImage = async (file) => {
    const d = this.d;
    if (d.selection?.kind !== "emblem") return;
    const ready = await this.prepare(file, true);
    if (!ready) return;
    d.onAsset?.(ready.prepared.file, (asset) =>
      patchObject(d.config, d.selection, { kind: "image", assetId: asset.id, aspect: ready.aspect }),
    );
  };

  // Картинка табло расписания (или выбранной эмблемы): правку собирает панель
  onScheduleImage = async (file, change) => {
    const d = this.d;
    const target = emblemTargetOf(scheduleBoardOf(d.config.emblems), d.selection);
    if (target) {
      const ready = await this.prepare(file, true);
      if (ready) {
        d.onAsset?.(ready.prepared.file, (asset) => patchObject(d.config, target, change(asset, ready.aspect)));
      }
    }
  };

  // Своя текстура подложки
  onTexture = (file) => {
    const d = this.d;
    if (!d.onAsset) return;
    d.notify(tr("Текстура наложена на карту"));
    const { base } = d.config;
    d.onAsset(file, (asset) => ({
      ...d.config,
      base: {
        ...base,
        textureId: "image",
        textureAssetId: asset.id,
        textureBlend: "soft-light",
        textureOpacity: Math.max(base.textureOpacity, 60),
      },
    }));
  };
}

// Имена команд наружу: поля-функции экземпляра
const COMMAND_NAMES = (() => {
  const probe = new PictureDesk(null, null);
  return Object.keys(probe).filter((name) => typeof probe[name] === "function");
})();

export function usePictures(deps) {
  const { config, setPicked } = deps;
  const inputRef = useRef(null);
  const pointRef = useRef(null);
  const fresh = useRef(null);
  const desk = useRef(null);
  desk.current = new PictureDesk(deps, fresh);

  // Свежая картинка выбирается, когда появится в проекте
  useEffect(() => {
    const wanted = fresh.current;
    if (wanted && findObject(config, wanted)) {
      fresh.current = null;
      setPicked([wanted]);
    }
  }, [config, setPicked]);

  const stable = useMemo(() => {
    const out = {};
    // команда читает свежую сводку окна в момент вызова
    for (const name of COMMAND_NAMES) {
      out[name] = (...args) => desk.current[name](...args);
    }

    // Скрытое поле выбора файла
    out.askForPicture = (world) => {
      pointRef.current = world;
      inputRef.current?.click();
    };
    out.onPickedFile = ({ target: input }) => {
      const file = input.files?.[0];
      const at = pointRef.current;
      input.value = "";
      pointRef.current = null;
      if (file) out.addPicture(file, at);
    };
    return out;
  }, []);

  return { inputRef, ...stable };
}
