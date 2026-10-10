/*
 * Series de los graficos del panel (logica pura). Cada grafico se calcula con
 * todos los filtros menos el suyo (omitir), como las listas de opciones: elegir
 * un cliente deja el grafico de clientes entero, con el elegido resaltado.
 * El valor de cada tarea es 1 o sus horas segun la metrica.
 */
import { pasaFiltros, riesgoEfectivo, type FiltrosCruzados } from "@/lib/seguimiento/filtros";
import { lunesDe, sumarDias } from "@/lib/tareas/fechas";
import { valorDe } from "./agregados";
import { GRUPOS_ESTADO, type CeldaPanel, type Metrica } from "./tipos";

const redondear = (n: number) => Math.round(n * 100) / 100;

export type Grupo = (typeof GRUPOS_ESTADO)[number]["valor"];
export type PorGrupo = Record<Grupo, number>;
const vacio = (): PorGrupo => ({ pendiente: 0, en_curso: 0, revision: 0, bloqueada: 0, hecha: 0 });

/* Tope de barras antes de resumir el resto: mas no se lee ni cabe en el movil. */
export const TOPE_BARRAS = 8;

export type BarraEstado = { clave: string; etiqueta: string; total: number; porGrupo: PorGrupo; vencidas: number };

/*
 * Estado por cliente: las TOPE_BARRAS con mas valor, de mayor a menor, mas el
 * cliente elegido aunque no entre. Las tareas sin cliente no se pueden elegir
 * como filtro y no salen.
 */
export function estadoPorCliente(filas: CeldaPanel[], f: FiltrosCruzados, hoy: string, m: Metrica): { barras: BarraEstado[]; omitidos: number } {
  const mapa = new Map<string, BarraEstado>();
  for (const t of filas) {
    if (!t.cliente || !pasaFiltros(t, f, hoy, "cliente")) continue;
    const b = mapa.get(t.cliente) ?? { clave: t.cliente, etiqueta: t.cliente, total: 0, porGrupo: vacio(), vencidas: 0 };
    const v = valorDe(t, m);
    b.total += v;
    b.porGrupo[t.estado] += v;
    if (riesgoEfectivo(t, hoy) === "vencida") b.vencidas += v;
    mapa.set(t.cliente, b);
  }
  return recortar([...mapa.values()], f.cliente);
}

/*
 * Carga por persona: sin filtro de estado cuenta solo lo abierto (lo que pesa
 * hoy); con uno, lo que ese filtro deje pasar.
 */
export function cargaPorPersona(filas: CeldaPanel[], f: FiltrosCruzados, hoy: string, m: Metrica): { barras: BarraEstado[]; omitidos: number } {
  const mapa = new Map<string, BarraEstado>();
  for (const t of filas) {
    if (!pasaFiltros(t, f, hoy, "persona")) continue;
    if (!f.estado && t.estado === "hecha") continue;
    const b = mapa.get(t.persona) ?? { clave: t.persona, etiqueta: t.personaNombre, total: 0, porGrupo: vacio(), vencidas: 0 };
    const v = valorDe(t, m);
    b.total += v;
    b.porGrupo[t.estado] += v;
    if (riesgoEfectivo(t, hoy) === "vencida") b.vencidas += v;
    mapa.set(t.persona, b);
  }
  return recortar([...mapa.values()], f.persona);
}

function recortar(todas: BarraEstado[], elegida: string): { barras: BarraEstado[]; omitidos: number } {
  for (const b of todas) {
    b.total = redondear(b.total);
    b.vencidas = redondear(b.vencidas);
    for (const g of GRUPOS_ESTADO) b.porGrupo[g.valor] = redondear(b.porGrupo[g.valor]);
  }
  todas.sort((a, b) => b.total - a.total || a.etiqueta.localeCompare(b.etiqueta, "es"));
  let barras = todas.slice(0, TOPE_BARRAS);
  const extra = elegida && !barras.some((b) => b.clave === elegida) ? todas.find((b) => b.clave === elegida) : undefined;
  if (extra) barras = [...barras.slice(0, TOPE_BARRAS - 1), extra];
  return { barras, omitidos: todas.length - barras.length };
}

export type Semana = { lunes: string; hechas: number; abiertas: number; vencidas: number; total: number };

/* Tope de semanas dibujadas: un periodo de "Todo" puede abarcar anos. */
export const TOPE_SEMANAS = 26;

/*
 * Entregas por semana (la semana es el lunes de la entrega): hechas, abiertas
 * y vencidas. Rellena las semanas vacias entre la primera y la ultima para que
 * el eje no mienta; si son demasiadas, deja las TOPE_SEMANAS mas cercanas a hoy.
 */
