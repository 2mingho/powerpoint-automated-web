/*
 * Busqueda de tareas para la paleta: GET /api/tareas?q=. Ese endpoint es del
 * modulo de tareas; aqui solo se lee, tolerando su forma (lista suelta o
 * { tareas | items | resultados }) y campos en espanol o en ingles. Si falla
 * o no existe todavia, devuelve [] y la paleta sigue sin el grupo de tareas.
 */
export type TareaEncontrada = { id: number; titulo: string; detalle: string };

type Cruda = Record<string, unknown>;

function texto(v: unknown) { return typeof v === "string" ? v : ""; }

function aTarea(t: Cruda): TareaEncontrada | null {
  const id = Number(t.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const titulo = texto(t.titulo) || texto(t.title) || "(sin título)";
  const estado = texto(t.estado) || texto(t.status);
  const cliente = texto(t.cliente) || texto(t.client);
  return { id, titulo, detalle: [cliente, estado].filter(Boolean).join(" · ") };
}

export async function buscarTareas(q: string, signal: AbortSignal): Promise<TareaEncontrada[]> {
  try {
    const r = await fetch(`/api/tareas?q=${encodeURIComponent(q)}&limite=6`, { signal, cache: "no-store" });
    if (!r.ok) return [];
    const d: unknown = await r.json();
    const lista = Array.isArray(d)
      ? d
      : d && typeof d === "object"
        ? ((d as Cruda).tareas ?? (d as Cruda).items ?? (d as Cruda).resultados)
        : null;
    if (!Array.isArray(lista)) return [];
    return lista
      .filter((x): x is Cruda => !!x && typeof x === "object")
      .map(aTarea)
      .filter((x): x is TareaEncontrada => !!x)
      .slice(0, 6);
  } catch {
    return [];
  }
}
