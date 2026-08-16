import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudioCategory, StudioFieldKey, StudioTemplate } from "@/lib/types/studio";
import { STUDIO_PREFILLED_FIELDS } from "@/lib/types/studio";

// studio_templates (migration-clubplus-v38-studio-sponsors.sql) — catalogue des modèles
// visuels du Studio, sorti de STUDIO_TEMPLATES (src/lib/mock/studio.ts, qui reste par ailleurs
// la source de données de Newsroom/Match Center/VisualRequest — fichier partagé avec un autre
// chantier en parallèle, non modifié ici) vers une vraie table pilotable par le staff sans
// déploiement. RLS : stpl_authenticated_read (club_members OU memberships, actif = true
// uniquement), stpl_staff_all (is_staff()).
//
// `formFields` est une règle de formulaire PAR CATÉGORIE (pas par modèle individuel) et
// `prefilledFields` une constante identique pour tout le catalogue : ce sont des règles de
// présentation, pas des données de catalogue — elles ne sont donc pas des colonnes de cette
// table. `CATEGORY_FIELDS` ci-dessous est une copie volontaire de la constante du même nom dans
// src/lib/mock/studio.ts (fichier hors périmètre de ce chantier, voir note ci-dessus) plutôt
// qu'une ré-exportation, pour ne produire aucun diff dessus.
const CATEGORY_FIELDS: Record<StudioCategory, StudioFieldKey[]> = {
  pre_match: ["team", "opponent", "competition", "date", "venue", "sponsor", "photo", "comment"],
  match_day: ["team", "opponent", "competition", "date", "venue", "photo", "comment"],
  post_match: ["team", "opponent", "competition", "date", "venue", "photo", "comment"],
  players: ["player", "team", "date", "photo", "comment"],
  club_life: ["team", "title", "date", "venue", "photo", "comment"],
  sponsors: ["sponsor", "team", "date", "photo", "comment"],
  events: ["title", "date", "venue", "sponsor", "photo", "comment"],
};

interface StudioTemplateRow {
  code: string;
  name: string;
  category: StudioCategory;
  credit_cost: 1 | 2 | 3;
  delivery_delay: "24 h" | "48 h" | "72 h";
  image_url: string | null;
}

function toStudioTemplate(row: StudioTemplateRow): StudioTemplate {
  const previewUrl = row.image_url ?? `placeholder://studio/${row.code}`;
  return {
    code: row.code,
    name: row.name,
    category: row.category,
    creditCost: row.credit_cost,
    deliveryDelay: row.delivery_delay,
    previewUrl,
    // Aucune vraie variante d'exemple n'existe côté design (pas plus qu'avant cette migration,
    // voir tpl() dans lib/mock/studio.ts) : même convention de nommage dérivée du code, pas une
    // vraie donnée stockée séparément.
    sampleUrls: [`${previewUrl}/exemple-1`, `${previewUrl}/exemple-2`, `${previewUrl}/exemple-3`],
    formFields: CATEGORY_FIELDS[row.category],
    prefilledFields: STUDIO_PREFILLED_FIELDS,
    // `min_tier` existe en base (migration v38) pour permettre une variation future sans
    // déploiement, mais StudioTemplate.minTier (lib/types/studio.ts, hors périmètre de ce
    // chantier) est typé en dur au littéral `2` aujourd'hui — toute valeur autre que 2 en base
    // nécessiterait d'abord d'élargir ce type, non fait ici pour ne pas toucher ce fichier.
    minTier: 2,
  };
}

const SELECT = "code, name, category, credit_cost, delivery_delay, image_url";

export async function fetchStudioTemplates(supabase: SupabaseClient): Promise<StudioTemplate[]> {
  const { data, error } = await supabase
    .from("studio_templates")
    .select(SELECT)
    .eq("active", true)
    .order("display_order", { ascending: true });
  if (error) throw error;
  return ((data ?? []) as StudioTemplateRow[]).map(toStudioTemplate);
}

export async function fetchStudioTemplate(supabase: SupabaseClient, code: string): Promise<StudioTemplate | null> {
  const { data, error } = await supabase
    .from("studio_templates")
    .select(SELECT)
    .eq("code", code)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data ? toStudioTemplate(data as StudioTemplateRow) : null;
}
