/**
 * El agente del chat compartido.
 *
 * No guarda estado propio: LEE el del hook, que es el que reduce todo lo que
 * llega por el canal. Por eso un mensaje escrito en otra pestaña le llega
 * igual que uno escrito acá — y por eso cualquiera puede tomar el mando sin
 * perder contexto: el contexto nunca fue de la pestaña, fue del canal.
 *
 * Reglas del turno, en orden:
 *   - hay una votación abierta  → no avanza; si venció, la resuelve
 *   - alguien está escribiendo  → se calla y espera
 *   - si no                     → pide un turno y lo publica
 *
 * Los pedidos se atienden de a uno: `pendientes` (ver `useChat.ts`) solo trae
 * el más viejo sin atender. Los demás quedan pausados —visibles en el
 * consolidado, cancelables— hasta que le toque el turno a cada uno.
 */

import {
  MARGEN_SOBRE_BYTES,
  TOPE_CONTENIDO_BYTES,
  type Artefacto,
  type Cuerpo,
  type Votacion,
} from "./protocolo";
import type { ArtefactoEnCurso, Intervencion, Turno } from "./modelo-turno";
import type { Transporte } from "./transporte";

/** Ritmo entre turnos. El modelo suele tardar más; esto es solo el respiro. */
export const RITMO_MS = 2500;

/** Cuánto dura una votación abierta. */
export const VENTANA_VOTACION_MS = 20_000;

/** Lo que el agente necesita saber, leído del estado del hook. */
export interface VistaAgente {
  tarea: string;
  conversacion: Intervencion[];
  /** ids de instrucciones humanas que ningún turno incorporó todavía */
  pendientes: string[];
  /** lo que la sala ya resolvió votando */
  decisiones: string[];
  artefacto: Artefacto | undefined;
  /**
   * La cola de pedidos sin atender, del más viejo al más nuevo, con su autor.
   *
   * El primero es el que el agente está por aplicar; los demás esperan. Es lo
   * que permite ver, ANTES de aplicar nada, si el que sigue contradice al que
   * viene — el momento exacto en que la sala debe votar.
   */
  enEspera: PedidoEnEspera[];
  /** la votación en curso, si la hay */
  votacionAbierta: Votacion | undefined;
  /** conteo por opción de la votación abierta */
  conteo: Record<string, number>;
  /** alguien está tecleando ahora mismo */
  escribiendo: boolean;
  /**
   * Otro cliente tomó el mando: hay que parar YA.
   *
   * Sin esto, dos pestañas que arrancan el agente publican en paralelo y todo
   * sale duplicado — mensajes, versiones del artefacto, votaciones. El puesto
   * es de uno solo, y el canal es quien lo dice.
   */
  debeCeder: boolean;
}

/** Un pedido humano que todavía ningún turno incorporó. */
export interface PedidoEnEspera {
  id: string;
  /** quién lo publicó, en ids del canal: dos pedidos del mismo no se votan */
  emisor: string;
  /** el nombre que ve la sala */
  autor: string;
  texto: string;
}

interface RespuestaTurno {
  turno?: Turno;
  fuente: string;
  degradado?: string;
}

export interface EventosAgenteChat {
  /** true mientras el modelo arma el turno; la UI lo muestra como "escribiendo" */
  onPensando?: (pensando: boolean) => void;
  onFuente?: (fuente: string, degradado?: string) => void;
  onFin?: () => void;
}

export class AgenteChat {
  readonly #transporte: Transporte;
  readonly #ver: () => VistaAgente;
  readonly #eventos: EventosAgenteChat;

  #reloj: ReturnType<typeof setInterval> | undefined;
  #ocupado = false;
  #corriendo = false;
  /** corta la llamada en vuelo cuando el agente para */
  #abortar: AbortController | undefined;
  /** pares ya consultados al detector de conflictos; no se repregunta */
  readonly #paresRevisados = new Set<string>();

  constructor(transporte: Transporte, ver: () => VistaAgente, eventos: EventosAgenteChat = {}) {
    this.#transporte = transporte;
    this.#ver = ver;
    this.#eventos = eventos;
  }

  get corriendo(): boolean {
    return this.#corriendo;
  }

