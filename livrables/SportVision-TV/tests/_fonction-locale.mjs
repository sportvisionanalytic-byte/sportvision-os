// Lance une edge function sous Deno, en local, sur un port LIBRE.
//
// POURQUOI. std/http/serve écoute par défaut sur le port 8000, souvent déjà pris par une autre
// copie locale (un autre test, un autre chantier). Le 10/09/2026, un test a ainsi envoyé ses
// requêtes à la fonction d'un autre chantier sans s'en rendre compte : la vérification « le
// serveur répond » était vraie, mais ce n'était pas le bon serveur. Ici, le fichier est recopié
// dans un dossier temporaire, l'import de `serve` réécrit pour écouter sur un port choisi, et on
// vérifie que c'est bien NOTRE processus qui répond (il meurt, le port se ferme).
//
//   const f = await lancerFonctionLocale({ source, env: { SUPABASE_URL: … }, reseau: "api.example" });
//   await fetch(f.url, …); await f.arreter();

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const IMPORT_SERVE = 'import { serve } from "https://deno.land/std@0.168.0/http/server.ts";';

async function portLibre() {
  return new Promise((ok) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

/** source : contenu de index.ts. reseau : liste --allow-net supplémentaire (sinon réseau libre). */
export async function lancerFonctionLocale({ source, env = {}, reseau = null }) {
  if (!source.includes(IMPORT_SERVE)) throw new Error("import de serve introuvable : fonction non lançable en local par ce module");
  const port = await portLibre();
  const dossier = mkdtempSync(join(tmpdir(), "zz-fonction-locale-"));
  writeFileSync(join(dossier, "index.ts"), source.replace(IMPORT_SERVE,
    'import { serve as __serve } from "https://deno.land/std@0.168.0/http/server.ts";\n' +
    '// deno-lint-ignore no-explicit-any\n' +
    'const serve = (h: any) => __serve(h, { port: Number(Deno.env.get("PORT_FONCTION_LOCALE")) });'));
  const net = reseau === null ? "--allow-net" : `--allow-net=0.0.0.0:${port},localhost:${port},127.0.0.1:${port}${reseau ? "," + reseau : ""}`;
  const p = spawn("deno", ["run", "--allow-env", "--allow-read", net, "index.ts"], {
    cwd: dossier, env: { ...process.env, ...env, PORT_FONCTION_LOCALE: String(port) }, stdio: ["ignore", "pipe", "pipe"],
  });
  let journal = "";
  p.stdout.on("data", (d) => { journal += d; });
  p.stderr.on("data", (d) => { journal += d; });
  const url = `http://localhost:${port}/`;
  for (let i = 0; i < 120 && p.exitCode === null; i++) {
    try { await fetch(url, { method: "OPTIONS" }); break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (p.exitCode !== null) throw new Error(`la fonction locale s'est arrêtée : ${journal.slice(0, 300)}`);
  return {
    url,
    journal: () => journal,
    arreter: async () => {
      p.kill();
      await new Promise((r) => (p.exitCode !== null ? r() : p.once("exit", r)));
      rmSync(dossier, { recursive: true, force: true });
    },
  };
}
