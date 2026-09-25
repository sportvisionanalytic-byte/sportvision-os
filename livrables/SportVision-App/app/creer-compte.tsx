// Créer son compte, sans quitter l'application (22/09/2026).
//
// Fouka : « je veux tout faire vraiment depuis l'application ». Le site demande la même chose en
// quatre pages ; ici c'est trois temps sur un seul écran, parce qu'un tunnel de quatre pages sur
// un téléphone se termine surtout par un abandon.
//
// Seule l'étape de confirmation reste hors de l'application : la confirmation d'e-mail protège
// les comptes, et c'est le lien reçu qui l'active. On le dit clairement plutôt que de faire
// semblant.
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { chercherClubs, creerCompte, type ClubTrouve, type Profil } from "../src/lib/inscription";
import { Bouton, Champ, Erreur } from "../src/ui/Base";
import { C, E, R } from "../src/theme/couleurs";

type Etape = "profil" | "identite" | "club" | "confirme";

/** JJ/MM/AAAA pendant la saisie, AAAA-MM-JJ pour la base. Personne ne tape une date ISO. */
function formateDate(saisie: string, precedent: string): string {
  const chiffres = saisie.replace(/\D/g, "").slice(0, 8);
  // On laisse effacer le séparateur sans qu'il se remette aussitôt.
  if (saisie.length < precedent.length) return saisie;
  if (chiffres.length <= 2) return chiffres;
  if (chiffres.length <= 4) return `${chiffres.slice(0, 2)}/${chiffres.slice(2)}`;
  return `${chiffres.slice(0, 2)}/${chiffres.slice(2, 4)}/${chiffres.slice(4)}`;
}

function dateValide(v: string): string | null {
  const m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, j, mo, a] = m;
  const annee = Number(a), mois = Number(mo), jour = Number(j);
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return null;
  if (annee < 1920 || annee > new Date().getFullYear()) return null;
  return `${a}-${mo}-${j}`;
}

const emailValide = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

