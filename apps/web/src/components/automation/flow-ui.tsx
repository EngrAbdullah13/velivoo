'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import s from './flows.module.css';
export type IconName = 'flow' | 'email' | 'delay' | 'wait_until' | 'conditional' | 'trigger' | 'end' | 'plus' | 'back' | 'check' | 'search' | 'settings' | 'activity' | 'copy' | 'trash' | 'undo' | 'redo' | 'close' | 'refresh' | 'play' | 'pause';
const paths: Record<IconName, ReactNode> = {
  flow: <><rect x="8" y="2" width="8" height="6" rx="2"/><path d="M12 8v4M4 16v-4h16v4"/><rect x="1" y="16" width="6" height="6" rx="1"/><rect x="17" y="16" width="6" height="6" rx="1"/></>,
  email: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></>,
  delay: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  wait_until: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18m-9 3v4h3"/></>,
  conditional: <><path d="m12 2 5 5-5 5-5-5 5-5Zm0 10v3M5 21v-6h14v6m-17-3 3 3 3-3m8 0 3 3 3-3"/></>,
  trigger: <path d="m13 2-9 12h7l-1 8 10-13h-7l1-7Z"/>,
  end: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></>,
  plus: <path d="M12 5v14M5 12h14"/>, back: <path d="m10 5-7 7 7 7M3 12h18"/>, check: <path d="m4 12 5 5L20 6"/>,
  search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></>,
  settings: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="8" cy="18" r="2" fill="currentColor"/></>,
  activity: <path d="M2 12h5l3-8 4 16 3-8h5"/>, copy: <><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></>, undo: <path d="m8 3-5 5 5 5M3 8h11a7 7 0 0 1 0 14"/>, redo: <path d="m16 3 5 5-5 5m5-5H10a7 7 0 0 0 0 14"/>, close: <path d="m6 6 12 12M6 18 18 6"/>,
  refresh: <><path d="M20 8a8 8 0 1 0 0 8M20 2v6h-6"/></>, play: <path d="m7 3 14 9-14 9V3Z"/>, pause: <><path d="M8 4v16M16 4v16"/></>,
};
export function FlowIcon({ name, size = 18 }: { name: IconName; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; }
export function Status({ value }: { value: string }) { return <span className={s.status} data-state={value}><i/>{value.replaceAll('_', ' ')}</span>; }
export function FlowDialog({ title, children, close, busy = false, wide = false }: { title: string; children: ReactNode; close: () => void; busy?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={`${s.dialog} ${wide ? s.wideDialog : ''}`} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) close(); }}><header><div><small>VELIVOO AUTOMATIONS</small><h2>{title}</h2></div><button className={s.iconButton} aria-label="Close dialog" disabled={busy} onClick={close}><FlowIcon name="close"/></button></header>{children}</dialog>;
}
