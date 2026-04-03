import { useEffect, useRef } from 'react'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { MergeView } from '@codemirror/merge'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'

const readOnlyTheme = EditorView.theme({
  '&': {
    fontSize: '13px',
    fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
    backgroundColor: '#121314',
    height: '100%',
  },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
  '.cm-gutters': {
    backgroundColor: '#121314',
    borderRight: '1px solid #222323',
    color: '#52525B',
    minWidth: '36px',
  },
  '.cm-mergeView .cm-changedLine': { backgroundColor: 'transparent' },
  '.cm-deletedChunk': {
    backgroundColor: 'rgba(239, 68, 68, 0.10)',
  },
  '.cm-insertedLine': {
    backgroundColor: 'rgba(34, 197, 94, 0.10)',
  },
})

const extensions = [
  sql(),
  oneDark,
  syntaxHighlighting(defaultHighlightStyle),
  readOnlyTheme,
  EditorView.editable.of(false),
  EditorState.readOnly.of(true),
]

type Props = {
  original: string
  modified: string
}

export function TimelineDiffView({ original, modified }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<MergeView | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Destroy previous instance
    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    const view = new MergeView({
      a: { doc: original, extensions },
      b: { doc: modified, extensions },
      parent: containerRef.current,
      collapseUnchanged: {},
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [original, modified])

  return <div ref={containerRef} className="h-full overflow-hidden" />
}
