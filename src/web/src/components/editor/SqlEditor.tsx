import { useEffect, useRef, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
} from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import {
  foldGutter,
  indentOnInput,
  bracketMatching,
  foldKeymap,
  syntaxHighlighting,
  defaultHighlightStyle,
} from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search'
import { lintGutter, linter, type Diagnostic } from '@codemirror/lint'
import { sql, PostgreSQL, MySQL, type SQLNamespace } from '@codemirror/lang-sql'
import { oneDark } from '@codemirror/theme-one-dark'
import { useEditorStore } from '@/stores/editor.store'
import { connectionsApi, type Connection, type SchemaTable } from '@/api/connections'
import { cn } from '@/lib/utils'

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
  // Fold
  '.cm-foldPlaceholder': { backgroundColor: '#27272A', border: 'none', color: '#A1A1AA', padding: '0 4px' },
  '.cm-foldGutter span': { color: '#52525B', fontSize: '12px' },
  '.cm-foldGutter span:hover': { color: '#A1A1AA' },
  // Bracket matching
  '.cm-matchingBracket': { backgroundColor: '#41cd2a25', outline: '1px solid #41cd2a40' },
  '.cm-nonmatchingBracket': { backgroundColor: '#ef444425', outline: '1px solid #ef444440' },
  // Search
  '.cm-searchMatch': { backgroundColor: '#f59e0b30', outline: '1px solid #f59e0b50' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#41cd2a30' },
  '.cm-panels': { backgroundColor: '#1C1C1F', borderBottom: '1px solid #27272A', color: '#FAFAFA' },
  '.cm-panels input, .cm-panels button': { fontFamily: 'inherit', fontSize: '12px' },
  '.cm-panel.cm-search': { padding: '6px 8px' },
  '.cm-panel.cm-search input': {
    backgroundColor: '#27272A', border: '1px solid #3F3F46', borderRadius: '4px',
    color: '#FAFAFA', padding: '2px 6px', outline: 'none',
  },
  '.cm-panel.cm-search input:focus': { borderColor: '#41cd2a' },
  '.cm-panel.cm-search button': {
    backgroundColor: '#27272A', border: '1px solid #3F3F46', borderRadius: '4px',
    color: '#A1A1AA', padding: '2px 8px', cursor: 'pointer',
  },
  '.cm-panel.cm-search button:hover': { backgroundColor: '#3F3F46', color: '#FAFAFA' },
  '.cm-panel.cm-search label': { color: '#A1A1AA', fontSize: '11px' },
  // Selection matches
  '.cm-selectionMatch': { backgroundColor: '#41cd2a15' },
  // Lint
  '.cm-lintRange-warning': { backgroundImage: 'none', borderBottom: '1px dashed #f59e0b' },
  '.cm-lintRange-error': { backgroundImage: 'none', borderBottom: '1px dashed #ef4444' },
  '.cm-lint-marker': { width: '8px' },
  '.cm-tooltip.cm-tooltip-lint': {
    backgroundColor: '#1C1C1F', border: '1px solid #27272A', borderRadius: '4px',
    color: '#FAFAFA', fontSize: '12px',
  },
  // Autocomplete
  '.cm-tooltip.cm-tooltip-autocomplete': {
    backgroundColor: '#1C1C1F',
    border: '1px solid #27272A',
    borderRadius: '6px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
    overflow: 'hidden',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
    fontSize: '12px',
    maxHeight: '220px',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    padding: '3px 8px',
    color: '#A1A1AA',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: '#27272A',
    color: '#FAFAFA',
  },
  '.cm-completionIcon': { width: '16px', paddingRight: '4px', opacity: '0.6' },
  '.cm-completionLabel': { color: '#FAFAFA' },
  '.cm-completionDetail': { color: '#71717A', fontStyle: 'normal', marginLeft: '8px', fontSize: '10px' },
  '.cm-completionMatchedText': { color: '#41cd2a', textDecoration: 'none', fontWeight: 'bold' },
})

/** Convert schema tables to CodeMirror SQLNamespace */
function buildSqlSchema(tables: SchemaTable[]): SQLNamespace {
  const ns: Record<string, readonly string[]> = {}
  for (const table of tables) {
    ns[table.name] = table.columns.map((c) => c.name)
  }
  return ns
}

/** Pick the right CodeMirror dialect */
function getDialect(driver: string | undefined) {
  if (driver === 'mysql') return MySQL
  if (driver === 'postgresql') return PostgreSQL
  return PostgreSQL
}

