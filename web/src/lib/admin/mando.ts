/*
 * Cadena de mando en memoria, para la pantalla de Organizacion. Las reglas son
 * las de @/lib/alcance (services/alcance.py), recalculadas para todas las
 * personas de una vez: la pantalla muestra el alcance de cada una y consultar
 * persona a persona seria un N+1.
 *
 * Solo se configuran dos relaciones (quien lidera que unidad y quien reporta a
 * quien); papel y alcance se deducen.
 */

export type PersonaOrg = { id: number; nombre: string; unidadId: number | null; managerId: number | null; activo: boolean };
export type UnidadOrg = { id: number; nombre: string };
export type LiderOrg = { userId: number; unidadId: number };
export type PapelOrg = "director" | "manager" | "empleado";

function reportesPorJefe(personas: PersonaOrg[]) {
  const m = new Map<number, number[]>();
  for (const p of personas) {
    if (p.managerId == null) continue;
    const l = m.get(p.managerId) ?? [];
    l.push(p.id);
    m.set(p.managerId, l);
  }
  return m;
}

/* La persona y todo lo que cuelga de ella. Corta ciclos. */
export function aCargoDe(id: number, reportes: Map<number, number[]>): Set<number> {
  const dentro = new Set<number>();
  const pila = [id];
  while (pila.length) {
    const a = pila.pop()!;
    if (dentro.has(a)) continue;
    dentro.add(a);
    pila.push(...(reportes.get(a) ?? []));
  }
  return dentro;
}

export function calcularAlcances(personas: PersonaOrg[], lideres: LiderOrg[]) {
  const reportes = reportesPorJefe(personas);
  const lideradas = new Map<number, number[]>();
  for (const l of lideres) lideradas.set(l.userId, [...(lideradas.get(l.userId) ?? []), l.unidadId]);

  const alcance = new Map<number, number[]>();
  const papel = new Map<number, PapelOrg>();
  const aCargo = new Map<number, number>();
  for (const p of personas) {
    const debajo = aCargoDe(p.id, reportes);
    const u = new Set<number>();
    for (const id of debajo) for (const a of lideradas.get(id) ?? []) u.add(a);
    alcance.set(p.id, [...u]);
    aCargo.set(p.id, debajo.size - 1);
    papel.set(p.id, (lideradas.get(p.id)?.length ?? 0) > 0 ? "manager" : u.size > 0 ? "director" : "empleado");
  }
  return { alcance, papel, aCargo, lideradas };
}

/* Si asignar `jefeId` como superior de `personaId` cerraria un bucle. */
export function creariaBucle(personas: PersonaOrg[], personaId: number, jefeId: number): boolean {
  if (personaId === jefeId) return true;
  return aCargoDe(personaId, reportesPorJefe(personas)).has(jefeId);
}

/* Superiores de abajo arriba; corta ciclos. */
export function cadenaHaciaArriba(personas: PersonaOrg[], id: number): PersonaOrg[] {
  const porId = new Map(personas.map((p) => [p.id, p]));
  const cadena: PersonaOrg[] = [];
  const visto = new Set<number>([id]);
  let actual = porId.get(id)?.managerId ?? null;
  while (actual != null && !visto.has(actual)) {
    visto.add(actual);
    const jefe = porId.get(actual);
    if (!jefe) break;
    cadena.push(jefe);
    actual = jefe.managerId;
  }
  return cadena;
}

export type NodoUnidad = { unidad: UnidadOrg; miembros: PersonaOrg[] };
export type NodoMando = {
  persona: PersonaOrg;
  papel: PapelOrg;
  unidades: NodoUnidad[];
  subordinados: NodoMando[];
  directos: PersonaOrg[];
};

/*
 * Arbol legible: director -> managers -> unidades -> personas.
 * - Raices: quien tiene papel de mando y no cuelga de otro mando.
 * - Cada mando muestra sus unidades lideradas con sus miembros, los mandos que
 *   le reportan y las personas que le reportan sin estar ya en sus unidades.
 * - Lo que no cae en ningun arbol se devuelve aparte: unidades sin lider y
 *   personas sin unidad liderada ni superior con mando.
 */
export function arbolDeMando(personas: PersonaOrg[], unidades: UnidadOrg[], lideres: LiderOrg[]) {
  const { papel, lideradas } = calcularAlcances(personas, lideres);
  const reportes = reportesPorJefe(personas);
  const porId = new Map(personas.map((p) => [p.id, p]));
  const unidadPorId = new Map(unidades.map((u) => [u.id, u]));
  const orden = (a: { nombre: string }, b: { nombre: string }) => a.nombre.localeCompare(b.nombre, "es");
  const esMando = (id: number) => papel.get(id) !== "empleado";

  const miembrosDe = (unidadId: number) => personas.filter((p) => p.unidadId === unidadId).sort(orden);
  const colocadas = new Set<number>();
  const unidadesConLider = new Set(lideres.map((l) => l.unidadId));

  const construir = (id: number, camino: Set<number>): NodoMando => {
    const persona = porId.get(id)!;
    colocadas.add(id);
    const ids = lideradas.get(id) ?? [];
    const nodosUnidad = ids
      .map((uid) => unidadPorId.get(uid))
      .filter((u): u is UnidadOrg => !!u)
      .sort(orden)
      .map((unidad) => {
        // Un mando que le reporta sale como subordinado, no dos veces.
        const miembros = miembrosDe(unidad.id).filter((m) => m.id !== id && !(esMando(m.id) && m.managerId === id));
        miembros.forEach((m) => colocadas.add(m.id));
        return { unidad, miembros };
      });
    const enUnidades = new Set(nodosUnidad.flatMap((n) => n.miembros.map((m) => m.id)));
    const hijos = (reportes.get(id) ?? []).filter((h) => !camino.has(h)).map((h) => porId.get(h)!).filter(Boolean).sort(orden);
    const siguiente = new Set(camino).add(id);
    const subordinados = hijos.filter((h) => esMando(h.id)).map((h) => construir(h.id, siguiente));
    const directos = hijos.filter((h) => !esMando(h.id) && !enUnidades.has(h.id));
    directos.forEach((d) => colocadas.add(d.id));
    return { persona, papel: papel.get(id)!, unidades: nodosUnidad, subordinados, directos };
  };

  const raices = personas
    .filter((p) => esMando(p.id) && (p.managerId == null || !esMando(p.managerId) || !porId.has(p.managerId)))
    .sort(orden)
    .map((p) => construir(p.id, new Set()));

  // Un ciclo entero de mandos no tiene raiz: se cuelga desde el de menor id.
  for (const p of personas.filter((x) => esMando(x.id) && !colocadas.has(x.id)).sort((a, b) => a.id - b.id)) {
    if (!colocadas.has(p.id)) raices.push(construir(p.id, new Set()));
  }

  const sinLider: NodoUnidad[] = unidades
    .filter((u) => !unidadesConLider.has(u.id))
    .sort(orden)
    .map((unidad) => {
      const miembros = miembrosDe(unidad.id).filter((m) => !colocadas.has(m.id));
      miembros.forEach((m) => colocadas.add(m.id));
      return { unidad, miembros };
    });

  const sueltas = personas.filter((p) => !colocadas.has(p.id)).sort(orden);
  return { raices, sinLider, sueltas };
}
