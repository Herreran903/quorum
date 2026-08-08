"use client";

import { useState } from "react";

import { useSesion } from "@/lib/useSesion";
import type { Paso } from "@/lib/protocolo";
import { quienMira, type Espectador, type Presencia } from "@/lib/transporte";

/**
 * Un nombre corto y estable por espectador. Los ids de Portal son opacos;
 * el halo de Foco necesita algo que un humano pueda reconocer en pantalla.
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
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6 font-mono text-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-700 pb-3">
        <div>
          <h1 className="text-base font-bold">quorum · {idSesion}</h1>
          <p className="text-xs text-neutral-500">
            transporte: {s.transporte} · conexión: {s.conexion}
            {s.fuente && <> · modelo: {s.fuente}</>}
            {s.yo && <> · soy <span className="text-teal-400">{apodo(s.yo)}</span></>}
          </p>
        </div>
        <Testigos
          presencia={s.presencia}
          testigos={s.sala.espectadores}
          escribiendo={s.sala.escribiendo}
        />
      </header>

      <section className="flex flex-wrap items-center gap-2">
        <button
          onClick={s.agenteCorriendo ? s.pararAgente : s.arrancarAgente}
          className="rounded border border-neutral-600 px-3 py-1 hover:bg-neutral-800"
        >
          {s.agenteCorriendo ? "parar agente" : "arrancar agente"}
        </button>
        <button
          onClick={() => s.interrumpir("interrumpido desde la sala")}
          className="rounded border border-neutral-600 px-3 py-1 hover:bg-neutral-800"
        >
          interrumpir
        </button>
        <button
          onClick={() => s.cerrarOjos(!s.ojosCerrados)}
          className={`rounded border px-3 py-1 ${
            s.ojosCerrados
              ? "border-violet-500 bg-violet-950/50 text-violet-200"
              : "border-neutral-600 hover:bg-neutral-800"
          }`}
        >
          {s.ojosCerrados ? "abrir los ojos" : "cerrar los ojos"}
        </button>
        {s.planeando && (
          <span className="text-xs text-sky-400">el modelo está planeando…</span>
        )}
        {!s.planeando && s.ultimaDecision && (
          <span className="text-xs text-neutral-500">{s.ultimaDecision}</span>
        )}
      </section>

      {s.degradado && (
        <p className="rounded border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-400">
          el modelo falló, siguiendo con el guion de respaldo — {s.degradado}
        </p>
      )}

      {s.ojosCerrados && (
        <p className="rounded border border-violet-600/60 bg-violet-950/40 px-3 py-2 text-xs text-violet-300">
          tienes los ojos cerrados — el agente cree que está solo y avanza sin
          preguntarte. sigues viendo todo.
        </p>
      )}

      {s.confesion && (
        <section className="rounded border border-violet-600 bg-violet-950/40 px-3 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs uppercase tracking-wide text-violet-400">
              lo que hice mientras no mirabas
            </p>
            <button
              onClick={s.descartarConfesion}
              className="text-xs text-violet-500 hover:text-violet-300"
            >
              cerrar
            </button>
          </div>
          <p className="text-violet-100">
            Ejecuté {s.confesion.pasos.length}{" "}
            {s.confesion.pasos.length === 1 ? "paso" : "pasos"}
            {s.confesion.aSolas > 0 && <> · {s.confesion.aSolas} sin testigos</>}
            {s.confesion.arriesgados > 0 && (
              <> · <span className="text-rose-400">{s.confesion.arriesgados} de riesgo alto</span></>
            )}
            {s.confesion.volantes.length > 0 && (
              <> · me quedaron {s.confesion.volantes.length} dudas sin resolver</>
            )}
            .
          </p>
          <ul className="mt-1 text-xs text-violet-300">
            {s.confesion.pasos.map((p) => (
              <li key={p.n}>
                {p.n}. {p.texto}
                {p.riesgo === "alto" && <span className="text-rose-400"> (riesgo alto)</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.sala.escribiendo && (
        <p className="rounded border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-xs text-amber-400">
          alguien está escribiendo — el agente está callado
        </p>
      )}

      <section className="flex flex-col gap-1">
        <h2 className="text-xs uppercase tracking-wide text-neutral-500">pasos</h2>
        {s.estado.pasos.length === 0 && (
          <p className="text-neutral-600">todavía nada. arranca el agente.</p>
        )}
        {s.estado.pasos.map((p) => (
          <FilaPaso
            key={p.n}
            paso={p}
            onMirar={s.mirar}
            miran={quienMira(s.presencia, p.n)}
          />
        ))}
      </section>

      {s.estado.volantes.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-xs uppercase tracking-wide text-neutral-500">
            volantes — dudas que tuvo mientras nadie miraba ({s.estado.volantes.length})
          </h2>
          {s.estado.volantes.map((v) => (
            <p key={v.id} className="text-neutral-400">
              <span className="text-neutral-600">paso {v.pasos.join(", ")}</span> {v.texto}{" "}
              <span className="text-neutral-600">[{v.motivos.join(", ")}]</span>
            </p>
          ))}
        </section>
      )}

      {s.estado.restricciones.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-xs uppercase tracking-wide text-neutral-500">restricciones</h2>
          {s.estado.restricciones.map((r) => (
            <p key={r.id} className="text-emerald-400">
              · {r.texto}
            </p>
          ))}
        </section>
      )}

      {s.estado.interrupciones.length > 0 && (
        <section className="text-xs text-rose-400">
          {s.estado.interrupciones.map((i, k) => (
            <p key={k}>interrumpido: {i.motivo}</p>
          ))}
        </section>
      )}

      <div className="mt-auto flex flex-col gap-2">
        {s.preguntaAbierta && (
          <div className="rounded border border-sky-700 bg-sky-950/40 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-sky-500">
              el agente pregunta · pasos {s.preguntaAbierta.pasos.join(", ")}
            </p>
            <p className="whitespace-pre-wrap text-sky-200">{s.preguntaAbierta.texto}</p>
          </div>
        )}

        <div className="flex gap-2">
          <input
            value={borrador}
            onChange={(e) => {
              setBorrador(e.target.value);
              s.avisarEscribiendo();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") enviar();
            }}
            placeholder={
              s.preguntaAbierta ? "responder al agente…" : "fijar una restricción…"
            }
            className="flex-1 rounded border border-neutral-700 bg-transparent px-3 py-2 outline-none focus:border-neutral-500"
          />
          <button
            onClick={enviar}
            className="rounded border border-neutral-600 px-3 py-2 hover:bg-neutral-800"
          >
            enviar
          </button>
        </div>
      </div>
    </main>
  );
}

/**
 * Testigos, no conectados.
 *
 * La distinción es el proyecto: quien cerró los ojos sigue conectado pero
 * deja de contar, y es el conteo de TESTIGOS el que mueve a la política.
 */
