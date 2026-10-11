/*
 * Cifras de los gastos de una unidad en un año (logica pura): total, por mes y por categoria contra su presupuesto.
 */
import { estadoDePresupuesto, type Estado } from "./reglas";

export type GastoFila = { id: number; fecha: string; categoria: string; monto: number };
export type PresupuestoFila = { categoria: string; monto: number };

const redondear = (n: number) => Math.round(n * 100) / 100;
const clave = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export type FilaCategoria = { categoria: string; gastado: number; presupuesto: number; restante: number; porcentaje: number | null; estado: Estado };

export type ResumenGastos = {
  anio: number;
  /* Todo lo gastado en el año, con o sin presupuesto. */
  gastado: number;
  /* De lo gastado, lo que cayo en categorias SIN presupuesto: no se mide contra nada. */
  sinPresupuesto: number;
  presupuesto: number;
  /* Lo que queda del presupuesto total (negativo si se paso), midiendo solo lo gastado en categorias con presupuesto; null si no hay presupuesto. */
  restante: number | null;
  porcentaje: number | null;
  estado: Estado;
  porMes: { mes: number; gastado: number }[];
  porCategoria: FilaCategoria[];
};

/*
 * Solo cuentan los gastos del año. Las categorias son las que tienen gasto o presupuesto (sin distinguir mayusculas),
 * de mas gastado a menos. El presupuesto TOTAL es la suma de los presupuestos por categoria y se mide contra lo gastado
 * en ESAS categorias: un gasto en una categoria sin presupuesto cuenta en lo gastado, pero no gasta presupuesto de otra
 * (se informa aparte en `sinPresupuesto`).
 */
export function resumenDeGastos(gastos: readonly GastoFila[], presupuestos: readonly PresupuestoFila[], anio: number): ResumenGastos {
  const delAnio = gastos.filter((g) => g.fecha.startsWith(`${anio}-`));
  const porMes = Array.from({ length: 12 }, (_, i) => ({ mes: i + 1, gastado: 0 }));
  const cats = new Map<string, { categoria: string; gastado: number; presupuesto: number }>();
  const fila = (nombre: string) => {
    const k = clave(nombre);
    let f = cats.get(k);
    if (!f) { f = { categoria: nombre, gastado: 0, presupuesto: 0 }; cats.set(k, f); }
    return f;
  };
  for (const g of delAnio) {
    porMes[Number(g.fecha.slice(5, 7)) - 1].gastado += g.monto;
    fila(g.categoria).gastado += g.monto;
  }
  for (const p of presupuestos) fila(p.categoria).presupuesto += p.monto;

  const porCategoria: FilaCategoria[] = [...cats.values()].map((f) => ({
    categoria: f.categoria, gastado: redondear(f.gastado), presupuesto: redondear(f.presupuesto),
    restante: redondear(f.presupuesto - f.gastado),
    porcentaje: f.presupuesto > 0 ? f.gastado / f.presupuesto : null,
    estado: estadoDePresupuesto(f.gastado, f.presupuesto),
  })).sort((a, b) => b.gastado - a.gastado || a.categoria.localeCompare(b.categoria, "es", { sensitivity: "base" }));

  const gastado = redondear(delAnio.reduce((a, g) => a + g.monto, 0));
  const presupuesto = redondear(presupuestos.reduce((a, p) => a + p.monto, 0));
  const sinPresupuesto = redondear(porCategoria.filter((c) => c.presupuesto <= 0).reduce((a, c) => a + c.gastado, 0));
  const medido = redondear(gastado - sinPresupuesto);
  return {
    anio, gastado, sinPresupuesto, presupuesto,
    restante: presupuesto > 0 ? redondear(presupuesto - medido) : null,
    porcentaje: presupuesto > 0 ? medido / presupuesto : null,
    estado: estadoDePresupuesto(medido, presupuesto),
    porMes: porMes.map((m) => ({ mes: m.mes, gastado: redondear(m.gastado) })),
    porCategoria,
  };
}
