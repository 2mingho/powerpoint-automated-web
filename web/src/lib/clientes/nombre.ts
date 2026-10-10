/*
 * Nombres de cliente: la clave que decide cuando dos textos son el mismo
 * cliente, y como se agrupan las variantes al migrar. Es la opcion "A" de la
 * migracion: solo se unen los que difieren en MAYUSCULAS, acentos y espacios.
 * "Claro." o "Claro RD" siguen siendo otro cliente hasta que un admin los una.
 *
 * La migracion 0016 (Python) repite esta misma regla; los dos lados se prueban
 * contra claves-casos.json.
 */

/* Minusculas, sin acentos (la enie se conserva: Peña y Pena son otras palabras) y con los espacios colapsados. */
export function claveDeCliente(nombre: string): string {
  return nombre
    .normalize("NFC")
    .toLowerCase()
    .replace(/ñ/g, "\u0000")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\u0000/g, "ñ")
    .replace(/\s+/g, " ")
    .trim();
}

/* El nombre tal como se muestra: igual que se escribio, con los espacios colapsados. */
export function nombreLimpio(nombre: string): string {
  return nombre.replace(/\s+/g, " ").trim();
}

export type Variante = { nombre: string; n: number };
export type GrupoCliente = { clave: string; nombre: string; variantes: Variante[]; total: number };

/* Letras no ASCII: a igualdad de uso, «Nestlé» gana a «Nestle» (la bien escrita). */
function acentos(nombre: string): number {
  return [...nombre].filter((c) => c.charCodeAt(0) > 127).length;
}

/*
 * Agrupa textos por clave. El nombre canonico es la variante mas usada; si
 * empatan, la que lleva mas acentos y despues la primera en orden alfabetico
 * (las mayusculas van antes: «Claro» antes que «claro»). Los textos vacios no
 * forman grupo.
 */
export function agruparVariantes(filas: Variante[]): GrupoCliente[] {
  const grupos = new Map<string, Variante[]>();
  for (const f of filas) {
    const nombre = nombreLimpio(f.nombre);
    const clave = claveDeCliente(nombre);
    if (!clave) continue;
    const lista = grupos.get(clave) ?? [];
    const previa = lista.find((v) => v.nombre === nombre);
    if (previa) previa.n += f.n;
    else lista.push({ nombre, n: f.n });
    grupos.set(clave, lista);
  }
  return [...grupos.entries()]
    .map(([clave, variantes]) => {
      const orden = [...variantes].sort((a, b) => b.n - a.n || acentos(b.nombre) - acentos(a.nombre) || (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0));
      return { clave, nombre: orden[0].nombre, variantes: orden, total: variantes.reduce((s, v) => s + v.n, 0) };
    })
    .sort((a, b) => (a.clave < b.clave ? -1 : 1));
}

/* La clave sin puntuacion ni simbolos: «Claro.» y «Claro» comparten esta forma. */
function soloLetras(clave: string): string {
  return clave.replace(/[-_/]/g, " ").replace(/[^\p{L}\p{N}ñ ]/gu, "").replace(/\s+/g, " ").trim();
}

function distancia(a: string, b: string): number {
  if (a === b) return 0;
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    for (let j = 1; j <= b.length; j++) fila[j] = Math.min(previa[j] + 1, fila[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previa = fila;
  }
  return previa[b.length];
}

/*
 * Cuanto se parecen dos claves distintas, de 3 (casi seguro el mismo cliente)
 * a 0 (nada). Es solo una sugerencia para que un admin decida; nunca une nada.
 *   3  solo cambia la puntuacion («claro.» y «claro»)
 *   2  una es el comienzo de la otra, por palabras («claro» y «claro rd»)
 *   1  una letra de diferencia (ni mas: dos letras ya dan falsos parecidos) en nombres largos («cerveceria nacional» y «cervecria nacional»)
 */
export function parecido(a: string, b: string): 0 | 1 | 2 | 3 {
  if (a === b) return 0;
  const sa = soloLetras(a);
  const sb = soloLetras(b);
  if (sa && sa === sb) return 3;
  const [corta, larga] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
  if (corta.length >= 3 && larga.startsWith(`${corta} `)) return 2;
  const minimo = Math.min(sa.length, sb.length);
  if (minimo >= 6 && distancia(sa, sb) <= 1) return 1;
  return 0;
}

/* Los clientes mas parecidos a `clave`, del mas al menos parecido (maximo `limite`). */
export function parecidos<T extends { clave: string }>(clave: string, otros: T[], limite = 3): T[] {
  return otros
    .map((o) => ({ o, p: parecido(clave, o.clave) }))
    .filter((x) => x.p > 0)
    .sort((x, y) => y.p - x.p || (x.o.clave < y.o.clave ? -1 : 1))
    .slice(0, limite)
    .map((x) => x.o);
}
