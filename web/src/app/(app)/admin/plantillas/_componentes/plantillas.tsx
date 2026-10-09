"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileUp, Trash2 } from "lucide-react";
import { Boton } from "@/components/ui/boton";
import { cx } from "@/components/ui/cx";
import { Dialogo } from "@/components/ui/dialogo";
import { CeldaEstado } from "@/components/ui/estado";
import { Vacio } from "@/components/ui/panel";
import { ProcesoSalida, type EstadoProceso } from "@/components/ui/proceso";
import { useAvisos } from "@/components/ui/avisos";
import { mensajeDe, pedir } from "@/lib/admin/cliente";
import { fBytes, fFecha } from "@/lib/admin/formato";
import type { DatosPlantillas } from "@/lib/admin/consultas";
import { claseCelda, claseFila, Tabla, Th } from "../../_componentes/comunes";

const FASES = [{ clave: "subiendo", rotulo: "Subiendo" }, { clave: "validando", rotulo: "Comprobando que es un PowerPoint" }];

/* Subida con progreso real (XMLHttpRequest expone el avance; fetch no). */
function subir(archivo: File, onProgreso: (p: number) => void): Promise<{ nombre: string; reemplazada: boolean }> {
  return new Promise((resolver, rechazar) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append("plantilla", archivo);
    xhr.open("POST", "/api/admin/plantillas");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgreso((e.loaded / e.total) * 100); };
    xhr.onload = () => {
      let d: { error?: string; nombre?: string; reemplazada?: boolean } = {};
      try { d = JSON.parse(xhr.responseText); } catch { /* respuesta vacia */ }
      if (xhr.status >= 200 && xhr.status < 300) resolver({ nombre: d.nombre ?? archivo.name, reemplazada: !!d.reemplazada });
      else rechazar(new Error(d.error ?? `Error ${xhr.status}.`));
    };
    xhr.onerror = () => rechazar(new Error("Sin conexión con el servidor. Revisa tu red y vuelve a intentarlo."));
    xhr.send(form);
  });
}

