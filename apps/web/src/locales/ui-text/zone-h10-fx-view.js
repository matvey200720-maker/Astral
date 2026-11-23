/*
 * Зона Хелпера 10 (25.10.2026): вид «от лица жертвы» у кадра попаданий — подпись переключателя «Ракурс кадра» и пояснения под кадром
 * (`features/workshop/fx-frame/frame-choices.js`, `FxFrameStage.jsx`). Русская строка → [uk, en, de, pl]. Сторона слоя «Сзади» — подпись редактора
 * зон попадания (`IMPACT_PLACEMENTS`): «Ззаду», «Back», «Hinten», «Z tyłu».
 */
export const zoneH10FxView = {
  "От лица жертвы": ["Очима жертви", "Victim's view", "Aus Sicht des Opfers", "Z perspektywy ofiary"],
  "Вид от лица жертвы: камера стоит за спиной того, в кого стреляют, стрелок впереди. Вход пули закрыт телом жертвы — видны слои со стороной «Сзади» (выход).": [
    "Вигляд очима жертви: камера стоїть за спиною того, в кого стріляють, стрілець попереду. Вхід кулі закритий тілом жертви — видно шари зі стороною «Ззаду» (вихід).",
    "The victim's view: the camera stands behind the person being shot at, the shooter is ahead. The bullet entry is hidden by the victim's body — layers on the “Back” side (the exit) are visible.",
    "Ansicht aus Sicht des Opfers: Die Kamera steht hinter der Person, auf die geschossen wird, der Schütze steht vorn. Der Einschuss wird vom Körper des Opfers verdeckt — zu sehen sind Ebenen auf der Seite „Hinten“ (der Austritt).",
    "Widok z perspektywy ofiary: kamera stoi za plecami osoby, do której strzelają, strzelec jest z przodu. Wlot pocisku zasłania ciało ofiary — widać warstwy po stronie „Z tyłu” (wylot).",
  ],
  "У этой зоны нет слоёв со стороной «Сзади»: с этого ракурса эффекта не видно — добавьте такой слой или вернитесь к виду от третьего лица.": [
    "У цієї зони немає шарів зі стороною «Ззаду»: з цього ракурсу ефекту не видно — додайте такий шар або поверніться до вигляду від третьої особи.",
    "This zone has no layers on the “Back” side: the effect cannot be seen from this angle — add such a layer or go back to the third-person view.",
    "Diese Zone hat keine Ebenen auf der Seite „Hinten“: aus diesem Blickwinkel ist der Effekt nicht zu sehen — fügen Sie eine solche Ebene hinzu oder wechseln Sie zur Ansicht aus der dritten Person.",
    "Ta strefa nie ma warstw po stronie „Z tyłu”: z tego ujęcia efektu nie widać — dodaj taką warstwę albo wróć do widoku z trzeciej osoby.",
  ],
};
