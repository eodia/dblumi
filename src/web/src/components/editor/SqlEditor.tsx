import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
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
  selectAll,
} from '@codemirror/commands'
import { autocompletion, closeBrackets, closeBracketsKeymap, type CompletionContext, type Completion } from '@codemirror/autocomplete'
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
import { format as formatSql } from 'sql-formatter'
import { createCollabInstance, setActiveCollabInstance, type CollabInstance } from '@/collab/collab-provider'
import { collabExtensions } from '@/collab/collab-extensions'
import { CollabAvatars } from './CollabAvatars'
import { useAuthStore } from '@/stores/auth.store'
import { useEditorStore } from '@/stores/editor.store'
import { useI18n } from '@/i18n'
import { connectionsApi, type Connection, type SchemaTable, type SchemaFunction } from '@/api/connections'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

type Props = { onSave?: () => void }

// ── dblumi accent green ──
const G = '#41cd2a'
const G10 = '#41cd2a18'
const G15 = '#41cd2a25'
const G30 = '#41cd2a40'

const dblumiEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
    backgroundColor: '#121314',
  },
  '.cm-scroller': { overflow: 'auto', fontFamily: 'inherit' },
  '.cm-content': { caretColor: G, padding: '8px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: G, borderLeftWidth: '2px' },
  '.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: `${G10} !important`,
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
  '.cm-matchingBracket': { backgroundColor: G15, outline: `1px solid ${G30}` },
  '.cm-nonmatchingBracket': { backgroundColor: '#ef444425', outline: '1px solid #ef444440' },

  // Search panel — dblumi look
  '.cm-searchMatch': { backgroundColor: '#f59e0b30', outline: '1px solid #f59e0b50' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: `${G15}` },
  '.cm-panels': { backgroundColor: '#171717', borderBottom: '1px solid #222323', color: '#FAFAFA' },
  '.cm-panel.cm-search': {
    padding: '8px 12px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
    fontSize: '12px',
  },
  '.cm-panel.cm-search input': {
    backgroundColor: '#27272A',
    border: '1px solid #3F3F46',
    borderRadius: '6px',
    color: '#FAFAFA',
    padding: '4px 8px',
    fontSize: '12px',
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  '.cm-panel.cm-search input:focus': { borderColor: G, boxShadow: `0 0 0 1px ${G30}` },
  '.cm-panel.cm-search button': {
    backgroundColor: '#27272A',
    border: '1px solid #3F3F46',
    borderRadius: '6px',
    color: '#A1A1AA',
    padding: '4px 10px',
    fontSize: '12px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  '.cm-panel.cm-search button:hover': { backgroundColor: '#3F3F46', color: '#FAFAFA' },
  '.cm-panel.cm-search button[name="close"]': {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#71717A',
    padding: '4px',
    borderRadius: '4px',
  },
  '.cm-panel.cm-search button[name="close"]:hover': { color: '#FAFAFA', backgroundColor: '#27272A' },
  '.cm-panel.cm-search label': { color: '#A1A1AA', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' },
  '.cm-panel.cm-search label input[type="checkbox"]': {
    accentColor: G,
  },
  '.cm-panel.cm-search br': { display: 'none' },

  // Selection matches
  '.cm-selectionMatch': { backgroundColor: `${G10}` },

  // Lint
  '.cm-lintRange-warning': { backgroundImage: 'none', borderBottom: '1px dashed #f59e0b' },
  '.cm-lintRange-error': { backgroundImage: 'none', borderBottom: '1px dashed #ef4444' },
  '.cm-lint-marker': { width: '8px' },
  '.cm-tooltip.cm-tooltip-lint': {
    backgroundColor: '#1C1C1F', border: '1px solid #27272A', borderRadius: '6px',
    color: '#FAFAFA', fontSize: '12px', padding: '4px 8px',
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
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px', color: '#A1A1AA' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#27272A', color: '#FAFAFA' },
  '.cm-completionIcon': { width: '16px', paddingRight: '4px', opacity: '0.6' },
  '.cm-completionLabel': { color: '#FAFAFA' },
  '.cm-completionDetail': { color: '#71717A', fontStyle: 'normal', marginLeft: '8px', fontSize: '10px' },
  '.cm-completionMatchedText': { color: G, textDecoration: 'none', fontWeight: 'bold' },
})

// ── CodeMirror phrase translations ──
const cmPhrasesFr: Record<string, string> = {
  'Find': 'Rechercher', 'Replace': 'Remplacer', 'next': 'suivant', 'previous': 'précédent',
  'all': 'tout', 'match case': 'respecter la casse', 'regexp': 'regex', 'by word': 'mot entier',
  'replace': 'remplacer', 'replace all': 'tout remplacer', 'close': 'fermer',
  'current match': 'correspondance actuelle', 'on line': 'à la ligne',
  'replaced $ matches': '$ correspondance(s) remplacée(s)',
  'replaced match on line $': 'correspondance remplacée à la ligne $',
  'Go to line': 'Aller à la ligne', 'go': 'aller',
  'Diagnostics': 'Diagnostics', 'No diagnostics': 'Aucun diagnostic',
}
// English: pass-through (CodeMirror defaults are English)
const cmPhrasesEn: Record<string, string> = {}

function getCmPhrases(locale: string) {
  return EditorState.phrases.of(locale === 'fr' ? cmPhrasesFr : cmPhrasesEn)
}

/** Convert schema tables to CodeMirror SQLNamespace */
function buildSqlSchema(tables: SchemaTable[]): SQLNamespace {
  const ns: Record<string, readonly string[]> = {}
  for (const table of tables) {
    ns[table.name] = table.columns.map((c) => c.name)
  }
  return ns
}

/** Build custom completions for functions/procedures with parameter snippets */
function buildFunctionCompletions(functions: SchemaFunction[]): (ctx: CompletionContext) => { from: number; options: Completion[] } | null {
  const completions: Completion[] = functions.map((fn) => {
    const args = fn.arguments
      ? fn.arguments.split(',').map((a) => a.trim().split(/\s+/)[0] ?? '').filter(Boolean)
      : []
    const paramsStr = args.length > 0 ? args.join(', ') : ''
    const insertText = `${fn.name}(${paramsStr})`
    const isProc = fn.kind === 'procedure'

    return {
      label: fn.name,
      type: isProc ? 'keyword' : 'function',
      detail: isProc
        ? `procedure(${fn.arguments || ''})`
        : `(${fn.arguments || ''}) → ${fn.return_type || 'void'}`,
      apply: insertText,
      boost: -1, // slightly lower priority than tables/columns
    }
  })

  return (ctx: CompletionContext) => {
    const word = ctx.matchBefore(/\w+/)
    if (!word) return null
    return { from: word.from, options: completions }
  }
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
  const fnCompartment = useRef(new Compartment())
  const phrasesCompartment = useRef(new Compartment())
  const collabRef = useRef<CollabInstance | null>(null)
  const [collabReady, setCollabReady] = useState(false)
  const collabCompartment = useRef(new Compartment())
  const historyCompartment = useRef(new Compartment())
  const { locale, t } = useI18n()

  const { tabs, activeTabId, activeConnectionId, setSql, setSelection, executeQuery, executeSelection } = useEditorStore()
  const activeTab = tabs.find((t) => t.id === activeTabId)
  const sqlText = activeTab?.sql ?? ''
  const isRunning = activeTab?.result.status === 'running'
  const user = useAuthStore((s) => s.user)
  const isCollaborative = activeTab?.collaborative ?? false

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
    return sql({ dialect, ...(schema ? { schema } : {}), upperCaseKeywords: true })
  }, [activeConnection?.driver, schemaData?.tables])

  const fnCompletionSource = useMemo(() => {
    if (!schemaData?.functions?.length) return null
    return buildFunctionCompletions(schemaData.functions)
  }, [schemaData?.functions])

  // Create editor once
  useEffect(() => {
    if (!containerRef.current) return
    const view = new EditorView({
      state: EditorState.create({
        doc: sqlText,
        extensions: [
          // i18n
          phrasesCompartment.current.of(getCmPhrases(locale)),

          // Core
          historyCompartment.current.of(history()),
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
          fnCompartment.current.of(fnCompletionSource ? EditorState.languageData.of(() => [{ autocomplete: fnCompletionSource }]) : []),

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

          // Handle drop from schema sidebar (native HTML5 drag-and-drop)
          EditorView.domEventHandlers({
            drop(event, view) {
              const text = event.dataTransfer?.getData('text/plain')
              if (!text || !event.dataTransfer?.types.includes('application/x-dblumi-schema')) return false
              event.preventDefault()
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
              if (pos == null) return false
              view.dispatch({ changes: { from: pos, to: pos, insert: text }, selection: { anchor: pos + text.length } })
              view.focus()
              return true
            },
          }),

          // Line wrapping
          EditorView.lineWrapping,

          // Collab (empty by default, reconfigured when collaborative)
          collabCompartment.current.of([]),
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
      effects: [
        sqlCompartment.current.reconfigure(sqlExtension),
        fnCompartment.current.reconfigure(fnCompletionSource ? EditorState.languageData.of(() => [{ autocomplete: fnCompletionSource }]) : []),
      ],
    })
  }, [sqlExtension, fnCompletionSource])

  // Reconfigure phrases when locale changes
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({
      effects: phrasesCompartment.current.reconfigure(getCmPhrases(locale)),
    })
  }, [locale])

  // Sync doc when tab switches
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== sqlText) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: sqlText } })
    }
  }, [activeTabId, sqlText])

  // Manage collab connection lifecycle
  useEffect(() => {
    const view = viewRef.current
    if (!view || !activeTab) return
    if (!isCollaborative || !activeTab.savedQueryId || !user) return

    let cancelled = false
    let cleanupInstance: (() => void) | null = null

    // Fetch WS token from API (cookie is HttpOnly)
    fetch('/api/v1/auth/ws-token', { credentials: 'include' })
      .then((r) => r.json())
      .then(({ token }) => {
        if (cancelled || !token || !viewRef.current) return

        const instance = createCollabInstance(
          activeTab.savedQueryId!,
          token,
          { userId: user.id, name: user.name, avatarUrl: (user as any).avatarUrl ?? null },
        )
        collabRef.current = instance
        setActiveCollabInstance(instance)
        setCollabReady(true)

        if (!instance.provider.awareness) return

        const v = viewRef.current
        // Clear editor content before binding Yjs (Yjs will sync the content)
        const docLen = v.state.doc.length
        if (docLen > 0) {
          v.dispatch({ changes: { from: 0, to: docLen, insert: '' } })
        }

        // Enable collab extensions, disable history
        v.dispatch({
          effects: [
            collabCompartment.current.reconfigure(
              collabExtensions(instance.ytext, instance.provider.awareness),
            ),
            historyCompartment.current.reconfigure([]),
          ],
        })

        // Sync Yjs text changes back to store
        const observer = () => {
          setSql(instance.ytext.toString())
        }
        instance.ytext.observe(observer)

        const unsubChat = instance.onChatMessage(() => {
          const store = useEditorStore.getState()
          if (!store.chatOpen) {
            store.incrementUnread(activeTabId)
          }
        })

        cleanupInstance = () => {
          instance.ytext.unobserve(observer)
          unsubChat()
          viewRef.current?.dispatch({
            effects: [
              collabCompartment.current.reconfigure([]),
              historyCompartment.current.reconfigure(history()),
            ],
          })
          setActiveCollabInstance(null)
          instance.destroy()
          collabRef.current = null
        }
      })

    return () => {
      cancelled = true
      cleanupInstance?.()
      setCollabReady(false)
    }
  }, [activeTabId, isCollaborative, activeTab?.savedQueryId, user])

  const handleCut = useCallback(async () => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const text = view.state.sliceDoc(from, to)
    if (!text) return
    await navigator.clipboard.writeText(text)
    view.dispatch({ changes: { from, to, insert: '' } })
    view.focus()
  }, [])

  const handleCopy = useCallback(async () => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const text = from === to ? view.state.doc.toString() : view.state.sliceDoc(from, to)
    await navigator.clipboard.writeText(text)
    view.focus()
  }, [])

  const handlePaste = useCallback(async () => {
    const view = viewRef.current
    if (!view) return
    const text = await navigator.clipboard.readText()
    const { from, to } = view.state.selection.main
    view.dispatch({ changes: { from, to, insert: text } })
    view.focus()
  }, [])

  const handleSelectAll = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    selectAll(view)
    view.focus()
  }, [])

  const handleBeautify = useCallback(() => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    const hasSelection = from !== to
    const targetFrom = hasSelection ? from : 0
    const targetTo = hasSelection ? to : view.state.doc.length
    const text = view.state.sliceDoc(targetFrom, targetTo)
    try {
      const language = activeConnection?.driver === 'mysql' ? 'mysql' : 'postgresql'
      const formatted = formatSql(text, { language, tabWidth: 2, keywordCase: 'upper' })
      view.dispatch({ changes: { from: targetFrom, to: targetTo, insert: formatted } })
    } catch {
      // invalid SQL fragment — leave as-is
    }
    view.focus()
  }, [activeConnection?.driver])

  return (
    <>
      {isCollaborative && collabReady && (
        <div className="flex items-center justify-end px-2 py-1 border-b border-border-subtle">
          <CollabAvatars
            awareness={collabRef.current?.provider?.awareness ?? null}
            currentUserId={user?.id ?? ''}
            editorView={viewRef.current}
            unreadCount={activeTab?.unreadChat ?? 0}
            onToggleChat={() => {
              const store = useEditorStore.getState()
              const opening = !store.chatOpen
              store.setChatOpen(opening)
              if (opening) store.resetUnread(activeTabId)
            }}
          />
        </div>
      )}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="h-full">
            <div
              ref={containerRef}
              className={cn('h-full overflow-hidden', isRunning && 'opacity-60 pointer-events-none')}
            />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuItem onSelect={handleCut}>
            {t('editor.cut')}
            <ContextMenuShortcut>⌘X</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleCopy}>
            {t('editor.copy')}
            <ContextMenuShortcut>⌘C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={handlePaste}>
            {t('editor.paste')}
            <ContextMenuShortcut>⌘V</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleSelectAll}>
            {t('editor.selectAll')}
            <ContextMenuShortcut>⌘A</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleBeautify}>
            {t('editor.beautify')}
            <ContextMenuShortcut>⇧⌘F</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </>
  )
}