export function PantallaPlantillas({ inicial, maxBytes }: { inicial: DatosPlantillas; maxBytes: number }) {
  const router = useRouter();
  const { avisar } = useAvisos();
  const [datos, setDatos] = useState(inicial);
  const [proceso, setProceso] = useState<EstadoProceso | null>(null);
  const [encima, setEncima] = useState(false);
  const [borrar, setBorrar] = useState<DatosPlantillas["subidas"][number] | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  const recargar = async () => { setDatos(await pedir<DatosPlantillas>("/api/admin/plantillas")); router.refresh(); };

  async function elegir(archivo: File | undefined) {
    if (!archivo) return;
    if (!archivo.name.toLowerCase().endsWith(".pptx")) return setProceso({ fase: "subiendo", error: "El archivo debe ser un .pptx." });
    if (archivo.size > maxBytes) return setProceso({ fase: "subiendo", error: `Pesa ${fBytes(archivo.size)} y el límite es ${fBytes(maxBytes)}.` });
    setProceso({ fase: "subiendo", progreso: 0, mensaje: archivo.name });
    try {
      const r = await subir(archivo, (p) => setProceso(p >= 100 ? { fase: "validando", mensaje: archivo.name } : { fase: "subiendo", progreso: p, mensaje: archivo.name }));
      setProceso({ fase: "hecho" });
      avisar(`Plantilla ${r.nombre} ${r.reemplazada ? "reemplazada" : "subida"}.`, { tipo: "exito" });
      await recargar();
      setTimeout(() => setProceso(null), 2500);
    } catch (e) {
      setProceso((p) => ({ fase: p?.fase === "validando" ? "validando" : "subiendo", error: mensajeDe(e) }));
    } finally {
      if (entrada.current) entrada.current.value = "";
    }
  }

  async function eliminar() {
    if (!borrar) return;
    setTrabajando(true);
    try {
      await pedir(`/api/admin/plantillas/${borrar.id}`, { metodo: "DELETE" });
      avisar(`Plantilla ${borrar.nombre} eliminada.`, { tipo: "exito" });
      setBorrar(null);
      await recargar();
    } catch (e) { avisar(mensajeDe(e), { tipo: "error" }); } finally { setTrabajando(false); }
  }

  const ocupado = !!proceso && proceso.fase !== "hecho" && !proceso.error;

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Subir plantilla" className="rounded-md border border-hilo bg-superficie p-4 shadow-1">
        <label
          onDragOver={(e) => { e.preventDefault(); setEncima(true); }}
          onDragLeave={() => setEncima(false)}
          onDrop={(e) => { e.preventDefault(); setEncima(false); void elegir(e.dataTransfer.files[0]); }}
          className={cx("flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-sm border border-dashed px-4 py-5 text-center transition-colors duration-[var(--dur)]",
            encima ? "border-texto bg-superficie-2" : "border-hilo-fuerte hover:bg-superficie-2", ocupado && "pointer-events-none opacity-60")}
        >
          <FileUp className="size-5 text-texto-2" aria-hidden />
          <span className="font-semibold">Arrastra aquí un .pptx o pulsa para elegirlo</span>
          <span className="text-sm text-texto-3">Hasta {fBytes(maxBytes)}. Si ya hay una con ese nombre, se reemplaza.</span>
          <input ref={entrada} type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" className="sr-only"
            aria-label="Elegir plantilla .pptx" onChange={(e) => void elegir(e.target.files?.[0])} disabled={ocupado} />
        </label>
        {proceso && <div className="mt-3"><ProcesoSalida fases={FASES} estado={proceso} /></div>}
      </section>

      <Tabla etiqueta="Plantillas subidas" cabecera={<h2 className="font-rotulo text-sm font-semibold uppercase tracking-[0.14em]">Subidas</h2>}>
        {datos.subidas.length === 0 ? (
          <Vacio titulo="Ninguna subida todavía">Mientras tanto se usan las del repositorio. Sube una para cambiar el diseño de los reportes sin esperar a un despliegue.</Vacio>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead className="hidden border-b border-hilo md:table-header-group"><tr><Th>Nombre</Th><Th className="text-right">Tamaño</Th><Th>Subida por</Th><Th>Fecha</Th><Th><span className="sr-only">Acciones</span></Th></tr></thead>
            <tbody>
              {datos.subidas.map((p) => (
                <tr key={p.id} className={cx(claseFila, "flex flex-wrap items-center gap-x-3 px-4 py-2 md:table-row md:p-0")}>
                  <td className="min-w-0 flex-1 md:h-11 md:px-4">
                    <span className="font-mono text-sm">{p.nombre}</span>
                    {p.reemplazaRepositorio && <CeldaEstado texto="Sustituye a la del repositorio" tono="info" className="ml-2" />}
                  </td>
                  <td className={cx(claseCelda, "hidden text-right font-mono text-xs md:table-cell")}>{fBytes(p.bytes)}</td>
                  <td className={cx(claseCelda, "hidden text-texto-2 md:table-cell")}>{p.por ?? "—"}</td>
                  <td className={cx(claseCelda, "hidden font-mono text-xs text-texto-3 md:table-cell")}>{fFecha(p.fecha)}</td>
                  <td className="flex gap-1 md:h-11 md:px-2 md:text-right">
                    <a href={`/api/admin/plantillas/${p.id}`} download aria-label={`Descargar ${p.nombre}`} className="inline-grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-hundida hover:text-texto"><Download className="size-4" aria-hidden /></a>
                    <button type="button" onClick={() => setBorrar(p)} aria-label={`Eliminar ${p.nombre}`} className="inline-grid size-10 place-items-center rounded-sm text-texto-3 hover:bg-hundida hover:text-alerta"><Trash2 className="size-4" aria-hidden /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tabla>

      <Tabla etiqueta="Plantillas del repositorio" cabecera={<>
        <h2 className="font-rotulo text-sm font-semibold uppercase tracking-[0.14em]">Del repositorio</h2>
        <span className="text-sm text-texto-3">Vienen con la aplicación; se cambian en el repositorio, no aquí.</span>
      </>}>
        {datos.repositorio.length === 0 ? <p className="px-4 py-4 text-texto-2">No hay plantillas en el repositorio de este entorno.</p> : (
          <ul className="divide-y divide-hilo">
            {datos.repositorio.map((n) => <li key={n} className="flex h-11 items-center px-4 font-mono text-sm">{n}</li>)}
          </ul>
        )}
      </Tabla>

      <Dialogo abierto={!!borrar} onCerrar={() => setBorrar(null)} titulo="Eliminar plantilla" ancho="sm"
        pie={<><Boton variante="fantasma" onClick={() => setBorrar(null)}>Cancelar</Boton><Boton variante="peligro" cargando={trabajando} onClick={eliminar}>Eliminar plantilla</Boton></>}>
        <p><span className="font-mono">{borrar?.nombre}</span> deja de estar disponible para generar reportes{borrar?.reemplazaRepositorio ? "; vuelve a usarse la del repositorio con ese nombre" : ""}. Descárgala antes si quieres conservarla.</p>
      </Dialogo>
    </div>
  );
}
