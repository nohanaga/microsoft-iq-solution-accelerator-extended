import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { z } from 'zod';

const markdown = new Marked({ gfm: true, breaks: true, renderer: { html: () => '', image: () => '' } });

export function renderMarkdown(element: Element, source: string) {
  const fragment = DOMPurify.sanitize(markdown.parse(source, { async: false }), {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title', 'start', 'align'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  });
  for (const link of fragment.querySelectorAll('a')) {
    try {
      const url = new URL(link.getAttribute('href') || '');
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported link');
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    } catch { link.removeAttribute('href'); }
  }
  for (const table of fragment.querySelectorAll('table')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'markdown-table';
    wrapper.tabIndex = 0;
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', '表');
    table.replaceWith(wrapper);
    wrapper.append(table);
  }
  element.replaceChildren(fragment);
}

const todoSchema = z.array(z.object({
  id: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  is_complete: z.boolean(),
})).refine(items => new Set(items.map(item => item.id)).size === items.length);
type TodoItem = z.infer<typeof todoSchema>[number];
type TodoPhase = 'active' | 'done' | 'cancelled' | 'error';

export function createTodoView(message: Element) {
  const section = document.createElement('section');
  section.className = 'chat-todos';
  section.setAttribute('aria-label', 'Todo');
  const heading = document.createElement('h4');
  heading.textContent = 'Todo';
  const summary = document.createElement('p');
  summary.className = 'todo-summary';
  summary.setAttribute('role', 'status');
  summary.setAttribute('aria-live', 'polite');
  summary.setAttribute('aria-atomic', 'true');
  const progress = document.createElement('progress');
  progress.setAttribute('aria-label', 'Todo の完了状況');
  const list = document.createElement('ul');
  list.className = 'todo-list';
  section.append(heading, summary, progress, list);
  const rows = new Map<number, HTMLLIElement>();
  let items: TodoItem[] = [];
  let phase: TodoPhase = 'active';

  function summarize() {
    const completed = items.filter(item => item.is_complete).length;
    const status = phase === 'cancelled' ? '中断' : phase === 'error' ? '応答エラー' :
      !items.length ? '項目なし' : completed === items.length ? '完了' : phase === 'active' ? '処理中' : '一部未完了';
    summary.textContent = `${completed} / ${items.length} 件完了 · ${status}`;
    section.dataset.phase = phase;
    progress.hidden = !items.length;
    progress.max = items.length || 1;
    progress.value = completed;
  }

  return {
    update(value: unknown) {
      const parsed = todoSchema.safeParse(value);
      if (!parsed.success) return;
      items = parsed.data;
      if (!section.parentNode && items.length) message.insertBefore(section, message.querySelector('.message-text'));
      const ids = new Set(items.map(item => item.id));
      for (const [id, row] of rows) {
        if (!ids.has(id)) { row.remove(); rows.delete(id); }
      }
      for (const item of items) {
        let row = rows.get(item.id);
        if (!row) {
          row = document.createElement('li');
          row.className = 'todo-item';
          row.dataset.todoId = String(item.id);
          row.innerHTML = '<input type="checkbox" disabled><div class="todo-copy"><span class="todo-title"></span><p class="todo-description"></p></div><span class="todo-state"></span>';
          rows.set(item.id, row);
        }
        const check = row.querySelector('input')!;
        check.checked = item.is_complete;
        check.setAttribute('aria-label', item.title);
        row.classList.toggle('is-complete', item.is_complete);
        row.querySelector('.todo-title')!.textContent = item.title;
        row.querySelector('.todo-state')!.textContent = item.is_complete ? '完了' : '未完了';
        const description = row.querySelector<HTMLParagraphElement>('.todo-description')!;
        description.textContent = item.description || '';
        description.hidden = !item.description;
        list.append(row);
      }
      summarize();
    },
    finish(value: Exclude<TodoPhase, 'active'>) { phase = value; summarize(); },
  };
}