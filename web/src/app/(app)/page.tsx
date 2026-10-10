import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { ArrowLeftRight, ArrowRight, Send } from "lucide-react";
import { exigirUsuario } from "@/lib/auth/session";
import { estados } from "@/lib/catalogo";
import { hoyNegocio } from "@/lib/reloj";
import { CeldaEstado } from "@/components/ui/estado";
import { Esqueleto, Panel, Vacio } from "@/components/ui/panel";
import { cx } from "@/components/ui/cx";
import { asegurarAvisosDeVencimiento } from "@/lib/tareas/avisos";
import { datosInicio, desdeUltimaVisita, type CambioDTO, type CargaPersona } from "@/lib/tareas/inicio";
import type { TareaDTO } from "@/lib/tareas/tipos";
import type { Tono } from "@/components/ui/estado";
import { diaSemana } from "@/lib/tareas/fechas";
import { FranjaInicio, MarcarVisita } from "./_inicio/cliente";
import { PanelInicio } from "./_inicio/panel";
import { datosPanel, MAX_FILAS_PANEL } from "@/lib/panel/datos";
import { leerPeriodo, rangoDePeriodo } from "@/lib/seguimiento/periodo";
import { tieneHerramienta, type UsuarioActual } from "@/lib/auth/session";
import { fechaCorta, haceCuanto, MESES_LARGOS, relativo } from "./tareas/_componentes/cliente";

