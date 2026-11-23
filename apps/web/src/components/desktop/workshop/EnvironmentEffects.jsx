/*
 * Редактор «Огонь и взрывы»: огонь, вспышки и свет, взрывы, дым и пар.
 *
 * Правится не рисунок, а штатный спрайт игры: сцена показывает листы ядра из
 * GTA V игрока — все листы выбранного семейства, по кадру на лист, — с тем же
 * оттенком, яркостью и плотностью, что уйдут в патч: функция правки одна на
 * окно и на главный процесс. Без рабочего стола листов нет, и кадр пуст: нарисованного
 * образца вместо спрайта игры нет (17.11.2026), строка состояния говорит, что листы
 * прочитаются из игры в Astral Desktop.
 *
 * Семейств пятнадцать, и стоят они группами: «перекрасить огонь» — это шесть
 * разных огней, от костра до форсажа, и свалить их в один ряд значило бы
 * заставить человека читать пятнадцать подписей подряд.
 *
 * Раскладка — мастерская «как в Photoshop» (владелец, 03.10.2026): «Что
 * красим», «Цвет» и «Характер» — инструменты слева, справа — панель взятого,
 * подпись кадра — в его правом нижнем углу.
 *
 * Объёмный кадр (задача 7 ТЗ 05.10.2026): когда главный процесс выгрузил
 * эффект игры для семейства (`base.environmentScene`), в кадре — он сам, в 3D
 * на матовом фоне с тонкой сеткой, под правкой семейства
 * (`ptfx/environment-scene.js`). Без него (браузер, старый помощник, нет
 * WebGL) — прежний лист.
 *
 * Видно и мелкое (задача 3 ТЗ 06.10.2026): вспышка выстрела — очередью из
 * ствола, свечение и сварка — крупно и всё время; переключатель «Эффект /
 * Текстура» показывает саму текстуру семейства плоской картинкой — то, что
 * правится, а не догадка по вспышкам.
 *
 * У семейства несколько листов (ТЗ 22.10.2026, п. 5: «листов: 3»), и в объёмном
 * кадре они играют вперемешку: переключатель «Все / Лист 1 / 2 / 3» оставляет в
 * кадре частицы одного листа, чтобы видеть, что делает каждый.
 */

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ENVIRONMENT_FAMILIES,
  ENVIRONMENT_GROUPS,
  ENVIRONMENT_LIMITS,
  applyFamilyTint,
  FIRE_REMOVED_FAMILIES,
  effectsAreOff,
  familyChanged,
  familyIsRemoved,
  findEnvironmentFamily,
  fireIsRemoved,
} from "@modovik/ptfx-studio";
import Button from "../../ui/Button.jsx";
import SegmentedControl from "../../ui/SegmentedControl.jsx";
import SelectionMark from "../../ui/SelectionMark.jsx";
import Slider from "../../ui/Slider.jsx";
import Switch from "../../ui/Switch.jsx";
import ColorField from "../../ui/ColorField.jsx";
import { StageBar, StageNote } from "../../ui/StageOverlay.jsx";
import { watchFrameGate } from "../../../attention.js";
import { createEnvironmentScene } from "./ptfx/environment-scene.js";
import { READBACK, context2d } from "./effects-preview.js";
import { createLruCache } from "./lru-cache.js";
import { setPngSource } from "../../../utils/png-source.js";
import { Skeleton } from "../../ui/Skeleton.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { useEffectsCopy } from "./effects-lang.js";

const percent = (value) => `${Math.round(value * 100)}%`;

const TINT_SWATCHES = Object.freeze([
  "#ffffff",
  "#ff7a1a",
  "#ff2d2d",
  "#ffd23c",
  "#3cd0ff",
  "#b84dff",
  "#39ff8a",
  "#1b1b1f",
]);

/*
 * Пиксели PNG-превью из главного процесса — через холст. Листов в семействе до
 * девяти, и каждый рисуется дважды (крупно и в ряду), поэтому разбор кэшируется
 * по самому превью (строка или байты: Map ключует и то, и другое).
 */
const decoded = createLruCache(64);

