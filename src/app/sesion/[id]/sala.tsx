"use client";

import { useEffect, useRef, useState } from "react";

import { useSesion } from "@/lib/useSesion";
import type { Paso } from "@/lib/protocolo";
import { familiaDeConfianza } from "@/lib/tipografia";
import { quienMira, type Espectador, type Presencia } from "@/lib/transporte";

const APODOS = ["ana", "beto", "cami", "dani", "eli", "fran", "gabo", "hugo"];

function apodo(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return APODOS[h % APODOS.length];
}

export function Sala({ idSesion }: { idSesion: string }) {
  const s = useSesion(idSesion);
  const [borrador, setBorrador] = useState("");
  const corriendo = useCronometro(s.agenteCorriendo);

  const enviar = () => {
    const texto = borrador.trim();
    if (!texto) return;
    if (s.preguntaAbierta) s.responder(s.preguntaAbierta.id, texto);
    else s.fijarRestriccion(texto);
    setBorrador("");
  };

  const sinVigilancia = s.estado.pasos.filter((p) => p.sinTestigos).length;
  const ultimo = s.estado.pasos.at(-1)?.n;

  return (
    <main className="grano relative flex min-h-screen flex-col bg-fondo text-hueso">
      <TintaSucia />
      <Cruces />

      {/* ------------------------------------------------ borde superior */}
      <div className="flex items-start justify-between gap-8 px-8 pt-7">
        <p className="text-servicio uppercase text-pasado">
          {idSesion} · {s.transporte} · {s.conexion}
          {s.fuente && <> · {s.fuente}</>}
        </p>
        <p className="text-right text-servicio uppercase text-pasado">
          corriendo {corriendo}
          <br />
          {sinVigilancia > 0 ? (
            <span className="text-alarma">{sinVigilancia} sin vigilancia</span>
          ) : (
            <>0 sin vigilancia</>
          )}
          <br />
          {s.yo && <>eres {apodo(s.yo)}</>}
        </p>
      </div>

      {/* ------------------------------- el tablero: la palabra que voltea */}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 px-8 pt-2">
        <EstadoTablero
          palabra={palabraDeEstado({
            escribiendo: s.sala.escribiendo,
            testigos: s.sala.espectadores,
            preguntando: Boolean(s.preguntaAbierta),
            corriendo: s.agenteCorriendo,
          })}
          testigos={s.sala.espectadores}
        />
        <Censo presencia={s.presencia} />
      </div>

      {/* -------------------- el mapa de la sesión: una celda por paso */}
      <MapaSesion pasos={s.estado.pasos} ultimo={ultimo} className="px-8 pt-5" />

      <Mandos s={s} />

      {/* ------------------------------------- el canal: lo que hace ahora */}
      {/* Cuelga del mismo borde que la palabra; el aire queda a la derecha,
          donde vive el censo. Peso a las esquinas, no simetría de plantilla. */}
      <div className="grow px-8 pb-40 pt-10">
        <div className="w-full max-w-[46rem]">
          {s.estado.pasos.length === 0 && !s.planeando && (
            <p className="text-servicio uppercase text-pasado">
              nada todavía · arranca la máquina
            </p>
          )}

          <ol>
            {s.estado.pasos.map((p) => (
              <FilaPaso
                key={p.n}
                paso={p}
                vivo={p.n === ultimo}
                onMirar={s.mirar}
                miran={quienMira(s.presencia, p.n)}
              />
            ))}
          </ol>

          {s.planeando && (
            <p className="py-4 text-servicio uppercase text-hueso">pensando…</p>
          )}

          {s.sala.escribiendo && !s.planeando && (
            <div className="rayado mt-1 flex h-10 items-center px-2 text-servicio uppercase text-pasado">
              callada · alguien escribe
            </div>
          )}

          {s.confesion && (
            <Confesion c={s.confesion} onCerrar={s.descartarConfesion} />
          )}

          {s.estado.restricciones.length > 0 && (
            <section className="mt-10">
              <p className="mb-2 text-servicio uppercase text-pasado">
                lo que le prohibieron
              </p>
              {s.estado.restricciones.map((r) => (
                <p
                  key={r.id}
                  className="border-t border-tenue py-2 text-obra"
                  style={{ fontFamily: "var(--font-acta)" }}
                >
                  {r.texto}
                </p>
              ))}
            </section>
          )}

          {s.degradado && (
            <p className="rayado mt-8 px-2 py-2 text-servicio uppercase text-alarma">
              modelo caído · sigue el guion de respaldo
            </p>
          )}
        </div>
      </div>

      <Pie
        pregunta={s.preguntaAbierta}
        borrador={borrador}
        onBorrador={(v) => {
          setBorrador(v);
          s.avisarEscribiendo();
        }}
        onEnviar={enviar}
      />
    </main>
  );
}