export const metadata = { title: "Inicio" };

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/* Inicio: lo de hoy primero. El marco sale al instante; los datos llegan por streaming. */
export default function Inicio(props: PageProps<"/">) {
  return (
    <div className="flex flex-col gap-5">
      <Suspense fallback={<EsqueletoInicio />}>
        <Vista searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

/* Dos pestañas: «Hoy» (lo tuyo) y «Panel» (filtros cruzados sobre todo lo que ves). */
async function Vista({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const u = await exigirUsuario();
  const q = await searchParams;
  const panel = q.vista === "panel" && tieneHerramienta(u, "tasks");
  return panel ? <ContenidoPanel u={u} q={q} /> : <Contenido u={u} conPanel={tieneHerramienta(u, "tasks")} />;
}

function Pestanas({ actual }: { actual: "hoy" | "panel" }) {
  const clase = (activa: boolean) => cx(
    "inline-flex h-10 items-center border-b-2 px-4 font-rotulo text-sm font-semibold uppercase tracking-[0.12em] transition-colors duration-[var(--dur)]",
    activa ? "border-texto text-texto" : "border-transparent text-texto-3 hover:text-texto",
  );
  return (
    <nav aria-label="Vistas de Inicio" className="flex border-b border-hilo">
      <Link href="/" aria-current={actual === "hoy" ? "page" : undefined} className={clase(actual === "hoy")}>Hoy</Link>
      <Link href="/?vista=panel" aria-current={actual === "panel" ? "page" : undefined} className={clase(actual === "panel")}>Panel</Link>
    </nav>
  );
}

async function ContenidoPanel({ u, q }: { u: UsuarioActual; q: Record<string, string | string[] | undefined> }) {
  const hoy = hoyNegocio();
  const periodo = leerPeriodo(q.periodo);
  const rango = rangoDePeriodo(periodo, hoy, { desde: q.desde, hasta: q.hasta });
  const d = await datosPanel(u, rango);
  return (
    <>
      <header className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <h1 className="font-rotulo text-2xl font-semibold uppercase tracking-[0.06em]">Panel</h1>
        <p className="text-texto-2">Todo lo que puedes ver, filtrado entre sí</p>
      </header>
      <Pestanas actual="panel" />
      <PanelInicio filas={d.filas} estados={d.estados} hoy={hoy} periodo={periodo} desde={rango.desde} hasta={rango.hasta} truncado={d.truncado} tope={MAX_FILAS_PANEL} />
    </>
  );
}

async function Contenido({ u, conPanel }: { u: UsuarioActual; conPanel: boolean }) {
  const galletas = await cookies();
  const crudo = galletas.get("nl_ultima_visita")?.value;
  const desde = desdeUltimaVisita(crudo);

  await asegurarAvisosDeVencimiento(u.id).catch((e) => console.error("[inicio] avisos de vencimiento", e));
  const [d, cat] = await Promise.all([datosInicio(u, desde), estados()]);
  const tono = (nombre: string): Tono => cat.find((e) => e.nombre === nombre)?.color ?? "neutro";
  const hoy = hoyNegocio();
  const fecha = `${DIAS[diaSemana(hoy)]} ${Number(hoy.slice(8))} de ${MESES_LARGOS[Number(hoy.slice(5, 7)) - 1]}`;

  return (
    <>
      <MarcarVisita />
      <header className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <h1 className="font-rotulo text-2xl font-semibold uppercase tracking-[0.06em]">Hoy</h1>
        <p className="text-texto-2 first-letter:uppercase">{fecha} · {u.username}</p>
        {d.conTareas && (
          <Link href="/tareas" className="ml-auto inline-flex h-10 items-center gap-2 rounded-sm bg-texto px-4 font-rotulo text-sm font-semibold uppercase tracking-[0.1em] text-superficie hover:bg-pizarra active:bg-marca active:text-marca-tinta">
            Abrir mis tareas<ArrowRight aria-hidden className="size-4" />
          </Link>
        )}
      </header>

      {conPanel && <Pestanas actual="hoy" />}

      {d.conTareas && d.contadores && <FranjaInicio contadores={d.contadores} />}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {d.conTareas ? (
            <Panel titulo="Próximas salidas" acciones={<Link href="/tareas" className="text-sm text-texto-2 underline-offset-4 hover:text-texto hover:underline">Ver todas</Link>}>
              <ProximasSalidas tareas={d.proximas} hoy={hoy} tono={tono} />
            </Panel>
          ) : (
            <Panel titulo="Tu trabajo">
              <Vacio titulo="No tienes la gestión de tareas activada">Desde aquí puedes seguir las solicitudes entre unidades. Si necesitas gestionar tareas, pide acceso a un administrador.</Vacio>
            </Panel>
          )}
          {d.carga && <CargaAlcance carga={d.carga} />}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {d.conTareas && (
            <Panel titulo="Cambió desde tu última visita">
              <Cambios cambios={d.cambios} tono={tono} />
            </Panel>
          )}
          <Solicitudes recibidas={d.solicitudes.recibidas} enviadas={d.solicitudes.enviadas} />
        </div>
      </div>
    </>
  );
}

function ProximasSalidas({ tareas, hoy, tono }: { tareas: TareaDTO[]; hoy: string; tono: (n: string) => Tono }) {
  if (!tareas.length) {
    return <Vacio titulo="Nada por entregar">No tienes entregas pendientes desde hoy. Crea una tarea en «Mis tareas» o revisa las solicitudes de tu unidad.</Vacio>;
  }
  return (
    <ul>
      {tareas.map((t) => (
        <li key={t.id} className="border-b border-hilo last:border-b-0">
          <Link href={`/tareas?tarea=${t.id}`} className="grid min-h-11 grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-1.5 hover:bg-superficie-2 md:grid-cols-[88px_minmax(0,1fr)_140px_140px]">
            <span className="flex flex-col leading-tight">
              <span className="font-mono text-sm font-medium cifras">{fechaCorta(t.entrega)}</span>
              <span className="text-xs text-texto-3">{relativo(t.entrega, hoy)}</span>
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{t.titulo}</span>
              {t.cliente && <span className="block truncate text-xs text-texto-3">{t.cliente}{t.bloqueadaPorAbiertas > 0 ? " · bloqueada" : ""}</span>}
            </span>
            <span className="hidden truncate text-sm text-texto-2 md:block">{t.unidad}</span>
            <span className="flex justify-end md:justify-start"><CeldaEstado texto={t.estado} tono={tono(t.estado)} /></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Cambios({ cambios, tono }: { cambios: CambioDTO[]; tono: (n: string) => Tono }) {
  if (!cambios.length) {
    return <Vacio titulo="Todo como lo dejaste">Nadie ha tocado tus tareas ni las que observas desde tu última visita.</Vacio>;
  }
  return (
    <ul>
      {cambios.map((c) => (
        <li key={c.tarea.id} className="border-b border-hilo last:border-b-0">
          <Link href={`/tareas?tarea=${c.tarea.id}`} className="flex flex-col gap-1 px-4 py-2.5 hover:bg-superficie-2">
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">{c.tarea.titulo}</span>
              {/* Encendida: cambio y aun no lo has visto. Se apaga al verla. */}
              <CeldaEstado texto={c.tarea.estado} tono={tono(c.tarea.estado)} encendidaInicial />
            </span>
            <span className="text-xs text-texto-3">
              <span className="font-semibold text-texto-2">{c.quien}</span> {c.que} · <time dateTime={c.cuando} className="font-mono cifras">{haceCuanto(c.cuando)}</time>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Solicitudes({ recibidas, enviadas }: { recibidas: number; enviadas: number }) {
  return (
    <Panel titulo="Solicitudes">
      <ul>
        <li className="border-b border-hilo">
          <Link href="/solicitudes" className="flex min-h-12 items-center gap-3 px-4 hover:bg-superficie-2">
            <ArrowLeftRight aria-hidden className="size-4 text-texto-3" />
            <span className="flex-1">Pendientes para tu unidad</span>
            <span className={cx("font-mono text-xl cifras", recibidas ? "text-aviso" : "text-texto-3")}>{recibidas}</span>
          </Link>
        </li>
        <li>
          <Link href="/solicitudes" className="flex min-h-12 items-center gap-3 px-4 hover:bg-superficie-2">
            <Send aria-hidden className="size-4 text-texto-3" />
            <span className="flex-1">Enviadas por ti, sin respuesta</span>
            <span className="font-mono text-xl text-texto-3 cifras">{enviadas}</span>
          </Link>
        </li>
      </ul>
    </Panel>
  );
}

/* Quien lidera ve su alcance con la misma gramatica: personas por vencidas y abiertas. */
function CargaAlcance({ carga }: { carga: CargaPersona[] }) {
  return (
    <Panel titulo="Carga de tu alcance">
      {!carga.length ? <Vacio titulo="Sin trabajo abierto">Nadie de las unidades que supervisas tiene tareas abiertas.</Vacio> : (
        <div role="table" aria-label="Carga por persona">
          <div role="row" className="grid h-9 grid-cols-[minmax(0,1fr)_72px_72px] items-center gap-3 border-b border-hilo px-4 md:grid-cols-[minmax(0,1fr)_160px_88px_88px]">
            <span role="columnheader" className="rotulo">Persona</span>
            <span role="columnheader" className="rotulo hidden md:block">Unidad</span>
            <span role="columnheader" className="rotulo text-right">Abiertas</span>
            <span role="columnheader" className="rotulo text-right">Vencidas</span>
          </div>
          {carga.map((p) => (
            <Link key={p.id} role="row" href={`/tareas?alcance=unidad&persona=${p.id}`}
              className="grid min-h-11 grid-cols-[minmax(0,1fr)_72px_72px] items-center gap-3 border-b border-hilo px-4 last:border-b-0 hover:bg-superficie-2 md:grid-cols-[minmax(0,1fr)_160px_88px_88px]">
              <span role="cell" className="truncate font-medium">{p.nombre}</span>
              <span role="cell" className="hidden truncate text-sm text-texto-2 md:block">{p.unidad}</span>
              <span role="cell" className="text-right font-mono cifras">{p.abiertas}</span>
              <span role="cell" className={cx("text-right font-mono cifras", p.vencidas ? "font-semibold text-alerta" : "text-texto-3")}>{p.vencidas}</span>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}

function EsqueletoInicio() {
  return (
    <div className="flex flex-col gap-5" aria-busy aria-label="Cargando tu día">
      <Esqueleto className="h-8 w-56" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-hilo bg-hilo md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="bg-superficie p-4"><Esqueleto className="mb-2 h-3 w-20" /><Esqueleto className="h-9 w-12" /></div>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-2 rounded-md border border-hilo bg-superficie p-4">{Array.from({ length: 6 }).map((_, i) => <Esqueleto key={i} className="h-8" />)}</div>
        <div className="space-y-2 rounded-md border border-hilo bg-superficie p-4">{Array.from({ length: 4 }).map((_, i) => <Esqueleto key={i} className="h-10" />)}</div>
      </div>
    </div>
  );
}
