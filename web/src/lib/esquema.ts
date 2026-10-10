/*
 * Alembic (Flask) es el dueño del esquema; esta aplicacion solo lo lee. HISTORIAL son
 * las revisiones de Alembic hasta la que espera ESTA version del codigo (la ultima), en
 * orden. /healthz compara con la revision que hay en la base:
 *   - la ultima: al dia;
 *   - una anterior de la lista: el esquema esta ATRASADO (falta migrar): esta version no
 *     debe recibir trafico, porque consultaria tablas o columnas que aun no existen;
 *   - una desconocida: la base esta por delante (otra version ya migro), y como las
 *     migraciones son aditivas se sigue sirviendo;
 *   - ninguna (tabla vacia): sin migrar.
 * Al añadir una migracion, añadela aqui: una prueba compara esta lista con migrations/versions.
 */
export const HISTORIAL = [
  "0001_baseline", "0002_tasks_collab", "0004_jerarquia_de_mando", "0006_plantillas_pptx", "0007_catalogo_estados",
  "0008_proveedores_ia", "0009_consumo_ia", "0010_solicitud_sin_unidad", "0011_tour_de_bienvenida", "0012_reportes_persistentes",
  "0013_indices_de_consulta", "0014_tablero_etiquetas", "0015_seguimiento", "0016_clientes", "0017_finanzas_permisos", "0018_contratos_metas",
] as const;

export const REVISION_ESPERADA = HISTORIAL[HISTORIAL.length - 1];

export type EstadoEsquema = "al_dia" | "por_delante" | "atrasado" | "sin_migrar";

export function estadoDelEsquema(version: string | null | undefined): EstadoEsquema {
  if (!version) return "sin_migrar";
  const i = (HISTORIAL as readonly string[]).indexOf(version);
  if (i === HISTORIAL.length - 1) return "al_dia";
  return i === -1 ? "por_delante" : "atrasado";
}