/** La palabra que es verdad AHORA, no lo que ocurrió. */
function palabraDeEstado({
  escribiendo,
  testigos,
  preguntando,
  corriendo,
}: {
  escribiendo: boolean;
  testigos: number;
  preguntando: boolean;
  corriendo: boolean;
}): string {
  if (escribiendo) return "ESPERA";
  if (preguntando) return "PREGUNTA";
  if (!corriendo) return "QUIETA";
  return testigos === 0 ? "SOLA" : "VISTA";
}

const GLIFOS_TABLERO = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * El tablero de estación. Cuando el estado cambia, cada letra cicla glifos
 * antes de asentarse — el volteo de un split-flap, sin renderizar un solo
 * disco: el movimiento ES la identidad, no el skeuomorfismo.
 *
 * Con prefers-reduced-motion la palabra cambia en seco: el cambio de estado
 * se conserva, el desplazamiento se quita.
 */
function EstadoTablero({ palabra, testigos }: { palabra: string; testigos: number }) {
  /** la palabra en pleno volteo; null = asentada, se muestra `palabra` */
  const [ciclo, setCiclo] = useState<string | null>(null);
  const anterior = useRef(palabra);

  useEffect(() => {
    if (palabra === anterior.current) return;
    anterior.current = palabra;

    // Reducido: el cambio de estado se conserva, el volteo se quita.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cuadro = 0;
    const timer = setInterval(() => {
      cuadro++;
      let salida = "";
      for (let i = 0; i < palabra.length; i++) {
        // Cada letra se asienta por orden: el volteo recorre la palabra.
        const asienta = 3 + i * 2;
        salida +=
          cuadro >= asienta
            ? palabra[i]
            : GLIFOS_TABLERO[Math.floor(Math.random() * GLIFOS_TABLERO.length)];
      }
      if (cuadro >= 3 + palabra.length * 2) {
        setCiclo(null);
        clearInterval(timer);
      } else {
        setCiclo(salida);
      }
    }, 45);
    return () => clearInterval(timer);
  }, [palabra]);

  /**
   * El peso de la palabra ES la atención de la sala: con nadie mirando los
   * discos apenas se encienden; cada testigo que entra la engorda. Dato
   * hecho forma — y la fuente variable lo transiciona sola.
   */
  const peso = 380 + Math.min(testigos, 5) * 90;

  return (
    <h1
      className="text-estado"
      style={{
        fontFamily: "var(--font-tablero)",
        // Verificado en vivo contra los 17 valores del eje: ELSH 9 es el que
        // deja VER los discos individuales; con más peso se funden en barra.
        fontVariationSettings: `"ELSH" 9, "wght" ${peso}`,
        transition: "font-variation-settings 400ms cubic-bezier(0.23, 1, 0.32, 1)",
      }}
    >
      {ciclo ?? palabra}
    </h1>
  );
}

/**
 * La sesión entera de un golpe: una celda por paso, como el panel de carga
 * de un tablero. Cuadrado = trabajo (las personas van en redondo).
 *
 *   llena  = lo hizo con testigos      apagada = lo hizo sin vigilancia
 *   alarma = riesgo alto               contorno = detenido / descartado
 */
function MapaSesion({
  pasos,
  ultimo,
  className,
}: {
  pasos: Paso[];
  ultimo: number | undefined;
  className?: string;
}) {
  if (pasos.length === 0) return null;
  return (
    <div className={`flex flex-wrap gap-[4px] ${className ?? ""}`}>
      {pasos.map((p) => {
        const base = "h-[10px] w-[10px] transition-colors duration-150";
        let cara: string;
        if (p.estado === "bloqueado" || p.estado === "descartado") {
          cara = "border border-alarma bg-transparent";
        } else if (p.riesgo === "alto") {
          cara = "bg-alarma";
        } else if (p.sinTestigos) {
          cara = "bg-pasado";
        } else {
          cara = "bg-hueso";
        }
        const vivo = p.n === ultimo ? " outline outline-1 outline-hueso outline-offset-2" : "";
        return (
          <span
            key={p.n}
            title={`${String(p.n).padStart(2, "0")}. ${p.sinTestigos ? "(sin vigilancia)" : p.texto}`}
            className={`${base} ${cara}${vivo}`}
          />
        );
      })}
    </div>
  );
}

