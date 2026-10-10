/*
 * Permisos de ingresos por unidad (logica pura). Hay dos, independientes:
 * editar contratos y editar metas de ingresos, cada uno con sus unidades.
 * Conceden EDICION; ver se decide por la estructura de mando (lib/alcance).
 */

export const TIPOS_FINANZAS = { contracts: "Contratos", goals: "Metas de ingresos" } as const;
export type TipoFinanzas = keyof typeof TIPOS_FINANZAS;
export const CLAVES_FINANZAS = Object.keys(TIPOS_FINANZAS) as TipoFinanzas[];

export type Concesiones = Record<TipoFinanzas, number[]>;

export const SIN_CONCESIONES = (): Concesiones => ({ contracts: [], goals: [] });

export type Leido<T> = { ok: true; valor: T } | { ok: false; error: string };

/*
 * Concesiones de un formulario: {contracts?: ids, goals?: ids}. Solo se tocan
 * los tipos que llegan; cada uno reemplaza su lista entera. Ids enteros > 0, sin repetir.
 */
export function leerConcesiones(crudo: unknown): Leido<Partial<Concesiones>> {
  if (typeof crudo !== "object" || crudo === null || Array.isArray(crudo)) return { ok: false, error: "Permisos de ingresos inválidos." };
  const d = crudo as Record<string, unknown>;
  const desconocida = Object.keys(d).find((k) => !(k in TIPOS_FINANZAS));
  if (desconocida) return { ok: false, error: `Permiso de ingresos desconocido: ${desconocida}.` };
  const valor: Partial<Concesiones> = {};
  for (const tipo of CLAVES_FINANZAS) {
    if (!(tipo in d)) continue;
    const lista = d[tipo];
    if (!Array.isArray(lista) || lista.length > 500 || lista.some((x) => !Number.isInteger(x) || (x as number) <= 0)) {
      return { ok: false, error: `Las unidades de «${TIPOS_FINANZAS[tipo]}» deben ser una lista de ids.` };
    }
    valor[tipo] = [...new Set(lista as number[])].sort((a, b) => a - b);
  }
  return { ok: true, valor };
}

/* Que unidades se agregan y cuales se quitan al pasar de `actual` a `nuevo`. */
export function diferencia(actual: number[], nuevo: number[]): { altas: number[]; bajas: number[] } {
  const a = new Set(actual);
  const n = new Set(nuevo);
  return { altas: [...n].filter((x) => !a.has(x)).sort((x, y) => x - y), bajas: [...a].filter((x) => !n.has(x)).sort((x, y) => x - y) };
}
