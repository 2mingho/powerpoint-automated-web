/*
 * Busqueda de tareas para la paleta: GET /api/tareas?q=&alcance=unidad&limite=6.
 * alcance=unidad es "todo lo que puedo ver" (sin el, la API solo mira las
 * asignadas a mi); limite corta la lista y ahorra los contadores. Se tolera
 * la forma de la respuesta; si falla, [] y la paleta sigue sin el grupo.
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
    const r = await fetch(`/api/tareas?q=${encodeURIComponent(q)}&alcance=unidad&limite=6`, { signal, cache: "no-store" });
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
