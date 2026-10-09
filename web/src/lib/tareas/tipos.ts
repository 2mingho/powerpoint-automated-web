/*
 * Formas de datos que viajan entre la API de tareas y la interfaz. Sin
 * "server-only": las importan los componentes de cliente para tipar lo que
 * reciben. Los nombres van en espanol; solo `expected_updated_at` se conserva
 * tal cual porque es el contrato de concurrencia que ya usaba Flask.
 */
import type { Tono } from "@/components/ui/estado";

export type EtiquetaDTO = { id: number; nombre: string; color: Tono; unidadId: number | null; unidad: string };

export type TareaDTO = {
  id: number;
  titulo: string;
  descripcion: string;
  cliente: string;
  clienteId: number | null;
  inicio: string; // YYYY-MM-DD o ""
  fin: string;
  direccion: string; // directorate
  solicitadoPor: string;
  presupuesto: string;
  creada: string; // ISO UTC
  entrega: string; // YYYY-MM-DD (dia de negocio)
  estado: string;
  prioridad: string;
  recurrente: boolean;
  recurrencia: string;
  padreId: number | null;
  unidad: string;
  unidadId: number | null;
  visibilidad: string;
  creadorId: number;
  creador: string;
  asignadoId: number;
  asignado: string;
  horas: number | null; // estimated_hours
  revisorId: number | null;
  revisor: string;
  motivoBloqueo: string; // block_reason
  cerradaEl: string; // ISO UTC de done_at, "" si no esta cerrada o se cerro antes de existir la columna
  actualizada: string; // ISO UTC de updated_at: es la version para expected_updated_at
  posicion: number | null;
  vencida: boolean;
  // Contadores de la fila (en bloque, nunca tarea a tarea)
  checklistTotal: number;
  checklistHechos: number;
  comentarios: number;
  observando: boolean;
  etiquetas: EtiquetaDTO[];
  bloqueadaPorAbiertas: number;
  bloqueaA: number;
};

export type EstadoCatalogo = { nombre: string; color: Tono; esInicial: boolean; esFinal: boolean };
export type PrioridadCatalogo = { nombre: string; color: Tono; esDefecto: boolean };

export type PersonaDTO = { id: number; nombre: string; unidad: string; unidadId: number | null };

export type Contadores = { vencidas: number; hoy: number; enCurso: number; bloqueadas: number };

export type Alcance = "mias" | "creadas" | "unidad";
export type FiltroRapido = "" | "vencidas" | "hoy" | "en_curso" | "bloqueadas";

export type Filtros = {
  alcance: Alcance;
  filtro: FiltroRapido;
  q: string;
  prioridad: string;
  persona: string; // id como texto, "" = todas
  cliente: string;
  etiqueta: string; // id como texto
  unidad: string; // id como texto, solo admin
};

export const FILTROS_VACIOS: Filtros = {
  alcance: "mias", filtro: "", q: "", prioridad: "", persona: "", cliente: "", etiqueta: "", unidad: "",
};

export type ObservadorDTO = { usuarioId: number; nombre: string; unidad: string; soyYo: boolean };
export type ItemChecklistDTO = { id: number; texto: string; posicion: number; hecho: boolean; hechoPor: string | null };
export type ComentarioDTO = { id: number; autorId: number; autor: string; texto: string; creado: string; editado: boolean };
export type RelacionDTO = { id: number; titulo: string; estado: string; entrega: string; asignado: string; cerrada: boolean; dependenciaId: number };
export type DependenciasDTO = {
  bloqueadaPor: RelacionDTO[];
  bloquea: RelacionDTO[];
  ocultasBloqueadaPor: number;
  ocultasBloquea: number;
};
export type ActividadDTO = { accion: string; detalle: string; usuario: string; momento: string };

export type DetalleDTO = TareaDTO & {
  puedeEditar: boolean;
  observadores: ObservadorDTO[];
};

export type PlantillaDTO = {
  id: number;
  nombre: string;
  unidadId: number;
  unidad: string;
  creador: string;
  datos: {
    title: string;
    description: string;
    client: string;
    priority: string;
    budget_type: string;
    due_offset_days: number;
    checklist: string[];
  };
};
