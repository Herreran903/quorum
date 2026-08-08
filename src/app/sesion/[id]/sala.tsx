"use client";

import { useState } from "react";

import { useSesion } from "@/lib/useSesion";
import type { Paso } from "@/lib/protocolo";
import { familiaDeConfianza } from "@/lib/tipografia";
import { quienMira, type Espectador, type Presencia } from "@/lib/transporte";

/**
 * Un nombre corto y estable por espectador. Los ids son opacos; las marcas de
 * lectura al margen necesitan algo que un humano reconozca.
 */
const APODOS = ["ana", "beto", "cami", "dani", "eli", "fran", "gabo", "hugo"];

function apodo(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return APODOS[h % APODOS.length];
}

export function Sala({ idSesion }: { idSesion: string }) {
  const s = useSesion(idSesion);
  const [borrador, setBorrador] = useState("");

  const enviar = () => {
    const texto = borrador.trim();
    if (!texto) return;
    if (s.preguntaAbierta) s.responder(s.preguntaAbierta.id, texto);
    else s.fijarRestriccion(texto);
    setBorrador("");
  };

  return (
    <main className="flex min-h-screen flex-col bg-papel text-tinta">
      <Cabecera
        idSesion={idSesion}
        presencia={s.presencia}
        testigos={s.sala.espectadores}
        transporte={s.transporte}
        conexion={s.conexion}
        fuente={s.fuente}
        yo={s.yo}
      />

      <div className="mx-auto w-full max-w-4xl grow px-6 py-8">
        <Mandos s={s} />

        {s.confesion && <Confesion c={s.confesion} onCerrar={s.descartarConfesion} />}

        <section
          className={`mt-8 ${s.sala.escribiendo || s.ojosCerrados ? "reticula" : ""}`}
        >
          <Rotulo>acta de la sesión</Rotulo>

          {s.estado.pasos.length === 0 && (
            <p className="py-6 text-mina" style={{ fontFamily: "var(--font-acta)" }}>
              Sin actuaciones registradas.
            </p>
          )}

          <ol>
            {s.estado.pasos.map((p) => (
              <FilaPaso
                key={p.n}
                paso={p}
                onMirar={s.mirar}
                miran={quienMira(s.presencia, p.n)}
              />
            ))}
          </ol>

          {s.planeando && (
            <p className="py-3 text-rotulo tracking-[0.08em] text-mina uppercase">
              deliberando…
            </p>
          )}
          {/* El silencio no es un hueco: es un tercer estado, y se raya. */}
          {s.sala.escribiendo && !s.planeando && (
            <div className="rayado mt-1 flex h-8 items-center px-2 text-rotulo uppercase tracking-[0.08em] text-mina">
              en suspenso · alguien delibera
            </div>
          )}
        </section>

        {s.estado.restricciones.length > 0 && (
          <section className="mt-8">
            <Rotulo>restricciones fijadas por la sala</Rotulo>
            <ol className="border-t border-filete">
              {s.estado.restricciones.map((r) => (
                <li
                  key={r.id}
                  className="border-b border-filete py-2 text-paso"
                  style={{ fontFamily: "var(--font-acta)" }}
                >
                  {r.texto}
                </li>
              ))}
            </ol>
          </section>
        )}

        {s.degradado && (
          <p className="rayado mt-6 px-2 py-2 text-rotulo uppercase tracking-[0.08em] text-vino">
            modelo caído · continúa el guion de respaldo
          </p>
        )}
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

function Rotulo({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-rotulo uppercase tracking-[0.08em] text-mina">
      {/* El glifo de comentario ya significa "metadato" para esta audiencia. */}
      <span className="text-filete">{"// "}</span>
      {children}
    </p>
  );
}

/**
 * La banda a sangre. Es la única región invertida del documento y lleva su
 * propio juego de variables acotado, sin sistema de temas global.
 */
function Cabecera({
  idSesion,
  presencia,
  testigos,
  transporte,
  conexion,
  fuente,
  yo,
}: {
  idSesion: string;
  presencia: Presencia;
  testigos: number;
  transporte: string;
  conexion: string;
  fuente?: string;
  yo?: string;
}) {
  return (
    <header className="bg-campo text-papel">
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-end justify-between gap-6 px-6 py-6">
        <div>
          <h1
            className="text-acta"
            style={{ fontFamily: "var(--font-acta)", fontWeight: 700 }}
          >
            Acta
          </h1>
          <p className="mt-1 text-rotulo uppercase tracking-[0.08em] text-campo-tenue">
            sesión {idSesion} · {transporte} · {conexion}
            {fuente && <> · {fuente}</>}
            {yo && <> · consta {apodo(yo)}</>}
          </p>
        </div>

        <Censo presencia={presencia} testigos={testigos} />
      </div>
    </header>
  );
}

/**
 * El censo del teatro: una fila de muescas.
 * Sólida = testigo. Hueca = conectado con los ojos cerrados.
 * La ausencia es un asiento que sigue ahí y deja de pesar.
 */
function Censo({ presencia, testigos }: { presencia: Presencia; testigos: number }) {
  const otros = presencia.espectadores.filter((e) => !e.soyYo);
  return (
    <div className="text-right">
      <div className="flex items-end justify-end gap-[3px]">
        {otros.length === 0 && (
          <span className="text-rotulo uppercase tracking-[0.08em] text-campo-tenue">
            sala vacía
          </span>
        )}
        {otros.map((e) => (
          <span
            key={e.id}
            title={`${apodo(e.id)}${e.presente === false ? " · ojos cerrados" : ""}`}
            className={`h-[14px] w-[6px] border ${
              e.presente === false
                ? "border-campo-tenue bg-transparent"
                : "border-papel bg-papel"
            }`}
          />
        ))}
      </div>
      <p className="mt-2 text-rotulo uppercase tracking-[0.08em] text-campo-tenue">
        {testigos} {testigos === 1 ? "testigo" : "testigos"} · {presencia.total}{" "}
        {presencia.total === 1 ? "presente" : "presentes"}
      </p>
    </div>
  );
}

function Mandos({ s }: { s: ReturnType<typeof useSesion> }) {
  return (
    <section className="flex flex-wrap items-center gap-2">
      <Boton onClick={s.agenteCorriendo ? s.pararAgente : s.arrancarAgente}>
        {s.agenteCorriendo ? "suspender" : "abrir sesión"}
      </Boton>
      <Boton onClick={() => s.interrumpir("la sala lo desvía")}>desviar</Boton>
      <Boton onClick={() => s.cerrarOjos(!s.ojosCerrados)} activo={s.ojosCerrados}>
        {s.ojosCerrados ? "abrir los ojos" : "cerrar los ojos"}
      </Boton>
      {s.ultimaDecision && !s.planeando && (
        <span className="text-rotulo uppercase tracking-[0.08em] text-mina">
          {s.ultimaDecision}
        </span>
      )}
    </section>
  );
}

/** Cuadrado es esquemático. Aquí todo lo clicable lleva el mismo peso. */
function Boton({
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
      className={`border px-3 py-1 text-rotulo uppercase tracking-[0.08em] transition-colors duration-150 ${
        activo
          ? "border-tinta bg-tinta text-papel"
          : "border-filete text-mina hover:border-mina hover:text-tinta"
      }`}
    >
      {children}
    </button>
  );
}

function FilaPaso({
  paso,
  onMirar,
  miran,
}: {
  paso: Paso;
  onMirar: (n: number | undefined) => void;
  miran: Espectador[];
}) {
  const redactado = paso.sinTestigos && paso.estado === "hecho";

  return (
    <li
      onMouseEnter={() => onMirar(paso.n)}
      onMouseLeave={() => onMirar(undefined)}
      /* Celdas adyacentes comparten UN filete en vez de duplicarlo. */
      className="plancha relative grid grid-cols-[2.5rem_1fr_auto] items-baseline gap-3 border-b border-filete py-2"
    >
      <span className="text-rotulo text-mina">
        {String(paso.n).padStart(2, "0")}
      </span>

      <span className="min-w-0">
        {redactado ? (
          /* La barra tiene el ancho de la frase que no se dijo. */
          <span
            className="inline-block max-w-full align-middle bg-redaccion text-transparent select-none"
            style={{ fontFamily: familiaDeConfianza(paso.confianza) }}
            title="ejecutado sin testigos"
          >
            {paso.texto}
          </span>
        ) : (
          <span
            className="text-paso"
            style={{ fontFamily: familiaDeConfianza(paso.confianza) }}
          >
            {paso.texto}
          </span>
        )}

        {/* Foco: las marcas de lectura van al margen de la fila que se mira. */}
        {miran.length > 0 && (
          <span className="ml-2 text-rotulo uppercase tracking-[0.08em] text-mina">
            ← {miran.map((e) => apodo(e.id)).join(" ")}
          </span>
        )}
      </span>

      <span className="flex items-baseline gap-3 text-rotulo">
        {paso.riesgo === "alto" && (
          <span className="text-vino uppercase tracking-[0.08em]">riesgo</span>
        )}
        <span className="text-dato">conf {paso.confianza.toFixed(2)}</span>
      </span>

      {/* Estado por inversión, no por color: la plancha bloqueada se invierte. */}
      {paso.estado === "bloqueado" && (
        <span className="absolute inset-y-0 -left-3 w-[3px] bg-vino" />
      )}
    </li>
  );
}

/** La confesión no aparece: se DESREDACTA. */
function Confesion({
  c,
  onCerrar,
}: {
  c: NonNullable<ReturnType<typeof useSesion>["confesion"]>;
  onCerrar: () => void;
}) {
  return (
    <section className="mt-8 border-y border-tinta bg-banda px-4 py-4">
      <div className="flex items-baseline justify-between gap-4">
        <Rotulo>lo actuado sin testigos</Rotulo>
        <button
          onClick={onCerrar}
          className="text-rotulo uppercase tracking-[0.08em] text-mina hover:text-tinta"
        >
          dar por leído
        </button>
      </div>

      <p className="text-paso" style={{ fontFamily: "var(--font-acta)" }}>
        Se ejecutaron {c.pasos.length}{" "}
        {c.pasos.length === 1 ? "actuación" : "actuaciones"} en ausencia de testigo
        {c.arriesgados > 0 && (
          <>
            , <span className="text-vino">{c.arriesgados} de riesgo alto</span>
          </>
        )}
        {c.volantes.length > 0 && <>, con {c.volantes.length} dudas sin resolver</>}.
      </p>

      <ol className="mt-3 border-t border-filete">
        {c.pasos.map((p) => (
          <li
            key={p.n}
            className="grid grid-cols-[2.5rem_1fr] gap-3 border-b border-filete py-1"
          >
            <span className="text-rotulo text-mina">
              {String(p.n).padStart(2, "0")}
            </span>
            <span
              className="text-paso"
              style={{ fontFamily: familiaDeConfianza(p.confianza) }}
            >
              {p.texto}
              {p.riesgo === "alto" && (
                <span className="ml-2 text-rotulo uppercase tracking-[0.08em] text-vino">
                  riesgo
                </span>
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
    <footer className="sticky bottom-0 border-t border-filete bg-papel">
      <div className="mx-auto w-full max-w-4xl px-6 py-4">
        {pregunta && (
          <div className="mb-3 border-l-[3px] border-vino pl-3">
            <p className="text-rotulo uppercase tracking-[0.08em] text-mina">
              el agente eleva consulta · actuaciones {pregunta.pasos.join(", ")}
            </p>
            <p
              className="mt-1 whitespace-pre-wrap text-paso"
              style={{ fontFamily: "var(--font-acta)" }}
            >
              {pregunta.texto}
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={borrador}
            onChange={(e) => onBorrador(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onEnviar();
            }}
            placeholder={pregunta ? "constar respuesta…" : "fijar restricción…"}
            className="min-w-0 flex-1 border-b border-filete bg-transparent py-2 text-paso outline-none placeholder:text-mina focus:border-tinta"
            style={{ fontFamily: "var(--font-acta)" }}
          />
          <Boton onClick={onEnviar}>hacer constar</Boton>
        </div>
      </div>
    </footer>
  );
}
