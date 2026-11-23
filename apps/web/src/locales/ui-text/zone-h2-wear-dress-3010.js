/*
 * Зона «Одеть персонажа» (ТЗ 30.10.2026): вход в мастерскую одежды — сразу персонаж, слот → список → «надето», «Редактировать» → витрина, «Применить» → «Установить комплект» со всем надетым.
 * Русская строка → [uk, en, de, pl]; французский — `fr/zone-h2-wear-dress-3010.js`.
 */
export const zoneH2WearDress3010 = {
  "Надето": ["Одягнено", "Worn", "Angezogen", "Założone"],
  "Без вещи": ["Без речі", "No item", "Kein Teil", "Bez rzeczy"],
  /* Значок-мусорка справа от названия надетой вещи: подсказка и имя для читалки экрана. */
  "Снять с персонажа": ["Зняти з персонажа", "Remove from the character", "Vom Charakter ausziehen", "Zdejmij z postaci"],
  "К персонажу": ["До персонажа", "To the character", "Zum Charakter", "Do postaci"],
  "Назад к персонажу: правки вещи остаются": [
    "Назад до персонажа: правки речі залишаються",
    "Back to the character: your edits stay",
    "Zurück zum Charakter: Ihre Änderungen bleiben erhalten",
    "Wróć do postaci: zmiany rzeczy zostają",
  ],
  "Вернуться к персонажу — вещь останется надетой": [
    "Повернутися до персонажа — річ залишиться вдягненою",
    "Back to the character — the item stays on",
    "Zurück zum Charakter — das Teil bleibt angezogen",
    "Wróć do postaci — rzecz zostanie założona",
  ],
  "«Применить» откроет «Установить комплект»: всё, что надето на персонаже": [
    "«Застосувати» відкриє «Встановити комплект»: усе, що вдягнено на персонажа",
    "“Apply” opens “Install the outfit”: everything the character is wearing",
    "„Anwenden“ öffnet „Outfit installieren“: alles, was der Charakter trägt",
    "„Zastosuj” otworzy „Zainstaluj zestaw”: wszystko, co ma na sobie postać",
  ],
  "Наденьте хотя бы одну вещь — ставить пока нечего": [
    "Одягніть хоча б одну річ — встановлювати поки нічого",
    "Put on at least one item — nothing to install yet",
    "Ziehen Sie mindestens ein Teil an — es gibt noch nichts zu installieren",
    "Załóż choć jedną rzecz — na razie nie ma czego instalować",
  ],
  "Женского персонажа в Astral нет — женская вещь правится отдельно, на витрине": [
    "Жіночого персонажа в Astral немає — жіноча річ редагується окремо, на вітрині",
    "Astral has no female character — a women’s item is edited on its own, in the showcase",
    "Astral hat keinen weiblichen Charakter — ein Damenteil wird einzeln im Schaufenster bearbeitet",
    "W Astral nie ma postaci żeńskiej — rzecz damska jest edytowana osobno, na witrynie",
  ],
  "Ставить «{name}»": ["Встановити «{name}»", "Install “{name}”", "„{name}“ installieren", "Zainstaluj „{name}”"],
};
