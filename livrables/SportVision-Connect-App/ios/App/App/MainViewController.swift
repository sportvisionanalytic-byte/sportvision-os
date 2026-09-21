import UIKit
import Capacitor

/// L'écran de l'application, avec le geste de retour (22/09/2026).
///
/// Fouka : « si quelqu'un clique sur "je fais partie de SportVision", il ne peut plus retourner
/// en arrière, pareil pour les autres ». C'était exact : une fois l'espace ouvert, l'écran
/// d'entrée n'était plus atteignable qu'en fermant l'application et en rattrapant le bouton
/// affiché deux secondes au lancement. Autant dire jamais.
///
/// On active donc le geste que tout le monde connaît sur iPhone : glisser depuis le bord gauche
/// pour revenir. Il ramène à l'écran précédent, donc au choix d'espace, et il fonctionne aussi à
/// l'intérieur des sites — un parent qui s'enfonce dans les photos de son enfant revient d'un
/// geste, comme dans Safari.
///
/// Pourquoi ici et pas en JavaScript : les pages affichées viennent de domaines distants, où
/// aucun code de l'application ne s'exécute. Seule la webview elle-même peut offrir ce retour.
class MainViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.allowsBackForwardNavigationGestures = true
    }
}
