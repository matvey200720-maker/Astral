/*
 * Имя мода — как его написал автор.
 *
 * После выгрузки Discord сотни имён набраны прописными («ХУДИ BALENCIAGA
 * OVERSIZE»), а менять регистр — значит переписывать чужое название (BMW,
 * GTA5RP). Как ник автора (`ModAuthor`), это объявленное
 * исключение правила «крик прописными»: иначе сверка экрана
 * (`__astralAudit`) не бывала бы пустой ни на одном экране каталога.
 */
import { dataLangOf } from "./data-lang.js";

export default function ModName({ name }) {
  return (
    <span data-audit-ignore="caps" lang={dataLangOf(name)}>
      {name}
    </span>
  );
}

