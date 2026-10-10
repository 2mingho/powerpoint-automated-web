import type { TareaFiltrable } from "@/lib/seguimiento/filtros";

/*
 * Una tarea del panel de Inicio, ya reducida a lo que se cuenta y se filtra.
 * Las claves de filtro (unidad, cliente, persona, tipo) son texto para que
 * pasaFiltros las compare tal cual; los nombres para mostrar van aparte.
 * Sin cliente o sin tipo la clave es "" y se rotula "Sin cliente" / "Sin tipo".
 */
export type FilaPanel = TareaFiltrable & {
  id: number;
  titulo: string;
  /* Nombre del estado del catalogo (para el color y el rotulo). */
  estadoNombre: string;
  /* Horas estimadas, o las de por defecto si no hay; `estimada` dice cual. */
  estimada: boolean;
  personaNombre: string;
  clienteId: number | null;
};

export type Metrica = "n" | "h";

export type EstadoPanel = { nombre: string; tono: string };

export const GRUPOS_ESTADO = [
  { valor: "pendiente", rotulo: "Pendiente" },
  { valor: "en_curso", rotulo: "En curso" },
  { valor: "revision", rotulo: "En revisión" },
  { valor: "bloqueada", rotulo: "Bloqueada" },
  { valor: "hecha", rotulo: "Completada" },
] as const;
