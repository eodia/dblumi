import { useEffect, useRef } from 'react'
import { EditorView, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { unifiedMergeView } from '@codemirror/merge'
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
  '.cm-deletedChunk': {
    backgroundColor: 'rgba(239, 68, 68, 0.10)',
  },
  '.cm-deletedChunk .cm-gutters': {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    color: '#ef4444',
  },
  '.cm-insertedChunk': {
    backgroundColor: 'rgba(34, 197, 94, 0.10)',
  },
  '.cm-insertedChunk .cm-gutters': {
    backgroundColor: 'rgba(34, 197, 94, 0.08)',
    color: '#22c55e',
  },
})

const baseExtensions = [
  lineNumbers(),
  sql(),
  oneDark,
  syntaxHighlighting(defaultHighlightStyle),
  readOnlyTheme,
  EditorView.editable.of(false),
  EditorState.readOnly.of(true),
]

export function TimelineDiffView({ original, modified }: { original: string; modified: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    const view = new EditorView({
      doc: modified,
      extensions: [
        ...baseExtensions,
        unifiedMergeView({
          original,
          mergeControls: false,
          syntaxHighlightDeletions: true,
        }),
      ],
      parent: containerRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [original, modified])

  return <div ref={containerRef} className="h-full overflow-hidden" />
}

export function SqlReadOnlyView({ value }: { value: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    const view = new EditorView({
      doc: value,
      extensions: baseExtensions,
      parent: containerRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [value])

  return <div ref={containerRef} className="h-full overflow-hidden" />
}