function decodePreview(sheet) {
  const source = sheet?.preview?.png;
  if (!source || typeof Image === "undefined") return Promise.resolve(null);
  if (decoded.has(source)) return decoded.get(source);
  const pending = new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = sheet.preview.width;
        canvas.height = sheet.preview.height;
        /* Из этого холста пиксели читают — заводим его в обычной памяти, а
           не в видеопамяти: `getImageData` с видеокарты — синхронная
           выгрузка кадра (см. `context2d`). */
        const context = context2d(canvas, READBACK);
        if (!context) {
          resolve(null);
          return;
        }
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height);
        resolve({
          rgba: data.data,
          width: canvas.width,
          height: canvas.height,
          format: sheet.format,
        });
      } catch {
        resolve(null);
      }
    };
    image.onerror = () => resolve(null);
    setPngSource(image, source);
  });
  decoded.set(source, pending);
  return pending;
}

/** Холст листа под правкой: те же пиксели, что уйдут в ядро. */
function SheetCanvas({ sheet, settings, className }) {
  const canvasRef = useRef(null);
  const [pixels, setPixels] = useState(null);

  useEffect(() => {
    let cancelled = false;
    /* Листа из игры нет или превью не разобралось — кадр пуст: рисованного образца вместо спрайта игры нет (17.11.2026). */
    if (!sheet) {
      setPixels(null);
      return () => {};
    }
    decodePreview(sheet).then((result) => {
      if (!cancelled) setPixels(result);
    });
    return () => {
      cancelled = true;
    };
  }, [sheet]);

  /*
   * Правка листа — пять чисел, и перекрашивать его стоит только когда
   * поменялось одно из них. Сами настройки — новый объект на каждую правку
   * проекта, в том числе соседнего семейства: эффект, привязанный к ним,
   * гнал попиксельную перекраску крупного листа и всех листов ряда от любого
   * ползунка.
   */
  const enabled = Boolean(settings?.enabled);
  const tint = settings?.tint;
  const tintStrength = settings?.tintStrength;
  const brightness = settings?.brightness;
  const opacity = settings?.opacity;
  /* «Убрать огонь совсем»: лист гаснет — чёрный и прозрачный. */
  const remove = settings?.remove === true;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pixels || tint === undefined) return;
    const context = context2d(canvas);
    if (!context) return;
    /* Размер холста переставляется только когда он другой: присвоение
       заново выделяет его память даже с тем же самым числом. */
    if (canvas.width !== pixels.width) canvas.width = pixels.width;
    if (canvas.height !== pixels.height) canvas.height = pixels.height;
    /* Правка одна и та же, что уйдёт в ядро: смотрим ровно то, что ставим. */
    const tinted = enabled
      ? applyFamilyTint(
          pixels.rgba,
          { tint, tintStrength, brightness, opacity, remove },
          { format: pixels.format },
        )
      : pixels.rgba;
    const image = context.createImageData(pixels.width, pixels.height);
    image.data.set(tinted);
    context.putImageData(image, 0, 0);
  }, [pixels, enabled, tint, tintStrength, brightness, opacity, remove]);

  return pixels ? <canvas ref={canvasRef} className={className} /> : null;
}

const frames =(sheet) =>
  (sheet?.grid?.columns || 1) * (sheet?.grid?.rows || 1);

/*
 * Объёмный кадр семейства: эффект игры в 3D под правкой. Камера — общая
 * на мастерскую: ЛКМ — вокруг, колесо — ближе, щелчок ПКМ — полёт.
 * `onFailure` — WebGL не завёлся: сцена вернётся к листу.
 */
