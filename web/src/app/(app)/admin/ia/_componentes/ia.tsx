"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plug, Plus, Power, Trash2 } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { Campo, Entrada, Selector } from "@/components/ui/campo";
import { cx } from "@/components/ui/cx";
import { Dialogo } from "@/components/ui/dialogo";
import { CeldaEstado } from "@/components/ui/estado";
import { PanelLateral } from "@/components/ui/panel-lateral";
import { Vacio } from "@/components/ui/panel";
import { useAvisos } from "@/components/ui/avisos";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import { fCompacto, fEntero, fFechaHora, fUsd } from "@/lib/admin/formato";
import type { DatosIa } from "@/lib/admin/consultas";
import { claseCelda, claseFila, Tabla, Th } from "../../_componentes/comunes";

type Conexion = DatosIa["conexiones"][number];

export function PantallaIa({ inicial, proveedores, precios }: { inicial: DatosIa; proveedores: string[]; precios: Record<string, [number, number]> }) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [datos, setDatos] = useState(inicial);
  const [editando, setEditando] = useState<Conexion | "nueva" | null>(null);
  const [borrar, setBorrar] = useState<Conexion | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [prueba, setPrueba] = useState<Record<number, { ok: boolean; mensaje: string }>>({});
  const cerrar = useCallback(() => setEditando(null), []);

  const recargar = async () => { setDatos(await pedir<DatosIa>("/api/admin/ia")); router.refresh(); };

  async function accion(clave: string, url: string, mensaje: string) {
    setOcupado(clave);
    try { await pedir(url, { cuerpo: {} }); avisar(mensaje, { tipo: "exito" }); await recargar(); }
    catch (e) { avisar(mensajeDe(e), { tipo: "error" }); } finally { setOcupado(null); }
  }

  async function probar(c: Conexion) {
    setOcupado(`probar${c.id}`);
    try {
      const r = await pedir<{ ok: boolean; mensaje: string }>(`/api/admin/ia/${c.id}/probar`, { cuerpo: {} });
      setPrueba((p) => ({ ...p, [c.id]: r }));
    } catch (e) { setPrueba((p) => ({ ...p, [c.id]: { ok: false, mensaje: mensajeDe(e) } })); } finally { setOcupado(null); }
  }

  async function eliminar() {
    if (!borrar) return;
    setOcupado("borrar");
    try { await pedir(`/api/admin/ia/${borrar.id}`, { metodo: "DELETE" }); avisar(`Conexión ${borrar.nombre} eliminada. Su consumo se conserva.`, { tipo: "exito" }); setBorrar(null); await recargar(); }
    catch (e) { avisar(mensajeDe(e), { tipo: "error" }); } finally { setOcupado(null); }
  }

  const activa = datos.conexiones.find((c) => c.activa);
  const maxCoste = Math.max(0, ...datos.consumo.map((c) => c.coste));

  return (
    <div className="flex flex-col gap-5">
      {!activa && (
        <p role="status" className="rounded-md border border-aviso/40 bg-superficie px-4 py-3 text-sm">
          <strong>Ninguna conexión activa.</strong> {datos.hayRespaldoEntorno ? "Se usa la clave de Groq del entorno como respaldo." : "Los reportes se generan sin el análisis de IA hasta que actives una."}
        </p>
      )}
      <Tabla etiqueta="Conexiones" cabecera={<>
        <h2 className="font-rotulo text-sm font-semibold uppercase tracking-[0.14em]">Conexiones</h2>
        <div className="ml-auto"><Boton variante="primario" icono={<Plus className="size-4" aria-hidden />} onClick={() => setEditando("nueva")}>Nueva conexión</Boton></div>
      </>}>
        {datos.conexiones.length === 0 ? (
          <Vacio titulo="Sin conexiones" accion={<Boton variante="primario" onClick={() => setEditando("nueva")}>Nueva conexión</Boton>}>
            Añade una con su proveedor, modelo y clave; después actívala y pruébala.
          </Vacio>
        ) : (
          <ul className="divide-y divide-hilo">
            {datos.conexiones.map((c) => (
              <li key={c.id} className="grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto] md:items-center">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{c.nombre}</span>
                    {c.activa ? <CeldaEstado texto="Activa" tono="bien" /> : <CeldaEstado texto="En pausa" tono="neutro" />}
                  </p>
                  <p className="truncate font-mono text-xs text-texto-3">{c.proveedor} · {c.modelo}</p>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 text-sm">
                  <dt className="rotulo">Tarifa / 1M</dt><dd className="font-mono text-xs cifras">{c.precioIn} / {c.precioOut}</dd>
                  <dt className="rotulo">Clave</dt><dd className="font-mono text-xs" aria-label="Clave enmascarada">{c.clave}</dd>
                </dl>
                <div className="min-w-0 text-sm">
                  {prueba[c.id] ? <p role="status" className={cx(prueba[c.id].ok ? "text-bien" : "text-alerta")}>{prueba[c.id].mensaje}</p> : <p className="text-texto-3">Creada {fFechaHora(c.creada)}{c.por ? ` por ${c.por}` : ""}</p>}
                </div>
                <div className="flex flex-wrap gap-1 md:justify-end">
                  {c.activa
                    ? <Boton variante="secundario" tamano="sm" icono={<Power className="size-3.5" aria-hidden />} cargando={ocupado === `act${c.id}`} onClick={() => accion(`act${c.id}`, `/api/admin/ia/${c.id}/desactivar`, `${c.nombre} en pausa. Las funciones de IA quedan detenidas.`)}>Pausar</Boton>
                    : <Boton variante="secundario" tamano="sm" icono={<Power className="size-3.5" aria-hidden />} cargando={ocupado === `act${c.id}`} onClick={() => accion(`act${c.id}`, `/api/admin/ia/${c.id}/activar`, `${c.nombre} es ahora la conexión activa.`)}>Activar</Boton>}
                  <Boton variante="fantasma" tamano="sm" icono={<Plug className="size-3.5" aria-hidden />} cargando={ocupado === `probar${c.id}`} onClick={() => probar(c)}>Probar</Boton>
                  <button type="button" onClick={() => setEditando(c)} aria-label={`Editar ${c.nombre}`} className="grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-superficie-2 hover:text-texto"><Pencil className="size-4" aria-hidden /></button>
                  <button type="button" onClick={() => setBorrar(c)} aria-label={`Eliminar ${c.nombre}`} className="grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-superficie-2 hover:text-alerta"><Trash2 className="size-4" aria-hidden /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Tabla>

      <Tabla etiqueta="Consumo por modelo" cabecera={<>
        <h2 className="font-rotulo text-sm font-semibold uppercase tracking-[0.14em]">Consumo por modelo</h2>
        <span className="text-sm text-texto-3">Histórico completo. El coste se congela al hacer cada llamada.</span>
      </>}>
        {datos.consumo.length === 0 ? <p className="px-4 py-4 text-texto-2">Aún no se ha hecho ninguna llamada.</p> : (
          <div>
            <table className="w-full border-collapse text-sm">
              <thead className="border-b border-hilo"><tr><Th>Modelo</Th><Th className="text-right">Llamadas</Th><Th className="hidden text-right sm:table-cell">Fallos</Th><Th className="hidden text-right md:table-cell">Tokens entrada</Th><Th className="hidden text-right md:table-cell">Tokens salida</Th><Th className="md:w-[28%]">Coste</Th><Th className="hidden lg:table-cell">Última</Th></tr></thead>
              <tbody>
                {datos.consumo.map((c) => (
                  <tr key={`${c.proveedor}${c.modelo}`} className={claseFila}>
                    <td className={cx(claseCelda, "max-w-0 truncate")}><span className="font-mono text-xs">{c.modelo}</span> <span className="text-texto-3">· {c.proveedor}</span></td>
                    <td className={cx(claseCelda, "text-right font-mono cifras")}>{fEntero(c.llamadas)}</td>
                    <td className={cx(claseCelda, "hidden text-right font-mono cifras sm:table-cell", c.fallos ? "text-alerta" : "text-texto-3")}>{c.fallos}</td>
                    <td className={cx(claseCelda, "hidden text-right font-mono cifras md:table-cell")}>{fCompacto(c.tokensIn)}</td>
                    <td className={cx(claseCelda, "hidden text-right font-mono cifras md:table-cell")}>{fCompacto(c.tokensOut)}</td>
                    <td className={claseCelda}>
                      <span className="flex items-center gap-2">
                        <span aria-hidden className="hidden h-2 flex-1 overflow-hidden rounded-full bg-hundida sm:block">
                          <span className="block h-full rounded-full bg-texto-2" style={{ width: `${maxCoste ? Math.max(2, (c.coste / maxCoste) * 100) : 0}%` }} />
                        </span>
                        <span className="w-24 text-right font-mono text-xs cifras">{fUsd(c.coste)}</span>
                      </span>
                    </td>
                    <td className={cx(claseCelda, "hidden font-mono text-xs text-texto-3 lg:table-cell")}>{fFechaHora(c.ultima)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-hilo-fuerte">
                <tr>
                  <td className={cx(claseCelda, "rotulo")}>Total</td>
                  <td className={cx(claseCelda, "text-right font-mono font-semibold cifras")}>{fEntero(datos.totales.llamadas)}</td>
                  <td className={cx(claseCelda, "hidden sm:table-cell")} />
                  <td className={cx(claseCelda, "hidden text-right font-mono cifras md:table-cell")}>{fCompacto(datos.totales.tokensIn)}</td>
                  <td className={cx(claseCelda, "hidden text-right font-mono cifras md:table-cell")}>{fCompacto(datos.totales.tokensOut)}</td>
                  <td className={cx(claseCelda, "text-right font-mono font-semibold cifras")}>{fUsd(datos.totales.coste)}</td>
                  <td className="hidden lg:table-cell" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Tabla>

      {datos.porUso.length > 0 && (
        <Tabla etiqueta="Consumo por uso" cabecera={<h2 className="font-rotulo text-sm font-semibold uppercase tracking-[0.14em]">En qué se gasta</h2>}>
          <ul className="divide-y divide-hilo">
            {datos.porUso.map((u) => (
              <li key={u.uso} className="flex h-11 items-center gap-4 px-4 text-sm">
                <span className="flex-1 font-mono text-xs">{u.uso}</span>
                <span className="font-mono cifras text-texto-2">{fEntero(u.llamadas)} llamadas</span>
                <span className="w-24 text-right font-mono cifras">{fUsd(u.coste)}</span>
              </li>
            ))}
          </ul>
        </Tabla>
      )}

      <PanelLateral abierto={editando !== null} onCerrar={cerrar} titulo={editando === "nueva" ? "Nueva conexión" : editando ? editando.nombre : ""}
        subtitulo={editando && editando !== "nueva" ? "Deja la clave vacía para conservar la actual." : "La clave se guarda en el servidor y no vuelve a mostrarse."}>
        {editando !== null && (
          <FormularioConexion key={editando === "nueva" ? "nueva" : editando.id} c={editando === "nueva" ? null : editando} proveedores={proveedores} precios={precios}
            onHecho={async (m) => { avisar(m, { tipo: "exito" }); setEditando(null); await recargar(); }} />
        )}
      </PanelLateral>

      <Dialogo abierto={!!borrar} onCerrar={() => setBorrar(null)} titulo="Eliminar conexión" ancho="sm"
        pie={<><Boton variante="fantasma" onClick={() => setBorrar(null)}>Cancelar</Boton><Boton variante="peligro" cargando={ocupado === "borrar"} onClick={eliminar}>Eliminar conexión</Boton></>}>
        <p><strong>{borrar?.nombre}</strong> y su clave se borran. El consumo que generó se conserva en el histórico.{borrar?.activa ? " Es la conexión activa: las funciones de IA quedarán en pausa." : ""}</p>
      </Dialogo>
    </div>
  );
}

function FormularioConexion({ c, proveedores, precios, onHecho }: { c: Conexion | null; proveedores: string[]; precios: Record<string, [number, number]>; onHecho: (m: string) => Promise<void> }) {
  const [nombre, setNombre] = useState(c?.nombre ?? "");
  const [proveedor, setProveedor] = useState(c?.proveedor ?? proveedores[0]);
  const [modelo, setModelo] = useState(c?.modelo ?? "");
  const [clave, setClave] = useState("");
  const [precioIn, setPrecioIn] = useState(String(c?.precioIn ?? ""));
  const [precioOut, setPrecioOut] = useState(String(c?.precioOut ?? ""));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  function cambiarModelo(m: string) {
    setModelo(m);
    const p = precios[m.trim()];
    if (p && !precioIn && !precioOut) { setPrecioIn(String(p[0])); setPrecioOut(String(p[1])); }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (!nombre.trim()) er.nombre = "Ponle un nombre.";
    if (!modelo.trim()) er.modelo = "Escribe el modelo.";
    if (!c && !clave.trim()) er.clave = "La clave es obligatoria al crear.";
    setErrores(er);
    if (Object.keys(er).length) return;
    setGuardando(true);
    const cuerpo = { nombre, proveedor, modelo, clave, precioIn, precioOut };
    try {
      if (c) await pedir(`/api/admin/ia/${c.id}`, { metodo: "PATCH", cuerpo });
      else await pedir("/api/admin/ia", { cuerpo });
      await onHecho(c ? `Conexión ${nombre} actualizada.` : `Conexión ${nombre} creada. Actívala para usarla.`);
    } catch (er2) { setErrores({ general: mensajeDe(er2) }); } finally { setGuardando(false); }
  }

  return (
    <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
      {errores.general && <p role="alert" className="rounded-sm border border-alerta/40 px-3 py-2 text-sm text-alerta">{errores.general}</p>}
      <Campo etiqueta="Nombre" error={errores.nombre}>{(a) => <Entrada {...a} value={nombre} maxLength={100} placeholder="Groq producción" onChange={(e) => setNombre(e.target.value)} />}</Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Proveedor">{(a) => <Selector {...a} value={proveedor} onChange={(e) => setProveedor(e.target.value)}>{proveedores.map((p) => <option key={p} value={p}>{p}</option>)}</Selector>}</Campo>
        <Campo etiqueta="Modelo" error={errores.modelo}>{(a) => <Entrada {...a} value={modelo} maxLength={150} placeholder="claude-sonnet-5" onChange={(e) => cambiarModelo(e.target.value)} className="font-mono" />}</Campo>
      </div>
      <Campo etiqueta={c ? "Clave nueva" : "Clave API"} error={errores.clave} ayuda={c ? `Actual: ${c.clave}` : undefined}>
        {(a) => <Entrada {...a} type="password" autoComplete="new-password" value={clave} onChange={(e) => setClave(e.target.value)} placeholder={c ? "Vacía = conservar" : "sk-…"} />}
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Entrada US$ / 1M">{(a) => <Entrada {...a} inputMode="decimal" value={precioIn} onChange={(e) => setPrecioIn(e.target.value)} placeholder="3.00" className="font-mono" />}</Campo>
        <Campo etiqueta="Salida US$ / 1M">{(a) => <Entrada {...a} inputMode="decimal" value={precioOut} onChange={(e) => setPrecioOut(e.target.value)} placeholder="15.00" className="font-mono" />}</Campo>
      </div>
      <p className="-mt-2 text-sm text-texto-3">Sin tarifa se cuentan los tokens pero el coste queda en 0. Los modelos de Anthropic conocidos la rellenan solos.</p>
      <Boton type="submit" variante="primario" cargando={guardando}>{c ? "Guardar conexión" : "Crear conexión"}</Boton>
    </form>
  );
}
