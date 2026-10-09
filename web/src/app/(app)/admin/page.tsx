import { Suspense } from "react";
import Link from "next/link";
import * as Iconos from "lucide-react";
import { exigirAdmin } from "@/lib/admin/guardia";
import { actividad, resumenAdmin, type ResumenAdmin } from "@/lib/admin/consultas";
import { fCompacto, fFechaHora, fUsd } from "@/lib/admin/formato";
import { CeldaEstado, type Tono } from "@/components/ui/estado";
import { Esqueleto } from "@/components/ui/panel";
import { Encabezado } from "./_componentes/encabezado";
import { SECCIONES } from "./_componentes/secciones";

export const metadata = { title: "Administración" };

type Estado = { tono: Tono; texto: string; detalle?: string };
type Linea = { conteos: { valor: string; rotulo: string }[]; estado: Estado };

/* Lo que cada fila del indice cuenta y si la seccion pide atencion. */
function lineas(r: ResumenAdmin): Record<string, Linea> {
  const catalogoMal = r.catalogo.finales === 0 || r.catalogo.iniciales !== 1;
  const tasaFallo = r.ia.llamadas30 ? r.ia.fallos30 / r.ia.llamadas30 : 0;
  return {
    "/admin/personas": {
      conteos: [{ valor: fCompacto(r.personas.activas), rotulo: "activas" }, { valor: fCompacto(r.personas.inactivas), rotulo: "inactivas" }, { valor: fCompacto(r.personas.roles), rotulo: "roles" }],
      estado: r.personas.sinUnidad ? { tono: "aviso", texto: "Revisar", detalle: `${r.personas.sinUnidad} activa(s) sin unidad` } : { tono: "bien", texto: "Al día" },
    },
    "/admin/organizacion": {
      conteos: [{ valor: fCompacto(r.organizacion.unidades), rotulo: "unidades" }, { valor: fCompacto(r.organizacion.unidades - r.organizacion.sinLider), rotulo: "con líder" }],
      estado: r.organizacion.sinLider ? { tono: "aviso", texto: "Revisar", detalle: `${r.organizacion.sinLider} unidad(es) sin líder: nadie recibe sus solicitudes` } : { tono: "bien", texto: "Al día" },
    },
    "/admin/clientes": {
      conteos: [{ valor: fCompacto(r.clientes.activos), rotulo: "activos" }, { valor: fCompacto(r.clientes.inactivos), rotulo: "inactivos" }],
      estado: r.clientes.pendientes
        ? { tono: "aviso", texto: "Revisar", detalle: `${r.clientes.pendientes} tarea(s) con un nombre de cliente sin vincular` }
        : { tono: "bien", texto: "Al día" },
    },
    "/admin/catalogo": {
      conteos: [{ valor: String(r.catalogo.estados), rotulo: "estados" }, { valor: String(r.catalogo.prioridades), rotulo: "prioridades" }],
      estado: catalogoMal
        ? { tono: "alerta", texto: "Incompleto", detalle: r.catalogo.finales === 0 ? "Falta un estado final" : "Tiene que haber un único estado inicial" }
        : r.catalogo.defecto !== 1 ? { tono: "aviso", texto: "Revisar", detalle: "Falta la prioridad por defecto" } : { tono: "bien", texto: "Correcto" },
    },
    "/admin/plantillas": {
      conteos: [{ valor: String(r.plantillas.subidas), rotulo: "subidas" }, { valor: String(r.plantillas.repositorio), rotulo: "del repositorio" }],
      estado: r.plantillas.subidas + r.plantillas.repositorio === 0 ? { tono: "alerta", texto: "Sin plantillas", detalle: "No se pueden generar reportes" } : { tono: "bien", texto: "Disponibles" },
    },
    "/admin/ia": {
      conteos: [{ valor: String(r.ia.conexiones), rotulo: "conexiones" }, { valor: fUsd(r.ia.coste30), rotulo: "30 días" }, { valor: fCompacto(r.ia.llamadas30), rotulo: "llamadas" }],
      estado: !r.ia.activa
        ? { tono: "aviso", texto: "Sin activa", detalle: "Los reportes salen sin análisis de IA" }
        : tasaFallo > 0.1 ? { tono: "alerta", texto: "Fallos", detalle: `${Math.round(tasaFallo * 100)} % de llamadas fallidas en 30 días` }
          : { tono: "bien", texto: "Activa", detalle: `${r.ia.activa.name} · ${r.ia.activa.model}` },
    },
    "/admin/actividad": {
      conteos: [{ valor: fCompacto(r.actividad.ultimas24), rotulo: "en 24 h" }],
      estado: { tono: "neutro", texto: "Registro", detalle: r.actividad.ultima ? `Último: ${r.actividad.ultima.accion} · ${r.actividad.ultima.quien}` : "Sin movimientos" },
    },
  };
}

