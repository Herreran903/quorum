"use client";

/**
 * La portada ES el mecanismo, ciclando solo.
 *
 * La palabra voltea por las cuatro conductas del agente y la veta cambia de
 * ánimo con cada una — incluida ESPERA, donde la luz SE CONGELA. No hay
 * párrafo de marketing que explique la tesis: la portada la ejecuta.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { EstadoTablero } from "@/components/tablero";
import { Veta } from "./sesion/[id]/veta";

const CONDUCTAS = [
  {
    palabra: "SOLA",
    testigos: 0,
    conducta: "nadie mira: avanza y encola sus dudas",
  },
  {
    palabra: "VISTA",
    testigos: 2,
    conducta: "hay testigos: el riesgo se detiene y consulta",
  },
  {
    palabra: "ESPERA",
    testigos: 2,
    conducta: "alguien escribe: se calla — hasta la luz se congela",
  },
  {
    palabra: "PREGUNTA",
    testigos: 3,
    conducta: "las dudas acumuladas salen como una sola, nunca en ráfaga",
  },
] as const;

const CICLO_MS = 3200;

export default function Inicio() {
  const [indice, setIndice] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIndice((i) => (i + 1) % CONDUCTAS.length), CICLO_MS);
    return () => clearInterval(t);
  }, []);

  const actual = CONDUCTAS[indice];

  return (
    <main className="grano relative flex min-h-screen flex-col text-hueso">
      <Veta
        estado={actual.palabra as Parameters<typeof Veta>[0]["estado"]}
        congelada={actual.palabra === "ESPERA"}
      />

      {/* ------------------------------------------------ borde superior */}
      <div className="relative z-10 flex items-start justify-between gap-8 px-8 pt-7">
        <p className="text-servicio uppercase text-pasado">
          una sesión de agente que varias personas ven en vivo
        </p>
        <p className="text-right text-servicio uppercase text-pasado">
          el agente decide cuándo hablar
          <br />
          según quién esté mirando
        </p>
      </div>

      {/* -------------------------------------- el tablero, ciclando solo */}
      <div className="relative z-10 grow px-8 pt-2">
        <EstadoTablero palabra={actual.palabra} testigos={actual.testigos} />

        {/* las cuatro conductas: solo la activa está en tinta */}
        <ol className="mt-10 max-w-[46rem]">
          {CONDUCTAS.map((c, i) => (
            <li
              key={c.palabra}
              className={`grid grid-cols-[3rem_8rem_1fr] items-baseline gap-4 border-t border-tenue py-3 transition-colors duration-300 ${
                i === indice ? "text-hueso" : "text-pasado"
              }`}
            >
              <span className="text-servicio">{String(i + 1).padStart(2, "0")}.</span>
              <span className="text-servicio uppercase">{c.palabra}</span>
              <span className="text-obra" style={{ fontFamily: "var(--font-acta)" }}>
                {c.conducta}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-12 flex items-baseline gap-8">
          <Link
            href="/sesion/demo"
            className="text-servicio uppercase text-hueso transition-colors duration-150 hover:text-alarma"
          >
            <span className="text-tenue">[ </span>entrar a la sesión
            <span className="text-tenue"> ]</span>
          </Link>
          <p className="text-servicio uppercase text-pasado">
            ábrela en dos pestañas · cierra los ojos en una
          </p>
        </div>
      </div>

      {/* ------------------------------------------------ borde inferior */}
      <div className="relative z-10 flex items-end justify-between gap-8 px-8 pb-7">
        <p className="text-servicio uppercase text-pasado">
          si nadie vigila, lo hecho queda bajo tinta
        </p>
        <p className="text-servicio uppercase text-pasado">portal × crafter station</p>
      </div>
    </main>
  );
}
