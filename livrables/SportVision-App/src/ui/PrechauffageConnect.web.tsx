// Sur le web, il n'y a rien a prechauffer : les pages de Connect sont sur le meme navigateur, avec
// ses propres cookies. `react-native-webview` n'existe pas ici — sans ce fichier, la demonstration
// en ligne casserait a l'import.
import React from "react";

export function PrechauffageConnect() { return null; }
