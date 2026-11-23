import { desktopClothingShooter } from "./clothing-shooter.js";
import { desktopGunpackShooter } from "./gunpack-shooter.js";
import { desktopPartShooter } from "./part-shooter.js";

// Службы в порядке создания и закрытия.
const SERVICE_FACTORIES = [
  ["clothing", desktopClothingShooter],
  ["gunpack", desktopGunpackShooter],
  ["part", desktopPartShooter],
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
