import type { TareaFiltrable } from "@/lib/seguimiento/filtros";
import type { TareaSeg } from "@/lib/seguimiento/riesgo";

/*
 * El panel de Inicio no recibe tareas: recibe CELDAS. Una celda es una combinacion de
 * (unidad, cliente, persona, tipo de cliente, tipo de contrato, semana de entrega, estado, riesgo,
 * puntualidad) con cuantas tareas y cuantas horas suman. La base las agrupa, asi que el tamano de
 * lo que viaja depende de cuantas combinaciones distintas hay, no de cuantas tareas: con decenas
 * de miles de tareas no se manda un titulo ni una fecha suelta. Los filtros cruzados siguen
 * corriendo en el navegador, al instante, sobre las celdas.
 *
 * Las claves de filtro (unidad, cliente, persona, tipo, contrato) son texto para que pasaFiltros
 * las compare tal cual; los nombres para mostrar van aparte. Sin cliente o sin tipo la clave es ""
 * y se rotula "Sin cliente" / "Sin tipo".
 */
export type CeldaPanel = TareaFiltrable & {
  /* Tareas que agrupa la celda. */
  n: number;
  /* En una celda `horas` es el TOTAL de horas de sus tareas (las sin estimar cuentan con las de por defecto). */
  personaNombre: string;
  /* Entre las cerradas en los ultimos 30 dias: "a" llego a su fecha, "t" despues; "" no cuenta para la puntualidad. */
  tiempo: "" | "a" | "t";
};

/*
 * Una tarea del detalle: la que se ve en la tabla. Estas si viajan sueltas, pero solo las de la
 * pagina que se despliega y siempre con los filtros aplicados en el servidor.
 */
export type FilaDetalle = TareaSeg & {
  id: number;
  titulo: string;
  /* Nombre del estado del catalogo (para el color y el rotulo). */
  estadoNombre: string;
  /* Horas estimadas, o las de por defecto si no hay; `estimada` dice cual. */
  estimada: boolean;
  personaNombre: string;
  unidad: string;
  cliente: string;
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