export function entregasPorSemana(filas: CeldaPanel[], f: FiltrosCruzados, hoy: string, m: Metrica): { semanas: Semana[]; omitidas: number } {
  const mapa = new Map<string, Semana>();
  for (const t of filas) {
    if (!t.entrega || !pasaFiltros(t, f, hoy, "semana")) continue;
    const lunes = lunesDe(t.entrega);
    const s = mapa.get(lunes) ?? { lunes, hechas: 0, abiertas: 0, vencidas: 0, total: 0 };
    const v = valorDe(t, m);
    if (t.estado === "hecha") s.hechas += v;
    else if (riesgoEfectivo(t, hoy) === "vencida") s.vencidas += v;
    else s.abiertas += v;
    mapa.set(lunes, s);
  }
  if (f.semana && !mapa.has(f.semana)) mapa.set(f.semana, { lunes: f.semana, hechas: 0, abiertas: 0, vencidas: 0, total: 0 });
  if (!mapa.size) return { semanas: [], omitidas: 0 };

  const claves = [...mapa.keys()].sort();
  let todas: Semana[] = [];
  for (let d = claves[0]; d <= claves[claves.length - 1]; d = sumarDias(d, 7)) todas.push(mapa.get(d) ?? { lunes: d, hechas: 0, abiertas: 0, vencidas: 0, total: 0 });
  for (const s of todas) {
    s.hechas = redondear(s.hechas); s.abiertas = redondear(s.abiertas); s.vencidas = redondear(s.vencidas);
    s.total = redondear(s.hechas + s.abiertas + s.vencidas);
  }
  const omitidas = Math.max(0, todas.length - TOPE_SEMANAS);
  if (omitidas) {
    // La ventana mas cercana a hoy; la semana elegida, si existe, tambien debe entrar.
    const lunesHoy = lunesDe(hoy);
    let i = todas.findIndex((s) => s.lunes >= lunesHoy);
    if (i < 0) i = todas.length - 1;
    let ini = Math.min(Math.max(0, i - Math.floor(TOPE_SEMANAS / 2)), todas.length - TOPE_SEMANAS);
    if (f.semana) {
      const j = todas.findIndex((s) => s.lunes === f.semana);
      if (j >= 0 && (j < ini || j >= ini + TOPE_SEMANAS)) ini = Math.min(Math.max(0, j - Math.floor(TOPE_SEMANAS / 2)), todas.length - TOPE_SEMANAS);
    }
    todas = todas.slice(ini, ini + TOPE_SEMANAS);
  }
  return { semanas: todas, omitidas };
}

export type Porcion = { clave: string; etiqueta: string; valor: number };

/* Porciones con nombre antes de juntar el resto en "Otras": mas de seis no se distinguen en una dona. */
export const TOPE_PORCIONES = 6;
export const CLAVE_OTRAS = "__otras__";

/* Reparto por tipo de cliente o por unidad. "" (sin tipo) cuenta pero no se puede elegir como filtro. */
export function repartoPor(filas: CeldaPanel[], f: FiltrosCruzados, hoy: string, m: Metrica, dim: "tipo" | "unidad", sinValor: string): Porcion[] {
  const mapa = new Map<string, Porcion>();
  for (const t of filas) {
    if (!pasaFiltros(t, f, hoy, dim)) continue;
    const clave = t[dim];
    const p = mapa.get(clave) ?? { clave, etiqueta: clave || sinValor, valor: 0 };
    p.valor += valorDe(t, m);
    mapa.set(clave, p);
  }
  const lista = [...mapa.values()].filter((p) => p.valor > 0 || p.clave === f[dim]);
  for (const p of lista) p.valor = redondear(p.valor);
  lista.sort((a, b) => b.valor - a.valor || a.etiqueta.localeCompare(b.etiqueta, "es"));
  if (lista.length <= TOPE_PORCIONES + 1) return lista;
  // La elegida siempre entra con nombre, aunque no sea de las mayores.
  const elegida = f[dim] ? lista.findIndex((p) => p.clave === f[dim]) : -1;
  const visibles = lista.slice(0, TOPE_PORCIONES);
  if (elegida >= TOPE_PORCIONES) visibles[TOPE_PORCIONES - 1] = lista[elegida];
  const resto = lista.filter((p) => !visibles.includes(p));
  return [...visibles, { clave: CLAVE_OTRAS, etiqueta: `Otras ${resto.length}`, valor: redondear(resto.reduce((a, p) => a + p.valor, 0)) }];
}
