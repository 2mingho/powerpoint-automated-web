"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EstadoProceso, FaseProceso } from "@/components/ui/proceso";
import type { Trabajo } from "@/lib/datos/tipos";

/*
 * Un proceso de datos visto desde el navegador: la subida (con su progreso
 * real, byte a byte) y despues el trabajo del servicio, consultado cada
 * segundo hasta que termina. Una sola maquina para las cuatro herramientas.
 */

export type Situacion = "inactivo" | "subiendo" | "procesando" | "hecho" | "fallido" | "cancelado";

export const FASE_SUBIDA: FaseProceso = { clave: "subida", rotulo: "Subir archivos" };

export const FASES = {
  reporte: [
    FASE_SUBIDA,
    { clave: "carga", rotulo: "Leer los widgets" },
    { clave: "limpieza", rotulo: "Normalizar datos" },
    { clave: "calculo", rotulo: "Calcular indicadores" },
    { clave: "graficos", rotulo: "Preparar gráficos" },
    { clave: "ia", rotulo: "Textos e IA" },
    { clave: "guardado", rotulo: "Guardar el reporte" },
  ],
  clasificacion: [
    FASE_SUBIDA,
    { clave: "carga", rotulo: "Leer y detectar codificación" },
    { clave: "limpieza", rotulo: "Comprobar columnas" },
    { clave: "calculo", rotulo: "Clasificar menciones" },
    { clave: "graficos", rotulo: "Resumir categorías" },
    { clave: "guardado", rotulo: "Preparar la descarga" },
  ],
  union: [
    FASE_SUBIDA,
    { clave: "carga", rotulo: "Leer los archivos" },
    { clave: "limpieza", rotulo: "Alinear columnas" },
    { clave: "calculo", rotulo: "Unir filas" },
    { clave: "guardado", rotulo: "Escribir el resultado" },
  ],
  analisis: [
    FASE_SUBIDA,
    { clave: "carga", rotulo: "Detectar formato" },
    { clave: "limpieza", rotulo: "Leer y revisar columnas" },
    { clave: "calculo", rotulo: "Estadísticas" },
    { clave: "graficos", rotulo: "Distribuciones" },
    { clave: "guardado", rotulo: "Resumen descargable" },
  ],
  insights: [
    { clave: "ia", rotulo: "Redactar con IA" },
    { clave: "guardado", rotulo: "Guardar los textos" },
  ],
} satisfies Record<string, FaseProceso[]>;

export type RespuestaSubida = { status: number; datos: Record<string, unknown> };

/* POST multipart con progreso de subida real (fetch no lo da; XHR si). */
export function subirConProgreso(url: string, datos: FormData, alAvanzar: (pct: number) => void, senal?: AbortSignal) {
  return new Promise<RespuestaSubida>((resolver, rechazar) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) alAvanzar((e.loaded / e.total) * 100); };
    xhr.onload = () => resolver({ status: xhr.status, datos: (xhr.response ?? {}) as Record<string, unknown> });
    xhr.onerror = () => rechazar(new Error("Se perdió la conexión mientras se subía el archivo."));
    xhr.onabort = () => rechazar(new DOMException("cancelado", "AbortError"));
    senal?.addEventListener("abort", () => xhr.abort());
    xhr.send(datos);
  });
}

/* Llamada JSON con el { error } en espanol del API. */
export async function pedirJson<T>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch {
    throw new Error("Sin conexión. Comprueba la red e inténtalo de nuevo.");
  }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof datos.error === "string" ? datos.error : "No se pudo completar la operación.");
  return datos as T;
}

type Estado<R> = {
  situacion: Situacion;
  proceso: EstadoProceso & { detalle?: string[] };
  resultado: R | null;
  trabajoId: string | null;
  enCola: boolean;
};

const INICIAL: Estado<never> = {
  situacion: "inactivo", proceso: { fase: "subida" }, resultado: null, trabajoId: null, enCola: false,
};

const SONDEO_MS = 1000;
const FALLOS_MAXIMOS = 20;

