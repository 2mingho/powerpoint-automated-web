"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Check, FileDown, Link2, Plus, Sparkles } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { cx } from "@/components/ui/cx";
import { ProcesoSalida } from "@/components/ui/proceso";
import { useAvisos } from "@/components/ui/avisos";
import type { DetalleReporte } from "@/lib/datos/tipos";
import { Apiladas100, Ranking, Reparto, Tendencia, type ItemRanking } from "../../_datos/graficos";
import { FASES, pedirJson, useProcesoDatos } from "../../_datos/proceso";
import "./impresion.css";

type Guardado = "quieto" | "pendiente" | "guardando" | "guardado" | "error";

const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString("es-DO"));

const SENTIMIENTO: Record<string, { color: string; orden: number }> = {
  Positive: { color: "var(--tono-bien)", orden: 0 },
  Neutral: { color: "var(--tono-neutro)", orden: 1 },
  Negative: { color: "var(--tono-alerta)", orden: 2 },
  "Not Rated": { color: "var(--hilo-fuerte)", orden: 3 },
};

/* Texto retocable en su sitio. Solo el dueno (o admin) puede: para los demas es texto. */
function Editable({ slot, valor, puede, como = "p", className, alCambiar }: {
  slot: string; valor: string; puede: boolean; como?: "h1" | "h2" | "p"; className?: string;
  alCambiar: (slot: string, texto: string, ahora?: boolean) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  // El contenido inicial va una vez; despues lo lleva el navegador. Si llega
  // un texto nuevo (la IA) y nadie esta escribiendo ahi, se sustituye.
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current && ref.current.textContent !== valor) ref.current.textContent = valor;
  }, [valor]);
  const Tag = como;
  if (!valor && !puede) return null;
  return (
    <Tag
      ref={ref as never}
      data-slot={slot}
      contentEditable={puede}
      suppressContentEditableWarning
      spellCheck={puede}
      onInput={(e) => alCambiar(slot, (e.currentTarget as HTMLElement).textContent ?? "")}
      onBlur={(e) => alCambiar(slot, (e.currentTarget as HTMLElement).textContent ?? "", true)}
      aria-label={puede ? `Editar: ${slot.replace(/_/g, " ")}` : undefined}
      className={cx(
        className,
        puede && "-mx-1.5 rounded-sm px-1.5 outline-none transition-[background-color,box-shadow] duration-[var(--dur)] hover:bg-superficie-2 focus:bg-superficie-2 focus:shadow-[inset_0_-2px_0_var(--texto)]",
        puede && !valor && "empty:before:text-texto-3 empty:before:content-['Escribe_aquí…']",
      )}
    />
  );
}

function Delta({ pct }: { pct: number | null | undefined }) {
  if (pct == null) return null;
  const sube = pct >= 0;
  const I = sube ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 font-mono text-xs text-texto-2 cifras">
      <I className="size-3.5" aria-hidden />{Math.abs(pct).toLocaleString("es-DO")}%
      <span className="sr-only">{sube ? "más" : "menos"} que el periodo anterior</span>
    </span>
  );
}

function Seccion({ pregunta, children, salto }: { pregunta: string; children: ReactNode; salto?: boolean }) {
  return (
    <section className={cx("flex flex-col gap-4 border-t border-hilo px-5 py-8 md:px-8", salto && "salto")}>
      <p className="rotulo">{pregunta}</p>
      {children}
    </section>
  );
}

function Bloque({ titulo, children, className }: { titulo: string; children: ReactNode; className?: string }) {
  return (
    <figure className={cx("flex min-w-0 flex-col gap-3", className)}>
      <figcaption className="font-rotulo text-sm font-semibold uppercase tracking-[0.12em] text-texto-2">{titulo}</figcaption>
      {children}
    </figure>
  );
}

