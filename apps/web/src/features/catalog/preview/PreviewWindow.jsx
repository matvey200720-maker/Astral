import "./catalog-preview.css";
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Skeleton from "../../../components/ui/Skeleton.jsx";
import DesktopOverlayPortal from "../../../components/desktop/overlays/DesktopOverlayPortal.jsx";
import { ImageSquare, X } from "../../../components/ui/icons.jsx";
import {
  LightFinder,
  LightSweep,
} from "../../../components/ui/light/LightContour.jsx";
import { tr, useTr } from "../../../locales/ui.js";
import { loadPartPreview } from "./preview-source.js";

/*
 * Полный предпросмотр на весь экран окна (Каталог 2.0, часть 2, доски `Preview-*`): заголовок — имя мода, справа органы вида и ✕. Виды — миникарта, таймцикл (небо),
 * прицел; арена добавляется отдельным видом. Сцены — готовые из мастерской (`MinimapPreview`, `SkyStage`, `ReticleStage`), только для просмотра: проекта части
 * в мастерской нет и в игру ничего не пишется. Каждый вид едет отдельным куском, когда его открыли. Органы вида ставятся в шапку окна через `slot`.
 *
 * Файлы части читаются по нажатию (грант на скачивание → файлы пакета, `preview-source.js`). Пока идёт чтение и собирается сцена, на месте стоит фото кадра (`poster`) и
 * по центру — загрузчик с подписью; когда сцена нарисовала первый кадр (`onReady` вида), она проявляется поверх фото, и оно уходит (владелец, 16.11.2026: «вместо фото —
 * живой предпросмотр, пока он не готов — фото и загрузчик по центру, потом плавная смена»). Нет фото — вместо него серая плита. Не вышло — слова и «Закрыть».
 */

/* Сцена, что не отозвалась за это время, всё равно проявляется: у неба свой отказ («WebGL не запустился»), его надо показать, а не держать фото вечно. */
const ARRIVE_LIMIT_MS = 6000;
/* Длительность проявления сцены (`.pv-live` в листе) и запас, после которого фото снимают из документа. */
const FADE_MS = 420;

const VIEWS = {
  minimap: lazy(() => import("./MinimapView.jsx")),
  timecycle: lazy(() => import("./SkyView.jsx")),
  crosshair: lazy(() => import("./ReticleView.jsx")),
};

// Часть читается один раз за показ: статус и данные.
function usePartData(part, kind) {
  const [state, setState] = useState({ status: "loading", data: null });
  useEffect(() => {
    let alive = true;
    setState({ status: "loading", data: null });
    loadPartPreview(part, kind).then(
      (data) => alive && setState({ status: "ready", data }),
      () => alive && setState({ status: "failed", data: null }),
    );
    return () => {
      alive = false;
    };
  }, [part, kind]);
  return state;
}

// Фото кадра (или серая плита) и загрузчик по центру: стоят, пока живая сцена не нарисовала первый кадр.
function Waiting({ poster, shown }) {
  return (
    <div className="pv-wait" aria-hidden={shown ? "true" : undefined}>
      {poster ? (
        <img
          className="pv-poster"
          src={poster}
          alt=""
          data-photo=""
          draggable="false"
        />
      ) : (
        <Skeleton className="pv-skeleton" />
      )}
      {/* Ожидание кадра — язык «контур и свет» (макеты r8/loaders): видоискатель, светлый проход по кадру, подпись-плашка с бегущей чертой. */}
      <LightFinder />
      <LightSweep period={2.6} />
      <div className="pv-loader" role="status">
        <span className="pv-loader-chip">
          <ImageSquare aria-hidden="true" />
          {tr("Загружаем живой предпросмотр")}
          <i className="pv-loader-bar" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}

function Body({ state, kind, language, slot, poster, shown, onShown }) {
  useTr();
  const [photoGone, setPhotoGone] = useState(false);
  const ready = state.status === "ready";

  // Сцена не отозвалась — проявляем её всё равно (отказ сцены виден на ней самой).
  useEffect(() => {
    if (!ready || shown) return undefined;
    const timer = window.setTimeout(onShown, ARRIVE_LIMIT_MS);
    return () => window.clearTimeout(timer);
  }, [ready, shown, onShown]);

  // Сцена проявилась — фото и загрузчик снимаются из документа после перехода.
  useEffect(() => {
    if (!shown) return undefined;
    const timer = window.setTimeout(() => setPhotoGone(true), FADE_MS + 80);
    return () => window.clearTimeout(timer);
  }, [shown]);

  if (state.status === "failed")
    return (
      <p className="pv-failure">
        {tr("Файлы части не удалось прочитать — предпросмотра нет")}
      </p>
    );
  const View = VIEWS[kind];
  return (
    <div className="pv-stage" data-shown={shown ? "" : undefined}>
      {!photoGone && <Waiting poster={poster} shown={shown} />}
      {ready && (
        <Suspense fallback={null}>
          <div className="pv-live">
            <View
              data={state.data}
              language={language}
              slot={slot}
              onReady={onShown}
            />
          </div>
        </Suspense>
      )}
    </div>
  );
}

export default function PreviewWindow({
  title,
  kind,
  part,
  language,
  poster = "",
  onClose,
}) {
  useTr();
  const state = usePartData(part, kind);
  const [slot, setSlot] = useState(null);
  // Живая сцена нарисовала первый кадр: органы вида в шапке встают, фото уходит.
  const [shown, setShown] = useState(false);
  const arrive = useCallback(() => setShown(true), []);
  const closeRef = useRef(null);
  const closing = useRef(onClose);
  closing.current = onClose;

  // Escape закрывает; фокус — на «Закрыть», при уходе возвращается туда, где был.
  useEffect(() => {
    const returnTo = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closing.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      returnTo?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <DesktopOverlayPortal>
      <div
        className="pv-window"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-kind={kind}
        data-shown={shown ? "" : undefined}
      >
        <header className="pv-head">
          <h2 className="pv-title" data-no-translate="">
            {title}
          </h2>
          <div className="pv-controls" ref={setSlot} />
          <button
            ref={closeRef}
            type="button"
            className="pv-close"
            aria-label={tr("Закрыть предпросмотр")}
            title={tr("Закрыть предпросмотр")}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="pv-body">
          <Body
            state={state}
            kind={kind}
            language={language}
            slot={slot}
            poster={poster}
            shown={shown}
            onShown={arrive}
          />
        </div>
      </div>
    </DesktopOverlayPortal>
  );
}