export default function CreerCompte() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [etape, setEtape] = useState<Etape>("profil");
  const [profil, setProfil] = useState<Profil | null>(null);

  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [naissance, setNaissance] = useState("");
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");

  const [recherche, setRecherche] = useState("");
  const [resultats, setResultats] = useState<ClubTrouve[]>([]);
  const [chercheEnCours, setChercheEnCours] = useState(false);
  const [clubChoisi, setClubChoisi] = useState<ClubTrouve | null>(null);
  const [declare, setDeclare] = useState(false);
  const [decNom, setDecNom] = useState("");
  const [decVille, setDecVille] = useState("");
  const [decEquipe, setDecEquipe] = useState("");

  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [dejaInscrit, setDejaInscrit] = useState(false);

  // La recherche part 350 ms après la dernière frappe : sans cette pause, chaque lettre lance un
  // appel, et les réponses reviennent dans le désordre.
  useEffect(() => {
    if (etape !== "club" || declare || recherche.trim().length < 2) { setResultats([]); return; }
    let vivant = true;
    setChercheEnCours(true);
    const t = setTimeout(async () => {
      const r = await chercherClubs(recherche);
      if (!vivant) return;
      setResultats(r);
      setChercheEnCours(false);
    }, 350);
    return () => { vivant = false; clearTimeout(t); };
  }, [recherche, etape, declare]);

  const identiteComplete = useMemo(() => {
    const baseOk = prenom.trim() && nom.trim() && emailValide(email) && motDePasse.length >= 8;
    if (profil === "joueur") return !!baseOk && !!dateValide(naissance);
    return !!baseOk;
  }, [prenom, nom, email, motDePasse, naissance, profil]);

  async function envoyer(avecClub: boolean) {
    if (!profil) return;
    setEnvoi(true); setErreur(null); setDejaInscrit(false);
    const r = await creerCompte({
      profil, prenom, nom, email, motDePasse,
      dateNaissance: profil === "joueur" ? dateValide(naissance) ?? undefined : undefined,
      clubChoisi: avecClub && !declare ? clubChoisi : null,
      clubDeclare: avecClub && declare && decNom.trim() && decVille.trim()
        ? { nom: decNom.trim(), ville: decVille.trim(), equipe: decEquipe.trim() }
        : null,
    });
    setEnvoi(false);
    if (r.ok) { setEtape("confirme"); return; }
    setErreur(r.message);
    setDejaInscrit(!!r.dejaInscrit);
  }

  const numeroEtape = etape === "profil" ? 1 : etape === "identite" ? 2 : 3;
  const total = profil === "parent" ? 2 : 3;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.fond }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        contentContainerStyle={[
          s.page,
          { paddingTop: insets.top + E.m, paddingBottom: insets.bottom + E.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {etape !== "confirme" ? (
          <>
            <View style={s.barre}>
              <Pressable
                accessibilityRole="button" accessibilityLabel="Étape précédente"
                onPress={() => {
                  if (etape === "profil") router.back();
                  else if (etape === "identite") setEtape("profil");
                  else setEtape("identite");
                }}
                hitSlop={10}
                style={s.retour}
              >
                <Ionicons name="chevron-back" size={20} color={C.texteDoux} />
              </Pressable>
              <View style={s.points}>
                {Array.from({ length: total }).map((_, i) => (
                  <View key={i} style={[s.point, i < numeroEtape && s.pointActif]} />
                ))}
              </View>
            </View>

            {etape === "profil" ? (
              <View style={{ gap: E.l }}>
                <View style={{ gap: E.xs }}>
                  <Text style={s.titre}>Créer mon compte</Text>
                  <Text style={s.sous}>Qui va utiliser ce compte ?</Text>
                </View>
                <View style={{ gap: E.m }}>
                  <Choix
                    icone="football"
                    teinte={C.accent}
                    titre="Je suis le sportif"
                    texte="Mon calendrier, mes résultats et mes photos."
                    onPress={() => { setProfil("joueur"); setEtape("identite"); }}
                  />
                  <Choix
                    icone="people"
                    teinte={C.violet}
                    titre="Je suis parent"
                    texte="Je suis un ou plusieurs enfants licenciés."
                    onPress={() => { setProfil("parent"); setEtape("identite"); }}
                  />
                </View>
              </View>
            ) : null}

            {etape === "identite" ? (
              <View style={{ gap: E.l }}>
                <View style={{ gap: E.xs }}>
                  <Text style={s.titre}>Vos informations</Text>
                  <Text style={s.sous}>
                    {profil === "joueur"
                      ? "Elles serviront à vous reconnaître dans les galeries de votre équipe."
                      : "Vous rattacherez vos enfants juste après."}
                  </Text>
                </View>

                <View style={{ gap: E.m }}>
                  <Champ label="Prénom" value={prenom} onChangeText={setPrenom} placeholder="Lucas" autoCapitalize="words" textContentType="givenName" />
                  <Champ label="Nom" value={nom} onChangeText={setNom} placeholder="Moreau" autoCapitalize="words" textContentType="familyName" />
                  {profil === "joueur" ? (
                    <Champ
                      label="Date de naissance"
                      value={naissance}
                      onChangeText={(t) => setNaissance(formateDate(t, naissance))}
                      placeholder="JJ/MM/AAAA"
                      keyboardType="number-pad"
                    />
                  ) : null}
                  <Champ label="Adresse e-mail" value={email} onChangeText={setEmail} placeholder="vous@exemple.fr" keyboardType="email-address" textContentType="emailAddress" />
                  <Champ label="Mot de passe" value={motDePasse} onChangeText={setMotDePasse} placeholder="Huit caractères au minimum" secureTextEntry textContentType="newPassword" />

                  <Erreur message={erreur} />
                  {dejaInscrit ? (
                    <Pressable onPress={() => router.replace("/connexion")} accessibilityRole="link" accessibilityLabel="J'ai déjà un compte, me connecter" hitSlop={8}>
                      <Text style={s.lien}>Se connecter avec cette adresse</Text>
                    </Pressable>
                  ) : null}

                  <Bouton
                    titre={profil === "joueur" ? "Continuer" : "Créer mon compte"}
                    desactive={!identiteComplete}
                    enCours={envoi}
                    onPress={() => {
                      if (!identiteComplete) return;
                      if (profil === "joueur") { setErreur(null); setEtape("club"); }
                      else envoyer(false);
                    }}
                  />
                  <Text style={s.mentions}>
                    En créant un compte, vous acceptez les conditions générales et la politique de
                    confidentialité de SportVision.
                  </Text>
                </View>
              </View>
            ) : null}

            {etape === "club" ? (
              <View style={{ gap: E.l }}>
                <View style={{ gap: E.xs }}>
                  <Text style={s.titre}>Votre club</Text>
                  <Text style={s.sous}>
                    Il devra confirmer votre rattachement. Vous pouvez aussi le faire plus tard.
                  </Text>
                </View>

                {!declare ? (
                  <View style={{ gap: E.m }}>
                    <Champ
                      label="Rechercher mon club"
                      value={recherche}
                      onChangeText={(t) => { setRecherche(t); setClubChoisi(null); }}
                      placeholder="Nom du club"
                    />

                    {chercheEnCours ? (
                      <View style={{ paddingVertical: E.m, alignItems: "center" }}>
                        <ActivityIndicator color={C.accent} />
                      </View>
                    ) : null}

                    {resultats.map((c) => {
                      const actif = clubChoisi?.id === c.id;
                      return (
                        <Pressable key={c.id} onPress={() => setClubChoisi(c)} accessibilityRole="button" accessibilityState={{ selected: actif }} accessibilityLabel={`Choisir ${c.nom}`} style={[s.club, actif && s.clubActif]}>
                          <View style={{ flex: 1, gap: 2 }}>
                            <Text style={s.clubNom} numberOfLines={1}>{c.nom}</Text>
                            {c.ville ? <Text style={s.clubVille} numberOfLines={1}>{c.ville}</Text> : null}
                          </View>
                          {actif ? <Ionicons name="checkmark-circle" size={20} color={C.succes} /> : null}
                        </Pressable>
                      );
                    })}

                    {recherche.trim().length >= 2 && !chercheEnCours && resultats.length === 0 ? (
                      <Text style={s.sous}>Aucun club trouvé sous ce nom.</Text>
                    ) : null}

                    <Pressable onPress={() => setDeclare(true)} accessibilityRole="button" accessibilityLabel="Mon club n'est pas dans la liste" hitSlop={8}>
                      <Text style={s.lien}>Mon club n'est pas dans la liste</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View style={{ gap: E.m }}>
                    <Champ label="Nom du club" value={decNom} onChangeText={setDecNom} placeholder="SF Villemomble" autoCapitalize="words" />
                    <Champ label="Ville" value={decVille} onChangeText={setDecVille} placeholder="Villemomble" autoCapitalize="words" />
                    <Champ label="Équipe (facultatif)" value={decEquipe} onChangeText={setDecEquipe} placeholder="U18" />
                    <Pressable
                      onPress={() => setDeclare(false)}
                      hitSlop={8}
                      accessibilityRole="link"
                      accessibilityLabel="Revenir à la recherche de club"
                    >
                      <Text style={s.lien}>Revenir à la recherche</Text>
                    </Pressable>
                  </View>
                )}

                <Erreur message={erreur} />

                <View style={{ gap: E.s }}>
                  <Bouton
                    titre="Créer mon compte"
                    enCours={envoi}
                    desactive={declare ? !(decNom.trim() && decVille.trim()) : !clubChoisi}
                    onPress={() => envoyer(true)}
                  />
                  <Bouton titre="Je le ferai plus tard" secondaire onPress={() => envoyer(false)} />
                </View>
              </View>
            ) : null}
          </>
        ) : (
          <View style={s.fin}>
            <View style={s.rond}>
              <Ionicons name="mail-open-outline" size={30} color={C.cyan} />
            </View>
            <Text style={s.titre}>Vérifiez votre boîte mail</Text>
            <Text style={s.sous}>
              Un message vient de partir à {email.trim().toLowerCase()}. Touchez le lien qu'il
              contient pour activer votre compte, puis revenez ici pour vous connecter.
            </Text>
            <Text style={s.sousFaible}>
              Rien reçu ? Regardez dans les indésirables. L'adresse peut aussi comporter une faute
              de frappe, dans ce cas recommencez l'inscription.
            </Text>
            <View style={{ gap: E.s, width: "100%", paddingTop: E.s }}>
              <Bouton titre="J'ai confirmé, me connecter" onPress={() => router.replace("/connexion")} />
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Choix({
  icone, teinte, titre, texte, onPress,
}: { icone: keyof typeof Ionicons.glyphMap; teinte: string; titre: string; texte: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.carteChoix, { borderColor: pressed ? teinte + "88" : C.bordure }]}
    >
      <View style={[s.icone, { backgroundColor: teinte + "22" }]}>
        <Ionicons name={icone} size={22} color={teinte} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={s.choixTitre}>{titre}</Text>
        <Text style={s.sous}>{texte}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={C.texteFaible} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  page: { flexGrow: 1, paddingHorizontal: E.l, gap: E.l },
  barre: { flexDirection: "row", alignItems: "center", gap: E.m },
  retour: { width: 32, height: 32, alignItems: "center", justifyContent: "center", marginLeft: -6 },
  points: { flexDirection: "row", gap: 6, flex: 1 },
  point: { flex: 1, height: 3, borderRadius: 2, backgroundColor: "rgba(255,255,255,.12)" },
  pointActif: { backgroundColor: C.accent },
  titre: { color: C.texte, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  sous: { color: C.texteDoux, fontSize: 14.5, lineHeight: 20 },
  sousFaible: { color: C.texteFaible, fontSize: 13, lineHeight: 18 },
  carteChoix: {
    flexDirection: "row", alignItems: "center", gap: E.m,
    backgroundColor: C.surface, borderRadius: R.l, borderWidth: 1, padding: E.m,
  },
  icone: { width: 46, height: 46, borderRadius: R.m, alignItems: "center", justifyContent: "center" },
  choixTitre: { color: C.texte, fontSize: 16.5, fontWeight: "700" },
  club: {
    flexDirection: "row", alignItems: "center", gap: E.s,
    backgroundColor: C.surface, borderRadius: R.m, borderWidth: 1, borderColor: C.bordure,
    paddingHorizontal: E.m, paddingVertical: E.s + 2,
  },
  clubActif: { borderColor: "rgba(46,204,138,.5)", backgroundColor: "rgba(46,204,138,.08)" },
  clubNom: { color: C.texte, fontSize: 15, fontWeight: "600" },
  clubVille: { color: C.texteFaible, fontSize: 12.5 },
  lien: { color: C.accentClair, fontSize: 14, fontWeight: "600" },
  mentions: { color: C.texteFaible, fontSize: 11.5, lineHeight: 16, textAlign: "center" },
  fin: { flex: 1, justifyContent: "center", alignItems: "flex-start", gap: E.m },
  rond: {
    width: 58, height: 58, borderRadius: R.l, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(34,211,238,.12)",
  },
});
