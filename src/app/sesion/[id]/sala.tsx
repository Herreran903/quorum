"use client";

import { useState } from "react";

import { useSesion } from "@/lib/useSesion";
import type { Paso } from "@/lib/protocolo";

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
          </p>
        </div>
        <Presencia
          total={s.presencia.total}
          detallada={s.presencia.detallada}
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
        {s.ultimaDecision && (
          <span className="text-xs text-neutral-500">{s.ultimaDecision}</span>
        )}
      </section>

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
          <FilaPaso key={p.n} paso={p} onMirar={s.mirar} />
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

function Presencia({
  total,
  detallada,
  escribiendo,
}: {
  total: number;
  detallada: boolean;
  escribiendo: boolean;
}) {
  return (
    <div className="text-right text-xs">
      <p>
        <span className="text-neutral-100">{total}</span>{" "}
        <span className="text-neutral-500">
          {total === 1 ? "persona conectada" : "personas conectadas"}
        </span>
      </p>
      <p className="text-neutral-600">
        {escribiendo ? "escribiendo…" : detallada ? "presencia detallada" : "solo conteo"}
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
}: {
  paso: Paso;
  onMirar: (n: number | undefined) => void;
}) {
  return (
    <p
      onMouseEnter={() => onMirar(paso.n)}
      onMouseLeave={() => onMirar(undefined)}
      className={`flex gap-2 ${COLOR_ESTADO[paso.estado]}`}
    >
      <span className="w-6 shrink-0 text-right text-neutral-600">{paso.n}</span>
      <span className="flex-1">{paso.texto}</span>
      {paso.riesgo === "alto" && (
        <span className="shrink-0 text-rose-500">riesgo alto</span>
      )}
      <span className="w-10 shrink-0 text-right text-neutral-600">
        {paso.confianza.toFixed(2)}
      </span>
    </p>
  );
}
