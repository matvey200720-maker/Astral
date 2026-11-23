/*
 * «Окружение» студии звуков (10.11.2026): кнопка «выключить / включить» у каждого канала и у заголовка группы. Русская строка → [uk, en, de, pl]; французская — в
 * `fr/zone-h26-sound-mix.js`. Слова «Выкл.», «Выключить», «Выключить все», «Вернуть» уже есть в словаре.
 */

export const zoneH26SoundMix = {
  "Звук: {name}": ["Звук: {name}", "Sound: {name}", "Ton: {name}", "Dźwięk: {name}"],
  "Выключить: {name}": ["Вимкнути: {name}", "Turn off: {name}", "Ausschalten: {name}", "Wyłącz: {name}"],
  "Включить: {name}": ["Увімкнути: {name}", "Turn on: {name}", "Einschalten: {name}", "Włącz: {name}"],
  "Включить": ["Увімкнути", "Turn on", "Einschalten", "Włącz"],
  "Выключить все: {group}": ["Вимкнути всі: {group}", "Turn all off: {group}", "Alle ausschalten: {group}", "Wyłącz wszystkie: {group}"],
  "Вернуть: {group}": ["Повернути: {group}", "Restore: {group}", "Wiederherstellen: {group}", "Przywróć: {group}"],

  /* Группа «Столкновения» и новые каналы пульта (10.11.2026). */
  "Столкновения": ["Зіткнення", "Collisions", "Kollisionen", "Kolizje"],
  "Двери машин": ["Двері машин", "Car doors", "Autotüren", "Drzwi aut"],
  "Хлопки и стук дверей машин, когда садятся и выходят": [
    "Грюкіт і стукіт дверей машин, коли сідають і виходять",
    "Car doors slamming and knocking as people get in and out",
    "Zuschlagen und Klopfen von Autotüren beim Ein- und Aussteigen",
    "Trzaskanie i stuk drzwi aut przy wsiadaniu i wysiadaniu",
  ],
  "Удары и аварии": ["Удари й аварії", "Impacts and crashes", "Aufprälle und Unfälle", "Uderzenia i wypadki"],
  "Удары машин о машины, стены и предметы, падающие и сбитые вещи, бьющееся стекло, шорох ткани": [
    "Удари машин об машини, стіни й предмети, падаючі та збиті речі, скло, що б'ється, шелест тканини",
    "Cars hitting cars, walls and objects, falling and knocked-over things, breaking glass, rustling cloth",
    "Autos, die auf Autos, Wände und Gegenstände prallen, fallende und umgestoßene Dinge, zerbrechendes Glas, raschelnder Stoff",
    "Auta uderzające w auta, ściany i przedmioty, spadające i przewrócone rzeczy, tłukące się szkło, szelest materiału",
  ],
  "Машину о машину, о стену и о предмет игра здесь не разделяет: звук выбирает поверхность и сила удара, а не то, что ударилось": [
    "Машину об машину, об стіну й об предмет гра тут не розділяє: звук обирає поверхня й сила удару, а не те, що вдарилося",
    "The game does not tell a car hitting a car, a wall or an object apart here: the sound depends on the surface and the force of the hit, not on what hit",
    "Auto gegen Auto, Wand oder Gegenstand trennt das Spiel hier nicht: den Ton bestimmen Oberfläche und Wucht des Aufpralls, nicht das, was aufprallt",
    "Gra nie odróżnia tu auta uderzającego w auto, ścianę czy przedmiot: dźwięk zależy od powierzchni i siły uderzenia, a nie od tego, co uderzyło",
  ],
  "Удары тела": ["Удари тіла", "Body impacts", "Körperaufprälle", "Uderzenia ciała"],
  "Тело человека о землю, стены и предметы: падения и удары": [
    "Тіло людини об землю, стіни й предмети: падіння та удари",
    "A person's body against the ground, walls and objects: falls and hits",
    "Der Körper eines Menschen auf Boden, Wände und Gegenstände: Stürze und Aufprälle",
    "Ciało człowieka o ziemię, ściany i przedmioty: upadki i uderzenia",
  ],
  "Крики и стоны — в своём канале, а удары кулаками и пули — отдельные звуки оружия, их ползунок не трогает": [
    "Крики й стогін — у своєму каналі, а удари кулаками й кулі — окремі звуки зброї, їх повзунок не чіпає",
    "Screams and groans have their own channel; punches and bullets are separate weapon sounds that this slider does not touch",
    "Schreie und Stöhnen haben einen eigenen Kanal; Faustschläge und Kugeln sind eigene Waffengeräusche, die dieser Regler nicht berührt",
    "Krzyki i jęki mają własny kanał, a ciosy pięścią i kule to osobne dźwięki broni — ten suwak ich nie rusza",
  ],
};
