/*
 * Français pour `zone-clip-table-2211.js` : refus d’installation quand un autre mod a modifié la table des images de particules avec des compteurs erronés dans l’en-tête (22.11.2026).
 * Un seul message pour les deux compteurs (nombre de textures, nombre d’images) ; le fichier n’est que « probablement » intact, et le dernier conseil est de vérifier le jeu s’il n’y a pas d’autres mods.
 * Espaces insécables : séquences d’échappement seulement (voir CLAUDE.md).
 */
export const frZoneClipTable2211 = {
  "Таблицу эффектов игры изменил другой мод":
    "Un autre mod a modifié la table des effets du jeu",
  "В таблице кадров частиц неверные счётчики в заголовке — скорее всего, её записал другой мод (редукс). Файл, вероятно, не повреждён, но эта работа меняет ту же таблицу и поверх чужой не ставится. В игру ничего не записано. Всё, что таблицу не трогает, ставится как обычно; либо снимите мод, который изменил таблицу, и нажмите «Повторить». Числа — в «Подробностях». Если других модов нет — проверьте целостность игры: {verify}":
    "La table des images de particules a des compteurs erronés dans son en-tête, très probablement écrite par un autre mod (un redux). Le fichier n’est probablement pas endommagé, mais ce travail modifie la même table et ne s’installe pas par-dessus celle d’un autre. Rien n’a été écrit dans le jeu. Tout ce qui ne touche pas à la table s’installe comme d’habitude\u00a0; ou retirez le mod qui a modifié la table, puis cliquez sur «\u00a0Réessayer\u00a0». Les chiffres figurent dans «\u00a0Détails\u00a0». S’il n’y a pas d’autres mods, vérifiez l’intégrité du jeu\u00a0: {verify}",
};
