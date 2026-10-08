"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Eye, EyeOff, Lock, Plus, Trash2, X } from "lucide-react";
import { useAvisos } from "@/components/ui/avisos";
import { Boton } from "@/components/ui/boton";
import { AreaTexto, Entrada, Selector } from "@/components/ui/campo";
import { Dialogo } from "@/components/ui/dialogo";
import { CeldaEstado, PuntoTono } from "@/components/ui/estado";
import { Esqueleto } from "@/components/ui/panel";
import { cx } from "@/components/ui/cx";
import type { ActividadDTO, ComentarioDTO, DependenciasDTO, DetalleDTO, ItemChecklistDTO, TareaDTO } from "@/lib/tareas/tipos";
import { ErrorPeticion, fechaCorta, haceCuanto, momento, pedir, relativo, tonoEstado } from "./cliente";
import { useTareas, type Cambios } from "./estado";

/*
 * Pase de la tarea seleccionada: una tarjeta de embarque. Arriba, las cuatro
 * celdas rotuladas (Entrega, Prioridad, Unidad, Responsable) y el estado;
 * debajo lo que se usa a diario (checklist, comentarios, observadores,
 * etiquetas, bloqueos) y plegado lo ocasional.
 */

type Datos = { detalle: DetalleDTO; checklist: ItemChecklistDTO[]; comentarios: ComentarioDTO[]; deps: DependenciasDTO & { puedeEditar: boolean } };

function obtenerDatos(id: number, senal?: AbortSignal): Promise<Datos> {
  return Promise.all([
    pedir<{ tarea: DetalleDTO }>(`/api/tareas/${id}`, { senal }),
    pedir<{ items: ItemChecklistDTO[] }>(`/api/tareas/${id}/checklist`, { senal }),
    pedir<{ comentarios: ComentarioDTO[] }>(`/api/tareas/${id}/comentarios`, { senal }),
    pedir<DependenciasDTO & { puedeEditar: boolean }>(`/api/tareas/${id}/dependencias`, { senal }),
  ]).then(([d, c, k, deps]) => ({ detalle: d.tarea, checklist: c.items, comentarios: k.comentarios, deps }));
}

