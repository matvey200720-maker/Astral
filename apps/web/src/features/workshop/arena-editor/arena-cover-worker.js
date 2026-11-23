import { arenaCoverPicture } from "@modovik/climb-contract/recolor/arenas";
import { panelJobBuffers, panelJobPixels } from "./arena-panel-pixels.js";

function coverSheet(job) {
  return arenaCoverPicture(job.look, job.picture, job.decal);
}

// Плашки места: по листу на задачу и по одному буферу на каждый лист.
function solveCovers(jobs) {
  const out = jobs.map(coverSheet);
  return { out, transfer: Array.from(out, ({ rgba }) => rgba.buffer) };
}

// Полотна: картинки, общие для нескольких граней, переносятся один раз,
// в порядке первого появления.
function solvePanels(jobs) {
  const out = jobs.map((job) => panelJobPixels(job));
  const seen = new Set();
  for (const result of out) {
    for (const buffer of panelJobBuffers(result)) seen.add(buffer);
  }
  return { out, transfer: Array.from(seen) };
}

const scope = self;

function reply(id, solve) {
  try {
    const { out, transfer } = solve();
    scope.postMessage({ id, out }, transfer);
  } catch (thrown) {
    scope.postMessage({ id, error: String(thrown?.message || thrown) });
  }
}

scope.onmessage = (event) => {
  const data = event.data ?? {};
  const solver = data.kind === "panel" ? solvePanels : solveCovers;
  reply(data.id, () => solver(data.jobs));
};
