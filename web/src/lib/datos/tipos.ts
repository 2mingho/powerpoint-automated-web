/* Formas que devuelve el servicio de analisis (blueprints/interno.py). */

export type EstadoTrabajo = "en_cola" | "en_curso" | "hecho" | "fallido" | "cancelado";

export type Trabajo<R = unknown> = {
  id: string;
  tipo: "reporte" | "insights" | "clasificacion" | "union" | "analisis";
  estado: EstadoTrabajo;
  fase: string;
  progreso: number | null;
  mensaje: string | null;
  error: string | null;
  detalle: string[];
  resultado: R | null;
};

export type Descarga = { tipo: "classified" | "union" | "csv_summary"; id: string; nombre: string };

export type Deteccion = {
  columnas: string[];
  vista_previa: Record<string, string>[];
  codificacion: string | null;
  separador: string | null;
  tipo: "csv" | "xlsx" | "xls";
};

/* ── Reportes ── */

export type ReporteResumen = {
  token: string;
  titulo: string;
  cliente: string;
  periodo: string | null;
  menciones: number | null;
  creado: string | null;
  actualizado: string | null;
  estado_ia: string | null;
  fuente: string;
  disponible: boolean;
};

export type PrevisualizacionReporte = {
  archivos: { nombre: string; widget: string | null; etiqueta: string | null; hoja: string | null; error: string | null }[];
  faltan: { clave: string; etiqueta: string; aporta: string }[];
};

export type ContextoReporte = {
  meta: { client_name: string; date_generated: string };
  kpis: {
    total_mentions: number;
    mentions_change_pct: number | null;
    estimated_reach: number;
    estimated_reach_fmt: string;
    reach_change_pct: number | null;
    mentions_prensa: number;
    mentions_redes: number;
    mentions_by_source?: Record<string, number>;
    source_labels?: Record<string, string>;
    unique_authors?: number | null;
  };
  charts: {
    evolution: { labels: string[]; mentions: number[]; mentions_prev?: number[] };
    reach_evolution?: { labels: string[]; reach: number[]; reach_prev?: number[] };
    sentiment: { key: string; label: string; value: number }[];
    sentiment_by_source: { source: string; positive: number; neutral: number; negative: number; not_rated?: number }[];
    emotions: { key: string; label: string; value: number }[];
  };
  content: {
    clusters: { summary: string; mentions: number }[];
    keywords: { keyword: string; mentions: number }[];
    hashtags: { hashtag: string; mentions: number }[];
    top_authors: { author: string; posts: number; followers: number; platform?: string }[];
  };
  insights: Record<string, string>;
  warnings: string[];
};

export type DetalleReporte = {
  token: string;
  titulo: string | null;
  contexto: ContextoReporte;
  vista: { pct_redes: number; pct_prensa: number; top_authors: ContextoReporte["content"]["top_authors"] };
  puede_editar: boolean;
  es_propio: boolean;
  estado_ia: string | null;
  fuente: string;
  error_ia: string | null;
  editados: string[];
  creado: string | null;
};

export type ResultadoReporte = { token: string; titulo: string; avisos: number; estado_ia: string };

/* ── Clasificacion ── */

export type StatsClasificacion = Record<string, { total: number; tematicas: Record<string, number> }>;

export type ResultadoClasificacion = {
  descarga: Descarga;
  stats: StatsClasificacion;
  total_filas: number;
  clasificadas: number;
  sin_clasificar: number;
  etiqueta_defecto: string;
  insights: { top_category: string; top_count: number };
};

export type ReglaCategoria = { category: string; tematicas: { name: string; keywords: string[] }[] };

/* ── Union ── */

export type ResultadoUnion = {
  descarga: Descarga;
  total_filas: number;
  total_columnas: number;
  archivos_unidos: number;
  columnas: string[];
  filas_por_archivo: { nombre: string; filas: number }[];
};

/* ── Analisis ── */

export type ResultadoAnalisis = {
  descarga: Descarga;
  nombre_original: string;
  file_info: { file_size_mb: number; encoding_used: string; separator_used: string };
  general: {
    row_count: number; column_count: number; columns: string[]; memory_usage_mb: number;
    dtypes: Record<string, string>; numeric_columns: string[]; categorical_columns: string[]; datetime_columns: string[];
  };
  missing: {
    total_missing_cells: number; total_missing_percentage: number;
    columns_with_missing: { column: string; missing_count: number; missing_percentage: number | null }[];
    columns_fully_complete: string[];
  };
  numeric: { columns: string[]; stats: { column: string; count: number; mean: number | null; median: number | null; std: number | null; min: number | null; max: number | null; q25: number | null; q75: number | null }[] };
  categorical: { columns: string[]; stats: { column: string; unique_count: number; most_common: string | null; most_common_count: number; top_5_values: Record<string, number> }[] };
  correlation: { columns: string[]; matrix: { column: string; correlations: Record<string, number | null> }[]; note?: string };
  distributions: {
    numeric: { column: string; bins: (number | null)[]; counts: number[] }[];
    categorical: { column: string; labels: string[]; counts: number[] }[];
  };
  insights: string[];
};
