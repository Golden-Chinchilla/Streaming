import { EditorWorkspace } from "@/components/editor/editor-workspace";

type Props = {
  searchParams: Promise<{ template?: string; doc?: string }>;
};

export default async function EditorPage({ searchParams }: Props) {
  const params = await searchParams;
  return <EditorWorkspace templateId={params.template} docId={params.doc} />;
}
