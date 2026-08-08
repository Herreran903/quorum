import Link from "next/link";

const DEMO = "demo";

export default function Inicio() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8 font-mono text-sm">
      <div>
        <h1 className="text-lg font-bold">quorum</h1>
        <p className="text-neutral-400">
          una sesión de agente que varias personas ven en vivo y pueden intervenir.
        </p>
      </div>

      <p className="text-neutral-400">
        el agente decide cuándo hablar según quién esté mirando la sala: avanza solo si
        no hay nadie, pregunta si hay gente y el paso es arriesgado, y se calla mientras
        alguien escribe.
      </p>

      <Link
        href={`/sesion/${DEMO}`}
        className="w-fit rounded border border-neutral-600 px-4 py-2 hover:bg-neutral-800"
      >
        abrir la sesión demo →
      </Link>

      <p className="text-xs text-neutral-600">
        abre el mismo enlace en dos pestañas para ver la política cambiar de decisión.
      </p>
    </main>
  );
}
