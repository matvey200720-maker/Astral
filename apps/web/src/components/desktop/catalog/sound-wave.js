const LIMIT = 64;
const SAMPLE_RATE = 22050;

// Кэш обещаний по адресу (вытесняется по порядку добавления) и общая очередь разбора.
const state = { cache: new Map(), tail: Promise.resolve() };

const enqueue = (work) => {
  state.tail = state.tail.then(work);
  return state.tail;
};

// Самая старая запись уходит, когда их стало больше предела.
function trimCache() {
  if (state.cache.size <= LIMIT) return;
  const [oldest] = state.cache.keys();
  state.cache.delete(oldest);
}

const toHundredths = (share) => Math.round(share * 100) / 100;

export const wavePeaks = (buffer, bars = BARS) => {
  const channels = Array.from({ length: buffer.numberOfChannels }).map((_, index) => buffer.getChannelData(index));
  const length = channels[0]?.length || 0;
  const peaks = Array(bars).fill(0);
  if (!length) return peaks;

  // Граница столбика в значениях канала; каждый столбик берёт хотя бы одно значение.
  const edge = (bar) => Math.floor((bar / bars) * length);
  const loudestIn = (from, to) => {
    let loudest = 0;
    for (const channel of channels) {
      for (let at = from; at < to; at += 1) {
        const value = channel[at];
        if (typeof value === "number" && !Number.isNaN(value) && Math.abs(value) > loudest) loudest = Math.abs(value);
      }
    }
    return loudest;
  };

  let bar = 0;
  while (bar < bars) {
    const start = edge(bar);
    peaks[bar] = loudestIn(start, Math.max(start + 1, edge(bar + 1)));
    bar += 1;
  }

  const top = peaks.reduce((best, peak) => Math.max(best, peak), 0);
  return top > 0 ? peaks.map((peak) => toHundredths(peak / top)) : peaks;
};

// Байты ответа → буфер веб-аудио (контекст без вывода) → пики и длительность.
async function foldResponse(Context, response) {
  const bytes = await response.arrayBuffer();
  const offline = new Context(1, 1, SAMPLE_RATE);
  const decoded = await offline.decodeAudioData(bytes);
  const peaks = wavePeaks(decoded, BARS);
  return { peaks, duration: decoded.duration };
}

// Любой сбой, как и отсутствие веб-аудио или fetch, даёт null.
async function loadWave(url) {
  const Context = ["OfflineAudioContext", "webkitOfflineAudioContext"].map((name) => globalThis[name]).find(Boolean);
  const ready = Context && typeof fetch === "function";
  if (!ready) return null;
  try {
    const response = await fetch(url);
    return response.ok ? await foldResponse(Context, response) : null;
  } catch {
    return null;
  }
}

export function soundWave(url) {
  if (state.cache.has(url)) return state.cache.get(url);
  const pending = enqueue(() => loadWave(url));
  state.cache.set(url, pending);
  trimCache();
  return pending;
}

export const BARS = 64;
