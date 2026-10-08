import { conUsuario, ok } from "@/lib/api";
import { listarNotificaciones } from "@/lib/campana/consultas";

/* GET ?limite=20&no_leidas=1 → { items, noLeidas }. Solo las del propio usuario. */
export const GET = conUsuario(async (req, u) => {
  const p = new URL(req.url).searchParams;
  const n = Number.parseInt(p.get("limite") ?? "20", 10);
  const limite = Math.max(1, Math.min(Number.isFinite(n) ? n : 20, 50));
  return ok(await listarNotificaciones(u.id, { limite, soloNoLeidas: p.get("no_leidas") === "1" }));
});
