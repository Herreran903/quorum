import type { Metadata } from "next";
import "./estilos.css";

export const metadata: Metadata = {
  title: "La sala · sesión de agente compartida",
  description:
    "Un agente de IA trabaja una tarea larga dentro de una sesión que el equipo entero ve en vivo, redirige y se puede traspasar sin perder contexto.",
};

export default function LayoutSala({ children }: LayoutProps<"/sala">) {
  return <>{children}</>;
}
