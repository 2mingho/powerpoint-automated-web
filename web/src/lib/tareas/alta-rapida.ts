import { diaSemana, sumarDias } from "./fechas";

/*
 * Alta rapida: una linea de texto con tres atajos opcionales (port exacto de
 * interpretar() en static/js/tasks_bandeja.js).
 *
 *   @persona   asigna (por defecto, a quien escribe)
 *   hoy, mañana, pasado mañana, lunes…domingo   fija la entrega (por defecto, hoy)
 *   !alta      fija la prioridad (por defecto, la de la unidad)
 *
 * Lo que no se reconoce se queda en el titulo: mejor un titulo con una palabra
 * de mas que una tarea con una fecha que nadie pidio. Las palabras de fecha
 * solo cuentan al final ("Preparar la mañana de cine" no es para mañana).
 */

export type PersonaAlta = { id: number; nombre: string };

export type ContextoAlta = {
  hoy: string;
  miId: number;
  personas: PersonaAlta[];
  prioridades: string[];
  prioridadDefecto: string;
};

export type ResultadoAlta = {
  titulo: string;
  asignado: number;
  fecha: string;
  fechaExplicita: boolean;
  prioridad: string;
  problema: string;
};

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

export function normalizar(texto: unknown): string {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function interpretarAlta(texto: string, ctx: ContextoAlta): ResultadoAlta {
  const fichas = String(texto ?? "").trim().split(/\s+/).filter(Boolean);
  const r: ResultadoAlta = {
    titulo: "", asignado: ctx.miId, fecha: ctx.hoy, fechaExplicita: false, prioridad: ctx.prioridadDefecto, problema: "",
  };
  const resto: string[] = [];
  let fechaPuesta = false;

  // Nombres largos primero: "ana maria" debe ganar a "ana".
  const ordenadas = [...ctx.personas].sort((a, b) => b.nombre.length - a.nombre.length);

  // Donde empieza la cola de atajos, buscando desde atras.
  let inicioCola = fichas.length;
  for (let j = fichas.length - 1; j >= 0;) {
    const n = normalizar(fichas[j]);
    let paso = 0;
    for (const p of ordenadas) {
      const partes = normalizar(p.nombre).split(/\s+/);
      const desde = j - partes.length + 1;
      if (partes.length > 1 && desde >= 0 && fichas[desde][0] === "@"
        && [normalizar(fichas[desde]).slice(1), ...fichas.slice(desde + 1, j + 1).map(normalizar)].join(" ") === partes.join(" ")) {
        paso = partes.length;
        break;
      }
    }
    if (!paso && fichas[j].length > 1 && (fichas[j][0] === "@" || fichas[j][0] === "!")) paso = 1;
    if (!paso && n === "manana" && j > 0 && normalizar(fichas[j - 1]) === "pasado") paso = 2;
    if (!paso && (n === "hoy" || n === "manana" || DIAS_SEMANA.includes(n))) paso = 1;
    if (!paso) break;
    j -= paso;
    inicioCola = j + 1;
  }

  for (let i = 0; i < fichas.length; i++) {
    const ficha = fichas[i];
    const norm = normalizar(ficha);

    if (ficha.length > 1 && ficha[0] === "@") {
      let encontrada: PersonaAlta | null = null;
      let consumidas = 1;
      for (const p of ordenadas) {
        const partes = normalizar(p.nombre).split(/\s+/);
        const tramo = [norm.slice(1), ...fichas.slice(i + 1, i + partes.length).map(normalizar)].join(" ");
        if (tramo === partes.join(" ")) {
          encontrada = p;
          consumidas = partes.length;
          break;
        }
      }
      if (!encontrada) {
        const prefijo = norm.slice(1);
        const candidatas = ctx.personas.filter((p) => normalizar(p.nombre).startsWith(prefijo));
        if (candidatas.length === 1) encontrada = candidatas[0];
        else if (candidatas.length > 1) r.problema = `«${ficha}» coincide con varias personas; escribe más letras.`;
        else r.problema = `No hay nadie llamado «${ficha.slice(1)}» en tu unidad.`;
      }
      if (encontrada) {
        r.asignado = encontrada.id;
        i += consumidas - 1;
        continue;
      }
      resto.push(ficha);
      continue;
    }

    if (ficha.length > 1 && ficha[0] === "!") {
      const buscada = norm.slice(1);
      let prio = ctx.prioridades.find((p) => normalizar(p) === buscada);
      if (!prio) {
        const candidatas = ctx.prioridades.filter((p) => normalizar(p).startsWith(buscada));
        if (candidatas.length === 1) prio = candidatas[0];
      }
      if (prio) { r.prioridad = prio; continue; }
      resto.push(ficha);
      continue;
    }

    if (!fechaPuesta && i >= inicioCola) {
      if (norm === "pasado" && normalizar(fichas[i + 1]) === "manana") {
        r.fecha = sumarDias(ctx.hoy, 2);
        fechaPuesta = true;
        i += 1;
        continue;
      }
      if (norm === "hoy") { r.fecha = ctx.hoy; fechaPuesta = true; continue; }
      if (norm === "manana") { r.fecha = sumarDias(ctx.hoy, 1); fechaPuesta = true; continue; }
      const dia = DIAS_SEMANA.indexOf(norm);
      if (dia !== -1) {
        // La proxima vez que llegue ese dia; si es hoy mismo, la semana que viene.
        let faltan = (dia - diaSemana(ctx.hoy) + 7) % 7;
        if (faltan === 0) faltan = 7;
        r.fecha = sumarDias(ctx.hoy, faltan);
        fechaPuesta = true;
        continue;
      }
    }
    resto.push(ficha);
  }

  r.fechaExplicita = fechaPuesta;
  r.titulo = resto.join(" ").trim();
  return r;
}