function Icono({ nombre }: { nombre: string }) {
  const C = (Iconos as unknown as Record<string, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>>)[nombre];
  return C ? <C className="size-4" aria-hidden /> : null;
}

async function Indice() {
  await exigirAdmin();
  const [r, recientes] = await Promise.all([resumenAdmin(), actividad({ usuario: null, accion: "", desde: "", hasta: "", pagina: 1 })]);
  const l = lineas(r);
  const atencion = Object.values(l).filter((x) => x.estado.tono === "alerta" || x.estado.tono === "aviso").length;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section aria-labelledby="indice" className="rounded-md border border-hilo bg-superficie shadow-1">
        <header className="flex min-h-12 items-center justify-between border-b border-hilo px-4">
          <h2 id="indice" className="font-rotulo text-sm font-semibold uppercase tracking-[0.14em]">Secciones</h2>
          <p className="text-sm text-texto-2">
            {atencion ? <><span className="font-mono cifras text-texto">{atencion}</span> piden atención</> : "Todo en orden"}
          </p>
        </header>
        <ol className="divide-y divide-hilo">
          {SECCIONES.map((s) => {
            const x = l[s.href];
            return (
              <li key={s.href}>
                <Link href={s.href} className="group grid min-h-16 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors duration-[var(--dur)] hover:bg-superficie-2 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-rotulo text-lg font-semibold uppercase tracking-[0.06em] text-texto"><Icono nombre={s.icono} />{s.rotulo}</p>
                    <p className="truncate text-sm text-texto-3">{s.descripcion}</p>
                  </div>
                  <dl className="order-3 col-span-2 flex flex-wrap gap-x-4 gap-y-1 md:order-none md:col-span-1">
                    {x.conteos.map((c) => (
                      <div key={c.rotulo} className="flex items-baseline gap-1.5 whitespace-nowrap">
                        <dt className="sr-only">{c.rotulo}</dt>
                        <dd className="font-mono text-base font-medium text-texto cifras">{c.valor}</dd>
                        <span aria-hidden className="text-xs text-texto-3">{c.rotulo}</span>
                      </div>
                    ))}
                  </dl>
                  <div className="order-4 col-span-2 flex min-w-0 items-center gap-2 md:order-none md:col-span-1">
                    <CeldaEstado texto={x.estado.texto} tono={x.estado.tono} />
                    {x.estado.detalle && <span className="truncate text-sm text-texto-2">{x.estado.detalle}</span>}
                  </div>
                  <Iconos.ChevronRight className="size-4 text-texto-3 transition-transform duration-[var(--dur)] group-hover:translate-x-0.5" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="recientes" className="rounded-md border border-hilo bg-superficie shadow-1">
        <header className="flex min-h-12 items-center justify-between border-b border-hilo px-4">
          <h2 id="recientes" className="font-rotulo text-sm font-semibold uppercase tracking-[0.14em]">Últimos movimientos</h2>
          <Link href="/admin/actividad" className="text-sm text-texto-2 underline-offset-4 hover:text-texto hover:underline">Ver todo</Link>
        </header>
        {recientes.filas.length === 0 ? (
          <p className="px-4 py-6 text-texto-2">Aún no hay actividad registrada.</p>
        ) : (
          <ol className="divide-y divide-hilo">
            {recientes.filas.slice(0, 9).map((a) => (
              <li key={a.id} className="px-4 py-2.5">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-mono text-xs text-texto">{a.accion}</span>
                  <time className="shrink-0 font-mono text-xs text-texto-3">{fFechaHora(a.cuando)}</time>
                </p>
                <p className="truncate text-sm text-texto-2"><span className="text-texto">{a.usuario}</span> · {a.detalle}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function EsqueletoIndice() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]" aria-busy="true" aria-label="Cargando">
      <div className="rounded-md border border-hilo bg-superficie">
        {SECCIONES.map((s) => (
          <div key={s.href} className="flex min-h-16 items-center gap-6 border-b border-hilo px-4 last:border-0">
            <Esqueleto className="h-5 w-40" /><Esqueleto className="w-24" /><Esqueleto className="h-6 w-28" />
          </div>
        ))}
      </div>
      <div className="h-80 rounded-md border border-hilo bg-superficie p-4"><Esqueleto className="w-full" /></div>
    </div>
  );
}

export default function PortadaAdmin() {
  return (
    <>
      <Encabezado titulo="Administración">Lo que hay que configurar para que el resto de la aplicación funcione, y si algo pide atención.</Encabezado>
      <Suspense fallback={<EsqueletoIndice />}><Indice /></Suspense>
    </>
  );
}
