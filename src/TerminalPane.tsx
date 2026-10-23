import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { api, message, type Session } from './types';
import '@xterm/xterm/css/xterm.css';

export function TerminalPane({ session, active, onFailure }: { session: Session; active: boolean; onFailure: (id: string, error: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const instance = useRef<{ terminal: Terminal; fit: FitAddon } | null>(null);
  const failure = useRef(onFailure);
  failure.current = onFailure;
  useEffect(() => {
    const terminal = new Terminal({
      cursorBlink: true, cursorStyle: 'bar', fontSize: 13, lineHeight: 1.32,
      fontFamily: '"SF Mono", "Cascadia Code", Consolas, Menlo, Monaco, "PingFang SC", monospace',
      scrollback: 10000, allowProposedApi: false, convertEol: false,
      theme: {
        background: '#101417', foreground: '#d4dce1', cursor: '#77e0be', selectionBackground: '#30645288',
        black: '#283137', red: '#ee868b', green: '#80d7a9', yellow: '#e3c180', blue: '#88b9ef',
        magenta: '#c5a3e7', cyan: '#82cccf', white: '#d4dce1', brightBlack: '#7d8992',
        brightRed: '#ff9a9f', brightGreen: '#a2eac4', brightYellow: '#f4d69d', brightBlue: '#a5ceff',
        brightMagenta: '#dfbdff', brightCyan: '#a6e5e7', brightWhite: '#f4f6f8',
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon((event, uri) => { event.preventDefault(); void api.openExternal(uri).catch(() => {}); }));
    terminal.open(element.current!);
    instance.current = { terminal, fit };
    const resize = () => {
      if (!element.current?.clientWidth || !element.current?.clientHeight) return;
      try { fit.fit(); api.resize(session.id, terminal.cols, terminal.rows); } catch {}
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element.current!);
    const unsubscribe = api.onData(event => {
      if (event.id !== session.id) return;
      terminal.write(event.data, () => api.ack(session.id, event.data.length));
    });
    const input = terminal.onData(data => api.write(session.id, data));
    terminal.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown') return true;
      const mac = navigator.platform.toLowerCase().includes('mac');
      if (mac ? !event.metaKey : !(event.ctrlKey && event.shiftKey)) return true;
      if (!mac && /^(Key[TNWJ]|Digit[1-9])$/.test(event.code)) return false;
      if (event.key.toLowerCase() === 'c' && terminal.hasSelection()) {
        event.preventDefault(); void api.clipboardWrite(terminal.getSelection()); return false;
      }
      if (event.key.toLowerCase() === 'v') {
        event.preventDefault(); void api.clipboardRead().then(text => terminal.paste(text)); return false;
      }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); terminal.clear(); return false; }
      return true;
    });
    resize();
    let disposed = false;
    api.startSession({ ...session, cols: terminal.cols, rows: terminal.rows }).then(() => {
      if (disposed) void api.closeSession(session.id);
      else resize();
    }).catch(error => {
      if (!disposed) failure.current(session.id, message(error));
    });
    return () => {
      disposed = true;
      unsubscribe(); input.dispose(); observer.disconnect();
      terminal.dispose(); instance.current = null;
      void api.closeSession(session.id);
    };
  }, [session.id]);
  useEffect(() => {
    if (active && instance.current) {
      const frame = requestAnimationFrame(() => {
        if (!instance.current) return;
        instance.current.fit.fit();
        api.resize(session.id, instance.current.terminal.cols, instance.current.terminal.rows);
        instance.current.terminal.focus();
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [active, session.id]);
  return <div className={`terminal-pane ${active ? 'active' : ''}`} ref={element} aria-label={`${session.label} 终端`} />;
}
