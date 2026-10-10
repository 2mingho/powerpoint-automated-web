import "server-only";
import { db } from "@/lib/db";
import type { UsuarioActual } from "@/lib/auth/session";
import { hoyNegocio } from "@/lib/reloj";
import { unidadesEditables, unidadesVisiblesFinanzas } from "./permisos";
import { listarContratos, metasDelAnio, type ContratoDTO, type MetaDTO } from "./servicio";

/*
 * Todo lo que necesita la vista Ingresos de un año, acotado a lo que la persona
 * ve. Nada fuera de sus unidades llega al navegador: ni contratos, ni metas, ni
 * nombres de unidad.
 */
export type DatosIngresos = {
  anio: number;
  hoy: string;
  contratos: ContratoDTO[];
  truncado: boolean;
  direccion: MetaDTO | null;
  /* La meta total por defecto: la suma de las unidades que ve. */
  sumaUnidades: number;
  /* Unidades visibles con su meta del año. */
  unidades: MetaDTO[];
  /* A donde puede crear contratos (unidades editables) y quienes pueden ser el cliente. */
  puedeCrearEn: { id: number; nombre: string }[];
  clientes: { id: number; nombre: string }[];
  /* Todas las unidades, para "Unidad que asigna" (solo nombres; no revela contratos). */
  todasLasUnidades: { id: number; nombre: string }[];
};

export async function datosIngresos(u: Pick<UsuarioActual, "id" | "isAdmin">, anio: number): Promise<DatosIngresos> {
  const [lista, metas, editables, visibles, clientes, todas] = await Promise.all([
    listarContratos(u, { anio, unidadId: null, clienteId: null, tipo: "" }),
    metasDelAnio(u, anio),
    unidadesEditables(u, "contracts"),
    unidadesVisiblesFinanzas(u),
    db.clients.findMany({ where: { is_active: true }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 5000 }),
    db.areas.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const nombres = new Map(todas.map((a) => [a.id, a.name]));
  return {
    anio,
    hoy: hoyNegocio(),
    contratos: lista.contratos,
    truncado: lista.truncado,
    direccion: metas.direccion,
    sumaUnidades: metas.sumaUnidades,
    unidades: metas.unidades,
    puedeCrearEn: editables.filter((id) => visibles.includes(id) && nombres.has(id)).map((id) => ({ id, nombre: nombres.get(id)! })),
    // Elegir cliente para un contrato nuevo pide el catalogo; quien solo mira ve unicamente los de sus contratos.
    clientes: editables.some((id) => visibles.includes(id))
      ? clientes.map((c) => ({ id: c.id, nombre: c.name }))
      : [...new Map(lista.contratos.map((c) => [c.cliente.id, { id: c.cliente.id, nombre: c.cliente.nombre }])).values()],
    // Solo quien puede crear contratos necesita elegir la unidad que asigna; el resto no recibe nombres de unidades que no ve.
    todasLasUnidades: editables.some((id) => visibles.includes(id)) ? todas.map((a) => ({ id: a.id, nombre: a.name })) : [],
  };
}