export function Pase({ id, alCerrar }: { id: number; alCerrar: () => void }) {
  const ctx = useTareas();
  const { avisar } = useAvisos();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<{ status: number; mensaje: string } | null>(null);
  const enLista = ctx.tareas.find((t) => t.id === id);

  const cargar = useCallback((senal?: AbortSignal) =>
    obtenerDatos(id, senal).then((d) => { setDatos(d); setError(null); }).catch((e) => {
      if ((e as Error).name === "AbortError") return;
      setError({ status: e instanceof ErrorPeticion ? e.status : 0, mensaje: (e as Error).message });
    }), [id]);

  // El pase se monta de nuevo con cada tarea (key), asi que aqui solo se carga.
  useEffect(() => {
    const ac = new AbortController();
    void cargar(ac.signal);
    return () => ac.abort();
  }, [cargar]);

  /* Si la lista trae una version nueva de esta tarea (refresco o cambio desde la fila), el pase la sigue. */
  const versionLista = enLista?.actualizada;
  const versionPase = datos?.detalle.actualizada;
  useEffect(() => {
    if (versionLista && versionPase && versionLista > versionPase) void cargar();
  }, [versionLista, versionPase, cargar]);

  if (error) {
    return (
      <div className="flex flex-col gap-3 p-5">
        <CabeceraPase titulo="Tarea" alCerrar={alCerrar} />
        <p className="text-texto-2">{error.status === 404 ? "Esta tarea ya no existe o no la puedes ver. Puede que la hayan borrado o movido a otra unidad." : error.mensaje}</p>
        <div><Boton variante="secundario" tamano="sm" onClick={() => void cargar()}>Reintentar</Boton></div>
      </div>
    );
  }
  if (!datos) {
    return (
      <div className="space-y-4 p-5" aria-busy>
        <Esqueleto className="h-6 w-3/4" />
        <Esqueleto className="h-16" />
        <Esqueleto className="h-8 w-2/3" />
        <Esqueleto className="h-24" />
      </div>
    );
  }

  const t = { ...datos.detalle, ...(enLista ?? {}) } as DetalleDTO;
  const editable = datos.detalle.puedeEditar;

  const guardar = async (cambios: Cambios, mensaje?: string) => {
    const r = await ctx.guardar(id, cambios, { mensaje, version: t.actualizada });
    if (r) setDatos((d) => (d ? { ...d, detalle: { ...d.detalle, ...r } } : d));
    else if (!enLista) void cargar();
  };

  return (
    <article aria-label={`Tarea: ${t.titulo}`} className="flex min-h-0 flex-col">
      <CabeceraPase titulo={`#${t.id}`} alCerrar={alCerrar} />
      <div className="flex flex-col gap-5 overflow-y-auto px-5 pb-6">
        <Titulo key={`t-${t.titulo}`} t={t} editable={editable} alGuardar={(v) => void guardar({ title: v })} />

        {/* Pase segmentado */}
        <dl className="grid grid-cols-2 overflow-hidden rounded-sm border border-hilo sm:grid-cols-4">
          <Celda rotulo="Entrega">
            {editable ? (
              <input type="date" aria-label="Fecha de entrega" value={t.entrega} required
                onChange={(e) => e.target.value && e.target.value !== t.entrega && void guardar({ due_date: e.target.value }, `Entrega movida al ${fechaCorta(e.target.value)}`)}
                className={cx("w-full bg-transparent font-mono text-sm cifras outline-none", t.vencida && "text-alerta")} />
            ) : <span className="font-mono text-sm cifras">{fechaCorta(t.entrega)}</span>}
            <span className={cx("text-xs", t.vencida ? "text-alerta" : "text-texto-3")}>{relativo(t.entrega, ctx.hoy)}</span>
          </Celda>
          <Celda rotulo="Prioridad">
            {editable ? (
              <select aria-label="Prioridad" value={t.prioridad} onChange={(e) => void guardar({ priority: e.target.value }, `Prioridad: ${e.target.value}`)}
                className="w-full bg-transparent text-sm font-medium outline-none">
                {ctx.prioridades.map((p) => <option key={p.nombre}>{p.nombre}</option>)}
              </select>
            ) : <span className="text-sm font-medium">{t.prioridad}</span>}
          </Celda>
          <Celda rotulo="Unidad"><span className="truncate text-sm">{t.unidad}</span></Celda>
          <Celda rotulo="Responsable">
            {editable ? (
              <select aria-label="Responsable" value={t.asignadoId} onChange={(e) => void guardar({ assignee_id: Number(e.target.value) }, "Tarea reasignada")}
                className="w-full truncate bg-transparent text-sm font-medium outline-none">
                {!ctx.personas.some((p) => p.id === t.asignadoId) && <option value={t.asignadoId}>{t.asignado}</option>}
                {ctx.personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            ) : <span className="truncate text-sm font-medium">{t.asignado}</span>}
          </Celda>
        </dl>

        {/* Estado */}
        <section aria-label="Estado" className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="rotulo">Estado</h3>
            <CeldaEstado texto={t.estado} tono={tonoEstado(ctx.estados, t.estado)} cambio={`${t.estado}|${t.actualizada}`} />
          </div>
          {editable ? (
            <div role="radiogroup" aria-label="Cambiar estado" className="flex flex-wrap gap-1">
              {ctx.estados.map((e) => (
                <button key={e.nombre} type="button" role="radio" aria-checked={t.estado === e.nombre}
                  onClick={() => t.estado !== e.nombre && void guardar({ status: e.nombre }, `Estado: ${e.nombre}`)}
                  className={cx("inline-flex h-9 items-center gap-1.5 rounded-sm border px-2.5 text-sm transition-colors duration-[var(--dur)]",
                    t.estado === e.nombre ? "border-texto bg-texto font-semibold text-superficie" : "border-hilo text-texto-2 hover:border-hilo-fuerte hover:text-texto")}>
                  <PuntoTono tono={e.color} />{e.nombre}
                </button>
              ))}
            </div>
          ) : <p className="text-sm text-texto-3">Observas esta tarea: puedes verla y seguirla, pero no cambiarla.</p>}
          {t.bloqueadaPorAbiertas > 0 && (
            <p className="flex items-center gap-1.5 text-sm text-alerta"><Lock aria-hidden className="size-3.5" />Espera a {t.bloqueadaPorAbiertas === 1 ? "una tarea abierta" : `${t.bloqueadaPorAbiertas} tareas abiertas`}.</p>
          )}
        </section>

        <Acciones t={t} editable={editable} alCambiarObservar={() => void cargar()} alBorrar={alCerrar} />

        <Descripcion key={`d-${t.descripcion}`} t={t} editable={editable} alGuardar={(v) => void guardar({ description: v })} />

        <Checklist id={id} items={datos.checklist} editable={editable} alCambiar={(items) => {
          setDatos((d) => (d ? { ...d, checklist: items } : d));
          const hechos = items.filter((i) => i.hecho).length;
          if (enLista) ctx.fusionar({ ...enLista, checklistTotal: items.length, checklistHechos: hechos });
        }} />

        <Etiquetas t={t} editable={editable} alCambiar={(etiquetas) => {
          setDatos((d) => (d ? { ...d, detalle: { ...d.detalle, etiquetas } } : d));
          if (enLista) ctx.fusionar({ ...enLista, etiquetas });
        }} />

        <Bloqueos id={id} deps={datos.deps} editable={editable} alCambiar={() => { void cargar(); void ctx.recargar(); }} />

        <Comentarios id={id} lista={datos.comentarios} editable={editable} alCambiar={(comentarios) => {
          setDatos((d) => (d ? { ...d, comentarios } : d));
          if (enLista) ctx.fusionar({ ...enLista, comentarios: comentarios.length });
        }} />

        <Observadores t={datos.detalle} editable={editable} alCambiar={(salio) => {
          if (salio) { avisar("Ya no observas esta tarea y no la puedes ver."); alCerrar(); } else void cargar();
        }} />

        <MasCampos t={t} editable={editable} alGuardar={(c) => void guardar(c)} />

        <Actividad id={id} />
      </div>
    </article>
  );
}

function CabeceraPase({ titulo, alCerrar }: { titulo: string; alCerrar: () => void }) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between px-5">
      <span className="font-mono text-xs text-texto-3 cifras">{titulo}</span>
      <button type="button" onClick={alCerrar} aria-label="Cerrar el pase" className="grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-superficie-2 hover:text-texto">
        <X aria-hidden className="size-4" />
      </button>
    </header>
  );
}

