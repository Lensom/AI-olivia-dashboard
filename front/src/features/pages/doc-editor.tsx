"use client";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import type { Block, BlockNoteEditor, PartialBlock } from "@blocknote/core";
import { en, uk } from "@blocknote/core/locales";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useEffect } from "react";
import { useLang } from "@/lib/i18n";

type Props = {
  initial: PartialBlock[] | null;
  onChange: (blocks: Block[]) => void;
  /** Hands the editor to the page for Markdown import / export. */
  onReady?: (editor: BlockNoteEditor) => void;
};

/**
 * Notion-like block editor (BlockNote): type "/" for blocks, drag the ⋮⋮ handle to move them,
 * select text for bold / italic / links. Its menus follow the interface language.
 */
export default function DocEditor({ initial, onChange, onReady }: Props) {
  const [lang] = useLang();
  // The editor is rebuilt when the language changes (menus are set at creation), starting from
  // `initial`, which the page keeps up to date with the last saved content.
  const editor = useCreateBlockNote(
    {
      initialContent: initial && initial.length ? initial : undefined,
      dictionary: lang === "uk" ? uk : en,
    },
    [lang],
  );

  useEffect(() => {
    onReady?.(editor as unknown as BlockNoteEditor);
  }, [editor, onReady]);

  return (
    <div className="olivia-doc -mx-[54px]">
      <BlockNoteView
        editor={editor}
        theme="light"
        onChange={() => onChange(editor.document as Block[])}
      />
    </div>
  );
}
