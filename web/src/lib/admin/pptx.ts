/*
 * Un .pptx es un zip con [Content_Types].xml y al menos una parte bajo ppt/.
 * Se comprueba la estructura, no la extension (como _es_pptx_de_verdad de
 * Flask), leyendo el directorio central del zip a mano: sin dependencias y
 * sin descomprimir nada.
 *
 *   EOCD  firma 0x06054b50, al final (puede llevar un comentario de hasta 64 KB)
 *   CDFH  firma 0x02014b50, una por entrada; el nombre va en el offset 46
 */
export const MAX_PLANTILLA_BYTES = 15 * 1024 * 1024;

const FIRMA_EOCD = 0x06054b50;
const FIRMA_CENTRAL = 0x02014b50;

export function nombresDelZip(b: Uint8Array): string[] | null {
  if (b.length < 22) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const desdeMin = Math.max(0, b.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = b.length - 22; i >= desdeMin; i--) {
    if (v.getUint32(i, true) === FIRMA_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) return null;

  const entradas = v.getUint16(eocd + 10, true);
  const tamano = v.getUint32(eocd + 12, true);
  const inicio = v.getUint32(eocd + 16, true);
  if (inicio + tamano > b.length) return null;

  const nombres: string[] = [];
  const dec = new TextDecoder("utf-8", { fatal: false });
  let p = inicio;
  for (let n = 0; n < entradas; n++) {
    if (p + 46 > b.length || v.getUint32(p, true) !== FIRMA_CENTRAL) return null;
    const lnNombre = v.getUint16(p + 28, true);
    const lnExtra = v.getUint16(p + 30, true);
    const lnComentario = v.getUint16(p + 32, true);
    if (p + 46 + lnNombre > b.length) return null;
    nombres.push(dec.decode(b.subarray(p + 46, p + 46 + lnNombre)));
    p += 46 + lnNombre + lnExtra + lnComentario;
  }
  return nombres;
}

export function esPptxValido(b: Uint8Array): boolean {
  const nombres = nombresDelZip(b);
  if (!nombres) return false;
  return nombres.includes("[Content_Types].xml") && nombres.some((n) => n.startsWith("ppt/"));
}

/* Equivalente a secure_filename + basename: sin rutas, sin caracteres raros. */
export function nombreSeguro(nombre: string): string {
  const base = nombre.split(/[\\/]/).pop() ?? "";
  return base
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_.-]/g, "")
    .replace(/^[._]+/, "")
    .slice(0, 150);
}
