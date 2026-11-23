/*
 * Зона: volume2111. Словарь строк интерфейса: русская строка → [uk, en, de, pl]; французский — `fr/zone-volume2111.js`.
 *
 * «Большая карта»: строка «3D-здания» (21.11.2026, `world-map/MapVolume.jsx`) — настоящие здания в мини-карте, объёма на карте паузы
 * нет. Отдельный файл, чтобы не мешать словарю карты и чужим сессиям. Единица «м» уже есть в словаре.
 */

export const zoneVolume2111 = {
  "3D-здания": ["3D-будівлі", "3D buildings", "3D-Gebäude", "Budynki 3D"],
  "3D-здания включены": ["3D-будівлі увімкнено", "3D buildings on", "3D-Gebäude eingeschaltet", "Budynki 3D włączone"],
  "3D-здания выключены": ["3D-будівлі вимкнено", "3D buildings off", "3D-Gebäude ausgeschaltet", "Budynki 3D wyłączone"],
  "Здания рисуются у карты из игры и у векторных готовых карт. У снимка и карты-картинки кварталов нет.": [
    "Будівлі малюються в карти з гри та у векторних готових карт. У знімка та карти-картинки кварталів немає.",
    "Buildings are drawn for a map from the game and for vector ready-made maps. A photo or a picture map has no city blocks.",
    "Gebäude werden bei einer Karte aus dem Spiel und bei vektorbasierten fertigen Karten gezeichnet. Bei einem Foto oder einer Bildkarte gibt es keine Häuserblöcke.",
    "Budynki są rysowane na mapie z gry i na wektorowych gotowych mapach. Zdjęcie i mapa-obrazek nie mają kwartałów.",
  ],
  "Высота зданий": ["Висота будівель", "Building height", "Gebäudehöhe", "Wysokość budynków"],
  "В мини-карте здания настоящие (стенки, высоты по районам). На карте паузы объёма нет.": [
    "У мінікарті будівлі справжні (стінки, висоти за районами). На карті паузи об'єму немає.",
    "On the minimap the buildings are real (walls, heights by district). The pause map has no volume.",
    "In der Minikarte sind die Gebäude echt (Wände, Höhen je nach Bezirk). Auf der Pausenkarte gibt es kein Volumen.",
    "Na minimapie budynki są prawdziwe (ściany, wysokości według dzielnic). Na mapie pauzy nie ma objętości.",
  ],
};
