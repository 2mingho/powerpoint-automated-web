import { conUsuario, ok } from "@/lib/api";
import { contarNoLeidas } from "@/lib/campana/consultas";

/* Solo el numero de la campana: la consulta mas barata posible, porque la sondea cada pestana visible. */
export const GET = conUsuario(async (_req, u) => ok({ noLeidas: await contarNoLeidas(u.id) }));
