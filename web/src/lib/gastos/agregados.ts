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
  gastado: number;
  presupuesto: number;
  /* Lo que queda del presupuesto total (negativo si se paso); null si no hay presupuesto. */
  restante: number | null;
  porcentaje: number | null;
  estado: Estado;
  porMes: { mes: number; gastado: number }[];
  porCategoria: FilaCategoria[];
};

/*
 * Solo cuentan los gastos del año. Las categorias son las que tienen gasto o presupuesto (sin distinguir mayusculas),
 * de mas gastado a menos. El presupuesto TOTAL es la suma de los presupuestos por categoria: un gasto en una categoria
 * sin presupuesto cuenta en lo gastado pero no mueve el presupuesto.
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
  return {
    anio, gastado, presupuesto,
    restante: presupuesto > 0 ? redondear(presupuesto - gastado) : null,
    porcentaje: presupuesto > 0 ? gastado / presupuesto : null,
    estado: estadoDePresupuesto(gastado, presupuesto),
    porMes: porMes.map((m) => ({ mes: m.mes, gastado: redondear(m.gastado) })),
    porCategoria,
  };
}
