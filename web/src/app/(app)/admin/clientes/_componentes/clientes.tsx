"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { GitMerge, Link2, Pencil, Plus, Trash2 } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { cx } from "@/components/ui/cx";
import { Dialogo } from "@/components/ui/dialogo";
import { CeldaEstado } from "@/components/ui/estado";
import { Vacio } from "@/components/ui/panel";
import { useAvisos } from "@/components/ui/avisos";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import type { FilaCliente, ListaClientes } from "@/lib/clientes/admin";
import { BuscadorDiferido, claseCelda, claseFila, Paginacion, Tabla, Th, useListaRemota } from "../../_componentes/comunes";

type Edicion = FilaCliente | "nuevo";

export function PantallaClientes({ inicial, filtrosIniciales }: { inicial: ListaClientes; filtrosIniciales: Record<string, string> }) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const { datos, filtros, cambiar, recargar, cargando, error } = useListaRemota<ListaClientes>("/api/admin/clientes", inicial, filtrosIniciales);
  const [editando, setEditando] = useState<Edicion | null>(null);
  const [uniendo, setUniendo] = useState<{ origen: FilaCliente; destinoId: string } | null>(null);
  const [borrando, setBorrando] = useState<FilaCliente | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const recargarTodo = async () => { await recargar(); router.refresh(); };
  const hayFiltro = !!(filtros.q || filtros.estado);

  async function vincular() {
    setTrabajando(true);
    try {
      const r = await pedir<{ tareas: number; nuevos: number }>("/api/admin/clientes/vincular", { cuerpo: {} });
      avisar(`${r.tareas} tarea${r.tareas === 1 ? "" : "s"} vinculada${r.tareas === 1 ? "" : "s"}${r.nuevos ? `; ${r.nuevos} cliente${r.nuevos === 1 ? "" : "s"} nuevo${r.nuevos === 1 ? "" : "s"}` : ""}.`, { tipo: "exito" });
      await recargarTodo();
    } catch (e) { avisar(mensajeDe(e), { tipo: "error" }); } finally { setTrabajando(false); }
  }

  async function unir() {
    if (!uniendo?.destinoId) return;
    setTrabajando(true);
    try {
      const r = await pedir<{ movidas: number; destino: string }>(`/api/admin/clientes/${uniendo.origen.id}/unir`, { cuerpo: { destinoId: Number(uniendo.destinoId) } });
      avisar(`«${uniendo.origen.nombre}» se unió en «${r.destino}»: ${r.movidas} tarea${r.movidas === 1 ? "" : "s"}.`, { tipo: "exito" });
      setUniendo(null);
      await recargarTodo();
    } catch (e) { avisar(mensajeDe(e), { tipo: "error" }); } finally { setTrabajando(false); }
  }

  async function borrar() {
    if (!borrando) return;
    setTrabajando(true);
    try {
      await pedir(`/api/admin/clientes/${borrando.id}`, { metodo: "DELETE" });
      avisar(`Cliente «${borrando.nombre}» eliminado.`, { tipo: "exito" });
      setBorrando(null);
      await recargarTodo();
    } catch (e) { avisar(mensajeDe(e), { tipo: "error" }); setBorrando(null); } finally { setTrabajando(false); }
  }

  return (
    <div className="flex flex-col gap-5">
      {datos.pendientes > 0 && (
        <section aria-label="Tareas sin vincular" className="flex flex-wrap items-center gap-3 rounded-md border border-aviso/40 bg-superficie px-4 py-3">
          <p className="min-w-[14rem] flex-1 text-sm">
            <span className="font-mono cifras font-semibold">{datos.pendientes}</span> tarea{datos.pendientes === 1 ? "" : "s"} con un nombre de cliente que no está vinculado
            (por ejemplo, creadas desde la versión anterior). Vincularlas las une al cliente de igual nombre o crea uno nuevo.
          </p>
          <Boton variante="secundario" icono={<Link2 className="size-4" aria-hidden />} cargando={trabajando} onClick={vincular}>Vincular pendientes</Boton>
        </section>
      )}

      <Tabla
        etiqueta="Clientes"
        cargando={cargando}
        error={error}
        cabecera={
          <>
            <BuscadorDiferido valor={filtros.q ?? ""} onCambio={(q) => cambiar({ q })} etiqueta="Buscar cliente" placeholder="Buscar cliente" />
            <Selector aria-label="Estado" value={filtros.estado ?? ""} onChange={(e) => cambiar({ estado: e.target.value })} className="w-full sm:w-48">
              <option value="">Activos e inactivos</option>
              <option value="activos">Solo activos</option>
              <option value="inactivos">Solo inactivos</option>
            </Selector>
            <div className="ml-auto"><Boton variante="primario" icono={<Plus className="size-4" aria-hidden />} onClick={() => setEditando("nuevo")}>Nuevo cliente</Boton></div>
          </>
        }
        pie={<Paginacion pagina={datos.pagina} paginas={datos.paginas} total={datos.total} nombre={datos.total === 1 ? "cliente" : "clientes"} onPagina={(p) => cambiar({ p: String(p) }, false)} />}
      >
        {datos.filas.length === 0 ? (
          <Vacio titulo={hayFiltro ? "Ningún cliente coincide" : "Todavía no hay clientes"}
            accion={hayFiltro ? <Boton variante="secundario" onClick={() => cambiar({ q: "", estado: "" })}>Quitar filtros</Boton> : <Boton variante="primario" onClick={() => setEditando("nuevo")}>Nuevo cliente</Boton>}>
            {hayFiltro ? "Prueba con otro nombre o quita el filtro de estado." : "Los clientes aparecen solos cuando alguien escribe uno en una tarea; también puedes crearlos aquí."}
          </Vacio>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="hidden border-b border-hilo md:table-header-group">
              <tr><Th>Cliente</Th><Th className="hidden lg:table-cell">Tipo</Th><Th className="hidden md:table-cell">Líder de cuenta</Th><Th className="text-right">Tareas</Th><Th>Estado</Th><Th><span className="sr-only">Acciones</span></Th></tr>
            </thead>
            <tbody>
              {datos.filas.map((c) => (
                <tr key={c.id} className={cx(claseFila, "flex flex-wrap items-center gap-x-3 px-4 py-2 md:table-row md:p-0")}>
                  <td className="min-w-0 basis-full md:basis-auto md:h-11 md:px-4 md:py-1.5">
                    <button type="button" onClick={() => setEditando(c)} className="max-w-full truncate text-left font-semibold hover:underline">{c.nombre}</button>
                    {c.parecidos.length > 0 && (
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-texto-3">
                        Parecido a
                        {c.parecidos.map((p) => (
                          <button key={p.id} type="button" onClick={() => setUniendo({ origen: c, destinoId: String(p.id) })} title={`Unir «${c.nombre}» en «${p.nombre}»`}
                            className="inline-flex items-center gap-1 rounded-sm border border-hilo px-1.5 py-0.5 text-texto-2 hover:border-hilo-fuerte hover:text-texto">
                            {p.nombre}<GitMerge className="size-3" aria-hidden />
                          </button>
                        ))}
                      </p>
                    )}
                  </td>
                  <td className={cx(claseCelda, "hidden text-texto-2 lg:table-cell")}>{c.tipo || "—"}</td>
                  <td className={cx(claseCelda, "hidden text-texto-2 md:table-cell")}>{c.lider || "—"}</td>
                  <td className={cx(claseCelda, "h-auto px-0 text-right font-mono cifras md:h-11 md:px-4")}>{c.tareas}<span className="font-sans text-texto-3 md:hidden"> tarea{c.tareas === 1 ? "" : "s"}</span></td>
                  <td className={cx(claseCelda, "h-auto px-0 md:h-11 md:px-4")}>{c.activo ? <CeldaEstado texto="Activo" tono="bien" /> : <CeldaEstado texto="Inactivo" tono="neutro" />}</td>
                  <td className="ml-auto flex gap-1 md:h-11 md:px-2 md:text-right">
                    <button type="button" onClick={() => setEditando(c)} aria-label={`Editar ${c.nombre}`} className="inline-grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-hundida hover:text-texto"><Pencil className="size-4" aria-hidden /></button>
                    <button type="button" onClick={() => setUniendo({ origen: c, destinoId: "" })} aria-label={`Unir ${c.nombre} en otro cliente`} className="inline-grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-hundida hover:text-texto"><GitMerge className="size-4" aria-hidden /></button>
                    <button type="button" onClick={() => setBorrando(c)} aria-label={`Eliminar ${c.nombre}`} className="inline-grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-hundida hover:text-alerta"><Trash2 className="size-4" aria-hidden /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tabla>

      {editando && (
        <FormularioCliente key={editando === "nuevo" ? "nuevo" : editando.id} cliente={editando === "nuevo" ? null : editando} opciones={datos.opciones}
          onCerrar={() => setEditando(null)} onGuardado={async (m) => { avisar(m, { tipo: "exito" }); setEditando(null); await recargarTodo(); }} />
      )}

      <Dialogo abierto={!!uniendo} onCerrar={() => setUniendo(null)} titulo="Unir clientes" ancho="sm"
        pie={<><Boton variante="fantasma" onClick={() => setUniendo(null)}>Cancelar</Boton><Boton variante="peligro" cargando={trabajando} disabled={!uniendo?.destinoId} onClick={unir}>Unir clientes</Boton></>}>
        {uniendo && (
          <div className="flex flex-col gap-4">
            <p>Las <span className="font-mono cifras">{uniendo.origen.tareas}</span> tarea{uniendo.origen.tareas === 1 ? "" : "s"} de <strong>{uniendo.origen.nombre}</strong> pasan al cliente que elijas y <strong>{uniendo.origen.nombre}</strong> desaparece. No se puede deshacer.</p>
            <Campo etiqueta="Unir en">
              {(a) => (
                <Selector {...a} value={uniendo.destinoId} onChange={(e) => setUniendo({ ...uniendo, destinoId: e.target.value })}>
                  <option value="">Elige el cliente que se queda…</option>
                  {datos.opciones.clientes.filter((c) => c.id !== uniendo.origen.id).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </Selector>
              )}
            </Campo>
          </div>
        )}
      </Dialogo>

      <Dialogo abierto={!!borrando} onCerrar={() => setBorrando(null)} titulo="Eliminar cliente" ancho="sm"
        pie={<><Boton variante="fantasma" onClick={() => setBorrando(null)}>Cancelar</Boton><Boton variante="peligro" cargando={trabajando} onClick={borrar}>Eliminar cliente</Boton></>}>
        {borrando && (borrando.tareas > 0
          ? <p><strong>{borrando.nombre}</strong> tiene {borrando.tareas} tarea{borrando.tareas === 1 ? "" : "s"}, así que no se puede eliminar. Únelo a otro cliente o márcalo como inactivo.</p>
          : <p>Se elimina <strong>{borrando.nombre}</strong>. No tiene tareas, pero no se puede deshacer.</p>)}
      </Dialogo>
    </div>
  );
}

function FormularioCliente({ cliente, opciones, onCerrar, onGuardado }: {
  cliente: FilaCliente | null; opciones: ListaClientes["opciones"]; onCerrar: () => void; onGuardado: (mensaje: string) => Promise<void>;
}) {
  const [nombre, setNombre] = useState(cliente?.nombre ?? "");
  const [tipo, setTipo] = useState(cliente?.tipo ?? "");
  const [lider, setLider] = useState(cliente?.liderId ? String(cliente.liderId) : "");
  const [activo, setActivo] = useState(cliente?.activo ?? true);
  const [error, setError] = useState("");
  const [errorNombre, setErrorNombre] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    setError(""); setErrorNombre("");
    if (!nombre.trim()) return setErrorNombre("El cliente necesita un nombre.");
    setGuardando(true);
    const cuerpo = { nombre, tipo, liderId: lider ? Number(lider) : null, ...(cliente ? { activo } : {}) };
    try {
      if (cliente) await pedir(`/api/admin/clientes/${cliente.id}`, { metodo: "PATCH", cuerpo });
      else await pedir("/api/admin/clientes", { cuerpo });
      await onGuardado(cliente ? `${nombre.trim()} actualizado.` : `Cliente ${nombre.trim()} creado.`);
    } catch (e) {
      const m = mensajeDe(e);
      if (/nombre|Ya existe|caracteres/i.test(m)) setErrorNombre(m); else setError(m);
    } finally { setGuardando(false); }
  }

  return (
    <Dialogo abierto onCerrar={onCerrar} titulo={cliente ? "Editar cliente" : "Nuevo cliente"}
      pie={<><Boton variante="fantasma" onClick={onCerrar}>Cancelar</Boton><Boton variante="primario" cargando={guardando} onClick={() => void guardar({ preventDefault() {} } as React.FormEvent)}>{cliente ? "Guardar cambios" : "Crear cliente"}</Boton></>}>
      <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
        {error && <p role="alert" className="rounded-sm border border-alerta/40 px-3 py-2 text-sm text-alerta">{error}</p>}
        <Campo etiqueta="Nombre" error={errorNombre} ayuda={cliente && cliente.tareas ? `Cambiarlo renombra sus ${cliente.tareas} tarea${cliente.tareas === 1 ? "" : "s"}.` : undefined}>
          {(a) => <Entrada {...a} autoFocus value={nombre} maxLength={100} onChange={(e) => setNombre(e.target.value)} autoComplete="off" />}
        </Campo>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo etiqueta="Tipo" ayuda="Libre: Corporativo, Gobierno…">
            {(a) => <Entrada {...a} list="tipos-cliente" value={tipo} maxLength={40} onChange={(e) => setTipo(e.target.value)} autoComplete="off" />}
          </Campo>
          <datalist id="tipos-cliente">{opciones.tipos.map((t) => <option key={t} value={t} />)}</datalist>
          <Campo etiqueta="Líder de cuenta">
            {(a) => (
              <Selector {...a} value={lider} onChange={(e) => setLider(e.target.value)}>
                <option value="">Sin asignar</option>
                {opciones.personas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </Selector>
            )}
          </Campo>
        </div>
        {cliente && (
          <label className="flex min-h-10 cursor-pointer items-center gap-3">
            <input type="checkbox" className="size-4 accent-[var(--texto)]" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Activo <span className="text-sm text-texto-3">(los inactivos no se sugieren al escribir una tarea)</span>
          </label>
        )}
      </form>
    </Dialogo>
  );
}
