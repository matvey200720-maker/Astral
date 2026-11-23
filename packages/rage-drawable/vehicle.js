import { openResourceWith, pointerAt } from "@modovik/ypt/resource-core";
import { FRAGMENT_VERSION_LEGACY, readDrawableAt } from "./drawable.js";

// Отказы: вид → [код, текст по подробности].
const REFUSALS = {
  version: ["RAGE_VERSION", (version) => `Это не машина GTA V Legacy (версия ресурса ${version}).`],
  body: ["RAGE_BROKEN", () => "У машины нет модели кузова."],
};

function refuse(kind, detail) {
  const [code, describe] = REFUSALS[kind];
  const error = new Error(describe(detail));
  error.code = code;
  return error;
}

// Пути по цепочкам указателей: смещения звеньев от корня фрагмента.
const BODY_ROUTE = [0x30];
const CHILDREN_ROUTE = [0xf0, 0x10, 0xd0];
const CHILD_COUNT_AT = 0x11d;
const CHILD_TAG_AT = 0x12;
const CHILD_DRAWABLE_AT = 0xa0;

export const VEHICLE_WHEELS = Object.freeze("lf rf lr rr".split(" "));

// Идёт по цепочке указателей и возвращает все остановки; недействительное звено обрывает путь на -1.
const follow = (resource, start, route) =>
  route.reduce(
    (stops, offset) => {
      const here = stops[stops.length - 1];
      return [...stops, here >= 0 ? pointerAt(resource, here + offset) : -1];
    },
    [start],
  );

// Уже открытый ресурс берётся как есть; версия обязана быть версией фрагмента машины.
function openFragment(input, inflateRaw) {
  const resource = input?.view && input?.at ? input : openResourceWith(input, inflateRaw);
  if (resource.version !== FRAGMENT_VERSION_LEGACY) throw refuse("version", resource.version);
  return resource;
}

function findBody(resource) {
  const root = resource.at(resource.root);
  const [, bodyAt] = follow(resource, root, BODY_ROUTE);
  if (bodyAt < 0) throw refuse("body");
  return { root, bodyAt };
}

// Дети физической части: звенья «физика → часть → массив», потом тег и drawable каждого ребёнка.
function physicsChildren(resource, root) {
  const [, , part, array] = follow(resource, root, CHILDREN_ROUTE);
  const count = part >= 0 ? resource.view.getUint8(part + CHILD_COUNT_AT) : 0;
  return Array.from({ length: array >= 0 ? count : 0 }, (_, slot) => pointerAt(resource, array + slot * 8))
    .filter((child) => child >= 0)
    .map((child) => ({
      tag: resource.view.getUint16(child + CHILD_TAG_AT, true),
      drawable: pointerAt(resource, child + CHILD_DRAWABLE_AT),
    }));
}

// Положение кости — трансляция её абсолютной матрицы; у кости без матрицы положения нет.
const placement = (bone) => (bone?.matrix?.length ? [12, 13, 14].map((cell) => bone.matrix[cell]) : null);

// Кости по имени без учёта регистра; при повторе имени остаётся первая.
const bonesByName = (bones) =>
  bones.reduce((table, bone) => {
    const key = (bone.name ?? "").toLowerCase();
    return table.has(key) ? table : table.set(key, bone);
  }, new Map());

// Колёса кузова в порядке VEHICLE_WHEELS как пары [id, кость]; без положения колеса нет.
function* placedWheels(named) {
  for (const id of VEHICLE_WHEELS) {
    const bone = named.get(`wheel_${id}`);
    if (placement(bone)) yield [id, bone];
  }
}

const replaced = (object, key, value) => Object.assign({}, object, { [key]: value });

// Колёса-дети по очереди: первое с сетками отдаётся, остальные не читаются.
function* wheelModels({ resource, children, idOfTag, body, lod }) {
  for (const { tag, drawable } of children) {
    const id = idOfTag(tag);
    if (drawable < 0 || id === undefined) continue;
    const { meshes } = readDrawableAt(resource, drawable, { lod });
    if (meshes.length === 0) continue;
    yield {
      bone: id,
      meshes: meshes.map((mesh) => replaced(mesh, "material", mesh.material ?? body.materials?.[mesh.shaderIndex] ?? null)),
    };
  }
}

// Остальные части результата парами «ключ → значение», в порядке выдачи.
function assemble({ resource, root, body, lod }) {
  const bones = body.bones ?? [];
  const named = bonesByName(bones);
  const placed = [...placedWheels(named)];
  // При одинаковых тегах у двух колёс побеждает последнее.
  const idOfTag = (tag) => placed.findLast(([, bone]) => bone.tag === tag)?.[0];
  const children = physicsChildren(resource, root);
  const [wheel = null] = wheelModels({ resource, children, idOfTag, body, lod });

  return [
    ["wheel", wheel],
    ["wheels", placed.map(([id, bone]) => ({ id, position: placement(bone) }))],
    ["exhaust", placement(named.get("exhaust"))],
  ];
}

export function readVehicle(input, { inflateRaw, lod = "high" } = {}) {
  const resource = openFragment(input, inflateRaw);
  const { root, bodyAt } = findBody(resource);
  const body = readDrawableAt(resource, bodyAt, { lod });
  return Object.fromEntries([["body", body], ...assemble({ resource, root, body, lod })]);
}
