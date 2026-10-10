/*
 * Orden de tablas y listas (logica pura). Texto con la regla del español (sin
 * distinguir mayusculas ni tildes, numeros por su valor: "Paso 2" antes que "Paso 10"),
 * numeros como numeros, y lo vacio siempre al final, ordenes ascendente o descendente.
 */

export type Direccion = "asc" | "desc";
export type Orden<C extends string> = { col: C; dir: Direccion };
export type Clave = string | number | null | undefined;

const colador = new Intl.Collator("es", { sensitivity: "base", numeric: true });

const vacio = (c: Clave) => c === null || c === undefined || c === "" || (typeof c === "number" && Number.isNaN(c));

/* Copia ordenada; estable (los empates conservan el orden de entrada). */
export function ordenarPor<T>(items: readonly T[], clave: (t: T) => Clave, dir: Direccion): T[] {
  const signo = dir === "asc" ? 1 : -1;
  return items
    .map((t, i) => ({ t, i, c: clave(t) }))
    .sort((a, b) => {
      const va = vacio(a.c), vb = vacio(b.c);
      if (va || vb) return va && vb ? a.i - b.i : va ? 1 : -1; // lo vacio al final, sea cual sea la direccion
      const r = typeof a.c === "number" && typeof b.c === "number" ? a.c - b.c : colador.compare(String(a.c), String(b.c));
      return r ? r * signo : a.i - b.i;
    })
    .map((x) => x.t);
}

/*
 * Pulsar una columna: la primera vez ordena (en `primera`), la segunda invierte y la
 * tercera quita el orden y vuelve al predeterminado de la pantalla (null).
 */
export function alternarOrden<C extends string>(actual: Orden<C> | null, col: C, primera: Direccion = "asc"): Orden<C> | null {
  if (!actual || actual.col !== col) return { col, dir: primera };
  const segunda: Direccion = primera === "asc" ? "desc" : "asc";
  return actual.dir === primera ? { col, dir: segunda } : null;
}
