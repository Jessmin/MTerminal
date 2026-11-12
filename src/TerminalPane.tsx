import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { api, message, type Session } from './types';
import '@xterm/xterm/css/xterm.css';

// Cancel a partial escape sequence, restore the normal buffer and reset terminal modes.
// Move below the old screen so the new shell starts on a fresh line with scrollback intact.
const reconnectReset = '\x18\x1b[?1000;1006l\x1b[?1047l\x1b[!p\x1b[999B\r\n';

export function TerminalPane({ session, active, onFailure }: { session: Session; active: boolean; onFailure: (id: string, error: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const instance = useRef<{ terminal: Terminal; fit: FitAddon } | null>(null);
  const failure = useRef(onFailure);
  failure.current = onFailure;
  useEffect(() => {
    let disposed = false;
    let status = session.status;
    let inputGeneration = 0;
    let resetting = false;
    const terminal = new Terminal({
      cursorBlink: true, cursorStyle: 'bar', fontSize: 13, lineHeight: 1.32,
      fontFamily: '"SF Mono", "Cascadia Code", Consolas, Menlo, Monaco, "PingFang SC", monospace',
      scrollback: 10000, allowProposedApi: false, convertEol: false,
      disableStdin: status !== 'ready',
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
    const unsubscribeState = api.onState(event => {
      if (event.id !== session.id) return;
      const disconnected = status === 'ready' && event.status !== 'ready';
      status = event.status;
      if (disconnected) {
        inputGeneration++;
        if (status === 'reconnecting') {
          const generation = inputGeneration;
          resetting = true;
          terminal.write(reconnectReset, () => {
            if (disposed || generation !== inputGeneration) return;
            resetting = false;
            terminal.options.disableStdin = status !== 'ready';
          });
        }
      }
      terminal.options.disableStdin = resetting || status !== 'ready';
      if (status === 'ready') resize();
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
        event.preventDefault();
        if (!terminal.options.disableStdin) {
          const generation = inputGeneration;
          void api.clipboardRead().then(text => {
            if (!disposed && generation === inputGeneration) terminal.paste(text);
          });
        }
        return false;
      }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); terminal.clear(); return false; }
      return true;
    });
    resize();
    api.startSession({ ...session, cols: terminal.cols, rows: terminal.rows }).then(() => {
      if (disposed) void api.closeSession(session.id);
      else resize();
    }).catch(error => {
      if (!disposed) failure.current(session.id, message(error));
    });
    return () => {
      disposed = true;
      unsubscribe(); unsubscribeState(); input.dispose(); observer.disconnect();
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
