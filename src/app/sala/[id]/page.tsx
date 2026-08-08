import { Panel } from "./panel";

export default async function PaginaSala({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Panel idSala={id} />;
}