export function useProcesoDatos<R>({ alTerminar }: { alTerminar?: (r: R) => void } = {}) {
  const [estado, setEstado] = useState<Estado<R>>(INICIAL);
  const abortar = useRef<AbortController | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vivo = useRef(true);
  const alTerminarRef = useRef(alTerminar);
  useEffect(() => { alTerminarRef.current = alTerminar; }, [alTerminar]);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
      if (temporizador.current) clearTimeout(temporizador.current);
      abortar.current?.abort();
    };
  }, []);

  const sondear = useCallback((id: string, fallos = 0) => {
    temporizador.current = setTimeout(async () => {
      if (!vivo.current) return;
      try {
        const r = await fetch(`/api/datos/trabajos/${id}`, { cache: "no-store" });
        if (r.status === 404) {
          setEstado((e) => ({ ...e, situacion: "fallido", proceso: { ...e.proceso, error: "El proceso ya no existe: caducó o se reinició el servicio." } }));
          return;
        }
        if (!r.ok) throw new Error(String(r.status));
        const t = (await r.json()) as Trabajo<R>;
        if (!vivo.current) return;
        const proceso = {
          fase: t.fase === "cola" ? "carga" : t.fase,
          progreso: t.progreso ?? undefined,
          mensaje: t.mensaje ?? undefined,
          error: t.estado === "fallido" ? (t.error ?? "El proceso falló.") : t.estado === "cancelado" ? "Cancelado." : undefined,
          detalle: t.detalle,
        };
        if (t.estado === "hecho") {
          setEstado((e) => ({ ...e, situacion: "hecho", proceso, resultado: t.resultado, enCola: false }));
          if (t.resultado) alTerminarRef.current?.(t.resultado);
          return;
        }
        if (t.estado === "fallido" || t.estado === "cancelado") {
          setEstado((e) => ({ ...e, situacion: t.estado as Situacion, proceso, enCola: false }));
          return;
        }
        setEstado((e) => ({ ...e, situacion: "procesando", proceso, enCola: t.estado === "en_cola" }));
        sondear(id, 0);
      } catch {
        if (fallos + 1 >= FALLOS_MAXIMOS) {
          setEstado((e) => ({ ...e, situacion: "fallido", proceso: { ...e.proceso, error: "Se perdió el contacto con el servicio. El proceso puede seguir: vuelve a intentarlo en un momento." } }));
          return;
        }
        setEstado((e) => ({ ...e, proceso: { ...e.proceso, mensaje: "Sin respuesta del servidor, reintentando…" } }));
        sondear(id, fallos + 1);
      }
    }, SONDEO_MS);
  }, []);

  /* Sube el formulario y sigue el trabajo que devuelva el servicio. */
  const lanzar = useCallback(async (url: string, datos: FormData) => {
    abortar.current?.abort();
    if (temporizador.current) clearTimeout(temporizador.current);
    const control = new AbortController();
    abortar.current = control;
    setEstado({ ...INICIAL, situacion: "subiendo", proceso: { fase: "subida", progreso: 0, mensaje: "Enviando al servidor" } });
    try {
      const r = await subirConProgreso(url, datos, (pct) => {
        setEstado((e) => ({ ...e, proceso: { fase: "subida", progreso: pct, mensaje: pct >= 100 ? "Recibido, esperando turno" : "Enviando al servidor" } }));
      }, control.signal);
      if (r.status !== 202 || typeof r.datos.trabajo !== "string") {
        const error = typeof r.datos.error === "string" ? r.datos.error : "No se pudo iniciar el proceso.";
        setEstado((e) => ({ ...e, situacion: "fallido", proceso: { fase: "subida", error } }));
        return;
      }
      const id = r.datos.trabajo;
      setEstado((e) => ({ ...e, trabajoId: id, situacion: "procesando", proceso: { fase: "carga", mensaje: "En cola" }, enCola: true }));
      sondear(id);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setEstado((e) => ({ ...e, situacion: "cancelado", proceso: { fase: "subida", error: "Subida cancelada." } }));
        return;
      }
      setEstado((e) => ({ ...e, situacion: "fallido", proceso: { fase: "subida", error: err instanceof Error ? err.message : "Error de red." } }));
    }
  }, [sondear]);

  /* Sigue un trabajo ya creado por otra via (p. ej. textos de IA). */
  const seguir = useCallback((id: string, faseInicial: string) => {
    if (temporizador.current) clearTimeout(temporizador.current);
    setEstado({ ...INICIAL, trabajoId: id, situacion: "procesando", proceso: { fase: faseInicial, mensaje: "En cola" }, enCola: true });
    sondear(id);
  }, [sondear]);

  const cancelar = useCallback(async () => {
    if (estado.situacion === "subiendo") { abortar.current?.abort(); return; }
    if (estado.trabajoId && estado.situacion === "procesando") {
      setEstado((e) => ({ ...e, proceso: { ...e.proceso, mensaje: "Cancelando…" } }));
      try { await fetch(`/api/datos/trabajos/${estado.trabajoId}/cancelar`, { method: "POST" }); } catch { /* el sondeo lo dira */ }
    }
  }, [estado.situacion, estado.trabajoId]);

  const reiniciar = useCallback(() => {
    if (temporizador.current) clearTimeout(temporizador.current);
    abortar.current?.abort();
    setEstado(INICIAL);
  }, []);

  return { ...estado, lanzar, seguir, cancelar, reiniciar };
}