  arrancar(): void {
    if (this.#corriendo) return;
    this.#corriendo = true;
    void this.#tick();
    this.#reloj = setInterval(() => void this.#tick(), RITMO_MS);
  }

  detener(): void {
    this.#corriendo = false;
    if (this.#reloj) clearInterval(this.#reloj);
    this.#reloj = undefined;
    // Sin esto, un turno pedido hace un segundo sigue viajando y se publica
    // después de haber parado: el agente "muerto" hablando.
    this.#abortar?.abort();
    this.#abortar = undefined;
  }

  // ------------------------------------------------------------------ interno

  /**
   * Un solo guardia para todo el turno: el reloj dispara cada `RITMO_MS` pero
   * un turno puede tardar más, y dos turnos encimados publicarían dos veces.
   */
  async #tick(): Promise<void> {
    if (!this.#corriendo || this.#ocupado) return;
    this.#ocupado = true;
    try {
      const v = this.#ver();

      // Alguien más tomó el mando. Se cede sin pelear: dos agentes publicando
      // a la vez es peor que ninguno.
      if (v.debeCeder) {
        this.detener();
        this.#eventos.onFin?.();
        return;
      }

      // Hay algo que la sala tiene que decidir: el agente no avanza. No
      // anuncia el resultado — eso lo deriva cada cliente por su cuenta (ver
      // `decisiones` en useChat), así queda registrado aunque en ese momento
      // no hubiera nadie conduciendo.
      if (v.votacionAbierta) return;

      // Alguien teclea: el agente se calla. No es una pausa técnica — es la
      // regla que evita que le hable encima a quien está escribiendo.
      if (v.escribiendo) return;

      // Antes de aplicar nada: si lo que sigue en la cola contradice a lo que
      // viene, que decida la sala. Aplicar los dos en fila haría que el
      // segundo pisara al primero sin que nadie lo hubiera elegido.
      await this.#quizasAbrirVotacion(v);
      if (!this.#corriendo || this.#ver().votacionAbierta) return;

      await this.#turno(v);
    } finally {
      this.#ocupado = false;
    }
  }

  async #turno(v: VistaAgente): Promise<void> {
    this.#eventos.onPensando?.(true);
    this.#abortar = new AbortController();
    try {
      const res = await fetch("/api/turno", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: this.#abortar.signal,
        body: JSON.stringify({
          tarea: v.tarea,
          conversacion: v.conversacion,
          // Contado acá, sobre la conversación entera: el servidor recorta a
          // una ventana y contar adentro se congela cuando el chat la llena.
          turnosDados: v.conversacion.filter((i) => i.deAgente).length,
          pendientes: v.pendientes,
          decisiones: v.decisiones,
          artefacto: v.artefacto
            ? {
                tipo: v.artefacto.tipo,
                titulo: v.artefacto.titulo,
                lenguaje: v.artefacto.lenguaje,
                contenido: v.artefacto.contenido,
              }
            : undefined,
        }),
      });
      if (!res.ok) throw new Error(`/api/turno respondió ${res.status}`);
      const datos = (await res.json()) as RespuestaTurno;
      const turno = datos.turno;
      if (!turno?.mensaje) return;

      this.#eventos.onFuente?.(datos.fuente, datos.degradado);
      if (!this.#corriendo) return;

      /**
       * El mundo pudo cambiar mientras el modelo pensaba —son segundos, y en
       * ese hueco alguien puede retirar su pedido o abrirse una votación—. La
       * vista `v` es una foto vieja: lo que se publica se decide contra la de
       * AHORA. Sin esto, retirar un pedido mientras el agente lo trabajaba no
       * lo detenía: volvía igual, lo publicaba y lo daba por aplicado.
       */
      const ahora = this.#ver();
      if (ahora.votacionAbierta) return;
      const seguianVivos = turno.atendio.filter((id) => ahora.pendientes.includes(id));
      if (v.pendientes.length > 0 && seguianVivos.length === 0) return;

      await this.#transporte.publicar({
        tipo: "mensaje",
        mensaje: {
          id: nuevoId(),
          texto: turno.mensaje,
          deAgente: true,
          actividad: turno.actividad,
          // Solo ids que sigan pendientes: el modelo a veces inventa, y lo
          // retirado ya no se puede dar por atendido.
          atendio: seguianVivos,
        },
      });

      if (turno.artefacto) {
        await this.#publicarArtefacto(turno.artefacto, (ahora.artefacto?.version ?? 0) + 1);
      }

      if (turno.fin) {
        this.detener();
        this.#eventos.onFin?.();
      }
    } catch (e) {
      // Abortar es una decisión nuestra, no una falla: no se grita.
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        console.error("[agente-chat] el turno falló", e);
      }
    } finally {
      this.#abortar = undefined;
      this.#eventos.onPensando?.(false);
    }
  }

  /**
   * ¿El pedido que viene y el que sigue se contradicen? Si sí, la sala vota.
   *
   * Se compara el primero de la cola contra el primero de OTRA persona: dos
   * pedidos de la misma no son un desacuerdo del equipo, son alguien que se
   * corrigió a sí mismo, y ahí manda el último.
   */
  async #quizasAbrirVotacion(v: VistaAgente): Promise<void> {
    const [a] = v.enEspera;
    if (!a) return;
    const b = v.enEspera.find((p) => p.emisor !== a.emisor);
    if (!b) return;

    const clave = `${a.id}|${b.id}`;
    if (this.#paresRevisados.has(clave)) return;
    this.#paresRevisados.add(clave);

    try {
      const res = await fetch("/api/turno", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conflicto: { a: a.texto, b: b.texto } }),
      });
      if (!res.ok) return;
      const { conflicto, motivo } = (await res.json()) as { conflicto: boolean; motivo: string };
      if (!conflicto || !this.#corriendo) return;

      // Los dos pudieron retirarse mientras se consultaba.
      const ahora = this.#ver();
      const vivos = new Set(ahora.enEspera.map((p) => p.id));
      if (!vivos.has(a.id) || !vivos.has(b.id) || ahora.votacionAbierta) return;

      await this.abrirVotacion(motivo, [
        { id: a.id, texto: a.texto, propuestaPor: a.emisor },
        { id: b.id, texto: b.texto, propuestaPor: b.emisor },
      ]);
    } catch (e) {
      console.error("[agente-chat] no pude revisar el conflicto", e);
    }
  }

  /** Abre una votación. La usa el detector de conflictos y también la gente, a mano. */
  async abrirVotacion(
    motivo: string,
    opciones: { id: string; texto: string; propuestaPor?: string }[],
  ): Promise<void> {
    await this.#transporte.publicar({
      tipo: "votacion",
      votacion: {
        id: nuevoId(),
        motivo,
        opciones,
        cierraEn: Date.now() + VENTANA_VOTACION_MS,
      },
    });
  }

  /** El artefacto va partido: Portal rechaza `content` por encima de 2KB. */
  async #publicarArtefacto(a: ArtefactoEnCurso, version: number): Promise<void> {
    const id = "art";
    const cabecera = { id, version, tipo: a.tipo, titulo: a.titulo, lenguaje: a.lenguaje };
    const partes = trocear(a.contenido, presupuestoDeTexto(cabecera));

    for (let i = 0; i < partes.length; i++) {
      await this.#transporte.publicar({
        tipo: "artefacto",
        trozo: { ...cabecera, parte: i, total: partes.length, texto: partes[i] },
      });
    }
  }

}

