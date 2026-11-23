import { tr } from "../../../../locales/ui.js";
import { counted } from "../../../../plural.js";
import { mapText } from "./map-copy.js";
import { createPackOcr } from "./pack-ocr.js";
import { useMapMemory } from "../world-map-memory.js";
import { useEffect, useState } from "react";

// Поле счётчиков и три русских формы слова при нём (переводятся при вызове).
const SUMMARY_PARTS = [
  ["labels", ["подпись", "подписи", "подписей"]],
  ["points", ["точка", "точки", "точек"]],
  ["zones", ["зона и линия", "зоны и линии", "зон и линий"]],
  ["icons", ["значок", "значка", "значков"]],
];

export function packLayersSummary(counts) {
  const pieces = [];
  for (const [field, forms] of SUMMARY_PARTS) {
    pieces.push(counted(Number(counts[field]) || 0, forms.map((form) => tr(form))));
  }
  return pieces.join(", ");
}

function readyText({ counts, noText }) {
  const summary = packLayersSummary(counts);
  if (!noText) {
    return mapText("Карта мода разрезана на слои: {summary} — всё правится", { summary });
  }
  return mapText(
    "Карта мода разрезана на слои: {summary} — всё правится. Подписи не прочлись и стоят значками",
    { summary },
  );
}

// Первое подошедшее правило даёт строку статуса.
const STATUS_RULES = [
  {
    when: (state) => state.failed,
    text: (state) => mapText("Карта мода не разрезалась на слои: {reason}", { reason: state.failed }),
  },
  { when: (state) => state.counts, text: readyText },
  {
    when: (state) => state.stage === "text" && Number.isFinite(state.share),
    text: (state) => {
      const share = Math.min(99, Math.floor(state.share * 100));
      return mapText("Режем карту мода на слои: читаем подписи — {share} %", { share });
    },
  },
];

export function packLayersStatus(state) {
  if (!state) return "";
  const rule = STATUS_RULES.find((entry) => entry.when(state));
  return rule ? rule.text(state) : tr("Режем карту мода на слои…");
}

const restoreFlag = (stored, fallback) => (typeof stored === "boolean" ? stored : fallback);

// OCR, который после первой ошибки молчит до конца нарезки и помнит, что отключился.
class QuietOcr {
  off = false;

  constructor(ocr) {
    this.ocr = ocr;
  }

  recognize = async (jobs, options) => {
    if (!this.off) {
      try {
        return await this.ocr.recognize(jobs, options);
      } catch {
        this.off = true;
      }
    }
    return new Map();
  };
}

// Ход нарезки: не чаще раза в 120 мс, конечный ход проходит всегда, доля не убывает.
class ProgressGate {
  lastAt = 0;
  share = 0;

  constructor(signal, publish) {
    this.signal = signal;
    this.publish = publish;
  }

  push = ({ stage, done, total }) => {
    if (this.signal.aborted) return;
    const now = Date.now();
    if (done < total && now - this.lastAt < 120) return;
    this.lastAt = now;
    this.share = Math.max(this.share, total ? done / total : 0);
    this.publish({ stage, share: this.share });
  };
}

// Одна на хук: помнит свежие config, apply и deps и ведёт нарезку.
class Splitter {
  latest = { config: null, apply: null, deps: {} };
  setFlag = null;

  constructor(setState) {
    this.setState = setState;
  }

  feed(config, apply, deps, setFlag) {
    this.latest = { config, apply, deps };
    this.setFlag = setFlag;
  }

  begin(geometry) {
    const abort = new AbortController();
    this.carve(geometry, abort.signal);
    return () => abort.abort();
  }

  async carve(geometry, signal) {
    const { createOcr, vectorMap } = this.latest.deps;
    const ocr = (createOcr || createPackOcr)();
    this.setState({ stage: "parts" });
    const quiet = new QuietOcr(ocr);
    const library = vectorMap
      ? Promise.resolve(vectorMap)
      : import("@modovik/vector-map/pack-layers");

    return library
      .then((lib) =>
        lib
          .splitPackLayers(geometry, {
            recognize: quiet.recognize,
            onProgress: new ProgressGate(signal, this.setState).push,
          })
          .then((layers) => (signal.aborted ? undefined : this.finish(lib, layers, quiet))),
      )
      .catch((error) => {
        if (!signal.aborted) this.setState({ failed: String(error?.message || error) });
      })
      .finally(() => ocr.terminate());
  }

  finish(lib, layers, quiet) {
    const { config, apply } = this.latest;
    const { config: next, counts } = lib.applyPackLayers(config, layers);
    apply(next, tr("Карта мода — на слои: подписи, точки, значки, зоны"));
    this.setFlag(true);
    this.setState({ counts, noText: quiet.off });
  }

  resplit = () => {
    this.setFlag(false);
    const { config, apply } = this.latest;
    if (config.base.packLayers === "pending") return;
    const queued = { ...config, base: { ...config.base, packLayers: "pending" } };
    apply(queued, tr("Карта мода — на слои"));
  };
}

const usePackLayers = ({ config, geometry, apply, memoryId = "", deps = {} }) => {
  const [state, setState] = useState(null);
  const memory = useMapMemory(memoryId, "packSplitOnce", false, restoreFlag);
  const [splitter] = useState(() => new Splitter(setState));
  const [splitOnce, setFlag] = memory;
  splitter.feed(config, apply, deps, setFlag);

  const pending = config?.base?.packLayers === "pending";
  useEffect(
    () => (!pending || !geometry || splitOnce ? undefined : splitter.begin(geometry)),
    [pending, geometry, splitOnce, splitter],
  );

  const canSplit =
    Boolean(config?.base?.packOrigin) && config?.base?.packLayers !== "split" && !state?.stage;
  return { state, resplit: splitter.resplit, canSplit };
};

export default usePackLayers;
