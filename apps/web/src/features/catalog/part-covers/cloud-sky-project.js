// Чистые помощники кадра неба с облаками (без WebGL и окна — тесты читают их напрямую): проект неба из файлов таймцикла соседней части и доля облачных точек кадра.
import { importCloudsFromMod, importSkyFromMod } from "@modovik/timecycle";

/** Облако — светлое и почти бесцветное (насыщенность ниже границы), небо — синее. */
export const CLOUD_SATURATION = 0.2;
export const CLOUD_LIGHT = 0.45;

const textOf = (bytes) => new TextDecoder().decode(bytes);

/** Файлы таймцикла соседней части: `w_*.xml` — небо, `clouds.xml` и `cloudkeyframes.xml` — какие облака разрешены. */
export function skyProjectOf(files, name = "") {
  const named = (pattern) =>
    files
      .filter((file) => pattern.test(file.name))
      .map((file) => ({ name: file.name, text: textOf(file.bytes) }));
  const sky = importSkyFromMod(named(/^w_[a-z0-9_]+\.xml$/i), { name });
  const clouds = importCloudsFromMod(named(/^(clouds|cloudkeyframes)\.xml$/i), {
    name,
  });
  const project = sky?.project || clouds?.project || null;
  if (project && sky?.project && clouds?.project)
    project.look = {
      ...(project.look || {}),
      clouds: clouds.project.look.clouds,
    };
  return {
    project,
    sky: Boolean(sky?.project),
    clouds: Boolean(clouds?.project),
  };
}

/** Доля «облачных» точек RGBA-кадра (светлые и почти бесцветные). */
export function cloudShare(rgba) {
  let hit = 0;
  const count = rgba.length / 4;
  for (let at = 0; at < rgba.length; at += 4) {
    const max = Math.max(rgba[at], rgba[at + 1], rgba[at + 2]) / 255;
    const min = Math.min(rgba[at], rgba[at + 1], rgba[at + 2]) / 255;
    if (max >= CLOUD_LIGHT && (max - min) / max <= CLOUD_SATURATION) hit += 1;
  }
  return count ? hit / count : 0;
}
