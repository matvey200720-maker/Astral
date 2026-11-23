/*
 * Редактор залазов.
 *
 * Залазы — десять меток паркура нового мода (ТЗ владельца 10.10.2026),
 * расставленных по карте 1393 раза: куда лезть, где встать, когда прыгать,
 * от какого лица забираться, где поставить машину, где нужен напарник.
 * Редактор меняет облик каждой из десяти: вид из готовых, слова своим
 * шрифтом или своя картинка — фото, вписанное или кадрированное, — цвета,
 * обводку, ореол, размер и свечение ночью. Места и развороты — как в моде:
 * их задаёт расстановка, и они уже правильные.
 *
 * Кадр показывает не «похожую картинку», а ту самую текстуру, что уедет в
 * игру: её рисует `climb-render.js`, и тот же рисовальщик отдаёт PNG
 * установке по нажатию «Применить».
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): разделы
 * прежней колонки — инструменты слева, справа — настройки только взятого,
 * сцена — на весь кадр, готовые наборы — инструмент «Шаблоны», «Снять из
 * игры» — пункт «⋯».
 *
 * Какую метку править, выбирают только картинками (владелец, 29.09.2026):
 * плитками набора, а в кадрах «На стене» и «Текстура» — столбиком тех же
 * картинок слева от кадра. Полоса слов «Стрелка · Встать здесь · …» в шапке
 * не нужна — она повторяла бы плитки.
 */

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowClockwise,
  DownloadSimple,
  Palette,
  Shapes,
  Sun,
  Swatches,
  TextT,
  Trash,
} from "../../../components/ui/icons.jsx";
import {
  CLIMB_SLOTS,
  CLIMB_VARIANTS,
  applyClimbPreset,
  climbImageFor,
  createDefaultClimbDesign,
  normalizeClimbDesign,
  normalizeClimbModule,
} from "@modovik/climb-contract";
import useSettledValue from "../../../hooks/useSettledValue.js";
import EditorActions from "../../../components/ui/EditorActions.jsx";
import EditorShell from "../../../components/ui/EditorShell.jsx";
import {
  removeClimbCustomization,
  sanitizeDesktopErrorMessage,
} from "../../../api.js";
import { useRememberedState } from "../../../section-memory.js";
import { useWorkActions } from "../works/useWorkActions.jsx";
import ClimbInspector from "./ClimbInspector.jsx";
import ClimbPresets from "./ClimbPresets.jsx";
import ClimbStage from "./ClimbStage.jsx";
import { downloadClimbTextures } from "./climb-export.js";
import { loadClimbImage } from "./climb-image.js";
import {
  climbCanvasUrl,
  climbMarkerCanvas,
  climbMarkerPng,
  prepareClimbPicture,
} from "./climb-render.js";
import { useClimbStageMarker } from "./useClimbStageMarker.js";
import { useOwnFontReady } from "../emblem/own-font.js";
import { tr, useTr } from "../../../locales/ui.js";

const SET_TILE = 176;
const VARIANT_TILE = 96;

/*
 * Инструменты — разделы прежней колонки: сперва выбранная метка (вид,
 * надпись, своя картинка), потом набор целиком (цвет, размер и свет), что
 * уйдёт в игру и готовые наборы. Кадр двумерный, полёта камеры у него нет —
 * горячие клавиши буквами. «Вид» называет метку, которую правят, —
 * «Вид · Машина»: подпись всплывает у значка и стоит заголовком панели.
 * «Надпись» есть у всех меток со словами — у всех, кроме стрелки.
 */