/** Basic SQL linter — checks for common issues */
function sqlLinter(view: EditorView): Diagnostic[] {
  const doc = view.state.doc.toString()
  const diagnostics: Diagnostic[] = []

  // Check for unmatched quotes
  let inSingle = false
  let singleStart = 0
  for (let i = 0; i < doc.length; i++) {
    if (doc[i] === "'" && (i === 0 || doc[i - 1] !== "'")) {
      if (!inSingle) { inSingle = true; singleStart = i }
      else { inSingle = false }
    }
  }
  if (inSingle) {
    diagnostics.push({
      from: singleStart,
      to: singleStart + 1,
      severity: 'error',
      message: 'Apostrophe non fermée',
    })
  }

  // Check for unmatched parentheses
  let depth = 0
  let firstUnmatched = -1
  for (let i = 0; i < doc.length; i++) {
    if (doc[i] === '(') { if (depth === 0) firstUnmatched = i; depth++ }
    else if (doc[i] === ')') { depth-- }
    if (depth < 0) {
      diagnostics.push({ from: i, to: i + 1, severity: 'error', message: 'Parenthèse fermante sans correspondance' })
      depth = 0
    }
  }
  if (depth > 0 && firstUnmatched >= 0) {
    diagnostics.push({ from: firstUnmatched, to: firstUnmatched + 1, severity: 'error', message: 'Parenthèse ouvrante non fermée' })
  }

  // Warn on dangerous patterns
  const upperDoc = doc.toUpperCase()
  if (/\bDELETE\s+FROM\b/.test(upperDoc) && !/\bWHERE\b/.test(upperDoc)) {
    const m = doc.match(/\bDELETE\s+FROM\b/i)
    if (m?.index !== undefined) {
      diagnostics.push({ from: m.index, to: m.index + m[0].length, severity: 'warning', message: 'DELETE sans WHERE — supprime toutes les lignes' })
    }
  }
  if (/\bUPDATE\b/.test(upperDoc) && /\bSET\b/.test(upperDoc) && !/\bWHERE\b/.test(upperDoc)) {
    const m = doc.match(/\bUPDATE\b/i)
    if (m?.index !== undefined) {
      diagnostics.push({ from: m.index, to: m.index + m[0].length, severity: 'warning', message: 'UPDATE sans WHERE — modifie toutes les lignes' })
    }
  }
  if (/\bDROP\s+TABLE\b/i.test(doc)) {
    const m = doc.match(/\bDROP\s+TABLE\b/i)
    if (m?.index !== undefined) {
      diagnostics.push({ from: m.index, to: m.index + m[0].length, severity: 'warning', message: 'DROP TABLE — opération irréversible' })
    }
  }
  if (/\bTRUNCATE\b/i.test(doc)) {
    const m = doc.match(/\bTRUNCATE\b/i)
    if (m?.index !== undefined) {
      diagnostics.push({ from: m.index, to: m.index + m[0].length, severity: 'warning', message: 'TRUNCATE — supprime toutes les lignes' })
    }
  }

  return diagnostics
}

export function SqlEditor({ onSave }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const sqlCompartment = useRef(new Compartment())

  const { tabs, activeTabId, activeConnectionId, setSql, setSelection, executeQuery, executeSelection } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const sqlText = activeTab?.sql ?? ''
  const isRunning = activeTab?.result.status === 'running'

  const { data: connData } = useQuery({
    queryKey: ['connections'],
    queryFn: connectionsApi.list,
    staleTime: 5 * 60 * 1000,
  })
  const activeConnection: Connection | undefined = connData?.connections.find((c) => c.id === activeConnectionId)

  const { data: schemaData } = useQuery({
    queryKey: ['schema', activeConnectionId],
    queryFn: () => connectionsApi.schema(activeConnectionId!),
    enabled: !!activeConnectionId,
    staleTime: 5 * 60 * 1000,
  })

  const sqlExtension = useMemo(() => {
    const dialect = getDialect(activeConnection?.driver)
    const schema = schemaData?.tables ? buildSqlSchema(schemaData.tables) : undefined
    return sql({ dialect, schema, upperCaseKeywords: true })
  }, [activeConnection?.driver, schemaData?.tables])

  // Create editor once
  useEffect(() => {
    if (!containerRef.current) return
    const view = new EditorView({
      state: EditorState.create({
        doc: sqlText,
        extensions: [
          // Core
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          bracketMatching(),
          closeBrackets(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSpecialChars(),
          highlightSelectionMatches(),

          // Gutters
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          lintGutter(),

          // SQL language + schema
          sqlCompartment.current.of(sqlExtension),

          // Autocomplete
          autocompletion({ activateOnTyping: true, icons: true }),

          // Search (Ctrl+F / Ctrl+H)
          search({ top: true }),

          // Linting
          linter(sqlLinter, { delay: 500 }),

          // Theme
          oneDark,
          dblumiEditorTheme,

          // Keymaps
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
            indentWithTab,
            ...closeBracketsKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...defaultKeymap,
          ]),

          // Update listener
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

          // Line wrapping
          EditorView.lineWrapping,
        ],
      }),
      parent: containerRef.current,
    })
    viewRef.current = view
    return () => { view.destroy(); viewRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reconfigure sql extension when schema or driver changes
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: sqlCompartment.current.reconfigure(sqlExtension),
    })
  }, [sqlExtension])

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