function EnvironmentFlame({ scene, light, environment, family, sheet = "", onStatus, onFailure, barExtra = null }) {
  useTr();
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const statusRef = useRef(onStatus);
  const failureRef = useRef(onFailure);
  statusRef.current = onStatus;
  failureRef.current = onFailure;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let created;
    try {
      created = createEnvironmentScene({
        canvas,
        onStatus: (status) => statusRef.current?.(status),
      });
    } catch (error) {
      failureRef.current?.(error);
      return undefined;
    }
    sceneRef.current = created;
    /* Стенд разработки видит сцену: эффект, частицы, перекрашенные листы. */
    if (import.meta.env?.DEV) window.__astralEnvironmentScene = created;
    const measure = () => {
      const box = canvas.getBoundingClientRect();
      created.resize(box.width, box.height, window.devicePixelRatio || 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    measure();
    const stopGate = watchFrameGate(canvas, (open) => {
      if (open) created.start();
      else created.stop();
    });
    return () => {
      stopGate();
      observer.disconnect();
      created.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setBase(scene, light);
  }, [scene, light]);
  useEffect(() => {
    sceneRef.current?.setFamily(family);
  }, [family]);
  useEffect(() => {
    sceneRef.current?.setSheet(sheet);
  }, [sheet]);
  useEffect(() => {
    sceneRef.current?.setEnvironment(environment);
  }, [environment]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="fx-environment-scene"
        tabIndex={0}
        aria-label={tr("Эффект игры в 3D. Левая кнопка — повернуть, колесо — приблизить, правая кнопка — полёт.")}
      />
      {/* Стрелки «Вид по умолчанию» нет: вид возвращает двойной щелчок по
          кадру (общая камера, владелец 18.10.2026). */}
      {barExtra && <StageBar>{barExtra}</StageBar>}
    </>
  );
}


/*
 * Какой лист семейства играет в объёмном кадре: «Все» или один. До четырёх листов — «Лист 1…», дальше
 * (у дыма их девять) — числа, чтобы полоса не вылезала из кадра; подпись листа с именем текстуры — в подсказке.
 * Лист, которого выбранный эффект не рисует, не гаснет (ТЗ 23.10.2026, п. D): выбрать можно каждый, а кадр показывает
 * его частицами этого эффекта (`sheetLookup`); в подсказке — что сам эффект его не рисует.
 */
export function sheetOptions(textures, drawn) {
  const names = textures || [];
  const compact = names.length > 4;
  return [
    { value: "", label: tr("Все"), title: tr("Все листы эффекта вместе, как в игре") },
    ...names.map((name, index) => {
      const used = !drawn?.length || drawn.includes(String(name).toLowerCase());
      return {
        value: name,
        label: compact ? String(index + 1) : tr("Лист {0}").replace("{0}", String(index + 1)),
        title: used
          ? tr("Лист {0}: {1}").replace("{0}", String(index + 1)).replace("{1}", name)
          : tr("Лист {0}: {1} — эффект его не рисует, лист показан его частицами").replace("{0}", String(index + 1)).replace("{1}", name),
      };
    }),
  ];
}

/**
 * Сцена семейства: выбранный лист крупно и ряд всех его листов.
 *
 * `loading` — база игры ещё читается. Тогда кадр пуст и говорит «читаем»,
 * а не показывает нарисованный образец: образец через секунду сменялся
 * листом игры, и человек видел кляксу, которая превращается в огонь
 * (владелец, 25.09.2026). Образец остаётся там, где листов игры не будет
 * вовсе, — в браузере и в игре без ядра эффектов.
 */
export function EnvironmentStage({
  sprites,
  environment,
  family,
  loading = false,
  /* Эффекты игры для объёмного кадра (`base.environmentScene`) и свет. */
  scene = null,
  light = null,
}) {
  useTr();
  const copy = useEffectsCopy();
  /* WebGL не завёлся — кадр возвращается к листу, без повторных попыток. */
  const [flameFailed, setFlameFailed] = useState(false);
  const [flame, setFlame] = useState({ effect: "", failures: [], scale: 1, textures: [] });
  /* Что в кадре: эффект в 3D или текстура семейства плоской картинкой. */
  const [view, setView] = useState("effect");
  const effect = scene?.picks?.[family] || "";
  const canPlay = Boolean(effect) && !flameFailed;
  const live = canPlay && view === "effect";
  /* Листы семейства играют вместе; выбор одного живёт, пока открыто это семейство. */
  const familyTextures = findEnvironmentFamily(family)?.textures || [];
  const [only, setOnly] = useState({ family, texture: "" });
  const onlySheet = only.family === family && familyTextures.includes(only.texture) ? only.texture : "";
  const sheetPicker =
    live && familyTextures.length > 1 ? (
      <SegmentedControl
        label={tr("Какой лист в кадре")}
        size="sm"
        options={sheetOptions(familyTextures, flame.textures)}
        value={onlySheet}
        onChange={(texture) => {
          setOnly({ family, texture });
          /* Плоская текстура покажет тот же лист: выбор общий. */
          if (texture) setPicked({ family, texture });
        }}
      />
    ) : null;
  const viewToggle = canPlay ? (
    <SegmentedControl
      label={tr("Что в кадре")}
      size="sm"
      options={[
        { value: "effect", label: tr("Эффект") },
        { value: "texture", label: tr("Текстура") },
      ]}
      value={view}
      onChange={setView}
    />
  ) : null;
  const sprite = sprites?.[family] || null;
  const sheets = useMemo(
    () => (sprite?.sheets?.length ? sprite.sheets : sprite ? [sprite] : []),
    [sprite],
  );
  const settings = environment?.[family];
  /* Ряд листов догоняет крупный кадр с низким приоритетом: пока тянут
     ползунок, перекрашивается тот лист, на который смотрят, а до девяти
     маленьких доходит очередь, когда рука остановилась. */
  const rowSettings = useDeferredValue(settings);
  const meta = findEnvironmentFamily(family);
  const metaLabel = meta ? tr(meta.label) : undefined;
  /* Лист выбирают внутри семейства; у нового семейства — его главный лист. */
  const [picked, setPicked] = useState({ family, texture: "" });
  const sheet =
    sheets.find(
      (item) => picked.family === family && item.texture === picked.texture,
    ) ||
    sheets.find((item) => item.texture === sprite?.texture) ||
    sheets[0] ||
    null;

  const waiting = loading && !sprite;

  /*
   * Строка состояния кадра — в панели, не на картинке: чей лист в кадре, размер, кадр листа и что в игре уже стоит правка.
   * Пока листы читаются, слово «читаем» стоит в самом кадре (`role="status"`), второй раз его не повторяем.
   */
  const details = waiting
    ? ""
    : `${
        sheet
          ? copy.sheetDetails({
              label: metaLabel,
              texture: sheet.texture,
              width: sheet.width,
              height: sheet.height,
              format: sheet.format,
              frame: (sheet.frame ?? 0) + 1,
              frames: frames(sheet),
              total: sheets.length,
            })
          : copy.sheetsDrawn(metaLabel)
      }${
        sheet?.tinted
          ? tr(" · в игре сейчас стоит твоя правка, здесь — штатный лист под новой")
          : ""
      }${settings && !settings.enabled ? tr(" · семейство выключено") : ""}`;

  if (live)
    return (
      <div className="fx-environment is-scene" data-testid="environment-stage">
        <div className="fx-environment-frame">
          <EnvironmentFlame
            scene={scene}
            light={light}
            environment={environment}
            family={family}
            sheet={onlySheet}
            onStatus={setFlame}
            onFailure={() => setFlameFailed(true)}
            barExtra={
              <>
                {sheetPicker}
                {viewToggle}
              </>
            }
          />
        </div>
        <StageNote>
          {`${copy.liveHead(metaLabel, effect)}${
            settings?.enabled && familyChanged(settings) ? tr(" под твоей правкой — так он и встанет в игру") : tr(" — как в игре")
          }${family === "muzzle" ? tr(" · очередью из ствола") : ""}${
            onlySheet ? tr(" · в кадре только лист {0}: {1}").replace("{0}", String(familyTextures.indexOf(onlySheet) + 1)).replace("{1}", onlySheet) : ""
          }${
            onlySheet && flame.textures?.length && !flame.textures.includes(onlySheet.toLowerCase()) ? tr("; сам эффект его не рисует — лист показан частицами эффекта") : ""
          }${
            flame.scale > 1 ? copy.shownLarger(Math.round(flame.scale)) : ""
          }${sheet?.tinted ? tr(" · в игре сейчас стоит твоя прежняя правка") : ""}`}
        </StageNote>
        {flame.failures?.length ? <StageNote tone="warning">{copy.notBuilt(flame.failures.join("; "))}</StageNote> : null}
      </div>
    );

  return (
    <div className="fx-environment" data-testid="environment-stage">
      {viewToggle && <StageBar>{viewToggle}</StageBar>}
      <div className="fx-environment-frame">
        {waiting ? (
          <>
            <Skeleton fill className="fx-environment-loading" />
            {/* Плита — для глаз, а читалке экрана говорим словами, что идёт чтение. */}
            <span className="fx-environment-status" role="status">
              {tr("Читаем листы ядра…")}
            </span>
          </>
        ) : (
          <SheetCanvas
            sheet={sheet}
            settings={settings}
            className="fx-environment-canvas"
          />
        )}
      </div>
      {sheets.length > 1 && (
        <div
          className="fx-environment-sheets"
          role="group"
          aria-label={copy.sheetsAria(metaLabel)}
        >
          {sheets.map((item) => (
            <button
              key={item.texture}
              type="button"
              className={`fx-environment-sheet${item === sheet ? " is-active" : ""}`}
              aria-pressed={item === sheet}
              title={`${item.texture} · ${item.width}×${item.height}`}
              onClick={() => setPicked({ family, texture: item.texture })}
            >
              <SheetCanvas
                sheet={item}
                settings={rowSettings}
              />
            </button>
          ))}
        </div>
      )}
      {/* Листы не прочитаны (браузер, игра без ядра эффектов) — предупреждение; прочитаны — справка о листе. */}
      <StageNote tone={sheet || waiting ? undefined : "warning"}>{details}</StageNote>
    </div>
  );
}

/* Выбор цвета общий (`ui/ColorField`) — с тем же быстрым рядом, что был
   здесь до него. */
function ColourRow({ value, onChange }) {
  useTr();
  return (
    <ColorField
      label={tr("Оттенок")}
      value={value}
      swatches={TINT_SWATCHES}
      onChange={onChange}
    />
  );
}

/*
 * «Убрать огонь совсем»: один выключатель на пять семейств огня. Листы
 * гасятся — чёрные и прозрачные; цвет и яркость семейств лежат нетронутыми и
 * вернутся. Подпись говорит, что остаётся и чего файл листов не умеет:
 * огонь продолжает жечь — убирается картинка, а не механика.
 */
function FireOffSection({ removed, onChange }) {
  useTr();
  return (
    <section className="ui-panel fx-section" aria-label={tr("Убрать огонь совсем")}>
      <div className="fx-switch-row">
        <Switch
          checked={removed}
          label={removed ? tr("Вернуть огонь") : tr("Убрать огонь совсем")}
          onChange={onChange}
        />
        <span>{tr("Убрать огонь совсем")}</span>
      </div>
      {/* Одна подсказка: в две строки, щелчок раскрывает целиком. */}
      <p className="fx-hint">
        {removed
          ? tr("Пламя пожаров и техники, огненные хвосты, свеча и сварка и огненные шары взрывов не рисуются: их листы чёрные и прозрачные. Цвет и яркость сохранены — вернутся вместе с огнём.")
          : tr("Погасит пламя пожаров и техники, огненные хвосты, свечу и сварку и огненные шары взрывов — во всех пяти семействах огня.")}{" "}
        {tr("Остаются: дым, угольки, искры, свечение, форсаж самолётов и подпалины на земле и стенах. Огонь по-прежнему жжёт и поджигает — убирается только картинка, а не механика.")}
      </p>
    </section>
  );
}

/*
 * «Отключить все эффекты» (ТЗ 23.10.2026, п. E): листы всех семейств гаснут разом — огонь, вспышки и свет, взрывы,
 * дым и пар. Цвет и яркость семейств лежат нетронутыми и вернутся. Любое семейство можно вернуть отдельно — в его
 * настройках; убирается картинка, а не механика (звук, урон, поджоги остаются).
 */
function AllOffSection({ off, onChange }) {
  useTr();
  return (
    <section className="ui-panel fx-section" aria-label={tr("Отключить все эффекты")}>
      <div className="fx-switch-row">
        <Switch checked={off} label={off ? tr("Включить все эффекты") : tr("Отключить все эффекты")} onChange={onChange} />
        <span>{tr("Отключить все эффекты")}</span>
      </div>
      <p className="fx-hint">
        {tr("Листы всех семейств гаснут: огонь, вспышки и свет, взрывы, дым и пар не рисуются. Цвет и яркость сохранены и вернутся вместе с эффектами. Убирается только картинка — звук, урон и поджоги остаются. Любое семейство можно вернуть отдельно, в его настройках ниже.")}
      </p>
    </section>
  );
}

/** «Убрать семейство» — выключатель у каждого семейства своё: листы только этого семейства гаснут в игре. */
function FamilyOffSection({ label, removed, onChange }) {
  useTr();
  const name = label || tr("Семейство");
  return (
    <section className="ui-panel fx-section" aria-label={tr("Убрать семейство")}>
      <div className="fx-switch-row">
        <Switch
          checked={removed}
          label={(removed ? tr("Вернуть «{0}»") : tr("Убрать «{0}»")).replace("{0}", name)}
          onChange={onChange}
        />
        <span>{tr("Убрать «{0}»").replace("{0}", name)}</span>
      </div>
      <p className="fx-hint">
        {removed
          ? tr("Листы этого семейства не рисуются: они чёрные и прозрачные. Цвет и яркость сохранены — вернутся вместе с ним.")
          : tr("Листы этого семейства погаснут — чёрные и прозрачные, спрайт не виден. Цвет и яркость сохранены и вернутся вместе с ним. Убирается только картинка: звук, урон и механика остаются.")}
      </p>
    </section>
  );
}

/** Семейство убрано (не огонь целиком): цвет и характер настраивать нечего, вернуть можно здесь же. */
function FamilyOffNote({ onRestore }) {
  useTr();
  return (
    <section className="ui-panel fx-section" aria-label={tr("Семейство убрано")}>
      <p className="fx-hint">
        {tr("Семейство убрано: его листы не рисуются. Верните его, чтобы настроить цвет и яркость.")}
      </p>
      <Button variant="secondary" size="sm" onClick={onRestore}>
        {tr("Вернуть семейство")}
      </Button>
    </section>
  );
}

/** Семейство огня погашено: цвет и характер настраивать нечего. */
function FireOffNote({ onRestore }) {
  useTr();
  return (
    <section className="ui-panel fx-section" aria-label={tr("Огонь убран")}>
      <p className="fx-hint">
        {tr("Огонь убран совсем: листы этого семейства не рисуются. Верните огонь, чтобы настроить цвет и яркость.")}
      </p>
      <Button variant="secondary" size="sm" onClick={onRestore}>
        {tr("Вернуть огонь")}
      </Button>
    </section>
  );
}

/**
 * Панель взятого инструмента окружения: «family» — семейство, его включение
 * и итог по набору; «colour» — оттенок; «character» — яркость и плотность.
 * Заголовок панели рисует каркас — своего у разделов нет.
 */
export function EnvironmentInspector({
  tool = "family",
  environment,
  family,
  onSelectFamily,
  onChange,
  /* «Убрать огонь совсем» — разом у пяти семейств огня. */
  onRemoveFire = null,
  /* «Убрать семейство» — у каждого своё; «Отключить все эффекты» — у всех сразу. */
  onRemoveFamily = null,
  onRemoveAll = null,
}) {
  useTr();
  const copy = useEffectsCopy();
  const settings = environment[family];
  const fireRemoved = fireIsRemoved(environment);
  const removedHere = familyIsRemoved(environment, family);
  const meta = findEnvironmentFamily(family);
  const metaLabel = meta ? tr(meta.label) : undefined;

  if ((tool === "colour" || tool === "character") && removedHere)
    return fireRemoved && FIRE_REMOVED_FAMILIES.includes(family) ? (
      <FireOffNote onRestore={() => onRemoveFire?.(false)} />
    ) : (
      <FamilyOffNote onRestore={() => (onRemoveFamily ? onRemoveFamily(family, false) : onRemoveFire?.(false))} />
    );

  if (tool === "colour")
    return (
      <section className="ui-panel fx-section" aria-label={tr("Цвет")}>
        <ColourRow
          value={settings.tint}
          onChange={(tint) =>
            /* Выбранный цвет обязан быть видно сразу: при нулевой силе
               оттенка выбор ничего не менял, и человек решал, что цвет
               сломан. Ноль остаётся достижимым ползунком. */
            onChange(family, {
              tint,
              enabled: true,
              ...(settings.tintStrength === 0 ? { tintStrength: 0.6 } : {}),
            })
          }
        />
        <Slider
          label={<span title={tr("Ноль — родной цвет игры, сто — целиком в выбранный")}>{tr("Сила оттенка")}</span>}
          ariaLabel={tr("Сила оттенка")}
          min={ENVIRONMENT_LIMITS.tintStrength.min}
          max={ENVIRONMENT_LIMITS.tintStrength.max}
          step={0.01}
          value={settings.tintStrength}
          format={percent}
          onChange={(tintStrength) =>
            onChange(family, { tintStrength, enabled: true })
          }
        />
      </section>
    );

  if (tool === "character")
    return (
      <section className="ui-panel fx-section" aria-label={tr("Характер")}>
        <Slider
          label={tr("Яркость")}
          min={ENVIRONMENT_LIMITS.brightness.min}
          max={ENVIRONMENT_LIMITS.brightness.max}
          step={0.01}
          value={settings.brightness}
          format={percent}
          onChange={(brightness) =>
            onChange(family, { brightness, enabled: true })
          }
        />
        <Slider
          label={<span title={tr("У листов без прозрачности — огня и RGB — плотность работает как яркость")}>{tr("Плотность")}</span>}
          ariaLabel={tr("Плотность")}
          min={ENVIRONMENT_LIMITS.opacity.min}
          max={ENVIRONMENT_LIMITS.opacity.max}
          step={0.01}
          value={settings.opacity}
          format={percent}
          onChange={(opacity) => onChange(family, { opacity, enabled: true })}
        />
      </section>
    );

  return (
    <>
      {onRemoveAll && <AllOffSection off={effectsAreOff(environment)} onChange={onRemoveAll} />}
      {onRemoveFire && <FireOffSection removed={fireRemoved} onChange={onRemoveFire} />}
      <section className="ui-panel fx-section" aria-label={tr("Что красим")}>
        {ENVIRONMENT_GROUPS.map((group) => (
          <div className="fx-family-group" key={group.id}>
            <h4>{tr(group.label)}</h4>
            <div
              className="fx-chips"
              role="tablist"
              aria-label={copy.familiesAria(copy.lower(tr(group.label)))}
            >
              {ENVIRONMENT_FAMILIES.filter(
                (item) => item.group === group.id,
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={item.id === family}
                  className={`fx-chip${item.id === family ? " is-active" : ""}${
                    familyChanged(environment[item.id]) ? " is-changed" : ""
                  }${familyIsRemoved(environment, item.id) ? " is-removed" : ""}`}
                  onClick={() => onSelectFamily(item.id)}
                >
                  {tr(item.label)}
                </button>
              ))}
            </div>
          </div>
        ))}
        <small className="fx-environment-note">
          {meta ? tr(meta.description) : undefined} · {copy.sheetsInCore(meta?.textures.length)}
        </small>
      </section>

      {/* Выключатель — у выбора семейства: «что красим» и «красим ли»
          решаются вместе, а цвет и характер ниже по инструментам включают
          семейство сами, тронутым ползунком. */}
      <section className="ui-panel fx-section">
        <label className="fx-switch">
          <input
            type="checkbox"
            className="ui-checkbox-input"
            checked={settings.enabled}
            aria-label={copy.editFamily(metaLabel ? copy.lower(metaLabel) : undefined)}
            onChange={(event) =>
              onChange(family, { enabled: event.target.checked })
            }
          />
          <span>
            <b>{copy.editFamily(metaLabel ? copy.lower(metaLabel) : undefined)}</b>
            <small>
              {/* Одной фразой: строка-выключатель режет пояснение в одну строку. */}
              {familyChanged(settings)
                ? tr("Поменяется в игре")
                : settings.enabled
                  ? tr("Пока как в игре: сдвинь ползунок")
                  : tr("Как в игре")}
            </small>
          </span>
          <SelectionMark on={settings.enabled} />
        </label>
      </section>
      {onRemoveFamily && <FamilyOffSection label={metaLabel} removed={removedHere} onChange={(on) => onRemoveFamily(family, on)} />}
    </>
  );
}