function climbTools(slot) {
  return [
    {
      id: "marker",
      label: `${tr("Вид")} · ${tr(slot.label)}`,
      icon: <Shapes />,
      shortcut: "v",
      group: "marker",
      hint: tr("Выберите метку плиткой в кадре, а её вид — плиткой справа"),
    },
    {
      id: "text",
      label: tr("Надпись"),
      icon: <TextT />,
      shortcut: "n",
      group: "marker",
      hidden: !slot.text,
      hint: tr("Впишите надпись или возьмите быструю — она сама впишется в метку"),
    },
    {
      id: "colour",
      label: tr("Цвет"),
      icon: <Palette />,
      shortcut: "c",
      group: "set",
      hint: tr("Цвет общий на все метки; свой — выключателем у выбранной"),
    },
    {
      id: "size",
      label: tr("Размер"),
      icon: <Sun />,
      shortcut: "s",
      group: "set",
      hint: tr("Свечение смотрите «На стене» ночью — переключатель в углу кадра"),
    },
    {
      id: "templates",
      label: tr("Шаблоны"),
      icon: <Swatches />,
      shortcut: "t",
      group: "ready",
      hint: tr("Готовый набор меняет облик всех меток разом — надписи и картинки остаются"),
    },
  ];
}

/* Управление кадром: метку выбирают картинкой прямо в кадре. */
const CLIMB_GUIDE = Object.freeze([
  { keys: "ЛКМ", text: "выбрать метку" },
  { keys: ["Ctrl", "Z"], text: "отменить" },
]);

/*
 * Макет, которым рисуют.
 *
 * Метка «своей картинкой», чья картинка не прочиталась или ещё читается,
 * рисуется значком мода — и в кадре, и в игре. Иначе в игру уехала бы
 * пустая плашка, а кадр показывал бы то, чего не будет.
 */
function drawableDesign(design, pictures) {
  const missing = CLIMB_SLOTS.filter(
    (slot) => design.markers[slot.id].variant === "image" && !pictures[slot.id],
  );
  if (!missing.length) return design;
  const markers = { ...design.markers };
  for (const slot of missing)
    markers[slot.id] = { ...markers[slot.id], variant: "original" };
  return { ...design, markers };
}

/*
 * Плитки видов метки: каждый вид той же меткой и теми же цветами. Холсты
 * держит запас рисовальщика, строки PNG — сами холсты (`climbCanvasUrl`):
 * вернулся к метке — плитки уже готовы.
 */
function variantTile(design, slotId, variantId, picture) {
  if (variantId === "image" && !picture) return "";
  const slot = CLIMB_SLOTS.find((item) => item.id === slotId);
  const trial = {
    ...design,
    markers: {
      ...design.markers,
      [slotId]: {
        ...design.markers[slotId],
        variant: variantId,
        enabled: true,
      },
    },
  };
  return climbCanvasUrl(
    climbMarkerCanvas(trial, slotId, {
      size: VARIANT_TILE * slot.aspect,
      picture,
    }),
  );
}

const variantTiles = (design, slotId, picture) =>
  Object.fromEntries(
    CLIMB_VARIANTS[slotId].map((variant) => [
      variant.id,
      variantTile(design, slotId, variant.id, picture),
    ]),
  );

/*
 * Остальные метки — заранее, в простое после правки: плитки видов и кадр в
 * натуральную величину. Тогда смена метки берёт готовое, а не рисует под
 * щелчком десяток плиток и текстуру. Одна плитка на шаг — простой браузера
 * короче 50 мс, и ползунок с прокруткой этих шагов не ждут.
 */
function useWarmSlots(design, slotId, pictures) {
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const idle =
      window.requestIdleCallback ||
      ((callback) =>
        window.setTimeout(() => callback({ timeRemaining: () => 8 }), 32));
    const cancel = window.cancelIdleCallback || window.clearTimeout;
    const jobs = CLIMB_SLOTS.filter((slot) => slot.id !== slotId).flatMap(
      (slot) => {
        const picture = pictures[slot.id] || null;
        return [
          ...CLIMB_VARIANTS[slot.id].map(
            (variant) => () =>
              variantTile(design, slot.id, variant.id, picture),
          ),
          () => climbMarkerCanvas(design, slot.id, { picture }),
        ];
      },
    );
    let handle = 0;
    const step = (deadline) => {
      while (jobs.length && deadline.timeRemaining() > 4) jobs.shift()();
      if (jobs.length) handle = idle(step);
    };
    handle = idle(step);
    return () => cancel(handle);
    // Заготовка — от устоявшейся правки; выбранная метка рисуется и так.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, pictures]);
}