export function VistaReporte({ detalle }: { detalle: DetalleReporte }) {
  const { avisar } = useAvisos();
  const ctx = detalle.contexto;
  const puede = detalle.puede_editar;
  const [textos, setTextos] = useState<Record<string, string>>({ ...ctx.insights, client_name: ctx.meta.client_name });
  const [fuente, setFuente] = useState(detalle.fuente);
  const [estadoIa, setEstadoIa] = useState(detalle.estado_ia);
  const [avisos, setAvisos] = useState(ctx.warnings ?? []);
  const [guardado, setGuardado] = useState<Guardado>("quieto");
  const [copiado, setCopiado] = useState(false);
  const pendientes = useRef<Record<string, string>>({});
  const editados = useRef(new Set(detalle.editados));
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const guardar = useCallback(async () => {
    const lote = pendientes.current;
    pendientes.current = {};
    if (!Object.keys(lote).length) return;
    setGuardado("guardando");
    try {
      await pedirJson(`/api/datos/reportes/${detalle.token}/textos`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ textos: lote }),
      });
      Object.keys(lote).forEach((k) => editados.current.add(k));
      setGuardado(Object.keys(pendientes.current).length ? "pendiente" : "guardado");
    } catch {
      // Vuelven al monton: el siguiente intento los reenvia.
      pendientes.current = { ...lote, ...pendientes.current };
      setGuardado("error");
    }
  }, [detalle.token]);

  const alCambiar = useCallback((slot: string, texto: string, ahora?: boolean) => {
    if (!puede) return;
    if (!ahora) {
      pendientes.current[slot] = texto;
      setGuardado("pendiente");
    }
    if (temporizador.current) clearTimeout(temporizador.current);
    if (ahora) void guardar();
    else temporizador.current = setTimeout(() => void guardar(), 900);
  }, [puede, guardar]);

  // Nada se pierde al cerrar con retoques sin guardar.
  useEffect(() => {
    const aviso = (e: BeforeUnloadEvent) => {
      if (Object.keys(pendientes.current).length || guardado === "guardando") { e.preventDefault(); }
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [guardado]);

  /* ── Textos de la IA como trabajo con progreso ── */
  const aplicarIa = useCallback((r: { success?: boolean; insights?: Record<string, string>; warnings?: string[]; source?: string; estado?: string; error?: string | null }) => {
    if (r.insights) {
      const nuevos = Object.fromEntries(Object.entries(r.insights).filter(([k]) => !editados.current.has(k)));
      setTextos((t) => ({ ...t, ...nuevos }));
    }
    if (r.warnings) setAvisos(r.warnings);
    if (r.estado) setEstadoIa(r.estado);
    if (r.source) setFuente(r.source);
    if (r.success) avisar("Textos redactados por IA.", { tipo: "exito" });
    else avisar(`La IA no respondió${r.error ? ` (${r.error})` : ""}: se mantienen los textos por reglas.`, { tipo: "info" });
  }, [avisar]);

  const ia = useProcesoDatos<Parameters<typeof aplicarIa>[0]>({ alTerminar: aplicarIa });
  const lanzado = useRef(false);

  const pedirIa = useCallback(async () => {
    try {
      const r = await pedirJson<{ trabajo: string | null; resultado?: Parameters<typeof aplicarIa>[0] }>(`/api/datos/reportes/${detalle.token}/insights`, { method: "POST" });
      if (r.trabajo) ia.seguir(r.trabajo, "ia");
      else if (r.resultado) aplicarIa(r.resultado);
    } catch (e) {
      avisar(e instanceof Error ? e.message : "No se pudo pedir los textos.", { tipo: "error" });
    }
  }, [detalle.token, ia, aplicarIa, avisar]);

  // Reportes de antes (generados en Flask) quedaban "pendientes": se piden al abrir, como hacia Flask.
  useEffect(() => {
    if (puede && detalle.estado_ia === "pendiente" && !lanzado.current) { lanzado.current = true; void pedirIa(); }
  }, [puede, detalle.estado_ia, pedirIa]);

  async function copiarEnlace() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      avisar("No se pudo copiar. Copia la dirección desde la barra del navegador.", { tipo: "error" });
    }
  }

  /* ── Datos para los graficos ── */
  const sentimiento = useMemo(() => [...(ctx.charts.sentiment ?? [])]
    .sort((a, b) => (SENTIMIENTO[a.key]?.orden ?? 9) - (SENTIMIENTO[b.key]?.orden ?? 9))
    .map((s) => ({ etiqueta: s.label, valor: s.value, color: SENTIMIENTO[s.key]?.color ?? "var(--serie-otras)" })), [ctx.charts.sentiment]);

  const porRed = useMemo(() => (ctx.charts.sentiment_by_source ?? [])
    .filter((s) => s.positive + s.neutral + s.negative > 0)
    .sort((a, b) => (b.positive + b.neutral + b.negative) - (a.positive + a.neutral + a.negative))
    .slice(0, 6)
    .map((s) => ({ etiqueta: s.source, valores: { positive: s.positive, neutral: s.neutral, negative: s.negative } })), [ctx.charts.sentiment_by_source]);

  const fuentes = useMemo(() => {
    const etiquetas = ctx.kpis.source_labels ?? {};
    const todas: ItemRanking[] = Object.entries(ctx.kpis.mentions_by_source ?? {})
      .map(([k, v]) => ({ etiqueta: etiquetas[k] ?? k, valor: v }))
      .filter((s) => s.valor > 0)
      .sort((a, b) => b.valor - a.valor);
    const top = todas.slice(0, 5);
    const resto = todas.slice(5);
    if (resto.length) top.push({ etiqueta: `Otras ${resto.length} redes`, valor: resto.reduce((s, r) => s + r.valor, 0), apagado: true, nota: resto.map((r) => r.etiqueta).join(", ") });
    return top;
  }, [ctx.kpis]);

  const etiquetas = ctx.charts.evolution?.labels ?? [];
  const periodo = etiquetas.length ? `${etiquetas[0]} – ${etiquetas[etiquetas.length - 1]}` : null;
  const iaEnMarcha = ia.situacion === "subiendo" || ia.situacion === "procesando";

  const textoGuardado: Record<Guardado, string> = {
    quieto: "", pendiente: "Sin guardar", guardando: "Guardando…", guardado: "Guardado", error: "No se pudo guardar · se reintentará",
  };

  return (
    <article className="reporte flex flex-col gap-4">
      {/* Barra de acciones (fuera del PDF) */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-texto-2">
          <Link href="/reportes" className="hover:text-texto hover:underline">Mis reportes</Link>
          <span aria-hidden className="text-texto-3">/</span>
          <span className="truncate text-texto">{textos.client_name}</span>
          <span className="inline-flex h-6 items-center gap-1.5 rounded-sm border border-hilo px-2 font-rotulo text-xs font-semibold uppercase tracking-[0.1em]">
            {fuente === "ia" ? <><Sparkles className="size-3.5" aria-hidden />Textos por IA</> : "Textos por reglas"}
          </span>
          {!puede && <span className="text-texto-3">Solo lectura: el reporte es de otra persona.</span>}
          <span role="status" className={cx("text-xs", guardado === "error" ? "text-alerta" : "text-texto-3")}>{textoGuardado[guardado]}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {puede && estadoIa !== "listo" && (
            <Boton tamano="sm" variante="secundario" onClick={pedirIa} disabled={iaEnMarcha} icono={<Sparkles className="size-3.5" aria-hidden />}>Redactar con IA</Boton>
          )}
          <Boton tamano="sm" variante="secundario" onClick={copiarEnlace} confirmado={copiado} icono={copiado ? <Check className="size-3.5" aria-hidden /> : <Link2 className="size-3.5" aria-hidden />}>
            {copiado ? "Enlace copiado" : "Copiar enlace"}
          </Boton>
          <Boton tamano="sm" variante="primario" onClick={() => window.print()} icono={<FileDown className="size-3.5" aria-hidden />}>Descargar PDF</Boton>
        </div>
      </div>

      {ia.situacion !== "inactivo" && ia.situacion !== "hecho" && (
        <div className="print:hidden">
          <ProcesoSalida fases={FASES.insights} estado={ia.proceso} />
        </div>
      )}

      {avisos.length > 0 && (
        <details className="rounded-md border border-aviso/40 bg-superficie px-4 py-3 text-sm print:hidden">
          <summary className="cursor-pointer text-texto-2"><span className="font-mono text-texto cifras">{avisos.length}</span> avisos de carga: secciones sin datos o archivos que no se usaron</summary>
          <ul className="mt-2 list-disc pl-5 text-texto-2">{avisos.map((a) => <li key={a}>{a}</li>)}</ul>
        </details>
      )}

      <div className="overflow-hidden rounded-md border border-hilo bg-superficie shadow-1">
        {/* Portada */}
        <header className="flex flex-col gap-3 px-5 pb-8 pt-8 md:px-8 md:pt-10">
          <div className="flex items-center gap-3">
            <span aria-hidden className="h-1 w-10 rounded-full bg-marca" />
            <p className="rotulo">Newlink · Escucha social</p>
          </div>
          <Editable slot="client_name" como="h1" valor={textos.client_name ?? ""} puede={puede} alCambiar={alCambiar}
            className="font-rotulo text-3xl font-semibold uppercase leading-none tracking-[0.02em] md:text-[3.25rem]" />
          <p className="font-mono text-sm text-texto-2 cifras">
            {periodo && <>{periodo} · </>}{fmt(ctx.kpis.total_mentions)} menciones · generado el {ctx.meta.date_generated}
          </p>
        </header>

        <Seccion pregunta="¿Cuánto se habló?">
          <Editable slot="volume_title" como="h2" valor={textos.volume_title ?? ""} puede={puede} alCambiar={alCambiar} className="max-w-[40ch] font-rotulo text-2xl font-semibold uppercase leading-tight tracking-[0.03em]" />
          <Editable slot="volume_take" valor={textos.volume_take ?? ""} puede={puede} alCambiar={alCambiar} className="max-w-[72ch] text-lg leading-relaxed text-texto-2" />
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-hilo bg-hilo md:grid-cols-4">
            {[
              { r: "Menciones", v: fmt(ctx.kpis.total_mentions), d: <Delta pct={ctx.kpis.mentions_change_pct} /> },
              { r: "Alcance estimado", v: ctx.kpis.estimated_reach_fmt, d: <Delta pct={ctx.kpis.reach_change_pct} /> },
              { r: "En redes sociales", v: fmt(ctx.kpis.mentions_redes), d: <span className="font-mono text-xs text-texto-3 cifras">{detalle.vista.pct_redes}% del total</span> },
              { r: "En noticias digitales", v: fmt(ctx.kpis.mentions_prensa), d: <span className="font-mono text-xs text-texto-3 cifras">{detalle.vista.pct_prensa}% del total</span> },
              ...(ctx.kpis.unique_authors ? [{ r: "Autores únicos", v: fmt(ctx.kpis.unique_authors), d: null }] : []),
            ].map((k) => (
              <div key={k.r} className="flex flex-col gap-1 bg-superficie px-4 py-3">
                <dt className="rotulo">{k.r}</dt>
                <dd className="font-mono text-2xl font-medium cifras">{k.v}</dd>
                <dd>{k.d}</dd>
              </div>
            ))}
          </dl>
          {etiquetas.length > 0 && (
            <Bloque titulo="Menciones por día">
              <Tendencia titulo="Menciones por día" etiquetas={etiquetas} actual={ctx.charts.evolution.mentions} previo={ctx.charts.evolution.mentions_prev} />
            </Bloque>
          )}
        </Seccion>

        <Seccion pregunta="¿Cómo se sintió?" salto>
          <Editable slot="sentiment_title" como="h2" valor={textos.sentiment_title ?? ""} puede={puede} alCambiar={alCambiar} className="max-w-[40ch] font-rotulo text-2xl font-semibold uppercase leading-tight tracking-[0.03em]" />
          <Editable slot="sentiment_take" valor={textos.sentiment_take ?? ""} puede={puede} alCambiar={alCambiar} className="max-w-[72ch] text-lg leading-relaxed text-texto-2" />
          <div className="grid gap-8 md:grid-cols-2">
            {sentimiento.length > 0 && <Bloque titulo="Sentimiento"><Reparto titulo="Sentimiento" partes={sentimiento} /></Bloque>}
            {(ctx.charts.emotions ?? []).length > 0 && (
              <Bloque titulo="Emociones dominantes">
                <Ranking titulo="Emociones por menciones" color="var(--serie-1)" datos={[...ctx.charts.emotions].sort((a, b) => b.value - a.value).map((e) => ({ etiqueta: e.label, valor: e.value }))} />
              </Bloque>
            )}
          </div>
          {porRed.length > 0 && (
            <div className="flex flex-col gap-3 pt-4">
              <Editable slot="by_source_title" como="h2" valor={textos.by_source_title ?? ""} puede={puede} alCambiar={alCambiar} className="font-rotulo text-xl font-semibold uppercase tracking-[0.03em]" />
              <Editable slot="by_source_take" valor={textos.by_source_take ?? ""} puede={puede} alCambiar={alCambiar} className="max-w-[72ch] text-texto-2" />
              <Bloque titulo="Sentimiento dentro de cada red · % negativo a la derecha">
                <Apiladas100 filas={porRed} claves={[
                  { clave: "positive", etiqueta: "Positivo", color: "var(--tono-bien)" },
                  { clave: "neutral", etiqueta: "Neutro", color: "var(--tono-neutro)" },
                  { clave: "negative", etiqueta: "Negativo", color: "var(--tono-alerta)" },
                ]} />
              </Bloque>
            </div>
          )}
        </Seccion>

        <Seccion pregunta="¿De qué se habló?" salto>
          <Editable slot="topics_title" como="h2" valor={textos.topics_title ?? ""} puede={puede} alCambiar={alCambiar} className="max-w-[40ch] font-rotulo text-2xl font-semibold uppercase leading-tight tracking-[0.03em]" />
          <Editable slot="topics_take" valor={textos.topics_take ?? ""} puede={puede} alCambiar={alCambiar} className="max-w-[72ch] text-lg leading-relaxed text-texto-2" />
          {(ctx.content.clusters ?? []).length > 0 && (
            <Bloque titulo="Temas detectados">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-hilo"><th scope="col" className="h-9 w-10 text-left rotulo">#</th><th scope="col" className="text-left rotulo">Tema</th><th scope="col" className="text-right rotulo">Menciones</th></tr></thead>
                <tbody>
                  {ctx.content.clusters.slice(0, 8).map((c, i) => (
                    <tr key={i} className="border-b border-hilo last:border-0">
                      <td className="py-2.5 align-top font-mono text-texto-3 cifras">{i + 1}</td>
                      <td className="py-2.5 pr-4 align-top">{c.summary}</td>
                      <td className="py-2.5 text-right align-top font-mono cifras">{fmt(c.mentions)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Bloque>
          )}
          <div className="grid gap-8 md:grid-cols-2">
            {(ctx.content.hashtags ?? []).length > 0 && (
              <Bloque titulo="Hashtags más usados">
                <Ranking titulo="Hashtags por menciones" color="var(--serie-1)" datos={ctx.content.hashtags.slice(0, 8).map((h) => ({ etiqueta: `#${h.hashtag}`, valor: h.mentions }))} />
              </Bloque>
            )}
            {(ctx.content.keywords ?? []).length > 0 && (
              <Bloque titulo="Palabras clave">
                <Ranking titulo="Palabras clave por menciones" color="var(--serie-1)" datos={ctx.content.keywords.slice(0, 8).map((k) => ({ etiqueta: k.keyword, valor: k.mentions }))} />
              </Bloque>
            )}
          </div>
        </Seccion>

        <Seccion pregunta="¿Quién habló?" salto>
          <Editable slot="authors_title" como="h2" valor={textos.authors_title ?? ""} puede={puede} alCambiar={alCambiar} className="max-w-[40ch] font-rotulo text-2xl font-semibold uppercase leading-tight tracking-[0.03em]" />
          <Editable slot="authors_take" valor={textos.authors_take ?? ""} puede={puede} alCambiar={alCambiar} className="max-w-[72ch] text-lg leading-relaxed text-texto-2" />
          <div className="grid gap-8 md:grid-cols-2">
            {fuentes.length > 0 && (
              <Bloque titulo="Menciones por red">
                <Ranking titulo="Menciones por red" color="var(--serie-1)" datos={fuentes} />
              </Bloque>
            )}
            {detalle.vista.top_authors.length > 0 && (
              <Bloque titulo="Autores más activos">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-hilo"><th scope="col" className="h-9 text-left rotulo">Autor</th><th scope="col" className="text-right rotulo">Posts</th><th scope="col" className="text-right rotulo">Seguidores</th></tr></thead>
                  <tbody>
                    {detalle.vista.top_authors.map((a) => (
                      <tr key={a.author} className="border-b border-hilo last:border-0">
                        <td className="max-w-48 truncate py-2 pr-3">{a.author}</td>
                        <td className="py-2 text-right font-mono cifras">{fmt(a.posts)}</td>
                        <td className="py-2 text-right font-mono text-texto-2 cifras">{a.followers ? fmt(a.followers) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Bloque>
            )}
          </div>
        </Seccion>

        <section className="flex flex-col gap-4 border-t border-hilo bg-superficie-2 px-5 py-8 md:px-8">
          <h2 className="font-rotulo text-xl font-semibold uppercase tracking-[0.08em]">Conclusiones</h2>
          <ol className="flex flex-col divide-y divide-hilo">
            {["conclusion_1", "conclusion_2", "conclusion_3"].map((s, i) => (
              <li key={s} className="flex gap-4 py-3">
                <span className="font-mono text-sm text-texto-3 cifras">{i + 1}</span>
                <Editable slot={s} valor={textos[s] ?? ""} puede={puede} alCambiar={alCambiar} className="flex-1 leading-relaxed" />
              </li>
            ))}
          </ol>
        </section>

        <footer className="flex flex-wrap justify-between gap-2 border-t border-hilo px-5 py-4 text-xs text-texto-3 md:px-8">
          <span>Fuente: Meltwater · Generado por Newlink el {ctx.meta.date_generated}</span>
          <span>{textos.client_name}</span>
        </footer>
      </div>

      <div className="flex justify-end print:hidden">
        <Link href="/reportes/nuevo" className="inline-flex h-10 items-center gap-2 rounded-sm px-3 font-rotulo text-sm font-semibold uppercase tracking-[0.1em] text-texto-2 hover:bg-superficie-2 hover:text-texto">
          <Plus className="size-4" aria-hidden />Nuevo reporte
        </Link>
      </div>
    </article>
  );
}
