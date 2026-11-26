import { desktopClothingShooter } from "./clothing-shooter.js";

// Служба «по первой заявке»: модуль хозяина (`load`) грузится и хозяин создаётся при первом `render`, а не на старте главного процесса —
// исходники съёмщика и всего, что он тянет, в потолок старта не входят (`tests/main-startup-imports.test.js`).
function shooterOnCall(load) {
  return (deps) => {
    let host = null;
    let loading = null; // одно обещание на всех: две первые заявки разом получают одного хозяина
    const open = () => (loading ??= load().then((create) => (host = create(deps))));
    return {
      render: async (request) => (host ?? (await open())).render(request),
      // Пока хозяина нет, закрывать и мерить нечего: ни окна, ни заявок.
      close: () => host?.close(),
      stats: async () => (host ? host.stats() : { open: false, pid: null, info: null }),
    };
  };
}

// Съёмщик частей редукса (`part-shooter.js` с белыми списками полей заявки) грузится по первой заявке печи, а не на старте.
const desktopPartShooterOnCall = shooterOnCall(() => import("./part-shooter.js").then((module) => module.desktopPartShooter));
// Съёмщик ганпаков (26.11.2026): `gunpack-shooter.js` тянет сборку модели ствола (`gunpack-glb.js`, `packages/gunpack/*`, ~150 КБ исходников) — тоже по первой заявке.
const desktopGunpackShooterOnCall = shooterOnCall(() => import("./gunpack-shooter.js").then((module) => module.desktopGunpackShooter));

// Службы в порядке создания и закрытия.
const SERVICE_FACTORIES = [
  ["clothing", desktopClothingShooter],
  ["gunpack", desktopGunpackShooterOnCall],
  ["part", desktopPartShooterOnCall],
];

// Вид запроса -> имя службы; любой другой вид (и запрос без вида) снимает служба одежды.
const SERVICE_BY_KIND = new Map([
  ["gunpack", "gunpack"],
  ["redux-part", "part"],
]);
const DEFAULT_SERVICE = "clothing";

export function desktopShooters(deps) {
  const services = new Map(SERVICE_FACTORIES.map(([name, create]) => [name, create(deps)]));

  return {
    ...Object.fromEntries(services),
    render: (request) => services.get(SERVICE_BY_KIND.get(request?.kind) ?? DEFAULT_SERVICE).render(request),
    stats: () => services.get(DEFAULT_SERVICE).stats(),
    close: () => {
      for (const service of services.values()) {
        service.close();
      }
    },
  };
}
