/*
 * Материал ствола в окне «3D» карточки каталога (06.11.2026, «Боевой PDW · FrozenLove»): GLB, выложенные до правки сборки (`apps/desktop/src/gunpack-glb.js`), несут COLOR_0 у каждой вершины, а
 * three.js (`GLTFLoader`) включает по нему `vertexColors` и умножает картинку цвета. У оружия GTA цвета вершин — служебные маски шейдера, а не оттенок: у FrozenLove стоял (1; 0,976; 0),
 * розово-голубой ствол выходил зелёно-жёлтым. Окно показывает ствол по картинке цвета, как обложка; выложенные заново GLB без COLOR_0 от этого не меняются.
 */

/**
 * Материал ствола для просмотрщика: лицевые грани и цвет только от текстуры.
 * `own` — у отделки окна своя раскраска по вершинам (`prismatic-carbine`): её цвета оставляем.
 */
export function prepareWeaponMaterial(THREE, material, { own = false } = {}) {
  material.side = THREE.FrontSide;
  if (!own) material.vertexColors = false;
}
