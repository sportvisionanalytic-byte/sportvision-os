// Les modules qu'on allume et qu'on éteint, en un seul endroit.
//
// POURQUOI UN INTERRUPTEUR ET PAS UNE SUPPRESSION. Fouka, le 02/10/2026 : « pour le moment on
// retire les trucs de kit, les kits attribués tout ça, je vais les refaire bien plus tard ». Le
// code du Matériel marche — il a été audité et vérifié à l'écran le 01/10. Le supprimer
// obligerait à le réécrire ; le laisser visible mettrait sous les doigts du responsable de
// production un module qu'on a décidé de ne pas tenir. On l'éteint donc, et le rallumer est
// cette ligne.
//
// CE QUI A ÉTÉ RETIRÉ EN MÊME TEMPS, ET QU'IL FAUDRA REMETTRE AVEC : le déclencheur
// `trg_rattacher_kits_mission` sur `prestations_equipe` (migration v450). Il se déclenchait à
// CHAQUE acceptation de mission : tant qu'il existe, une garde de kit qui lève fait échouer
// l'acceptation d'une mission, c'est-à-dire le geste le plus irréversible de l'OS, pour une
// raison qui n'a rien à voir avec la mission. Rallumer l'écran sans remettre le déclencheur est
// sans danger ; remettre le déclencheur demande de revérifier ce chemin.
export const KITS_ACTIFS = false;
