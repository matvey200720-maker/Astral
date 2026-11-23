/*
 * Режимы выбора вещей арены (ТЗ владельца 21.10.2026: «этот / в комнате / во всей арене»):
 * `features/workshop/arena-editor/arena-items-section.jsx`. Русская строка → [uk, en, de, pl].
 */

export const zoneArenaScopes2110 = {
  "Этот": ["Цей", "This one", "Dieses", "Ten"],
  "В комнате": ["У кімнаті", "In this room", "Im Raum", "W pokoju"],
  "Во всей арене": ["По всій арені", "Whole arena", "Ganze Arena", "Cała arena"],
  "Щёлкните предмет в кадре. «В комнате» и «Во всей арене» берут все такие же.": [
    "Клацніть предмет у кадрі. «У кімнаті» і «По всій арені» беруть усі такі самі.",
    "Click an object in the frame. “In this room” and “Whole arena” take all the same.",
    "Klicken Sie ein Objekt an. „Im Raum“ und „Ganze Arena“ nehmen alle gleichen.",
    "Kliknij przedmiot w kadrze. „W pokoju” i „Cała arena” biorą wszystkie takie same.",
  ],
  "Все предметы этой модели в этой комнате: правка уходит на все сразу": [
    "Усі предмети цієї моделі в цій кімнаті: правка йде на всі одразу",
    "All objects of this model in this room: one edit goes to all of them",
    "Alle Objekte dieses Modells in diesem Raum: eine Änderung gilt für alle",
    "Wszystkie przedmioty tego modelu w tym pokoju: jedna zmiana dla wszystkich",
  ],
  "Все предметы этой модели во всей арене: правка уходит на все места сразу, обведены все": [
    "Усі предмети цієї моделі в усій арені: правка йде на всі місця одразу, обведені всі",
    "All objects of this model across the whole arena: an edit goes to every spot at once; all are outlined",
    "Alle Objekte dieses Modells in der ganzen Arena: Die Änderung gilt an allen Plätzen, alle sind umrandet",
    "Wszystkie przedmioty tego modelu w całej arenie: zmiana idzie na wszystkie miejsca; obrysowane są wszystkie",
  ],
  "Покраска стен": ["Фарбування стін", "Wall paint", "Wandfarbe", "Malowanie ścian"],
  /* «В комнате» — только у стен со своим листом в комнате (21.10.2026, `room-walls.js`). */
  "Эта стена красится только во всей арене: своего листа в этой комнате у неё нет": [
    "Ця стіна фарбується лише по всій арені: власного листа в цій кімнаті в неї немає",
    "This wall can only be painted across the whole arena: it has no texture of its own in this room",
    "Diese Wand lässt sich nur in der ganzen Arena streichen: In diesem Raum hat sie keine eigene Textur",
    "Tę ścianę można malować tylko w całej arenie: w tym pokoju nie ma własnej tekstury",
  ],
  "Стены этого материала в этой комнате": ["Стіни цього матеріалу в цій кімнаті", "Walls of this material in this room", "Wände dieses Materials in diesem Raum", "Ściany tego materiału w tym pokoju"],
  "Стены этого материала во всей арене": ["Стіни цього матеріалу в усій арені", "Walls of this material across the arena", "Wände dieses Materials in der ganzen Arena", "Ściany tego materiału w całej arenie"],
  "Цвет стен": ["Колір стін", "Wall colour", "Wandfarbe", "Kolor ścian"],
  "Задать цвет стен": ["Задати колір стін", "Set wall colour", "Wandfarbe festlegen", "Ustaw kolor ścian"],
  "Материал стен": ["Матеріал стін", "Wall material", "Wandmaterial", "Materiał ścian"],
  "Белый материал стен": ["Білий матеріал стін", "White wall material", "Weißes Wandmaterial", "Biały materiał ścian"],
  "Чёрный материал стен": ["Чорний матеріал стін", "Black wall material", "Schwarzes Wandmaterial", "Czarny materiał ścian"],
  "Серый материал стен": ["Сірий матеріал стін", "Grey wall material", "Graues Wandmaterial", "Szary materiał ścian"],
  "Как в игре": ["Як у грі", "As in the game", "Wie im Spiel", "Jak w grze"],
  "Вернуть как было": ["Повернути як було", "Restore as it was", "Wie zuvor wiederherstellen", "Przywróć jak było"],
  "Снимаю кадр…": ["Знімаю кадр…", "Taking the shot…", "Aufnahme läuft …", "Robię ujęcie…"],
  "Кадр не снялся": ["Кадр не вдалося зняти", "Couldn’t take the shot", "Aufnahme fehlgeschlagen", "Nie udało się zrobić ujęcia"],
  "Снимок предмета": ["Знімок предмета", "Item photo", "Foto des Objekts", "Zdjęcie przedmiotu"],
};
