/*
 * @modovik/clothing — одежда GTA V в Astral: что это за вещь, на что она
 * ставится, не повтор ли, живая ли.
 *
 * Чистый JS: работает в окне, в Worker, в Desktop и в работнике конвейера
 * публикации. Чтение моделей и текстур — @modovik/rage-drawable.
 */

export {
  CATEGORIES,
  COMPONENTS,
  COMPONENT_NAMES,
  GENDER_LABELS,
  PEDS,
  SERVERS,
  categoryById,
  categoryOfChannel,
  categoryOfComponent,
  categoryOfHashtag,
  serverById,
  serverOfText,
} from "./taxonomy.js";
export {
  isClothingPath,
  modelFileName,
  parseClothingPath,
  pedFolderName,
  textureFileName,
} from "./names.js";
export {
  groupClothingItems,
  modItems,
  retextureItems,
  setRootOf,
} from "./items.js";
export {
  createStockModels,
  gameAddress,
  stockModelIndex,
} from "./stock-model.js";
export { flatModelReason, modelShape } from "./flat-model.js";
export {
  STOCK_BODY_PARTS,
  STOCK_BODY_PARTS_FEMALE,
  bodyShowcase,
  readStockBody,
  skinsOf,
  underlayerShowcase,
} from "./stock-body.js";
export {
  authorFrom,
  clothingFromPost,
  isBodyZone,
  parseReplaceLine,
  parseReplaces,
  storyHeroesOf,
} from "./post.js";
export {
  FINGERPRINT_ALGO,
  clothingFingerprint,
  compareFingerprints,
  geometryHash,
  hammingHex,
  imageHash,
} from "./fingerprint.js";
export {
  dominantColour,
  looksLikeChecker,
  shrink,
  swatchColour,
} from "./pictures.js";
export {
  BODY_COMPONENTS,
  PROP_ANCHORS,
  TargetError,
  crossFit,
  incompatibility,
  retargetPlan,
  targetFromItem,
  targetKey,
} from "./targets.js";
export { ClothingCardError, normalizeClothingCard } from "./card.js";
export {
  archiveTitle,
  claimClothing,
  clothingHideDraft,
  createClothingWorker,
  foreignModelLink,
  gloveSets,
  inspectClothingItem,
  lookOf,
  mergePostCopies,
  nameApartInPost,
  newPlaces,
  pickCoverSide,
  sameGeometry,
  sameLook,
  blankOverlay,
  tattooPackDraft,
  targetNameOfFile,
} from "./worker.js";
export { shotRequestOf } from "./shot-request.js";
export { overlayGender, overlayOfPath, overlayOnSkin } from "./overlays.js";
export {
  clothingDrawable,
  clothingModelGlb,
  colourPicture,
  combinedDrawable,
  glovesShowcase,
  isHeadProp,
  isStubPicture,
  onBone,
  pairShowcase,
  showcaseDrawable,
  TATTOO_SKIN,
  tattooShowcase,
  UNDERLAY_MATERIAL,
} from "./model.js";
export {
  ASSORTMENT_SOURCES,
  assortmentFor,
  assortmentInstallTarget,
  assortmentItem,
  assortmentKey,
  assortmentPlace,
  catalogAssortment,
  customAssortmentItem,
  itemName,
  mergeAssortment,
  recommendedOf,
  searchAssortment,
  shopGroups,
} from "./assortment.js";