function Testigos({
  presencia,
  testigos,
  escribiendo,
}: {
  presencia: Presencia;
  testigos: number;
  escribiendo: boolean;
}) {
  const dormidos = presencia.espectadores.filter((e) => e.presente === false).length;
  return (
    <div className="text-right text-xs">
      <p>
        <span className={testigos === 0 ? "text-violet-400" : "text-neutral-100"}>
          {testigos}
        </span>{" "}
        <span className="text-neutral-500">
          {testigos === 1 ? "testigo" : "testigos"}
        </span>
        <span className="text-neutral-600"> · {presencia.total} conectados</span>
      </p>
      <p className="text-neutral-600">
        {escribiendo
          ? "escribiendo…"
          : testigos === 0
            ? "el agente se cree solo"
            : dormidos > 0
              ? `${dormidos} con los ojos cerrados`
              : presencia.detallada
                ? "presencia detallada"
                : "solo conteo"}
      </p>
    </div>
  );
}

const COLOR_ESTADO: Record<Paso["estado"], string> = {
  ejecutando: "text-neutral-300",
  hecho: "text-neutral-400",
  bloqueado: "text-sky-300",
  descartado: "text-neutral-600 line-through",
};

function FilaPaso({
  paso,
  onMirar,
  miran,
}: {
  paso: Paso;
  onMirar: (n: number | undefined) => void;
  /** otros espectadores con la mirada puesta en ESTE paso, ahora mismo */
  miran: Espectador[];
}) {
  const mirado = miran.length > 0;
  return (
    <p
      onMouseEnter={() => onMirar(paso.n)}
      onMouseLeave={() => onMirar(undefined)}
      className={`flex gap-2 rounded px-1 transition-colors ${COLOR_ESTADO[paso.estado]} ${
        mirado ? "bg-teal-950/60 ring-1 ring-teal-600/70" : ""
      }`}
    >
      <span className="w-6 shrink-0 text-right text-neutral-600">{paso.n}</span>
      <span className="flex-1">
        {paso.texto}
        {/* Foco: la mirada ajena ya viajaba por Portal; aquí se ve. */}
        {mirado && (
          <span className="ml-2 text-xs text-teal-400">
            ← {miran.map((e) => apodo(e.id)).join(", ")}{" "}
            {miran.length === 1 ? "está mirando" : "están mirando"}
          </span>
        )}
      </span>
      {paso.sinTestigos && (
        <span className="shrink-0 text-xs text-violet-400" title="nadie miraba">
          sin testigos
        </span>
      )}
      {paso.riesgo === "alto" && (
        <span className="shrink-0 text-rose-500">riesgo alto</span>
      )}
      <span className="w-10 shrink-0 text-right text-neutral-600">
        {paso.confianza.toFixed(2)}
      </span>
    </p>
  );
}