/* Те же картинки меток — тот же объект: соседям не за чем пересчитываться. */
function samePictures(a, b) {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => a[key] === b[key])
  );
}

/*
 * Картинки меток: файл проекта читается один раз, а не на правку и не на
 * смену метки.
 *
 * Пиксели файла лежат вне состояния и пропсов React (`pixelsRef`): в
 * состоянии — только «читается / готова / не прочиталась» и размер, наружу
 * уходят готовые холсты. Фриз 29.09.2026 был ровно здесь: пиксели картинки
 * (1024×1024 — четыре миллиона чисел) ехали в колонку правок пропсом, и
 * React в режиме разработки на каждой смене метки расписывал разницу пропсов
 * для дорожки «Components» поэлементно — шесть секунд на щелчок.
 */
function usePictures(design, assets) {
  const [loaded, setLoaded] = useState({});
  const pixelsRef = useRef(new Map());
  const requestedRef = useRef(new Set());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const wanted = useMemo(() => {
    const ids = new Set();
    for (const slot of CLIMB_SLOTS) {
      const assetId = design.markers[slot.id].image?.assetId;
      if (assetId) ids.add(assetId);
    }
    return [...ids].sort();
  }, [design.markers]);
  const wantedKey = wanted.join("|");

  useEffect(() => {
    /* Картинка, которую больше не ждёт ни одна метка, отпускается: четыре
       мегабайта пикселей на каждую замену файла копились бы до закрытия. */
    const stale = [...requestedRef.current].filter(
      (assetId) => !wanted.includes(assetId),
    );
    for (const assetId of stale) {
      requestedRef.current.delete(assetId);
      pixelsRef.current.delete(assetId);
    }
    if (stale.length)
      setLoaded((current) => {
        const next = { ...current };
        for (const assetId of stale) delete next[assetId];
        return next;
      });
    for (const assetId of wanted) {
      if (requestedRef.current.has(assetId)) continue;
      const asset = (assets || []).find((item) => item.id === assetId);
      if (!asset) {
        setLoaded((current) => ({
          ...current,
          [assetId]: { state: "failed" },
        }));
        continue;
      }
      /* Читается один раз на отпечаток: ни смена списка файлов посреди
         чтения, ни повторный проход эффекта не бросают начатое. */
      requestedRef.current.add(assetId);
      setLoaded((current) => ({ ...current, [assetId]: { state: "loading" } }));
      loadClimbImage(asset)
        .catch(() => null)
        .then((pixels) => {
          if (!mountedRef.current || !requestedRef.current.has(assetId)) return;
          if (pixels) pixelsRef.current.set(assetId, pixels);
          setLoaded((current) => ({
            ...current,
            [assetId]: pixels
              ? { state: "ready", width: pixels.width, height: pixels.height }
              : { state: "failed" },
          }));
        });
    }
    // Читаем по набору файлов, а не по каждой правке макета.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantedKey, assets]);

  const previousRef = useRef({});
  const prepared = useMemo(() => {
    const pictures = {};
    for (const slot of CLIMB_SLOTS) {
      const image = design.markers[slot.id].image;
      const pixels =
        image && loaded[image.assetId]?.state === "ready"
          ? pixelsRef.current.get(image.assetId)
          : null;
      if (pixels) pictures[slot.id] = prepareClimbPicture(pixels, image);
    }
    return samePictures(pictures, previousRef.current)
      ? previousRef.current
      : pictures;
  }, [design.markers, loaded]);
  useEffect(() => {
    previousRef.current = prepared;
  }, [prepared]);

  const status = (slotId) => {
    const assetId = design.markers[slotId].image?.assetId;
    return assetId ? loaded[assetId] || { state: "loading" } : null;
  };
  const loading = wanted.some(
    (assetId) => !loaded[assetId] || loaded[assetId].state === "loading",
  );
  return { pictures: prepared, status, loading };
}

export default function ClimbCustomizer({
  config: configInput,
  project,
  dirty,
  canUndo,
  canRedo,
  onChange,
  onUndo,
  onRedo,
  onApply,
  /* Надпись занятой кнопки: очередь применения общая на всё окно, и знает
     о ней студия. */
  applyBusy = "",
  /* Ход записи для заливки «Применить» (`useWorkshopApplyButton`). */
  applyMeter = null,
  applyHint = "",
  onCancel,
  onNotice,
  onImportAsset,
  onInstallationChange,
  /* «Мои работы» и коды — от студии (workshop-studio/studio-works.js). */
  works,
}) {
  useTr();
  const module = useMemo(
    () => normalizeClimbModule(configInput),
    [configInput],
  );
  const design = module.design;
  const workActions = useWorkActions({
    kind: "climbs",
    onNotice,
    linkedName: works?.linkedName,
    onSave: works?.save,
    onCopy: works?.copy,
    onOpen: works?.open,
  });
  const [slotId, setSlotId] = useState(CLIMB_SLOTS[0].id);
  const [view, setView] = useState("set");
  const [scene, setScene] = useState("day");
  const [backdrop, setBackdrop] = useState("dark");
  /* Инструменты зависят от метки: подпись «Вид · …» и «Надпись» только у
     меток с текстом. Взятый инструмент, которого у метки нет, уступает
     «Виду». */
  const slot = CLIMB_SLOTS.find((item) => item.id === slotId) || CLIMB_SLOTS[0];
  const tools = useMemo(() => climbTools(slot), [slot]);
  const [rememberedTool, setTool] = useRememberedState("climbs:tool", "marker");
  /* Прежняя «Своя картинка» — теперь первым блоком «Вида» (правило 10 `design-qa.md`, разбор критика 30.10.2026). */
  const tool = rememberedTool === "picture" ? "marker" : tools.some((item) => item.id === rememberedTool && !item.hidden)
    ? rememberedTool
    : "marker";
  const [exportBusy, setExportBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [installBusy, setInstallBusy] = useState("");
  const [installError, setInstallError] = useState("");

  const {
    pictures,
    status: pictureStatus,
    loading,
  } = usePictures(design, project?.assets);
  /* Свой шрифт меток открылся из хранилища окна — метки перерисуются им (до того писали бы запасным). */
  const fontReady = useOwnFontReady(design.style.fontAsset);
  const paintable = useMemo(() => {
    const drawable = drawableDesign(design, pictures);
    /* Новая ссылка, когда шрифт открылся: плитки и кадр держат прежний рисунок, пока ссылка та же. */
    return design.style.fontAsset && drawable === design ? { ...design } : drawable;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, pictures, fontReady]);

  /*
   * Кадр считается от отложенной правки: ползунок откликается сразу, а кадр
   * догоняет его в свободное между шагами время. Плитки набора и видов — от
   * правки, которая перестала меняться: посреди движения руки их никто не
   * разглядывает (стенд `npm run perf -- --profile`, 25.09.2026).
   */
  const previewDesign = useDeferredValue(paintable);
  /* Метка кадра: новая форма той же метки досчитывается в потоке, кадр до того держит прежнюю (19.10.2026). */
  const { marker, layout } = useClimbStageMarker(previewDesign, slotId, pictures[slotId] || null);
  const settled = useSettledValue(paintable);
  const setThumbnails = useMemo(
    () =>
      Object.fromEntries(
        CLIMB_SLOTS.map((slot) => [
          slot.id,
          settled.markers[slot.id].enabled
            ? climbCanvasUrl(
                climbMarkerCanvas(settled, slot.id, {
                  size: SET_TILE * slot.aspect,
                  picture: pictures[slot.id] || null,
                }),
              )
            : "",
        ]),
      ),
    [settled, pictures],
  );
  const variantThumbnails = useMemo(
    () => variantTiles(settled, slotId, pictures[slotId] || null),
    [settled, slotId, pictures],
  );
  useWarmSlots(settled, slotId, pictures);

  /* Установленный набор ищется по проекту, а не по игре: список установок
     ведёт мастерская, и она же переживает перезапуск приложения. */
  const activeInstall =
    [...(project?.installations || [])]
      .reverse()
      .find(
        (item) =>
          item.kind === "local-legacy-climbs" && item.status === "active",
      ) || null;

  /* Наружу уходит только приведённый к контракту макет: редактор не имеет
     права положить в проект то, чего сам потом не прочитает. */
  const commit = (nextDesign, label, path) =>
    onChange(
      { ...module, design: normalizeClimbDesign(nextDesign) },
      label,
      `design.${path}`,
    );
  const patchStyle = (values, label, path) =>
    commit(
      { ...design, style: { ...design.style, ...values } },
      label,
      `style.${path}`,
    );
  const patchTexture = (values, label, path) =>
    commit(
      { ...design, texture: { ...design.texture, ...values } },
      label,
      `texture.${path}`,
    );
  const patchMarker = (id, values, label, path) =>
    commit(
      {
        ...design,
        markers: {
          ...design.markers,
          [id]: { ...design.markers[id], ...values },
        },
      },
      label,
      `markers.${id}.${path}`,
    );

  const choosePreset = useCallback(
    (preset) =>
      onChange(
        { ...module, design: applyClimbPreset(design, preset) },
        `Готовые залазы: ${preset.label}`,
        "design",
      ),
    [module, design, onChange],
  );

  const reset = () =>
    onChange(
      {
        ...module,
        design: createDefaultClimbDesign(design.designId, design.name),
      },
      "Залазы как в моде",
      "design",
    );

  /* Файл кладёт в проект сама мастерская: она знает про хранилище и про
     историю правок. Редактору остаётся сказать, куда записать его в макете:
     подкраска и «вписать/заполнить» прежней картинки остаются, кадр нового
     снимка начинается с середины (`climbImageFor`). */
  const pickImage = async (id, event) => {
    const current = design.markers[id];
    await onImportAsset?.(event, (stored) => ({
      ...module,
      design: normalizeClimbDesign({
        ...design,
        markers: {
          ...design.markers,
          [id]: {
            ...current,
            variant: "image",
            image: climbImageFor(id, stored.id, current.image),
          },
        },
      }),
    }));
    if (event?.target) event.target.value = "";
  };

  const download = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      await downloadClimbTextures(paintable, { pictures });
      onNotice?.(tr("Текстуры меток выгружены — DDS и PNG с запиской"));
    } catch (error) {
      onNotice?.(
        error.message || tr("Не удалось выгрузить текстуры залазов"),
        "error",
      );
    } finally {
      setExportBusy(false);
    }
  };

  /*
   * Установка одним нажатием.
   *
   * Текстуры рисуются здесь же, в момент нажатия: в игру уезжает то, что
   * человек видел в кадре, а не то, что успеет поменяться, пока работа ждёт
   * очереди. Проект сохраняется и встаёт в очередь применения вместе с ними.
   */
  const install = async () => {
    if (preparing) return;
    setPreparing(true);
    try {
      const textures = {};
      for (const slot of CLIMB_SLOTS) {
        if (!paintable.markers[slot.id].enabled) continue;
        textures[slot.id] = await climbMarkerPng(paintable, slot.id, {
          picture: pictures[slot.id] || null,
        });
      }
      await onApply?.({ design: paintable, textures });
    } catch (error) {
      onNotice?.(
        error.message || tr("Не удалось подготовить текстуры залазов"),
        "error",
      );
    } finally {
      setPreparing(false);
    }
  };

  /*
   * «Снять из игры» — пункт «⋯»: меню закрывается сразу, и итог говорится
   * уведомлением — панель «Установки в игру» в этот момент может быть не
   * открыта. Отказ остаётся и строкой в той панели.
   */
  const removeInstall = async () => {
    if (!activeInstall || installBusy) return;
    setInstallBusy("remove");
    setInstallError("");
    try {
      const removed = await removeClimbCustomization({
        modId: activeInstall.modId,
        gameRoot: activeInstall.gameRoot,
        targetId: activeInstall.targetId,
      });
      onInstallationChange?.(removed);
      onNotice?.(tr("Залазы сняты из игры. Перезапустите игру."));
    } catch (error) {
      const message =
        sanitizeDesktopErrorMessage(error) || tr("Не удалось снять залазы.");
      setInstallError(message);
      onNotice?.(message, "error");
    } finally {
      setInstallBusy("");
    }
  };

  const assetOf = (id) =>
    (project?.assets || []).find(
      (item) => item.id === design.markers[id].image?.assetId,
    ) || null;

  const busyLabel = applyBusy || (preparing ? tr("Рисуем текстуры…") : "");
  return (
    <EditorShell
      toolCards={false}
      className="fx-editor climb-editor"
      title={tr("Мастерская залазов")}
      status={`${design.name} · ${dirty ? tr("Есть изменения") : tr("Сохранено")}`}
      backLabel={tr("Назад в мастерскую")}
      onBack={onCancel}
      tools={tools}
      tool={tool}
      onTool={setTool}
      guide={CLIMB_GUIDE}
      guideKey="climbs"
      actions={
        <EditorActions
          onUndo={onUndo}
          canUndo={canUndo}
          onRedo={onRedo}
          canRedo={canRedo}
          more={[
            ...workActions.items,
            { value: "reset", label: tr("Как в игре"), icon: <ArrowClockwise /> },
            {
              value: "download",
              label: tr("Скачать текстуры"),
              icon: <DownloadSimple />,
              disabled: exportBusy,
            },
            /* Прежняя кнопка «Снять из игры» из колонки — пунктом меню,
               как у всех редакторов мастерской. */
            ...(activeInstall
              ? [
                  {
                    value: "remove",
                    label:
                      installBusy === "remove"
                        ? tr("Снимаем из игры…")
                        : tr("Снять из игры"),
                    icon: <Trash />,
                    disabled: Boolean(installBusy),
                  },
                ]
              : []),
          ]}
          onMore={(action) => {
            if (workActions.handle(action)) return;
            if (action === "reset") return reset();
            if (action === "download") return void download();
            if (action === "remove") return void removeInstall();
          }}
          apply={{
            label: activeInstall ? tr("Обновить в игре") : tr("Применить"),
            title: loading
              ? tr("Картинка метки ещё читается")
              : applyHint || tr("Поставить залазы в GTA V Legacy"),
            busy: busyLabel,
            meter: applyMeter,
            disabled: loading,
            onClick: install,
          }}
        />
      }
      inspectorClassName="climb-inspector"
      inspector={
        tool === "templates" ? (
          <ClimbPresets
            design={settled}
            pictures={pictures}
            onApply={choosePreset}
          />
        ) : (
          <ClimbInspector
            tool={tool}
            design={design}
            slotId={slotId}
            thumbnails={variantThumbnails}
            asset={assetOf(slotId)}
            picture={pictureStatus(slotId)}
            installError={installError}
            onPatchStyle={patchStyle}
            onPatchTexture={patchTexture}
            onPatchMarker={patchMarker}
            onPickImage={pickImage}
            onNotice={onNotice}
          />
        )
      }
    >
      <ClimbStage
        design={previewDesign}
        slotId={slotId}
        onSlot={setSlotId}
        view={view}
        onView={setView}
        scene={scene}
        onScene={setScene}
        backdrop={backdrop}
        onBackdrop={setBackdrop}
        thumbnails={setThumbnails}
        marker={marker}
        layout={layout}
        settled={settled}
        pictures={pictures}
      />
      {workActions.dialogs}
    </EditorShell>
  );
}
