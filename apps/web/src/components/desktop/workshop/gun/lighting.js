// Общий свет студии оружия: пресеты света и отделки, отражения фотостудии,
// две правки шейдера стандартного материала three.js.
import * as THREE from "three";
import { reflectStrength, REFLECT_GAIN } from "@modovik/gunpack/shader-colour";

// Строки: имя, цвет и сила основного света, цвет и сила заполняющего,
// (у кадра мастерской ещё контровой), затем ambient, environment, exposure.
const STUDIO_ROWS = [
  ["studio", 0xffffff, 2.1, 0xbfd4ff, 0.85, 0.35, 1, 0.95],
  ["day", 0xfff1dc, 3.1, 0xbcd8ff, 1.2, 0.6, 1.15, 1.05],
  ["night", 0x8fa6ff, 0.45, 0x3a4a7a, 0.2, 0.08, 0.18, 0.9],
];

const STAGE_ROWS = [
  ["studio", 0xffffff, 2.4, 0xe4ebff, 0.6, 0xffffff, 1.6, 0.1, 1, 1.2],
  ["day", 0xfff1dc, 2.6, 0xbcd8ff, 0.8, 0xfff6ea, 1.4, 0.2, 1.15, 1.25],
  ["night", 0x8fa6ff, 0.45, 0x3a4a7a, 0.2, 0x8fa6ff, 0.5, 0.04, 0.18, 0.9],
];

// имя, roughness, metalness, envMapIntensity, iblDiffuse
const FINISH_ROWS = [["metal", 0.38, 0.05, 2.2, 0.25]];

const STUDIO_LIGHTING = sealTable(
  STUDIO_ROWS.map(([name, keyTint, keyPower, fillTint, fillPower, ambient, environment, exposure]) => [
    name,
    { key: [keyTint, keyPower], fill: [fillTint, fillPower], ambient, environment, exposure },
  ]),
);

const STAGE_LIGHTING = sealTable(
  STAGE_ROWS.map(([name, keyTint, keyPower, fillTint, fillPower, rimTint, rimPower, ambient, environment, exposure]) => [
    name,
    { key: [keyTint, keyPower], fill: [fillTint, fillPower], rim: [rimTint, rimPower], ambient, environment, exposure },
  ]),
);

const STUDIO_FINISHES = sealTable([
  ...FINISH_ROWS.map(([name, roughness, metalness, envMapIntensity, iblDiffuse]) => [
    name,
    { roughness, metalness, envMapIntensity, iblDiffuse },
  ]),
  ["cloth", null],
]);

// Правка шейдера - список «что найти -> чем заменить»; заменяется первое вхождение.
const finishShader = (iblDiffuse) => {
  const amount = fixed(iblDiffuse);
  const rules = [[GLSL.lightMaps, `${GLSL.lightMaps}\n        iblIrradiance *= ${amount};`]];
  return {
    key: ["astral-finish", amount].join("-"),
    patch: (shader) => {
      shader.fragmentShader = rewrite(shader.fragmentShader, rules);
    },
  };
};

const reflectLayerShader = (map, reflectivePower, finish = null) => {
  const strength = fixed(reflectStrength(reflectivePower));
  const rules = [[GLSL.emissive, `${GLSL.emissive}\n${reflectionBlock(strength)}`]];
  return {
    key: ["astral-reflect", strength, finish?.key ?? ""].join("-"),
    patch: (shader, renderer) => {
      if (![null, undefined].includes(finish)) finish.patch(shader, renderer);
      Object.assign(shader.uniforms, { astralReflectMap: { value: map } });
      shader.fragmentShader = `${GLSL.declaration}\n${rewrite(shader.fragmentShader, rules)}`;
    },
  };
};

const isNeutralMaterial = (base) => {
  const [metalness, roughness] = ["metalness", "roughness"].map((field) => Number(base?.[field]));
  return metalness === 0 && Math.abs(roughness - NEUTRAL_ROUGHNESS) < NEUTRAL_TOLERANCE;
};

const finishOf = (base, finish) => {
  const preset = STUDIO_FINISHES[finish];
  if (!preset || !isNeutralMaterial(base)) {
    return Object.fromEntries(OWN_FIELDS.map((field) => [field, base[field]]));
  }
  // числа отделки без iblDiffuse
  return Object.fromEntries(Object.entries(preset).filter(([field]) => field !== "iblDiffuse"));
};

