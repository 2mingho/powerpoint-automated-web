/*
 * Limites de subida por herramienta. Los mismos que aplica el servicio Python
 * (LIMITES y EXTENSIONES en blueprints/interno.py): si cambias uno, cambia el
 * otro. Aqui sirven para avisar al soltar el archivo, antes de subir nada.
 */
const MB = 1024 * 1024;

export type HerramientaDatos = "reports" | "classification" | "file_merge" | "csv_analysis";

export const LIMITES: Record<HerramientaDatos, number> = {
  reports: 60 * MB,
  classification: 150 * MB,
  file_merge: 200 * MB,
  csv_analysis: 150 * MB,
};

export const EXTENSIONES: Record<HerramientaDatos, string[]> = {
  reports: ["xlsx"],
  classification: ["csv", "txt", "xlsx", "xls"],
  file_merge: ["csv", "txt", "xlsx", "xls"],
  csv_analysis: ["csv", "txt"],
};

/* Para la vista previa de un CSV basta su principio. */
export const BYTES_VISTA_PREVIA = 2 * MB;

export function extension(nombre: string) {
  const i = nombre.lastIndexOf(".");
  return i >= 0 ? nombre.slice(i + 1).toLowerCase() : "";
}

export function tamano(bytes: number) {
  if (bytes >= MB) return `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/* Error en espanol para un archivo, o null si vale. `acumulado` suma lo ya elegido. */
export function validarArchivo(h: HerramientaDatos, archivo: { name: string; size: number }, acumulado = 0): string | null {
  const ext = extension(archivo.name);
  if (!EXTENSIONES[h].includes(ext)) {
    return `«${archivo.name}» no es un tipo admitido (${EXTENSIONES[h].map((e) => "." + e).join(", ")}).`;
  }
  if (archivo.size === 0) return `«${archivo.name}» está vacío.`;
  if (archivo.size + acumulado > LIMITES[h]) {
    return `«${archivo.name}» supera el máximo de ${tamano(LIMITES[h])}${acumulado ? " sumando los demás archivos" : ""}.`;
  }
  return null;
}

export const CODIFICACIONES = [
  { valor: "", rotulo: "Detectar sola" },
  { valor: "utf-8", rotulo: "UTF-8" },
  { valor: "utf-16", rotulo: "UTF-16 (Meltwater)" },
  { valor: "latin-1", rotulo: "Latin-1 (ISO-8859-1)" },
  { valor: "cp1252", rotulo: "Windows (CP-1252)" },
];

export const SEPARADORES = [
  { valor: "", rotulo: "Detectar solo" },
  { valor: ",", rotulo: "Coma ( , )" },
  { valor: ";", rotulo: "Punto y coma ( ; )" },
  { valor: "\\t", rotulo: "Tabulador" },
  { valor: "|", rotulo: "Barra vertical ( | )" },
];

export function nombreSeparador(sep: string | null | undefined) {
  if (!sep) return "—";
  if (sep === "\t" || sep === "\\t") return "tabulador";
  if (sep === ",") return "coma";
  if (sep === ";") return "punto y coma";
  if (sep === "|") return "barra vertical";
  return sep;
}
