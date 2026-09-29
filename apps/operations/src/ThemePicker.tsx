import { Check, ChevronDown, Palette } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export type ThemeId = 'light' | 'dark' | 'cyber' | 'contrast';

interface ThemeOption {
  id: ThemeId;
  label: string;
}

const themeOptions: ThemeOption[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'cyber', label: 'Cyber' },
  { id: 'contrast', label: 'High Contrast' },
];

const isThemeId = (value: string | null): value is ThemeId => themeOptions.some(option => option.id === value);

function currentTheme(): ThemeId {
  const value = document.documentElement.getAttribute('data-theme');
  return isThemeId(value) ? value : 'light';
}

function applyTheme(theme: ThemeId) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('micro-coffee-theme', theme); } catch {}
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('scoutTheme', theme);
    history.replaceState(history.state, '', url);
  } catch {}
}

export function ThemePicker() {
  const [theme, setTheme] = useState<ThemeId>(currentTheme);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const selected = themeOptions.find(option => option.id === theme) ?? themeOptions[0];

  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const dismiss = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) menuRef.current.open = false;
    };
    document.addEventListener('pointerdown', dismiss);
    return () => { observer.disconnect(); document.removeEventListener('pointerdown', dismiss); };
  }, []);

  const selectTheme = (nextTheme: ThemeId) => {
    applyTheme(nextTheme);
    setTheme(nextTheme);
    if (menuRef.current) menuRef.current.open = false;
    triggerRef.current?.focus();
  };

  return <details className="theme-picker" ref={menuRef} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false;
  }} onKeyDown={event => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.currentTarget.open = false; triggerRef.current?.focus();
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    event.currentTarget.open = true;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const current = buttons.findIndex(button => button === document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : current === -1 ? event.key === 'ArrowDown' ? 0 : buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }}>
    <summary ref={triggerRef} title="テーマを変更" aria-haspopup="menu" aria-label={`テーマを変更。現在は ${selected.label}`}>
      <Palette size={16}/><span>{selected.label}</span><ChevronDown size={13}/>
    </summary>
    <div className="theme-menu" role="menu" aria-label="表示テーマ">
      {themeOptions.map(option => <button
        type="button"
        role="menuitemradio"
        aria-checked={theme === option.id}
        key={option.id}
        onClick={() => selectTheme(option.id)}
      >
        <span className={`theme-swatch theme-swatch-${option.id}`}/>
        <span>{option.label}</span>
        {theme === option.id && <Check size={15}/>}
      </button>)}
    </div>
  </details>;
}