const createStudioEnvironment = (renderer) => {
  const scene = new THREE.Scene();
  scene.add(...STUDIO_PIECES.map(assemble));
  return bakeReflections(renderer, scene);
};

export {
  REFLECT_GAIN,
  STAGE_LIGHTING,
  STUDIO_FINISHES,
  STUDIO_LIGHTING,
  createStudioEnvironment,
  finishOf,
  finishShader,
  isNeutralMaterial,
  reflectLayerShader,
};

// ---- сборка студии --------------------------------------------------------

// Один предмет студии по описанию: примитив, цвет, сторона, сила (HDR выше единицы),
// положение, масштаб, наклон по X и «смотреть на центр».
function assemble({ shape: [kind, ...dims], color, side, power, at, scale, tilt, aimed }) {
  const material = new THREE.MeshBasicMaterial(side === undefined ? { color } : { color, side: SIDES[side] });
  if (power !== undefined) material.color.multiplyScalar(power);
  const piece = new THREE.Mesh(GEOMETRIES[kind](...dims), material);
  piece.position.set(...at);
  if (scale) piece.scale.set(...scale);
  if (tilt !== undefined) piece.rotation.x = tilt;
  if (aimed) piece.lookAt(0, 0, 0);
  return piece;
}

function bakeReflections(renderer, scene) {
  let generator = null;
  try {
    generator = new THREE.PMREMGenerator(renderer);
    return generator.fromScene(scene, PMREM_SIGMA).texture;
  } finally {
    generator?.dispose();
    scene.traverse(releaseNode);
  }
}

function releaseNode(node) {
  ["geometry", "material"].forEach((slot) => node[slot]?.dispose?.());
}

// ---- тексты шейдера -------------------------------------------------------

function fixed(value) {
  return Number(value).toFixed(3);
}

function rewrite(source, rules) {
  return rules.reduce((text, [needle, replacement]) => text.replace(needle, () => replacement), source);
}

function reflectionBlock(strength) {
  return [
    "        {",
    "          vec3 astralRay = reflect(normalize(-vViewPosition), normal);",
    "          vec2 astralAt = astralRay.xy / max(2.0 * length(vec3(astralRay.xy, astralRay.z + 1.0)), 0.0001);",
    `          totalEmissiveRadiance += texture2D(astralReflectMap, vec2(0.5 + astralAt.x, 0.5 - astralAt.y)).rgb * ${strength};`,
    "        }",
  ].join("\n");
}

// Заморозка на двух уровнях: таблица и каждый пресет; пары [цвет, сила] остаются обычными.
function sealTable(entries) {
  return Object.freeze(Object.fromEntries(entries.map(([name, preset]) => [name, Object.freeze(preset)])));
}

// ---- данные студии --------------------------------------------------------

// Порядок важен: комната, верхний софтбокс, передний, левая полоса, контровая, пол.
const STUDIO_PIECES = [
  { shape: ["box", 1, 1, 1], color: 0x2a2b30, side: "back", at: [0, 3, 0], scale: [24, 14, 24] },
  { shape: ["plane", 14, 5], color: 0xffffff, power: 12, at: [1.5, 8, 3], aimed: true },
  { shape: ["plane", 12, 5], color: 0xffffff, power: 6, at: [0, 1.5, 11], aimed: true },
  { shape: ["plane", 1.2, 8], color: 0xe6eeff, power: 8, at: [-9, 2, 1.5], aimed: true },
  { shape: ["plane", 1.2, 8], color: 0xffffff, power: 9, at: [7, 2.5, -8], aimed: true },
  { shape: ["plane", 24, 24], color: 0x3a3b40, at: [0, -3.9, 0], tilt: -Math.PI / 2 },
];

const GEOMETRIES = {
  box: (width, height, depth) => new THREE.BoxGeometry(width, height, depth),
  plane: (width, height) => new THREE.PlaneGeometry(width, height),
};

const SIDES = { back: THREE.BackSide };

const OWN_FIELDS = ["roughness", "metalness", "envMapIntensity"];

const [PMREM_SIGMA, NEUTRAL_ROUGHNESS, NEUTRAL_TOLERANCE] = [0.035, 0.85, 0.001];

const GLSL = Object.freeze({
  lightMaps: "#include <lights_fragment_maps>",
  emissive: "#include <emissivemap_fragment>",
  declaration: "uniform sampler2D astralReflectMap;",
});