/**
 * El censo: discos de flip-dot. Redondo = persona (el trabajo va en
 * cuadrado). Macizo = testigo; volteado = conectado con los ojos cerrados.
 * Cuando alguien los cierra, su disco se voltea en vivo delante de todos.
 */
function Censo({ presencia }: { presencia: Presencia }) {
  const otros = presencia.espectadores.filter((e) => !e.soyYo);
  return (
    <div className="flex items-end gap-[6px] pb-4">
      {otros.length === 0 ? (
        <span className="text-servicio uppercase text-pasado">nadie más</span>
      ) : (
        otros.map((e) => (
          <span
            key={e.id}
            title={`${apodo(e.id)}${e.presente === false ? " · ojos cerrados" : ""}`}
            className={`h-[22px] w-[22px] rounded-full transition-all duration-300 ${
              e.presente === false
                ? "border border-pasado bg-transparent"
                : "border border-hueso bg-hueso"
            }`}
          />
        ))
      )}
    </div>
  );
}

function Mandos({ s }: { s: ReturnType<typeof useSesion> }) {
  return (
    <div className="flex flex-wrap items-center gap-5 px-8 pt-6">
      <Accion onClick={s.agenteCorriendo ? s.pararAgente : s.arrancarAgente}>
        {s.agenteCorriendo ? "parar" : "arrancar"}
      </Accion>
      <Accion onClick={() => s.interrumpir("por ahí no")}>desviar</Accion>
      <Accion onClick={() => s.cerrarOjos(!s.ojosCerrados)} activo={s.ojosCerrados}>
        {s.ojosCerrados ? "abrir los ojos" : "cerrar los ojos"}
      </Accion>
      {s.ultimaDecision && !s.planeando && (
        <span className="text-servicio uppercase text-pasado">{s.ultimaDecision}</span>
      )}
    </div>
  );
}

