// Основа, к которой возвращают архив в режиме «оригинал», и порядок в записи
// ресурса после возврата.

// Поля записи, которые в режиме «оригинал» снова указывают на копию «до Astral».
const REBASED_FIELDS = ["base", "compositionBase", "original"];

const hasStockCopy = (resource) => Boolean(resource?.pristine?.exists);

export function originalRestoreBaseline(resource) {
  return hasStockCopy(resource) ? resource.pristine : resource?.original;
}

export function settleResourceAfterRestore(resource, mode) {
  resource.layers = [];
  if (mode !== "original") return;

  const stock = resource.pristine;
  if (stock?.exists) {
    for (const field of REBASED_FIELDS) resource[field] = { ...stock };
    // Чистая база, не проверенная лаунчером, больше не соответствует архиву.
    if (resource.clean?.verified !== true) {
      resource.clean = { ...stock, verified: false };
    }
  }
  delete resource.pristine;
}
