import { useEffect, useRef } from 'react'
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { sql } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import { useEditorStore } from '@/stores/editor.store'
import { cn } from '@/lib/utils'

// onSave not used here — actions live in UnifiedTabBar
type Props = { onSave?: () => void }

const dblumiEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
    backgroundColor: '#121314',
  },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
  '.cm-content': { caretColor: '#41cd2a', padding: '8px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#41cd2a', borderLeftWidth: '2px' },
  '.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: '#41cd2a18 !important',
  },
  '.cm-gutters': {
    backgroundColor: '#121314',
    borderRight: '1px solid #222323',
    color: '#52525B',
    minWidth: '40px',
  },
  '.cm-activeLineGutter': { backgroundColor: '#171717', color: '#71717A' },
  '.cm-activeLine': { backgroundColor: '#17171780' },
  '.cm-foldPlaceholder': { backgroundColor: '#27272A', border: 'none', color: '#A1A1AA' },
})

export function SqlEditor({ onSave }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  const { tabs, activeTabId, setSql, setSelection, executeQuery, executeSelection } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const sqlText = activeTab?.sql ?? ''
  const isRunning = activeTab?.result.status === 'running'

  useEffect(() => {
    if (!containerRef.current) return
    const view = new EditorView({
      state: EditorState.create({
        doc: sqlText,
        extensions: [
          history(),
          lineNumbers(),
          highlightActiveLineGutter(),
          sql(),
          oneDark,
          dblumiEditorTheme,
          keymap.of([
            { key: 'Mod-Enter', run: (view) => {
              const sel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
              sel ? executeSelection() : executeQuery()
              return true
            }},
            { key: 'Ctrl-Enter', run: (view) => {
              const sel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
              sel ? executeSelection() : executeQuery()
              return true
            }},
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setSql(update.state.doc.toString())
            if (update.selectionSet) {
              const sel = update.state.sliceDoc(
                update.state.selection.main.from,
                update.state.selection.main.to,
              )
              setSelection(sel)
            }
          }),
          EditorView.lineWrapping,
        ],
      }),
      parent: containerRef.current,
    })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync doc when tab switches
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== sqlText) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: sqlText } })
    }
  }, [activeTabId, sqlText])

  return (
    <div
      ref={containerRef}
      className={cn('h-full overflow-hidden', isRunning && 'opacity-60 pointer-events-none')}
    />
  )
}
