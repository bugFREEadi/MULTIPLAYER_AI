import SessionRouter from "./session-router";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function SessionPage({ params }: PageProps) {
  const { id } = await params;
  return <SessionRouter sessionId={id} />;
}
