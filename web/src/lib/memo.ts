/*
 * Memoria para no repetir consultas dentro de una misma peticion (o por unos segundos).
 *
 * `cache()` de React solo deduplica mientras se renderiza una pagina: en una ruta de API
 * (un manejador) cada llamada repetia la consulta. Medido con 60.000 tareas, una sola
 * lista hacia 4 veces la misma lectura de las personas a cargo y 4 la del catalogo.
 */

/*
 * Memoria por objeto: vale mientras viva el objeto. Con el usuario de la peticion como
 * clave (nace y muere con ella), es memoria de UNA peticion: nunca sirve el alcance de
 * una persona a otra ni de una peticion a la siguiente. Una promesa fallida no se guarda.
 */
export function porObjeto<A extends object, R>(fn: (a: A) => Promise<R>): (a: A) => Promise<R> {
  const memoria = new WeakMap<A, Promise<R>>();
  return (a) => {
    let p = memoria.get(a);
    if (!p) {
      p = fn(a);
      memoria.set(a, p);
      p.catch(() => memoria.delete(a));
    }
    return p;
  };
}

/*
 * Memoria con caducidad corta y borrado explicito, para lo que casi no cambia y se lee
 * en cada peticion (los catalogos). Quien lo cambia llama a `invalidar()` y el cambio se
 * ve al instante en este proceso; en otros procesos, a lo mas tras `ms`.
 *
 * El estado vive en globalThis, no en el modulo: Next empaqueta por separado las paginas y las rutas de API, asi que
 * el mismo archivo puede existir dos veces en un proceso, y una edicion hecha desde una ruta de API no
 * vaciaria la memoria que lee una pagina. Con la clave, todas las copias comparten la misma entrada.
 */
type Entrada = { hasta: number; valor: Promise<unknown> } | null;
const almacen = ((globalThis as { __nlMemoria?: Map<string, Entrada> }).__nlMemoria ??= new Map<string, Entrada>());

export function conCaducidad<R>(clave: string, fn: () => Promise<R>, ms: number) {
  return {
    leer(): Promise<R> {
      const ahora = Date.now();
      const guardado = almacen.get(clave);
      if (guardado && guardado.hasta > ahora) return guardado.valor as Promise<R>;
      const valor = fn();
      const entrada = { hasta: ahora + ms, valor };
      almacen.set(clave, entrada);
      valor.catch(() => { if (almacen.get(clave) === entrada) almacen.delete(clave); });
      return valor;
    },
    invalidar() { almacen.delete(clave); },
  };
}
