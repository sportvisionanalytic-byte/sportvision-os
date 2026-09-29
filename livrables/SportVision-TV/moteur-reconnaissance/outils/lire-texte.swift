// Lire le texte d'une image avec le moteur de macOS (29/09/2026).
//
// POURQUOI PAS TESSERACT. Tesseract est fait pour des documents imprimés. Un numéro de maillot est
// dessiné : trait fin, contour creux, police fantaisie, tissu qui plisse. Mesuré sur la galerie
// réelle, il lit « 1 » là où un « 2 » s'étale en grand et en net. Aucun réglage ne rattrape cela.
//
// macOS embarque Vision, entraîné sur des photos du monde réel — panneaux, devantures, plaques.
// C'est exactement le genre de texte qu'on cherche, et ça ne coûte ni téléchargement ni service
// tiers : le Mac qui fait déjà tourner la reconnaissance sait le faire.
//
// USAGE
//   swiftc -O -o outils/lire-texte outils/lire-texte.swift
//   ./outils/lire-texte image1.png image2.png ...
//
// Rend une ligne JSON par image : { "fichier": ..., "lignes": [ { "texte": ..., "confiance": ...,
// "boite": [x, y, largeur, hauteur] } ] }. Les coordonnées sont en fraction de l'image, origine en
// haut à gauche.
import Foundation
import Vision
import CoreImage
import AppKit

struct Ligne: Encodable { let texte: String; let confiance: Float; let boite: [Double] }
struct Sortie: Encodable { let fichier: String; let lignes: [Ligne]; let erreur: String? }

func lire(_ chemin: String) -> Sortie {
    guard let image = NSImage(contentsOfFile: chemin),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        return Sortie(fichier: chemin, lignes: [], erreur: "image illisible")
    }
    let requete = VNRecognizeTextRequest()
    requete.recognitionLevel = .accurate
    // PAS DE CORRECTION LINGUISTIQUE. Elle est faite pour transformer « hte » en « the » ; sur des
    // chiffres isolés elle invente des mots et abîme exactement ce qu'on cherche.
    requete.usesLanguageCorrection = false
    requete.recognitionLanguages = ["en-US"]
    // On veut toutes les hypothèses : un « 2 » ambigu peut sortir deuxième, et c'est au moteur de
    // reconnaissance de trancher avec ce qu'il sait du contexte.
    let traiteur = VNImageRequestHandler(cgImage: cg, options: [:])
    do { try traiteur.perform([requete]) }
    catch { return Sortie(fichier: chemin, lignes: [], erreur: "\(error)") }

    var lignes: [Ligne] = []
    for obs in (requete.results ?? []) {
        for candidat in obs.topCandidates(3) {
            let b = obs.boundingBox
            // Vision place l'origine en bas à gauche ; on la remet en haut à gauche.
            lignes.append(Ligne(texte: candidat.string, confiance: candidat.confidence,
                                boite: [b.minX, 1 - b.maxY, b.width, b.height]))
        }
    }
    return Sortie(fichier: chemin, lignes: lignes, erreur: nil)
}

let encodeur = JSONEncoder()
for chemin in CommandLine.arguments.dropFirst() {
    if let d = try? encodeur.encode(lire(chemin)), let s = String(data: d, encoding: .utf8) {
        print(s)
    }
}