/** La opción más votada. Empate: gana la que se propuso primero. */
export function ganadoraDe(v: Votacion, conteo: Record<string, number>) {
  let mejor = v.opciones[0];
  let mejorN = conteo[mejor.id] ?? 0;
  for (const o of v.opciones.slice(1)) {
    const n = conteo[o.id] ?? 0;
    if (n > mejorN) {
      mejor = o;
      mejorN = n;
    }
  }
  return mejor;
}

/**
 * Cuánto pesa un texto DENTRO del JSON, sin las comillas que lo envuelven.
 *
 * No alcanza con contar bytes UTF-8: al serializar, un salto de línea pasa a
 * ser `\n` (dos bytes) y las comillas y barras se escapan. En un archivo de
 * código eso es muchísimo salto de línea.
 */
function pesoEnJson(s: string): number {
  return new TextEncoder().encode(JSON.stringify(s)).length - 2;
}

/** Cuánto texto entra en un trozo, descontando la cabecera real de ESTE artefacto. */
export function presupuestoDeTexto(cabecera: Record<string, unknown>): number {
  const vacio: Cuerpo = {
    tipo: "artefacto",
    // `parte` y `total` con valores anchos: que el presupuesto no dependa de
    // cuántos trozos terminen siendo.
    trozo: { ...cabecera, parte: 9999, total: 9999, texto: "" } as never,
  };
  const gasto = new TextEncoder().encode(JSON.stringify(vacio)).length;
  return Math.max(256, TOPE_CONTENIDO_BYTES - MARGEN_SOBRE_BYTES - gasto);
}

/**
 * Parte un texto en trozos que quepan en un mensaje del canal.
 *
 * El tope de Portal es de BYTES, no de caracteres. Cortar por `length` parecía
 * andar solo porque el mock no tiene límite y el guion escribía en ASCII: con
 * acentos —o sea, con cualquier texto en español— cada trozo pesaba el doble
 * de lo previsto, Portal lo rechazaba, y el artefacto no aparecía nunca.
 *
 * Se recorre por puntos de código y no por unidades UTF-16: cortar en medio de
 * un par sustituto partiría un emoji en dos mitades inválidas.
 */
export function trocear(texto: string, maxBytes: number): string[] {
  if (pesoEnJson(texto) <= maxBytes) return [texto];

  const partes: string[] = [];
  let actual = "";
  let peso = 0;

  for (const punto of texto) {
    const p = pesoEnJson(punto);
    if (peso + p > maxBytes && actual) {
      partes.push(actual);
      actual = "";
      peso = 0;
    }
    actual += punto;
    peso += p;
  }
  if (actual) partes.push(actual);
  return partes;
}

export function nuevoId(): string {
  return Math.random().toString(36).slice(2, 10);
}