function Celda({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 border-b border-r border-hilo px-3 py-2.5 last:border-r-0 sm:border-b-0 [&:nth-child(2)]:border-r-0 sm:[&:nth-child(2)]:border-r">
      <dt className="rotulo">{rotulo}</dt>
      <dd className="flex min-w-0 flex-col">{children}</dd>
    </div>
  );
}

function Titulo({ t, editable, alGuardar }: { t: TareaDTO; editable: boolean; alGuardar: (v: string) => void }) {
  const [valor, setValor] = useState(t.titulo);
  if (!editable) return <h2 className="text-xl font-semibold leading-snug text-balance">{t.titulo}</h2>;
  return (
    <h2>
      <textarea aria-label="Título" rows={1} value={valor} maxLength={255} onChange={(e) => setValor(e.target.value)}
        onBlur={() => { const v = valor.trim(); if (v && v !== t.titulo) alGuardar(v); else setValor(t.titulo); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
        className="field-sizing-content w-full resize-none rounded-sm bg-transparent text-xl font-semibold leading-snug outline-none hover:bg-superficie-2 focus:bg-superficie-2" />
    </h2>
  );
}

function Acciones({ t, editable, alCambiarObservar, alBorrar }: { t: DetalleDTO; editable: boolean; alCambiarObservar: () => void; alBorrar: () => void }) {
  const ctx = useTareas();
  const { avisar } = useAvisos();
  const [confirmar, setConfirmar] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const yo = t.observadores.find((o) => o.soyYo);
  const hecha = ctx.esFinal(t.estado);
  const esMadre = t.recurrente && t.padreId == null;

  const observar = async () => {
    setOcupado(true);
    try {
      if (yo) {
        const r = await pedir<{ sigueViendo: boolean }>(`/api/tareas/${t.id}/observadores/${ctx.usuario.id}`, { metodo: "DELETE" });
        if (!r.sigueViendo) { avisar("Ya no observas esta tarea."); alBorrar(); return; }
      } else await pedir(`/api/tareas/${t.id}/observadores`, { cuerpo: { user_id: ctx.usuario.id } });
      alCambiarObservar();
    } catch (e) { avisar((e as Error).message, { tipo: "error" }); } finally { setOcupado(false); }
  };

  const borrar = async (serie: boolean) => {
    setConfirmar(false);
    try {
      const r = await pedir<{ borradas: number }>(`/api/tareas/${t.id}?serie=${serie}`, { metodo: "DELETE" });
      ctx.quitar([t.id]);
      alBorrar();
      avisar(r.borradas > 1 ? `Borradas ${r.borradas} tareas de la serie.` : "Tarea borrada.", {
        tipo: "exito",
        deshacer: () => { void pedir(`/api/tareas/${t.id}/restaurar`, { cuerpo: {} }).then(() => { avisar("Borrado deshecho."); void ctx.recargar(); }); },
      });
      if (r.borradas > 1) void ctx.recargar();
    } catch (e) { avisar((e as Error).message, { tipo: "error" }); }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {editable && (
        <Boton variante={hecha ? "secundario" : "primario"} tamano="sm" icono={<Check aria-hidden className="size-3.5" />} onClick={() => ctx.completar(t.id)}>
          {hecha ? "Reabrir" : "Completar"}
        </Boton>
      )}
      <Boton variante="secundario" tamano="sm" cargando={ocupado} onClick={() => void observar()}
        icono={yo ? <EyeOff aria-hidden className="size-3.5" /> : <Eye aria-hidden className="size-3.5" />}>
        {yo ? "Dejar de observar" : "Observar"}
      </Boton>
      {editable && (
        <Boton variante="fantasma" tamano="sm" className="ml-auto" icono={<Trash2 aria-hidden className="size-3.5" />} onClick={() => setConfirmar(true)}>Borrar</Boton>
      )}
      <Dialogo abierto={confirmar} onCerrar={() => setConfirmar(false)} titulo="Borrar tarea" ancho="sm" pie={
        <>
          <Boton variante="fantasma" onClick={() => setConfirmar(false)}>Cancelar</Boton>
          {esMadre && <Boton variante="peligro" onClick={() => void borrar(true)}>Borrar toda la serie</Boton>}
          <Boton variante="peligro" onClick={() => void borrar(false)}>{esMadre ? "Solo esta" : "Borrar tarea"}</Boton>
        </>
      }>
        <p className="text-texto-2">«{t.titulo}» desaparece de las listas. Podrás deshacerlo durante unos segundos.</p>
      </Dialogo>
    </div>
  );
}

function Descripcion({ t, editable, alGuardar }: { t: TareaDTO; editable: boolean; alGuardar: (v: string) => void }) {
  const [valor, setValor] = useState(t.descripcion);
  return (
    <section aria-label="Descripción" className="flex flex-col gap-1.5">
      <h3 className="rotulo">Descripción</h3>
      {editable ? (
        <AreaTexto value={valor} onChange={(e) => setValor(e.target.value)} placeholder="Qué hay que entregar y cómo saber que está hecho."
          onBlur={() => valor.trim() !== t.descripcion && alGuardar(valor.trim())} className="min-h-16" />
      ) : <p className="whitespace-pre-wrap text-texto-2">{t.descripcion || "Sin descripción."}</p>}
    </section>
  );
}

function Seccion({ titulo, cuenta, children }: { titulo: string; cuenta?: string; children: React.ReactNode }) {
  return (
    <section aria-label={titulo} className="flex flex-col gap-2 border-t border-hilo pt-4">
      <h3 className="flex items-center gap-2"><span className="rotulo">{titulo}</span>{cuenta && <span className="font-mono text-xs text-texto-3 cifras">{cuenta}</span>}</h3>
      {children}
    </section>
  );
}

function Checklist({ id, items, editable, alCambiar }: { id: number; items: ItemChecklistDTO[]; editable: boolean; alCambiar: (i: ItemChecklistDTO[]) => void }) {
  const { avisar } = useAvisos();
  const [nuevo, setNuevo] = useState("");
  const hechos = items.filter((i) => i.hecho).length;
  const marcar = async (it: ItemChecklistDTO) => {
    alCambiar(items.map((x) => (x.id === it.id ? { ...x, hecho: !x.hecho } : x)));
    try {
      const r = await pedir<{ item: ItemChecklistDTO }>(`/api/tareas/${id}/checklist/${it.id}`, { metodo: "PUT", cuerpo: { is_completed: !it.hecho } });
      alCambiar(items.map((x) => (x.id === it.id ? r.item : x)));
    } catch (e) { alCambiar(items); avisar((e as Error).message, { tipo: "error" }); }
  };
  const anadir = async () => {
    const body = nuevo.trim();
    if (!body) return;
    try {
      const r = await pedir<{ item: ItemChecklistDTO }>(`/api/tareas/${id}/checklist`, { cuerpo: { body } });
      alCambiar([...items, r.item]);
      setNuevo("");
    } catch (e) { avisar((e as Error).message, { tipo: "error" }); }
  };
  const borrar = async (it: ItemChecklistDTO) => {
    try { await pedir(`/api/tareas/${id}/checklist/${it.id}`, { metodo: "DELETE" }); alCambiar(items.filter((x) => x.id !== it.id)); }
    catch (e) { avisar((e as Error).message, { tipo: "error" }); }
  };
  return (
    <Seccion titulo="Checklist" cuenta={items.length ? `${hechos}/${items.length}` : undefined}>
      {items.length > 0 && (
        <ul className="divide-y divide-hilo rounded-sm border border-hilo">
          {items.map((it) => (
            <li key={it.id} className="group flex min-h-10 items-center gap-2 px-2">
              <input type="checkbox" checked={it.hecho} disabled={!editable} onChange={() => void marcar(it)} aria-label={it.texto} className="size-4 accent-[var(--texto)]" />
              <span className={cx("flex-1 text-sm", it.hecho && "text-texto-3 line-through")}>{it.texto}</span>
              {editable && (
                <button type="button" onClick={() => void borrar(it)} aria-label={`Quitar «${it.texto}»`} className="grid size-8 place-items-center text-texto-3 opacity-60 hover:text-alerta group-hover:opacity-100">
                  <X aria-hidden className="size-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void anadir(); }}>
          <Entrada value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Añadir un paso" maxLength={500} aria-label="Nuevo paso del checklist" className="h-9" />
          <Boton type="submit" tamano="sm" variante="secundario" className="h-9" disabled={!nuevo.trim()}>Añadir</Boton>
        </form>
      )}
    </Seccion>
  );
}

function Etiquetas({ t, editable, alCambiar }: { t: TareaDTO; editable: boolean; alCambiar: (e: TareaDTO["etiquetas"]) => void }) {
  const { etiquetas } = useTareas();
  const { avisar } = useAvisos();
  const [abierto, setAbierto] = useState(false);
  const visibles = new Set(etiquetas.map((e) => e.id));
  const alternar = async (tagId: number) => {
    const actuales = t.etiquetas.filter((e) => visibles.has(e.id)).map((e) => e.id);
    const nuevas = actuales.includes(tagId) ? actuales.filter((x) => x !== tagId) : [...actuales, tagId];
    try {
      const r = await pedir<{ etiquetas: TareaDTO["etiquetas"] }>(`/api/tareas/${t.id}/etiquetas`, { metodo: "PUT", cuerpo: { tag_ids: nuevas } });
      alCambiar(r.etiquetas);
    } catch (e) { avisar((e as Error).message, { tipo: "error" }); }
  };
  return (
    <Seccion titulo="Etiquetas">
      <div className="flex flex-wrap items-center gap-1.5">
        {t.etiquetas.length === 0 && <span className="text-sm text-texto-3">Sin etiquetas.</span>}
        {t.etiquetas.map((e) => (
          <span key={e.id} title={visibles.has(e.id) ? undefined : `De ${e.unidad || "otra unidad"}: se conserva`}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-hilo px-2 text-sm">
            <PuntoTono tono={e.color} />{e.nombre}
          </span>
        ))}
        {editable && (
          <button type="button" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}
            className="inline-flex h-7 items-center gap-1 rounded-sm px-2 text-sm text-texto-2 hover:bg-superficie-2 hover:text-texto">
            <Plus aria-hidden className="size-3.5" />{abierto ? "Listo" : "Etiquetar"}
          </button>
        )}
      </div>
      {abierto && (
        <ul className="grid grid-cols-2 gap-1">
          {etiquetas.length === 0 && <li className="col-span-2 text-sm text-texto-3">Tu unidad aún no tiene etiquetas. Créalas desde «Etiquetas» en la barra.</li>}
          {etiquetas.map((e) => {
            const puesta = t.etiquetas.some((x) => x.id === e.id);
            return (
              <li key={e.id}>
                <button type="button" aria-pressed={puesta} onClick={() => void alternar(e.id)}
                  className={cx("flex h-9 w-full items-center gap-2 rounded-sm border px-2 text-left text-sm", puesta ? "border-texto" : "border-hilo hover:border-hilo-fuerte")}>
                  <PuntoTono tono={e.color} /><span className="flex-1 truncate">{e.nombre}</span>{puesta && <Check aria-hidden className="size-3.5" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Seccion>
  );
}

function Bloqueos({ id, deps, editable, alCambiar }: { id: number; deps: DependenciasDTO; editable: boolean; alCambiar: () => void }) {
  const ctx = useTareas();
  const { avisar } = useAvisos();
  const [tipo, setTipo] = useState<"blocked_by" | "blocks">("blocked_by");
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Array<{ id: number; titulo: string; estado: string; entrega: string }>>([]);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    const ac = new AbortController();
    const t = setTimeout(() => {
      pedir<{ tareas: typeof resultados }>(`/api/tareas/${id}/relacionables?q=${encodeURIComponent(q)}`, { senal: ac.signal })
        .then((r) => setResultados(r.tareas)).catch(() => {});
    }, 200);
    return () => { clearTimeout(t); ac.abort(); };
  }, [q, id, abierto]);

  const crear = async (otra: number) => {
    try {
      await pedir(`/api/tareas/${id}/dependencias`, { cuerpo: { tipo, task_id: otra } });
      setAbierto(false); setQ("");
      alCambiar();
    } catch (e) { avisar((e as Error).message, { tipo: "error" }); }
  };
  const quitar = async (dep: number) => {
    try { await pedir(`/api/tareas/${id}/dependencias/${dep}`, { metodo: "DELETE" }); alCambiar(); }
    catch (e) { avisar((e as Error).message, { tipo: "error" }); }
  };

  const lista = (titulo: string, filas: DependenciasDTO["bloqueadaPor"], ocultas: number) => (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-texto-3">{titulo}</p>
      {filas.map((r) => (
        <div key={r.dependenciaId} className="flex min-h-9 items-center gap-2 rounded-sm border border-hilo px-2 text-sm">
          <button type="button" onClick={() => ctx.seleccionar(r.id)} className={cx("flex-1 truncate text-left hover:underline", r.cerrada && "text-texto-3 line-through")}>{r.titulo}</button>
          <span className="font-mono text-xs text-texto-3 cifras">{fechaCorta(r.entrega)}</span>
          <span className="text-xs text-texto-2">{r.estado}</span>
          {editable && <button type="button" onClick={() => void quitar(r.dependenciaId)} aria-label={`Quitar la relación con «${r.titulo}»`} className="grid size-8 place-items-center text-texto-3 hover:text-alerta"><X aria-hidden className="size-3.5" /></button>}
        </div>
      ))}
      {ocultas > 0 && <p className="text-xs text-texto-3">Y {ocultas} de otra unidad que no puedes ver.</p>}
    </div>
  );

  const hay = deps.bloqueadaPor.length + deps.bloquea.length + deps.ocultasBloqueadaPor + deps.ocultasBloquea > 0;
  return (
    <Seccion titulo="Bloqueos">
      {!hay && <p className="text-sm text-texto-3">No depende de nada ni nadie espera por ella.</p>}
      {(deps.bloqueadaPor.length > 0 || deps.ocultasBloqueadaPor > 0) && lista("Espera a", deps.bloqueadaPor, deps.ocultasBloqueadaPor)}
      {(deps.bloquea.length > 0 || deps.ocultasBloquea > 0) && lista("La esperan", deps.bloquea, deps.ocultasBloquea)}
      {editable && !abierto && (
        <div><Boton variante="fantasma" tamano="sm" icono={<Plus aria-hidden className="size-3.5" />} onClick={() => setAbierto(true)}>Añadir relación</Boton></div>
      )}
      {editable && abierto && (
        <div className="flex flex-col gap-2 rounded-sm border border-hilo p-2">
          <div className="flex gap-2">
            <Selector aria-label="Tipo de relación" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} className="h-9 w-auto">
              <option value="blocked_by">Espera a…</option>
              <option value="blocks">Bloquea a…</option>
            </Selector>
            <Entrada autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca por título" aria-label="Buscar tarea" className="h-9" />
            <button type="button" onClick={() => setAbierto(false)} aria-label="Cancelar" className="grid size-9 shrink-0 place-items-center text-texto-3 hover:text-texto"><X aria-hidden className="size-4" /></button>
          </div>
          <ul className="max-h-48 overflow-y-auto">
            {resultados.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => void crear(r.id)} className="flex h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-superficie-2">
                  <span className="flex-1 truncate">{r.titulo}</span><span className="font-mono text-xs text-texto-3 cifras">{fechaCorta(r.entrega)}</span>
                </button>
              </li>
            ))}
            {!resultados.length && <li className="px-2 py-1 text-sm text-texto-3">Escribe al menos dos letras del título.</li>}
          </ul>
        </div>
      )}
    </Seccion>
  );
}

function Comentarios({ id, lista, editable, alCambiar }: { id: number; lista: ComentarioDTO[]; editable: boolean; alCambiar: (c: ComentarioDTO[]) => void }) {
  const ctx = useTareas();
  const { avisar } = useAvisos();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // @menciones: sugerencias con la gente del ambito mientras se escribe "@pre".
  const prefijo = /(?:^|\s)@([\w.\-]*)$/.exec(texto)?.[1];
  const sugerencias = useMemo(() => (prefijo === undefined ? [] : ctx.personas.filter((p) => !/\s/.test(p.nombre) && p.nombre.toLowerCase().startsWith(prefijo.toLowerCase())).slice(0, 5)), [prefijo, ctx.personas]);
  const mencionar = (nombre: string) => {
    setTexto((t) => t.replace(/@([\w.\-]*)$/, `@${nombre} `));
    ref.current?.focus();
  };

  const enviar = async () => {
    const body = texto.trim();
    if (!body) return;
    setEnviando(true);
    try {
      const r = await pedir<{ comentario: ComentarioDTO }>(`/api/tareas/${id}/comentarios`, { cuerpo: { body } });
      alCambiar([...lista, r.comentario]);
      setTexto("");
    } catch (e) { avisar((e as Error).message, { tipo: "error" }); } finally { setEnviando(false); }
  };
  const borrar = async (c: ComentarioDTO) => {
    try { await pedir(`/api/tareas/comentarios/${c.id}`, { metodo: "DELETE" }); alCambiar(lista.filter((x) => x.id !== c.id)); }
    catch (e) { avisar((e as Error).message, { tipo: "error" }); }
  };

  return (
    <Seccion titulo="Comentarios" cuenta={lista.length ? String(lista.length) : undefined}>
      <ul className="flex flex-col gap-3">
        {lista.map((c) => (
          <li key={c.id} className="group flex flex-col gap-0.5">
            <p className="flex items-baseline gap-2 text-xs">
              <span className="font-semibold text-texto">{c.autor}</span>
              <time dateTime={c.creado} title={momento(c.creado)} className="font-mono text-texto-3 cifras">{haceCuanto(c.creado)}</time>
              {(c.autorId === ctx.usuario.id || ctx.usuario.esAdmin) && editable && (
                <button type="button" onClick={() => void borrar(c)} className="ml-auto text-texto-3 opacity-0 hover:text-alerta focus:opacity-100 group-hover:opacity-100">Borrar</button>
              )}
            </p>
            <p className="whitespace-pre-wrap text-sm text-texto-2">
              {c.texto.split(/(@[\w.\-]+)/g).map((parte, i) => (parte.startsWith("@") ? <strong key={i} className="font-semibold text-texto">{parte}</strong> : parte))}
            </p>
          </li>
        ))}
        {!lista.length && <li className="text-sm text-texto-3">Sin comentarios todavía.</li>}
      </ul>
      {editable && (
        <form className="relative flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
          <AreaTexto ref={ref} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={2000} aria-label="Nuevo comentario"
            placeholder="Escribe un comentario. Usa @nombre para avisar a alguien."
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void enviar(); } }} className="min-h-16" />
          {sugerencias.length > 0 && (
            <ul role="listbox" aria-label="Personas para mencionar" className="absolute bottom-full left-0 z-10 mb-1 w-56 rounded-sm border border-hilo bg-superficie shadow-2">
              {sugerencias.map((p) => (
                <li key={p.id}>
                  <button type="button" role="option" aria-selected={false} onClick={() => mencionar(p.nombre)} className="flex h-9 w-full items-center gap-2 px-3 text-left text-sm hover:bg-superficie-2">
                    {p.nombre}<span className="ml-auto truncate text-xs text-texto-3">{p.unidad}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div><Boton type="submit" tamano="sm" variante="secundario" cargando={enviando} disabled={!texto.trim()}>Comentar</Boton></div>
        </form>
      )}
    </Seccion>
  );
}

function Observadores({ t, editable, alCambiar }: { t: DetalleDTO; editable: boolean; alCambiar: (salio: boolean) => void }) {
  const ctx = useTareas();
  const { avisar } = useAvisos();
  const [candidatos, setCandidatos] = useState<Array<{ id: number; nombre: string; unidad: string }> | null>(null);
  const anadir = async (uid: number) => {
    try { await pedir(`/api/tareas/${t.id}/observadores`, { cuerpo: { user_id: uid } }); setCandidatos(null); alCambiar(false); }
    catch (e) { avisar((e as Error).message, { tipo: "error" }); }
  };
  const quitar = async (uid: number) => {
    try {
      const r = await pedir<{ sigueViendo: boolean }>(`/api/tareas/${t.id}/observadores/${uid}`, { metodo: "DELETE" });
      alCambiar(uid === ctx.usuario.id && !r.sigueViendo);
    } catch (e) { avisar((e as Error).message, { tipo: "error" }); }
  };
  return (
    <Seccion titulo="Observadores" cuenta={t.observadores.length ? String(t.observadores.length) : undefined}>
      <ul className="flex flex-wrap gap-1.5">
        {t.observadores.map((o) => (
          <li key={o.usuarioId} className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-hilo pl-2 text-sm">
            {o.nombre}<span className="text-xs text-texto-3">{o.unidad}</span>
            {(editable || o.soyYo) ? (
              <button type="button" onClick={() => void quitar(o.usuarioId)} aria-label={`Quitar a ${o.nombre}`} className="grid size-8 place-items-center text-texto-3 hover:text-alerta"><X aria-hidden className="size-3.5" /></button>
            ) : <span className="w-2" />}
          </li>
        ))}
        {!t.observadores.length && <li className="text-sm text-texto-3">Nadie más la sigue. Añade a alguien de otra unidad para mantenerlo al tanto.</li>}
      </ul>
      {editable && (candidatos ? (
        <Selector aria-label="Añadir observador" defaultValue="" onChange={(e) => e.target.value && void anadir(Number(e.target.value))} className="h-9">
          <option value="" disabled>Elige a quién avisar…</option>
          {candidatos.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {c.unidad}</option>)}
        </Selector>
      ) : (
        <div><Boton variante="fantasma" tamano="sm" icono={<Plus aria-hidden className="size-3.5" />}
          onClick={() => void pedir<{ personas: NonNullable<typeof candidatos> }>(`/api/tareas/${t.id}/observadores/candidatos`).then((r) => setCandidatos(r.personas)).catch((e) => avisar(e.message, { tipo: "error" }))}>
          Añadir observador
        </Boton></div>
      ))}
    </Seccion>
  );
}

function MasCampos({ t, editable, alGuardar }: { t: TareaDTO; editable: boolean; alGuardar: (c: Cambios) => void }) {
  const campos: Array<{ clave: string; rotulo: string; valor: string; tipo?: string }> = [
    { clave: "client", rotulo: "Cliente", valor: t.cliente },
    { clave: "directorate", rotulo: "Dirección o gerencia", valor: t.direccion },
    { clave: "requested_by", rotulo: "Solicitado por", valor: t.solicitadoPor },
    { clave: "budget_type", rotulo: "Tipo de presupuesto", valor: t.presupuesto },
    { clave: "start_date", rotulo: "Inicio", valor: t.inicio, tipo: "date" },
    { clave: "end_date", rotulo: "Finalización", valor: t.fin, tipo: "date" },
  ];
  const resumen = [t.cliente, t.recurrente ? `Serie ${t.recurrencia.toLowerCase()}` : ""].filter(Boolean).join(" · ");
  return (
    <details className="group border-t border-hilo pt-4">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <span className="rotulo">Más datos</span>
        {resumen && <span className="truncate text-xs text-texto-3">{resumen}</span>}
        <span aria-hidden className="ml-auto text-texto-3 transition-transform group-open:rotate-45"><Plus className="size-3.5" /></span>
      </summary>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {campos.map((c) => (
          <label key={c.clave} className="flex flex-col gap-1">
            <span className="rotulo">{c.rotulo}</span>
            {editable ? (
              <Entrada type={c.tipo ?? "text"} defaultValue={c.valor} className="h-9"
                onBlur={(e) => e.target.value.trim() !== c.valor && alGuardar({ [c.clave]: e.target.value.trim() })} />
            ) : <span className="text-sm text-texto-2">{c.valor || "—"}</span>}
          </label>
        ))}
        <div className="flex flex-col gap-1">
          <span className="rotulo">Recurrencia</span>
          <span className="text-sm text-texto-2">{t.recurrente ? `${t.recurrencia}${t.padreId ? " (parte de una serie)" : " (inicio de la serie)"}` : "No se repite"}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="rotulo">Creada por</span>
          <span className="text-sm text-texto-2">{t.creador} · <span className="font-mono cifras">{momento(t.creada)}</span></span>
        </div>
      </div>
    </details>
  );
}

const ACCIONES: Record<string, string> = {
  task_create: "Creó la tarea", task_update: "Actualizó", task_comment: "Comentó", task_delete: "Borró", task_restore: "Restauró",
  task_dependency_add: "Añadió una dependencia", task_dependency_remove: "Quitó una dependencia",
};

function Actividad({ id }: { id: number }) {
  const [lista, setLista] = useState<ActividadDTO[] | null>(null);
  return (
    <details className="group border-t border-hilo pt-4" onToggle={(e) => {
      if ((e.target as HTMLDetailsElement).open && !lista) void pedir<{ actividad: ActividadDTO[] }>(`/api/tareas/${id}/actividad`).then((r) => setLista(r.actividad)).catch(() => setLista([]));
    }}>
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <span className="rotulo">Actividad</span>
        <span aria-hidden className="ml-auto text-texto-3 transition-transform group-open:rotate-45"><Plus className="size-3.5" /></span>
      </summary>
      {!lista ? <Esqueleto className="mt-3 h-12" /> : (
        <ol className="mt-3 flex flex-col gap-2">
          {lista.map((a, i) => (
            <li key={i} className="grid grid-cols-[88px_1fr] gap-2 text-sm">
              <time dateTime={a.momento} className="font-mono text-xs text-texto-3 cifras">{momento(a.momento)}</time>
              <span><span className="font-semibold">{a.usuario}</span> <span className="text-texto-2">{ACCIONES[a.accion] ?? a.accion}</span>
                {a.detalle && <span className="block truncate text-xs text-texto-3" title={a.detalle}>{a.detalle}</span>}</span>
            </li>
          ))}
          {!lista.length && <li className="text-sm text-texto-3">Sin actividad registrada.</li>}
        </ol>
      )}
    </details>
  );
}
