import { createClothingShooter } from "./clothing-shot.js";

const explain = (failure) => String(failure?.message || failure);

// Просьбы выстраиваются в одну цепочку: следующая начинается после ответа на прежнюю.
function singleLane() {
  let tail = Promise.resolve();
  return (job) => {
    tail = tail.then(job);
  };
}

class ShotDesk {
  #bridge;
  #shooter = null;
  #contexts = 0;
  #shots = 0;

  constructor(bridge) {
    this.#bridge = bridge;
  }

  counters() {
    return { contexts: this.#contexts, shots: this.#shots, ...this.#shooter?.info() };
  }

  #shooterOnDemand() {
    if (this.#shooter === null) {
      const fresh = createClothingShooter();
      this.#contexts += 1;
      this.#shooter = fresh;
    }
    return this.#shooter;
  }

  async handle(id, request) {
    try {
      const { bytes, cover, detail } = await this.#shooterOnDemand().shoot(request);
      this.#shots += 1;
      this.#bridge.reply(id, { bytes, cover, detail });
    } catch (failure) {
      this.#bridge.reply(id, { error: explain(failure) });
    }
  }
}

export function serveClothingShots(bridge) {
  const desk = new ShotDesk(bridge);
  const enqueue = singleLane();
  globalThis.__astralShooterInfo = () => desk.counters();
  bridge.onShoot((id, request) => {
    enqueue(() => desk.handle(id, request));
  });
  bridge.ready();
}
