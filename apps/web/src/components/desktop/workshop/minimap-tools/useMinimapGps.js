import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { findGpsRoute } from "@modovik/minimap-contract/paths";
import { detectInstallations, readGps, readGpsGraph, sanitizeDesktopErrorMessage } from "../../../../api.js";
import { loadMinimapField } from "../hud-preview/hud-map-field.js";
import { gpsIconPicture, loadStockIcon } from "../../../../features/workshop/gps-editor/gps-icons.js";
import {
  GPS_DEFAULT_DESTINATION,
  GPS_START,
  gpsDestination,
} from "../../../../features/workshop/gps-editor/gps-scene.js";

/* Куда ведёт маршрут в кадре: одно место, чтобы оба варианта были сравнимы. */
const DESTINATION = gpsDestination(GPS_DEFAULT_DESTINATION);
import { tr } from "../../../../locales/ui.js";

/*
 * Карта паузы для инструментов «Метка GPS» и «Маршрут» (задача 10 ТЗ
 * 10.10.2026, вечер): плитки большой карты из игры игрока, значок метки из
 * его листа значков и узлы дорог для линии маршрута — то же, что показывал
 * прежний редактор «Меток и GPS», теперь внутри мини-карты.
 *
 * Читается, только когда инструмент GPS впервые взят: плитки карты и десятки
 * тысяч узлов дорог незачем тянуть каждому, кто открыл мини-карту ради
 * полосы HP. Узлы живут в ссылке, а не в состоянии: React в разработке
 * расписывает пропсы, а их десятки тысяч (`react-dev-props-no-pixel-buffers`).
 *
 * С 22.10.2026 (ТЗ владельца: «готовые картинки, а не чтобы человек мог переставлять метку») метка стоит на одном
 * месте — у Форт-Занкудо, где улучшенный путь короче всего, — и кадр показывает два готовых варианта пути
 * (`route-model.js`). Выбора места и щелчка по карте больше нет; прежний выбор, оставшийся в памяти раздела, ничего
 * не решает.
 */

/* Подложка — плитки большой карты: тысячи точек на плитку хватает на путь от 1 до 10 км. */
const FIELD_TILE = 1024;

export default function useMinimapGps({ active, gps }) {
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (active) setStarted(true);
  }, [active]);

  const [gameRoot, setGameRoot] = useState("");
  const [base, setBase] = useState(null);
  const [baseFailure, setBaseFailure] = useState("");
  const [baseLoading, setBaseLoading] = useState(false);
  const [stockImage, setStockImage] = useState(null);
  const [field, setField] = useState(null);
  const graphRef = useRef(null);
  const [graphVersion, setGraphVersion] = useState(0);
  const [graphState, setGraphState] = useState("idle");
  const [picture, setPicture] = useState(null);

  useEffect(() => {
    if (!started) return undefined;
    let cancelled = false;
    detectInstallations()
      .then((games) => {
        if (cancelled) return;
        const legacy = (Array.isArray(games) ? games : []).find(
          (item) => item?.path && String(item.edition || "Legacy").toLowerCase() === "legacy",
        );
        if (legacy) setGameRoot(legacy.path);
        else setGraphState("missing");
      })
      .catch(() => {
        if (!cancelled) setGraphState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [started]);

  useEffect(() => {
    if (!started) return undefined;
    let cancelled = false;
    let loaded = null;
    loadMinimapField({ tile: FIELD_TILE })
      .then((result) => {
        if (cancelled) result?.revoke?.();
        else {
          loaded = result;
          setField(result);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      loaded?.revoke?.();
    };
  }, [started]);

  useEffect(() => {
    if (!gameRoot) return undefined;
    let cancelled = false;
    setBaseLoading(true);
    readGps({ gameRoot })
      .then((result) => {
        if (cancelled) return;
        setBase(result || null);
        setBaseFailure(result ? "" : tr("главный процесс ещё не знает этого раздела — перезапустите Astral"));
      })
      .catch((error) => {
        if (!cancelled) setBaseFailure(sanitizeDesktopErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setBaseLoading(false);
      });
    setGraphState("loading");
    readGpsGraph({ gameRoot })
      .then((graph) => {
        if (cancelled) return;
        graphRef.current = graph?.nodes?.length ? graph.nodes : null;
        setGraphState(graphRef.current ? "ready" : "missing");
        setGraphVersion((value) => value + 1);
      })
      .catch(() => {
        if (!cancelled) setGraphState("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [gameRoot]);

  useEffect(() => {
    let cancelled = false;
    loadStockIcon(base?.icon?.stockPng || null).then((image) => {
      if (!cancelled) setStockImage(image);
    });
    return () => {
      cancelled = true;
    };
  }, [base]);

  /* Своя картинка метки — по отпечатку из хранилища мастерской. */
  const pictureAsset = gps?.marker?.icon === "custom" ? gps.marker.assetId : "";
  useEffect(() => {
    let cancelled = false;
    if (!pictureAsset) {
      setPicture(null);
      return undefined;
    }
    gpsIconPicture(pictureAsset)
      .then((found) => {
        if (!cancelled) setPicture(found);
      })
      .catch(() => {
        if (!cancelled) setPicture(null);
      });
    return () => {
      cancelled = true;
    };
  }, [pictureAsset]);

  const destination = DESTINATION;
  const routes = useMemo(() => {
    const nodes = graphRef.current;
    if (!nodes) return null;
    return {
      stock: findGpsRoute(nodes, GPS_START, destination, "stock"),
      direct: findGpsRoute(nodes, GPS_START, destination, "direct"),
    };
    // Граф — в ссылке: пересчёт по его версии.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphVersion, destination]);
  const distances = routes ? { stock: routes.stock?.distance, direct: routes.direct?.distance } : null;

  /* Своя картинка, только что выбранная человеком: её силуэт уже готов. */
  const rememberPicture = useCallback((next) => setPicture(next), []);

  return {
    field,
    graphState,
    baseLoading,
    baseFailure,
    stockImage,
    picture,
    rememberPicture,
    destination,
    routes,
    distances,
  };
}
