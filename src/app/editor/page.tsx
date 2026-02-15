import { EditorWorkspace } from "@/components/editor/editor-workspace";

type Props = {
  searchParams: Promise<{ id?: string }>;
};

export default async function EditorPage({ searchParams }: Props) {
  const params = await searchParams;
  return <EditorWorkspace docId={params.id} />;
}
