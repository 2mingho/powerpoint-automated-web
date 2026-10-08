"use client";
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus, Trash2, UserRound } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector, AreaTexto } from "@/components/ui/campo";
import { cx } from "@/components/ui/cx";
import { Dialogo } from "@/components/ui/dialogo";
import { PanelLateral } from "@/components/ui/panel-lateral";
import { Vacio } from "@/components/ui/panel";
import { useAvisos } from "@/components/ui/avisos";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import type { DatosOrganizacion } from "@/lib/admin/consultas";
import type { NodoMando, NodoUnidad, PersonaOrg } from "@/lib/admin/mando";
import { claseCelda, claseFila, Tabla, Th } from "../../_componentes/comunes";

type Persona = DatosOrganizacion["personas"][number];
type Unidad = DatosOrganizacion["unidades"][number];
type Seleccion = { tipo: "persona"; id: number } | { tipo: "unidad"; id: number } | { tipo: "nueva-unidad" } | null;

const PAPEL: Record<string, string> = { director: "Director", manager: "Manager", empleado: "Empleado" };

export function PantallaOrganizacion({ inicial }: { inicial: DatosOrganizacion }) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [datos, setDatos] = useState(inicial);
  const [sel, setSel] = useState<Seleccion>(null);
  const [cambiado, setCambiado] = useState<number | null>(null);
  const cerrar = useCallback(() => setSel(null), []);
  const porId = useMemo(() => new Map(datos.personas.map((p) => [p.id, p])), [datos.personas]);

  const recargar = async (resaltar?: number) => {
    setDatos(await pedir<DatosOrganizacion>("/api/admin/organizacion"));
    if (resaltar) setCambiado(resaltar);
    router.refresh();
  };

  const abrirPersona = (id: number) => setSel({ tipo: "persona", id });
  const abrirUnidad = (id: number) => setSel({ tipo: "unidad", id });
  const { raices, sinLider, sueltas } = datos.arbol;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
      <section aria-labelledby="cadena" className="rounded-md border border-hilo bg-superficie shadow-1">
        <header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-hilo px-4 py-2">
          <h2 id="cadena" className="font-rotulo text-sm font-semibold uppercase tracking-[0.14em]">Cadena de mando</h2>
          <p className="text-sm text-texto-3">Pulsa una persona o una unidad para reasignarla.</p>
        </header>
        {raices.length === 0 && sinLider.length === 0 && sueltas.length === 0 ? (
          <Vacio titulo="Aún no hay organización">Crea unidades y asígnales un líder: a partir de ahí se ve quién supervisa qué.</Vacio>
        ) : (
          <div className="px-2 py-2 md:px-3">
            <ul role="tree" aria-label="Cadena de mando">
              {raices.map((n) => <NodoArbol key={n.persona.id} nodo={n} nivel={1} porId={porId} onPersona={abrirPersona} onUnidad={abrirUnidad} cambiado={cambiado} />)}
            </ul>
            {sinLider.length > 0 && (
              <div className="mt-3 border-t border-hilo pt-3">
                <p className="rotulo px-2 pb-1 text-aviso">Unidades sin líder: nadie recibe sus solicitudes</p>
                <ul role="tree" aria-label="Unidades sin líder">
                  {sinLider.map((u) => <RamaUnidad key={u.unidad.id} n={u} nivel={1} porId={porId} onPersona={abrirPersona} onUnidad={abrirUnidad} cambiado={cambiado} />)}
                </ul>
              </div>
            )}
            {sueltas.length > 0 && (
              <div className="mt-3 border-t border-hilo pt-3">
                <p className="rotulo px-2 pb-1">Sin unidad liderada ni superior con mando</p>
                <ul className="flex flex-wrap gap-1 px-1">
                  {sueltas.map((p) => (
                    <li key={p.id}><button type="button" onClick={() => abrirPersona(p.id)} className="flex min-h-10 items-center gap-1.5 rounded-sm border border-hilo px-2.5 text-sm hover:bg-superficie-2"><UserRound className="size-3.5 text-texto-3" aria-hidden />{p.nombre}</button></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>

      <Tabla
        etiqueta="Unidades"
        cabecera={<>
          <h2 className="font-rotulo text-sm font-semibold uppercase tracking-[0.14em]">Unidades</h2>
          <div className="ml-auto"><Boton variante="secundario" tamano="sm" icono={<Plus className="size-4" aria-hidden />} onClick={() => setSel({ tipo: "nueva-unidad" })}>Nueva unidad</Boton></div>
        </>}
      >
        {datos.unidades.length === 0 ? <Vacio titulo="Sin unidades">Crea la primera para poder asignar personas y líderes.</Vacio> : (
          <table className="w-full border-collapse text-sm">
            <thead className="border-b border-hilo"><tr><Th>Unidad</Th><Th>Líderes</Th><Th className="text-right">Personas</Th><Th className="text-right">Tareas</Th></tr></thead>
            <tbody>
              {datos.unidades.map((u) => (
                <tr key={u.id} className={cx(claseFila, "cursor-pointer")} onClick={() => abrirUnidad(u.id)}>
                  <td className={claseCelda}><button type="button" className="text-left font-semibold hover:underline" onClick={(e) => { e.stopPropagation(); abrirUnidad(u.id); }}>{u.nombre}</button></td>
                  <td className={cx(claseCelda, "text-texto-2")}>{u.lideres.length ? u.lideres.map((l) => l.nombre).join(", ") : <span className="text-aviso">Sin líder</span>}</td>
                  <td className={cx(claseCelda, "text-right font-mono cifras")}>{u.personas}</td>
                  <td className={cx(claseCelda, "text-right font-mono cifras")}>{u.tareas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tabla>

      <PanelLateral
        abierto={sel !== null}
        onCerrar={cerrar}
        titulo={sel?.tipo === "persona" ? porId.get(sel.id)?.nombre ?? "Persona" : sel?.tipo === "unidad" ? datos.unidades.find((u) => u.id === sel.id)?.nombre ?? "Unidad" : "Nueva unidad"}
        subtitulo={sel?.tipo === "persona" ? <PapelYAlcance p={porId.get(sel.id)} /> : undefined}
      >
        {sel?.tipo === "persona" && porId.get(sel.id) && (
          <ReasignarPersona key={`p${sel.id}`} p={porId.get(sel.id)!} datos={datos}
            onHecho={async (m) => { avisar(m, { tipo: "exito" }); await recargar(sel.id); }} onError={(m) => avisar(m, { tipo: "error" })} />
        )}
        {sel?.tipo === "unidad" && datos.unidades.find((u) => u.id === sel.id) && (
          <EditarUnidad key={`u${sel.id}`} u={datos.unidades.find((u) => u.id === sel.id)!} personas={datos.personas}
            onHecho={async (m, cerrarPanel) => { avisar(m, { tipo: "exito" }); if (cerrarPanel) setSel(null); await recargar(); }} onError={(m) => avisar(m, { tipo: "error" })} />
        )}
        {sel?.tipo === "nueva-unidad" && (
          <NuevaUnidad onHecho={async (m) => { avisar(m, { tipo: "exito" }); setSel(null); await recargar(); }} />
        )}
      </PanelLateral>
    </div>
  );
}

function PapelYAlcance({ p }: { p?: Persona }) {
  if (!p) return null;
  return (
    <span>
      {PAPEL[p.papel]}{p.unidad ? ` · ${p.unidad}` : " · sin unidad"}
      {p.cadena.length > 0 && <span className="block text-xs text-texto-3">Reporta a {p.cadena.join(" → ")}</span>}
    </span>
  );
}

function FilaPersona({ p, papel, extra, onClick, cambiado }: { p: PersonaOrg; papel?: string; extra?: React.ReactNode; onClick: () => void; cambiado: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={cx("group flex min-h-10 w-full items-center gap-2 rounded-sm px-2 text-left transition-colors duration-[var(--dur)] hover:bg-superficie-2",
        cambiado && "bg-marca/25 motion-safe:animate-[encendido_2.4s_var(--curva)]")}>
      <UserRound className="size-4 shrink-0 text-texto-3" aria-hidden />
      <span className={cx("truncate", papel ? "font-semibold" : "text-texto-2")}>{p.nombre}</span>
      {papel && <span className="shrink-0 rounded-sm border border-hilo-fuerte px-1.5 font-rotulo text-[0.6875rem] font-semibold uppercase tracking-[0.1em] text-texto-2">{papel}</span>}
      {extra}
    </button>
  );
}

function NodoArbol({ nodo, nivel, porId, onPersona, onUnidad, cambiado }: {
  nodo: NodoMando; nivel: number; porId: Map<number, Persona>; onPersona: (id: number) => void; onUnidad: (id: number) => void; cambiado: number | null;
}) {
  const p = porId.get(nodo.persona.id);
  const hijos = nodo.subordinados.length + nodo.unidades.length + (nodo.directos.length ? 1 : 0);
  return (
    <li role="treeitem" aria-level={nivel} aria-expanded={hijos ? true : undefined} aria-selected={false}>
      <FilaPersona p={nodo.persona} papel={PAPEL[nodo.papel]} onClick={() => onPersona(nodo.persona.id)} cambiado={cambiado === nodo.persona.id}
        extra={p && p.alcance.length > 0 && <span className="ml-auto hidden truncate text-xs text-texto-3 sm:inline">Alcanza {p.alcance.length} unidad{p.alcance.length === 1 ? "" : "es"}</span>} />
      {hijos > 0 && (
        <ul role="group" className="ml-4 border-l border-hilo pl-2">
          {nodo.unidades.map((u) => <RamaUnidad key={u.unidad.id} n={u} nivel={nivel + 1} porId={porId} onPersona={onPersona} onUnidad={onUnidad} cambiado={cambiado} />)}
          {nodo.subordinados.map((s) => <NodoArbol key={s.persona.id} nodo={s} nivel={nivel + 1} porId={porId} onPersona={onPersona} onUnidad={onUnidad} cambiado={cambiado} />)}
          {nodo.directos.length > 0 && (
            <li role="treeitem" aria-level={nivel + 1} aria-selected={false}>
              <p className="rotulo px-2 pt-1">Le reportan sin estar en sus unidades</p>
              <ul role="group">{nodo.directos.map((d) => <li key={d.id} role="treeitem" aria-level={nivel + 2} aria-selected={false}><FilaPersona p={d} onClick={() => onPersona(d.id)} cambiado={cambiado === d.id} /></li>)}</ul>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

function RamaUnidad({ n, nivel, onPersona, onUnidad, cambiado }: {
  n: NodoUnidad; nivel: number; porId: Map<number, Persona>; onPersona: (id: number) => void; onUnidad: (id: number) => void; cambiado: number | null;
}) {
  return (
    <li role="treeitem" aria-level={nivel} aria-expanded={n.miembros.length ? true : undefined} aria-selected={false}>
      <button type="button" onClick={() => onUnidad(n.unidad.id)} className="flex min-h-10 w-full items-center gap-2 rounded-sm px-2 text-left hover:bg-superficie-2">
        <Building2 className="size-4 shrink-0 text-texto-2" aria-hidden />
        <span className="font-rotulo text-sm font-semibold uppercase tracking-[0.08em]">{n.unidad.nombre}</span>
        <span className="font-mono text-xs text-texto-3 cifras">{n.miembros.length}</span>
      </button>
      {n.miembros.length > 0 && (
        <ul role="group" className="ml-4 grid border-l border-hilo pl-2 sm:grid-cols-2 lg:grid-cols-3">
          {n.miembros.map((m) => <li key={m.id} role="treeitem" aria-level={nivel + 1} aria-selected={false}><FilaPersona p={m} onClick={() => onPersona(m.id)} cambiado={cambiado === m.id} /></li>)}
        </ul>
      )}
    </li>
  );
}

function ReasignarPersona({ p, datos, onHecho, onError }: { p: Persona; datos: DatosOrganizacion; onHecho: (m: string) => Promise<void>; onError: (m: string) => void }) {
  const lideradasAhora = datos.unidades.filter((u) => u.lideres.some((l) => l.id === p.id)).map((u) => u.id);
  const [superior, setSuperior] = useState(p.managerId ? String(p.managerId) : "");
  const [unidad, setUnidad] = useState(p.unidadId ? String(p.unidadId) : "");
  const [lidera, setLidera] = useState<number[]>(lideradasAhora);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const pasos: string[] = [];
      if ((p.managerId ? String(p.managerId) : "") !== superior) {
        await pedir("/api/admin/organizacion/superior", { cuerpo: { userId: p.id, managerId: superior ? Number(superior) : null } });
        pasos.push(superior ? `reporta a ${datos.personas.find((x) => x.id === Number(superior))?.nombre}` : "ya no reporta a nadie");
      }
      if ((p.unidadId ? String(p.unidadId) : "") !== unidad) {
        await pedir(`/api/admin/usuarios/${p.id}`, { metodo: "PATCH", cuerpo: { unidadId: unidad ? Number(unidad) : null } });
        pasos.push(unidad ? `pasa a ${datos.unidades.find((u) => u.id === Number(unidad))?.nombre}` : "queda sin unidad");
      }
      for (const id of lidera.filter((x) => !lideradasAhora.includes(x))) {
        await pedir("/api/admin/organizacion/lideres", { cuerpo: { unidadId: id, userId: p.id } });
        pasos.push(`lidera ${datos.unidades.find((u) => u.id === id)?.nombre}`);
      }
      for (const id of lideradasAhora.filter((x) => !lidera.includes(x))) {
        await pedir("/api/admin/organizacion/lideres", { metodo: "DELETE", cuerpo: { unidadId: id, userId: p.id } });
        pasos.push(`deja ${datos.unidades.find((u) => u.id === id)?.nombre}`);
      }
      if (pasos.length) await onHecho(`${p.nombre} ${pasos.join(", ")}.`);
    } catch (e) {
      setError(mensajeDe(e));
      onError(mensajeDe(e));
    } finally {
      setGuardando(false);
    }
  }

  const cambios = (p.managerId ? String(p.managerId) : "") !== superior || (p.unidadId ? String(p.unidadId) : "") !== unidad
    || lidera.length !== lideradasAhora.length || lidera.some((x) => !lideradasAhora.includes(x));

  return (
    <div className="flex flex-col gap-4">
      {error && <p role="alert" className="rounded-sm border border-alerta/40 px-3 py-2 text-sm text-alerta">{error}</p>}
      <Campo etiqueta="Reporta a" ayuda="Quien está por encima hereda lo que esta persona lidera.">
        {(a) => (
          <Selector {...a} value={superior} onChange={(e) => setSuperior(e.target.value)}>
            <option value="">Nadie</option>
            {datos.personas.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.nombre}{x.papel !== "empleado" ? ` · ${PAPEL[x.papel]}` : ""}</option>)}
          </Selector>
        )}
      </Campo>
      <Campo etiqueta="Pertenece a">
        {(a) => (
          <Selector {...a} value={unidad} onChange={(e) => setUnidad(e.target.value)}>
            <option value="">Sin unidad</option>
            {datos.unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </Selector>
        )}
      </Campo>
      <fieldset>
        <legend className="rotulo mb-1.5">Lidera</legend>
        {datos.unidades.map((u) => (
          <label key={u.id} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-sm px-2 hover:bg-superficie-2">
            <input type="checkbox" className="size-4 accent-[var(--texto)]" checked={lidera.includes(u.id)} onChange={(e) => setLidera((l) => e.target.checked ? [...l, u.id] : l.filter((x) => x !== u.id))} />
            <span className="flex-1">{u.nombre}</span>
            {u.lideres.filter((l) => l.id !== p.id).length > 0 && <span className="text-xs text-texto-3">con {u.lideres.filter((l) => l.id !== p.id).map((l) => l.nombre).join(", ")}</span>}
          </label>
        ))}
      </fieldset>
      <div className="rounded-sm bg-superficie-2 px-3 py-2.5 text-sm">
        <p className="rotulo mb-1">Alcance deducido hoy</p>
        {p.alcance.length ? <p>{p.alcance.join(", ")} <span className="text-texto-3">· {p.aCargo} persona{p.aCargo === 1 ? "" : "s"} a cargo</span></p>
          : <p className="text-texto-2">Ninguna: no ve el panel de equipo.</p>}
      </div>
      <Boton variante="primario" cargando={guardando} disabled={!cambios} onClick={guardar}>Guardar reasignación</Boton>
    </div>
  );
}

function EditarUnidad({ u, personas, onHecho, onError }: { u: Unidad; personas: Persona[]; onHecho: (m: string, cerrar?: boolean) => Promise<void>; onError: (m: string) => void }) {
  const [nombre, setNombre] = useState(u.nombre);
  const [descripcion, setDescripcion] = useState(u.descripcion);
  const [nuevoLider, setNuevoLider] = useState("");
  const [borrar, setBorrar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accion = async (f: () => Promise<unknown>, m: string, cerrar = false) => {
    setGuardando(true); setError(null);
    try { await f(); await onHecho(m, cerrar); } catch (e) { setError(mensajeDe(e)); onError(mensajeDe(e)); } finally { setGuardando(false); }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <p role="alert" className="rounded-sm border border-alerta/40 px-3 py-2 text-sm text-alerta">{error}</p>}
      <Campo etiqueta="Nombre">{(a) => <Entrada {...a} value={nombre} maxLength={100} onChange={(e) => setNombre(e.target.value)} />}</Campo>
      <Campo etiqueta="Descripción">{(a) => <AreaTexto {...a} value={descripcion} maxLength={500} onChange={(e) => setDescripcion(e.target.value)} className="min-h-16" />}</Campo>
      <Boton variante="secundario" cargando={guardando} disabled={nombre === u.nombre && descripcion === u.descripcion}
        onClick={() => accion(() => pedir(`/api/admin/unidades/${u.id}`, { metodo: "PATCH", cuerpo: { nombre, descripcion } }), `Unidad ${nombre} actualizada.`)}>Guardar unidad</Boton>

      <section aria-label="Líderes" className="border-t border-hilo pt-4">
        <h3 className="rotulo mb-2">Líderes</h3>
        {u.lideres.length === 0 && <p className="mb-2 text-sm text-aviso">Sin líder: nadie recibe sus solicitudes ni ve su carga.</p>}
        <ul className="mb-2 divide-y divide-hilo">
          {u.lideres.map((l) => (
            <li key={l.id} className="flex min-h-11 items-center justify-between gap-2">
              <span>{l.nombre}</span>
              <Boton variante="fantasma" tamano="sm" onClick={() => accion(() => pedir("/api/admin/organizacion/lideres", { metodo: "DELETE", cuerpo: { unidadId: u.id, userId: l.id } }), `${l.nombre} deja de liderar ${u.nombre}.`)}>Quitar</Boton>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Selector aria-label="Persona a añadir como líder" value={nuevoLider} onChange={(e) => setNuevoLider(e.target.value)}>
            <option value="">Añadir líder…</option>
            {personas.filter((p) => !u.lideres.some((l) => l.id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </Selector>
          <Boton variante="secundario" disabled={!nuevoLider} cargando={guardando}
            onClick={() => accion(() => pedir("/api/admin/organizacion/lideres", { cuerpo: { unidadId: u.id, userId: Number(nuevoLider) } }), `${personas.find((p) => p.id === Number(nuevoLider))?.nombre} lidera ${u.nombre}.`)}>Añadir</Boton>
        </div>
      </section>

      <section aria-label="Eliminar unidad" className="border-t border-hilo pt-4">
        <Boton variante="peligro" icono={<Trash2 className="size-4" aria-hidden />} onClick={() => setBorrar(true)} disabled={u.personas > 0 || u.tareas > 0}>Eliminar unidad</Boton>
        {(u.personas > 0 || u.tareas > 0) && <p className="mt-1.5 text-sm text-texto-3">Tiene {u.personas} persona(s) y {u.tareas} tarea(s): muévelas antes de eliminarla.</p>}
      </section>
      <Dialogo abierto={borrar} onCerrar={() => setBorrar(false)} titulo="Eliminar unidad" ancho="sm"
        pie={<><Boton variante="fantasma" onClick={() => setBorrar(false)}>Cancelar</Boton><Boton variante="peligro" cargando={guardando}
          onClick={() => { setBorrar(false); void accion(() => pedir(`/api/admin/unidades/${u.id}`, { metodo: "DELETE" }), `Unidad ${u.nombre} eliminada.`, true); }}>Eliminar</Boton></>}>
        <p><strong>{u.nombre}</strong> desaparece junto con sus asignaciones de liderazgo. No se puede deshacer.</p>
      </Dialogo>
    </div>
  );
}

function NuevaUnidad({ onHecho }: { onHecho: (m: string) => Promise<void> }) {
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [guardando, setGuardando] = useState(false);
  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return setError("El nombre es obligatorio.");
    setGuardando(true);
    try { await pedir("/api/admin/unidades", { cuerpo: { nombre, descripcion } }); await onHecho(`Unidad ${nombre} creada.`); }
    catch (er) { setError(mensajeDe(er)); } finally { setGuardando(false); }
  }
  return (
    <form onSubmit={crear} noValidate className="flex flex-col gap-4">
      <Campo etiqueta="Nombre" error={error}>{(a) => <Entrada {...a} value={nombre} maxLength={100} onChange={(e) => setNombre(e.target.value)} />}</Campo>
      <Campo etiqueta="Descripción" ayuda="Opcional: qué hace la unidad.">{(a) => <AreaTexto {...a} value={descripcion} maxLength={500} onChange={(e) => setDescripcion(e.target.value)} className="min-h-16" />}</Campo>
      <Boton type="submit" variante="primario" cargando={guardando}>Crear unidad</Boton>
    </form>
  );
}
