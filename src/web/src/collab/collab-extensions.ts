import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { keymap } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'

/**
 * Returns CodeMirror extensions for collaborative editing.
 * These replace the standard history() and historyKeymap.
 */
export function collabExtensions(
  ytext: Y.Text,
  awareness: Awareness,
): Extension[] {
  return [
    yCollab(ytext, awareness, { undoManager: null }),
    keymap.of(yUndoManagerKeymap),
  ]
}
