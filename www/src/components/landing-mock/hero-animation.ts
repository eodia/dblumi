// www/src/components/landing-mock/hero-animation.ts
// 13-step looping animation for the landing hero mockup.
// Respects prefers-reduced-motion.

type Token = ['cm' | 'kw' | 'fn' | 'str' | 'txt', string];
type Line = { tokens: Token[] };

interface AnimStrings {
  question: string;
  aiIntro: string;
}

const SQL_LINES: Line[] = [
  { tokens: [['cm', '-- Top regions by revenue']] },
  { tokens: [['kw', 'SELECT'], ['txt', ' region, '], ['fn', 'SUM'], ['txt', '(total) '], ['kw', 'AS'], ['txt', ' revenue']] },
  { tokens: [['kw', 'FROM'], ['txt', ' orders']] },
  { tokens: [['kw', 'WHERE'], ['txt', ' created_at >= '], ['str', "'2026-01-01'"]] },
  { tokens: [['kw', 'GROUP BY'], ['txt', ' region']] },
  { tokens: [['kw', 'ORDER BY'], ['txt', ' revenue '], ['kw', 'DESC'], ['txt', ';']] },
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function flatChars(line: Line): Token[] {
  const out: Token[] = [];
  for (const [cls, text] of line.tokens) {
    for (const ch of text) out.push([cls, ch]);
  }
  return out;
}

export function startHeroAnimation(strings: AnimStrings): void {
  const mock = document.getElementById('db-hero-mock');
  const editor = document.getElementById('db-hero-editor');
  const mouse = document.getElementById('db-hero-mouse');
  const runBtn = document.getElementById('btn-run');
  const results = document.getElementById('db-hero-results');
  const userMsg = document.getElementById('db-hero-user-msg');
  const typing = document.getElementById('db-hero-typing');
  const aiMsg = document.getElementById('db-hero-ai-msg');
  const copilotInput = document.getElementById('db-hero-copilot-input');
  const emptyState = document.getElementById('db-hero-empty-state');
  const convo = document.getElementById('db-hero-convo');

  if (!mock || !editor || !mouse || !runBtn || !results || !userMsg || !typing || !aiMsg || !copilotInput || !emptyState || !convo) {
    return;
  }

  // Respect prefers-reduced-motion: run once to final state, no loop
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Sidebar view switcher — clicking Tables / SQL Editor swaps the sidebar view
  mock.querySelectorAll<HTMLElement>('.sidebar .sb-nav .nav-item').forEach((item) => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      if (!view) return;
      mock.querySelectorAll('.sidebar .sb-nav .nav-item').forEach((n) => {
        n.classList.toggle('active', n === item);
      });
      mock.querySelectorAll('.sidebar .sb-view').forEach((v) => {
        v.classList.toggle('active', v.classList.contains(view + '-view'));
      });
    });
  });

  function resetAll(): void {
    editor!.classList.remove('has-content');
    // Remove only dynamically-added lines and stray cursors; keep .editor-empty intact
    editor!.querySelectorAll('.line').forEach((l) => l.remove());
    editor!.querySelectorAll('.cursor').forEach((c) => c.remove());
    results!.classList.remove('open');
    userMsg!.classList.remove('show');
    userMsg!.textContent = '';
    typing!.classList.remove('show');
    aiMsg!.classList.remove('show');
    copilotInput!.innerHTML = '';
    runBtn!.classList.remove('loading', 'clicked');
    mouse!.classList.remove('visible');
    emptyState!.classList.remove('hidden');
    convo!.classList.remove('show');
  }

  async function typeInInput(text: string): Promise<void> {
    copilotInput!.innerHTML = '';
    const textSpan = document.createElement('span');
    const caret = document.createElement('span');
    caret.className = 'caret';
    copilotInput!.appendChild(textSpan);
    copilotInput!.appendChild(caret);
    for (let i = 0; i < text.length; i++) {
      textSpan.textContent += text[i];
      await sleep(30 + Math.random() * 28);
    }
    await sleep(200);
  }

  async function submitQuestion(text: string): Promise<void> {
    copilotInput!.innerHTML = '';
    emptyState!.classList.add('hidden');
    convo!.classList.add('show');
    userMsg!.textContent = text;
    userMsg!.classList.add('show');
    await sleep(700);
  }

  async function showTypingThenAi(): Promise<void> {
    typing!.classList.add('show');
    await sleep(1100);
    typing!.classList.remove('show');
    aiMsg!.classList.add('show');
    await sleep(350);
  }

  async function writeSQL(): Promise<void> {
    // Remove any existing lines/cursors but keep .editor-empty
    editor!.querySelectorAll('.line').forEach((l) => l.remove());
    editor!.querySelectorAll('.cursor').forEach((c) => c.remove());
    editor!.classList.add('has-content');
    for (let i = 0; i < SQL_LINES.length; i++) {
      const div = document.createElement('div');
      div.className = 'line';
      div.innerHTML = `<span class="ln">${i + 1}</span><span class="code"></span>`;
      editor!.appendChild(div);
      const codeEl = div.querySelector<HTMLElement>('.code')!;

      const oldCursor = editor!.querySelector<HTMLElement>('.cursor');
      if (oldCursor) oldCursor.remove();
      const cur = document.createElement('span');
      cur.className = 'cursor';
      codeEl.appendChild(cur);

      const chars = flatChars(SQL_LINES[i]!);
      let currentCls: string | null = null;
      let currentSpan: HTMLElement | null = null;
      for (let c = 0; c < chars.length; c++) {
        const [cls, ch] = chars[c]!;
        if (cls !== currentCls) {
          currentSpan = document.createElement('span');
          if (cls !== 'txt') currentSpan.className = cls;
          codeEl.insertBefore(currentSpan, cur);
          currentCls = cls;
        }
        currentSpan!.textContent += ch;
        await sleep(14 + Math.random() * 14);
      }
      await sleep(90);
    }
  }

  function positionRelativeTo(el: HTMLElement): { x: number; y: number } {
    const r = el.getBoundingClientRect();
    const m = mock!.getBoundingClientRect();
    return { x: r.left - m.left + r.width / 2 - 4, y: r.top - m.top + r.height / 2 - 4 };
  }

  function moveMouseTo(pos: { x: number; y: number }): void {
    mouse!.style.left = pos.x + 'px';
    mouse!.style.top = pos.y + 'px';
  }

  async function moveMouseToRun(): Promise<void> {
    const editorRect = editor!.getBoundingClientRect();
    const mockRect = mock!.getBoundingClientRect();
    mouse!.style.transition = 'none';
    moveMouseTo({ x: editorRect.right - mockRect.left - 60, y: editorRect.bottom - mockRect.top - 30 });
    await sleep(50);
    mouse!.classList.add('visible');
    mouse!.getBoundingClientRect(); // force reflow
    mouse!.style.transition = '';
    await sleep(60);
    moveMouseTo(positionRelativeTo(runBtn as HTMLElement));
    await sleep(950);
  }

  async function clickRun(): Promise<void> {
    runBtn!.classList.add('clicked');
    await sleep(120);
    runBtn!.classList.add('loading');
    await sleep(450);
    results!.classList.add('open');
    await sleep(60);
    runBtn!.classList.remove('loading');
    runBtn!.classList.remove('clicked');
  }

  async function runOnce(): Promise<void> {
    resetAll();
    await sleep(500);
    await typeInInput(strings.question);
    await submitQuestion(strings.question);
    await showTypingThenAi();
    await sleep(300);
    await writeSQL();
    await sleep(350);
    await moveMouseToRun();
    await clickRun();
    await sleep(4200);
  }

  async function loop(): Promise<void> {
    if (prefersReduced) {
      await runOnce();
      return;
    }
    while (true) {
      await runOnce();
    }
  }

  void loop();
}