/** Los corchetes hacen de botón. Cero cromo. */
function Accion({
  children,
  onClick,
  activo,
}: {
  children: React.ReactNode;
  onClick: () => void;
  activo?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-servicio uppercase transition-colors duration-150 ${
        activo ? "text-alarma" : "text-pasado hover:text-hueso"
      }`}
    >
      <span className="text-tenue">[ </span>
      {children}
      <span className="text-tenue"> ]</span>
    </button>
  );
}

function FilaPaso({
  paso,
  vivo,
  onMirar,
  miran,
}: {
  paso: Paso;
  vivo: boolean;
  onMirar: (n: number | undefined) => void;
  miran: Espectador[];
}) {
  const tapado = paso.sinTestigos && paso.estado === "hecho";

  return (
    <li
      onMouseEnter={() => onMirar(paso.n)}
      onMouseLeave={() => onMirar(undefined)}
      className="aterriza grid grid-cols-[3rem_1fr_auto] items-baseline gap-4 border-t border-tenue py-3"
    >
      <span className="text-servicio text-pasado">
        {String(paso.n).padStart(2, "0")}.
      </span>

      <span className="min-w-0">
        {tapado ? (
          /*
           * Sobre papel, censurar es tinta más negra que el texto. Sobre un
           * campo oscuro eso desaparece: aquí censurar es QUEMAR. El bloque
           * es hueso, del ancho exacto de la frase que no viste, y el filtro
           * le ensucia los bordes para que no se lea como cinta digital.
           */
          <span
            className="inline-block max-w-full select-none bg-hueso align-middle text-transparent"
            style={{ fontFamily: familiaDeConfianza(paso.confianza), filter: "url(#tinta)" }}
            title="lo hizo sin que nadie mirara"
          >
            {paso.texto}
          </span>
        ) : (
          <span
            className={`text-obra transition-colors duration-150 ${
              vivo ? "text-hueso" : "text-pasado"
            }`}
            style={{ fontFamily: familiaDeConfianza(paso.confianza) }}
          >
            {paso.texto}
          </span>
        )}

        {miran.length > 0 && (
          <span className="ml-3 text-servicio uppercase text-hueso">
            ← {miran.map((e) => apodo(e.id)).join(" ")}
          </span>
        )}
      </span>

      <span className="flex items-baseline gap-3 text-servicio">
        {paso.riesgo === "alto" && <span className="uppercase text-alarma">riesgo</span>}
        <span className={vivo ? "text-hueso" : "text-pasado"}>
          {paso.confianza.toFixed(2)}
        </span>
      </span>
    </li>
  );
}

function Confesion({
  c,
  onCerrar,
}: {
  c: NonNullable<ReturnType<typeof useSesion>["confesion"]>;
  onCerrar: () => void;
}) {
  return (
    <section className="mt-10 border-y border-alarma py-5">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-servicio uppercase text-alarma">
          lo que hizo mientras no mirabas
        </p>
        <button
          onClick={onCerrar}
          className="text-servicio uppercase text-pasado hover:text-hueso"
        >
          <span className="text-tenue">[ </span>ya lo vi<span className="text-tenue"> ]</span>
        </button>
      </div>

      <p className="mt-3 text-obra" style={{ fontFamily: "var(--font-acta)" }}>
        {c.pasos.length} {c.pasos.length === 1 ? "paso" : "pasos"} sin nadie delante
        {c.arriesgados > 0 && (
          <>
            , <span className="text-alarma">{c.arriesgados} de riesgo alto</span>
          </>
        )}
        {c.volantes.length > 0 && <>, {c.volantes.length} dudas que se tragó</>}.
      </p>

      <ol className="mt-3">
        {c.pasos.map((p) => (
          <li key={p.n} className="grid grid-cols-[3rem_1fr] gap-4 py-1">
            <span className="text-servicio text-pasado">
              {String(p.n).padStart(2, "0")}.
            </span>
            <span
              className="text-obra text-hueso"
              style={{ fontFamily: familiaDeConfianza(p.confianza) }}
            >
              {p.texto}
              {p.riesgo === "alto" && (
                <span className="ml-2 text-servicio uppercase text-alarma">riesgo</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Pie({
  pregunta,
  borrador,
  onBorrador,
  onEnviar,
}: {
  pregunta: { id: string; texto: string; pasos: number[] } | undefined;
  borrador: string;
  onBorrador: (v: string) => void;
  onEnviar: () => void;
}) {
  return (
    <footer className="fixed inset-x-0 bottom-0 border-t border-tenue bg-fondo/95 backdrop-blur-sm">
      <div className="w-full max-w-[46rem] px-8 py-4">
        {pregunta && (
          <div className="mb-3 border-l border-alarma pl-3">
            <p className="text-servicio uppercase text-alarma">
              te pregunta · pasos {pregunta.pasos.join(", ")}
            </p>
            {/* Una pregunta agrupada puede traer diez dudas: el pie no puede
                comerse el canal. Tope y scroll interno. */}
            <p
              className="mt-1 max-h-[30vh] overflow-y-auto whitespace-pre-wrap text-obra"
              style={{ fontFamily: "var(--font-acta)" }}
            >
              {pregunta.texto}
            </p>
          </div>
        )}

        <div className="flex items-baseline gap-4">
          <input
            value={borrador}
            onChange={(e) => onBorrador(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onEnviar();
            }}
            placeholder={pregunta ? "respóndele…" : "prohíbele algo…"}
            className="min-w-0 flex-1 border-b border-tenue bg-transparent py-2 text-obra outline-none placeholder:text-pasado focus:border-hueso"
            style={{ fontFamily: "var(--font-acta)" }}
          />
          <Accion onClick={onEnviar}>enviar</Accion>
        </div>
      </div>
    </footer>
  );
}

/** Cuatro cruces de registro. Único marco de la página. */
function Cruces() {
  const c = "pointer-events-none fixed text-tenue text-[11px] select-none";
  return (
    <>
      <span className={`${c} left-3 top-3`}>+</span>
      <span className={`${c} right-3 top-3`}>+</span>
      <span className={`${c} bottom-3 left-3`}>+</span>
      <span className={`${c} bottom-3 right-3`}>+</span>
    </>
  );
}

/**
 * El filtro que ensucia la tinta. Un rectángulo perfecto de CSS se lee como
 * cinta adhesiva digital; una censura de verdad tiene bordes sucios y
 * esquinas que se pasan.
 */
function TintaSucia() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute">
      <filter id="tinta" x="-6%" y="-30%" width="112%" height="160%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.9 0.35"
          numOctaves="3"
          seed="7"
          result="ruido"
        />
        <feDisplacementMap in="SourceGraphic" in2="ruido" scale="7" />
      </filter>
    </svg>
  );
}

/** Dato vivo: demuestra que hay algo corriendo en vez de afirmarlo. */
function useCronometro(activo: boolean): string {
  const [seg, setSeg] = useState(0);
  const desde = useRef<number | null>(null);

  useEffect(() => {
    if (!activo) return;
    if (desde.current === null) desde.current = Date.now();
    const t = setInterval(() => {
      if (desde.current !== null) {
        setSeg(Math.floor((Date.now() - desde.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(t);
  }, [activo]);

  const m = String(Math.floor(seg / 60)).padStart(2, "0");
  const s = String(seg % 60).padStart(2, "0");
  return `${m}:${s}`;
}
