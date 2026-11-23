/* `import.meta.env?.` — модуль читают и под обычным Node (рабочие модули сборки в тестах движка, `tests/bundles-node-safe.test.js`), где `import.meta.env` нет. */
const fallbackProbe = (region) => `/api/health?region=${region}`;

export const downloadRegions = [
  {
    id: "eu",
    code: "EU",
    name: { ru: "Европа", uk: "Європа", en: "Europe", de: "Europa", pl: "Europa", fr: "Europe" },
    audience: {
      ru: "Украина, Казахстан, Узбекистан и остальные страны", uk: "Україна, Казахстан, Узбекистан та інші країни",
      en: "Europe, Ukraine, Central Asia and the rest of the world",
      de: "Europa, Ukraine, Zentralasien und der Rest der Welt",
      pl: "Europa, Ukraina, Azja Centralna i pozostałe kraje",
      fr: "Europe, Ukraine, Asie centrale et le reste du monde",
    },
    probeUrl: import.meta.env?.VITE_MODOVIK_EU_PROBE || fallbackProbe("eu"),
  },
  {
    id: "ru",
    code: "RU",
    name: { ru: "Россия", uk: "Росія", en: "Russia", de: "Russland", pl: "Rosja", fr: "Russie" },
    audience: {
      ru: "Российская Федерация", uk: "Російська Федерація",
      en: "Russian Federation",
      de: "Russische Föderation",
      pl: "Federacja Rosyjska",
      fr: "Fédération de Russie",
    },
    probeUrl: import.meta.env?.VITE_MODOVIK_RU_PROBE || fallbackProbe("ru"),
  },
];

async function timedProbe(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  const started = performance.now();
  try {
    const target = new URL(url, window.location.origin);
    target.searchParams.set("probe", `${Date.now()}-${Math.random()}`);
    const response = await fetch(target, {
      cache: "no-store",
      credentials:
        target.origin === window.location.origin ? "include" : "omit",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return Math.max(1, Math.round(performance.now() - started));
  } finally {
    clearTimeout(timeout);
  }
}

export async function measureDownloadRegions() {
  const reports = await Promise.all(
    downloadRegions.map(async (region) => {
      const attempts = [];
      for (let index = 0; index < 3; index += 1) {
        try {
          attempts.push(await timedProbe(region.probeUrl));
        } catch {}
      }
      attempts.sort((a, b) => a - b);
      return {
        id: region.id,
        latency: attempts.length
          ? attempts[Math.floor(attempts.length / 2)]
          : null,
        available: attempts.length > 0,
      };
    }),
  );
  return Object.fromEntries(reports.map((report) => [report.id, report]));
}

export function recommendedRegion(metrics, fallback = "eu") {
  const available = Object.values(metrics || {}).filter(
    (item) => item.available && Number.isFinite(item.latency),
  );
  if (!available.length) return fallback;
  return available.sort((a, b) => a.latency - b.latency)[0].id;
}

export function packageUrlForRegion(mod, region) {
  return (
    mod?.mirrors?.[region] ||
    mod?.delivery?.mirrors?.[region] ||
    mod?.packageBaseUrl ||
    ""
  );
}
