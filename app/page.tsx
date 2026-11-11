'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent, FormEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import type { TipTapDoc, TipTapNode } from '@/lib/tiptap';

type User = { userId: string; email: string; displayName: string };
type Role = 'owner' | 'editor' | 'viewer';
type DocumentItem = {
  id: string;
  title: string;
  ownerId: string;
  role: Role;
  ownership: 'owned' | 'shared';
  createdAt: string;
  updatedAt: string;
};
type DocumentData = DocumentItem & { content: TipTapDoc };
type SaveState = 'idle' | 'saving' | 'saved' | 'failed';
type Member = { userId: string; email: string; displayName: string; role: Role; createdAt: string };

class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const EMPTY_DOC: TipTapDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

async function api<T>(url: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { credentials: 'same-origin', ...init, signal: init?.signal ?? controller.signal });
    if (response.status === 204) return undefined as T;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiRequestError(body?.error?.message ?? 'Something went wrong. Please try again.', response.status);
    return body as T;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The server took too long to respond. Check that PostgreSQL is running, then try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

function nodeHtml(node: TipTapNode): string {
  if (node.type === 'text') {
    let text = escapeHtml(node.text ?? '');
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') text = `<strong>${text}</strong>`;
      else if (mark.type === 'italic') text = `<em>${text}</em>`;
      else if (mark.type === 'underline') text = `<u>${text}</u>`;
      else if (mark.type === 'code') text = `<code>${text}</code>`;
      else if (mark.type === 'link') {
        const href = typeof mark.attrs?.href === 'string' ? mark.attrs.href : '';
        const safe = /^(https?:|mailto:|tel:|\/|#)/i.test(href) ? href : '#';
        text = `<a href="${escapeHtml(safe)}" rel="noopener noreferrer nofollow" target="_blank">${text}</a>`;
      }
    }
    return text;
  }
  if (node.type === 'hardBreak') return '<br>';
  const children = (node.content ?? []).map(nodeHtml).join('');
  if (node.type === 'doc') return children;
  if (node.type === 'heading') return `<h${Math.min(3, Math.max(1, Number(node.attrs?.level) || 2))}>${children || '<br>'}</h${Math.min(3, Math.max(1, Number(node.attrs?.level) || 2))}>`;
  if (node.type === 'bulletList') return `<ul>${children}</ul>`;
  if (node.type === 'orderedList') return `<ol>${children}</ol>`;
  if (node.type === 'listItem') return `<li>${children || '<p><br></p>'}</li>`;
  if (node.type === 'blockquote') return `<blockquote>${children}</blockquote>`;
  if (node.type === 'codeBlock') return `<pre><code>${children}</code></pre>`;
  if (node.type === 'horizontalRule') return '<hr>';
  return `<p>${children || '<br>'}</p>`;
}

function toHtml(doc: TipTapDoc): string {
  return (doc.content ?? []).map(nodeHtml).join('') || '<p><br></p>';
}

function marksFor(element: Element): { type: string; attrs?: Record<string, unknown> }[] {
  const marks: { type: string; attrs?: Record<string, unknown> }[] = [];
  let current: Element | null = element;
  while (current && current.tagName !== 'DIV') {
    const tag = current.tagName.toLowerCase();
    if (tag === 'strong' || tag === 'b') marks.unshift({ type: 'bold' });
    if (tag === 'em' || tag === 'i') marks.unshift({ type: 'italic' });
    if (tag === 'u') marks.unshift({ type: 'underline' });
    if (tag === 'code') marks.unshift({ type: 'code' });
    if (tag === 'a') {
      const href = current.getAttribute('href') ?? '';
      if (/^(https?:|mailto:|tel:|\/|#)/i.test(href)) marks.unshift({ type: 'link', attrs: { href } });
    }
    current = current.parentElement;
  }
  return marks;
}

function readInline(node: Node, root: Element): TipTapNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? '';
    return text ? [{ type: 'text', text, ...(node.parentElement ? { marks: marksFor(node.parentElement) } : {}) }] : [];
  }
  if (!(node instanceof Element)) return [];
  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return [{ type: 'hardBreak' }];
  // The root is the block we're intentionally reading (for example the <h2> passed
  // by readBlocks). Only stop when a *nested* block is encountered. Previously this
  // rejected the root heading/paragraph too, so autosave serialized formatted text as
  // an empty node and overwrote the shared document in the database.
  if (node !== root && (
    tag === 'div' || tag === 'ul' || tag === 'ol' || tag === 'li' || tag === 'p' ||
    /^h[1-6]$/.test(tag) || tag === 'blockquote' || tag === 'pre'
  )) return [];
  const out: TipTapNode[] = [];
  node.childNodes.forEach((child) => out.push(...readInline(child, root)));
  return out;
}

function isBlockElement(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  return tag === 'div' || tag === 'p' || /^h[1-6]$/.test(tag) ||
    tag === 'ul' || tag === 'ol' || tag === 'blockquote' || tag === 'pre' || tag === 'hr';
}

function readBlocks(parent: ParentNode): TipTapNode[] {
  const nodes: TipTapNode[] = [];
  parent.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (text.trim()) nodes.push({ type: 'paragraph', content: [{ type: 'text', text }] });
      return;
    }
    if (!(child instanceof Element)) return;
    const tag = child.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') {
      nodes.push({ type: tag === 'ul' ? 'bulletList' : 'orderedList', content: Array.from(child.children).filter((item) => item.tagName.toLowerCase() === 'li').map((item) => ({ type: 'listItem', content: readBlocks(item) })) });
    } else if (/^h[1-3]$/.test(tag)) {
      nodes.push({ type: 'heading', attrs: { level: Number(tag[1]) }, content: readInline(child, child) });
    } else if (tag === 'blockquote') {
      nodes.push({ type: 'blockquote', content: readBlocks(child) });
    } else if (tag === 'pre') {
      nodes.push({ type: 'codeBlock', content: [{ type: 'text', text: child.textContent ?? '' }] });
    } else if (tag === 'hr') {
      nodes.push({ type: 'horizontalRule' });
    } else if (tag === 'div' && Array.from(child.children).some(isBlockElement)) {
      // Some browsers wrap formatted content in an extra editable <div>.
      nodes.push(...readBlocks(child));
    } else if (tag === 'div' || tag === 'p') {
      const children = readInline(child, child);
      nodes.push({ type: 'paragraph', content: children.length ? children : undefined });
    } else {
      const children = readInline(child, child);
      if (children.length) nodes.push({ type: 'paragraph', content: children });
    }
  });
  return nodes;
}

function fromHtml(html: string): TipTapDoc {
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild;
  const content = parsed ? readBlocks(parsed) : [];
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] };
}

function Icon({ name }: { name: string }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  const paths: Record<string, ReactNode> = {
    plus: <><path d="M12 5v14M5 12h14" /></>, search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    doc: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v6h6M10 13h6M10 17h6" /></>,
    share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.7 10.7 6.6-4.4m-6.6 7 6.6 4.1" /></>,
    upload: <><path d="M12 16V4m-4 4 4-4 4 4" /><path d="M5 14v5h14v-5" /></>,
    retry: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9a7 7 0 0 1 11.6-2L20 12M4 12l2.9 5a7 7 0 0 0 11.6-2" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
  };
  return <svg {...common}>{paths[name] ?? paths.doc}</svg>;
}

export default function Page() {
  const [user, setUser] = useState<User | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [active, setActive] = useState<DocumentData | null>(null);
  const [filter, setFilter] = useState<'all' | 'owned' | 'shared'>('all');
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [shareRole, setShareRole] = useState<'editor' | 'viewer'>('editor');
  const [members, setMembers] = useState<Member[]>([]);
  const [owner, setOwner] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ id: string; title: string; content: TipTapDoc } | null>(null);
  const drainPromise = useRef<Promise<void> | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const refreshList = useCallback(async () => {
    const result = await api<{ documents: DocumentItem[] }>('/api/documents');
    setDocuments(result.documents);
  }, []);

  const openDocument = useCallback(async (item: DocumentItem) => {
    setError('');
    setSaveState('idle');
    try {
      const doc = await api<DocumentData>(`/api/documents/${item.id}`);
      const savedDraft = doc.role === 'viewer' ? null : localStorage.getItem(`ajaia-draft-${doc.id}`);
      if (savedDraft) {
        try {
          const draft = JSON.parse(savedDraft) as { title?: string; content?: TipTapDoc };
          if (draft.content?.type === 'doc') {
            doc.content = draft.content;
            if (typeof draft.title === 'string') doc.title = draft.title;
            pending.current = { id: doc.id, title: doc.title, content: doc.content };
            setSaveState('failed');
            setError('An unsaved draft from this device is open. Retry to sync it.');
          }
        } catch { localStorage.removeItem(`ajaia-draft-${doc.id}`); }
      }
      setActive(doc);
      setTitle(doc.title);
      setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = toHtml(doc.content); }, 0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not open document.');
    }
  }, []);

  // Only replace the editor surface when switching documents. Replacing it on every
  // content update would reset the caret while the user is typing.
  useEffect(() => {
    if (!active) return;
    const editor = editorRef.current;
    if (editor) editor.innerHTML = toHtml(active.content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  useEffect(() => {
    let alive = true;
    const openWorkspace = async () => {
      try {
        const me = await api<{ user: User }>('/api/me', undefined, 5000);
        if (!alive) return;
        setUser(me.user);
        setLoading(false);
        try {
          await refreshList();
        } catch (reason) {
          if (alive) setError(reason instanceof Error ? reason.message : 'Could not load documents.');
        }
      } catch (reason) {
        if (!alive) return;
        if (!(reason instanceof ApiRequestError && reason.status === 401)) {
          setError(reason instanceof Error ? reason.message : 'Could not connect to the workspace.');
        }
      } finally {
        if (alive) setLoading(false);
      }
    };
    void openWorkspace();
    return () => { alive = false; };
  }, [refreshList]);

  // A collaborator may already have the workspace open when a document is shared.
  // Refresh the lightweight list periodically so the new document appears there.
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      void refreshList().catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [user, refreshList]);

  const filteredDocuments = useMemo(() => documents.filter((doc) =>
    (filter === 'all' || doc.ownership === filter) && doc.title.toLowerCase().includes(query.toLowerCase()),
  ), [documents, filter, query]);

  const signIn = async (email: string) => {
    setBusy(true); setError('');
    try {
      const result = await api<{ user: User }>('/api/auth/demo-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
      });
      setUser(result.user);
      setLoading(false);
      void refreshList().catch((reason) => setError(reason instanceof Error ? reason.message : 'Could not load documents.'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Demo sign-in failed.'); }
    finally { setBusy(false); setLoading(false); }
  };

  const signOut = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* Clear the local session view either way. */ }
    setUser(null); setDocuments([]); setActive(null); setTitle(''); setSaveState('idle');
  };

  const createDocument = async () => {
    setBusy(true); setError('');
    try {
      const doc = await api<DocumentData>('/api/documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Untitled document', content: EMPTY_DOC }),
      });
      setDocuments((current) => [doc, ...current]); setActive(doc); setTitle(doc.title); setSaveState('saved');
      if (editorRef.current) editorRef.current.innerHTML = toHtml(doc.content);
      setTimeout(() => editorRef.current?.focus(), 0);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not create document.'); }
    finally { setBusy(false); }
  };

  const activeDocumentId = active?.id;
  const persist = useCallback((item: { id: string; title: string; content: TipTapDoc }): Promise<void> => {
    pending.current = item;
    if (drainPromise.current) return drainPromise.current;

    const drain = async () => {
      while (pending.current) {
        const current = pending.current;
        pending.current = null;
        if (activeDocumentId === current.id) { setSaveState('saving'); setError(''); }
        try {
          const updated = await api<DocumentData>(`/api/documents/${current.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: current.title, content: current.content }),
          });
          const queuedAfterRequest = pending.current as { id: string; title: string; content: TipTapDoc } | null;
          const hasNewerDraft = queuedAfterRequest?.id === current.id;
          setActive((latest) => latest?.id === updated.id
            ? (hasNewerDraft ? latest : { ...updated })
            : latest);
          setDocuments((latest) => latest.map((doc) => doc.id === updated.id
            ? { ...doc, title: updated.title, updatedAt: updated.updatedAt }
            : doc));
          if (!hasNewerDraft) {
            if (activeDocumentId === current.id) setSaveState('saved');
            localStorage.removeItem(`ajaia-draft-${current.id}`);
          }
        } catch (reason) {
          const queuedAfterFailure = pending.current as { id: string; title: string; content: TipTapDoc } | null;
          if (!queuedAfterFailure || queuedAfterFailure.id !== current.id) pending.current = current;
          if (activeDocumentId === current.id) {
            setSaveState('failed');
            setError(reason instanceof Error ? reason.message : 'Save failed. Your draft is still here.');
          }
          break;
        }
      }
    };

    const running = drain().finally(() => {
      drainPromise.current = null;
    });
    drainPromise.current = running;
    return running;
  }, [activeDocumentId]);
  const queueSave = useCallback((nextTitle: string, nextContent: TipTapDoc) => {
    if (!active || active.role === 'viewer') return;
    const item = { id: active.id, title: nextTitle.trim() || 'Untitled document', content: nextContent };
    pending.current = item;
    try { localStorage.setItem(`ajaia-draft-${active.id}`, JSON.stringify({ title: item.title, content: item.content })); } catch { /* The in-memory draft is still available for retry. */ }
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { saveTimer.current = null; void persist(item); }, 750);
  }, [active, persist]);

  const retryCurrentSave = () => {
    if (!active || active.role === 'viewer') return;
    const item = pending.current?.id === active.id
      ? pending.current
      : { id: active.id, title: title.trim() || 'Untitled document', content: active.content };
    pending.current = item;
    void persist(item);
  };

  const saveNow = async () => {
    if (!active || active.role === 'viewer') return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const content = editorRef.current ? fromHtml(editorRef.current.innerHTML) : active.content;
    const item = { id: active.id, title: title.trim() || 'Untitled document', content };
    pending.current = item;
    try { localStorage.setItem(`ajaia-draft-${active.id}`, JSON.stringify({ title: item.title, content })); } catch { /* Keep the in-memory copy for retry. */ }
    await persist(item);
  };

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const handleTitleChange = (value: string) => { setTitle(value); if (active) queueSave(value, active.content); };
  const handleEditorInput = () => {
    if (!editorRef.current || !active) return;
    const content = fromHtml(editorRef.current.innerHTML);
    setActive((current) => current ? { ...current, content } : current);
    queueSave(title, content);
  };

  const handleEditorPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    const plainText = event.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, plainText);
    handleEditorInput();
  };

  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    const form = new FormData(); form.append('file', file);
    try {
      const doc = await api<DocumentData>('/api/documents/import', { method: 'POST', body: form });
      setDocuments((current) => [doc, ...current]); setActive(doc); setTitle(doc.title); setSaveState('saved');
      if (editorRef.current) editorRef.current.innerHTML = toHtml(doc.content);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Import failed.'); }
    finally { setBusy(false); }
  };

  const showSharing = async () => {
    if (!active) return;
    try {
      const result = await api<{ owner: Member; members: Member[] }>(`/api/documents/${active.id}/members`);
      setOwner(result.owner); setMembers(result.members); setShareOpen(true); setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not load sharing details.'); }
  };

  const share = async (event: FormEvent) => {
    event.preventDefault(); if (!active || active.role !== 'owner') return;
    setBusy(true); setError('');
    try {
      await api(`/api/documents/${active.id}/members`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: shareEmail, role: shareRole }),
      });
      const result = await api<{ owner: Member; members: Member[] }>(`/api/documents/${active.id}/members`);
      setOwner(result.owner); setMembers(result.members); setShareEmail('');
      await refreshList();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not share document.'); }
    finally { setBusy(false); }
  };

  const runFormat = (event: ReactMouseEvent<HTMLButtonElement>, command: string, value?: string) => {
    event.preventDefault();
    if (active?.role === 'viewer') return;
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    handleEditorInput();
  };

  const statusText = saveState === 'saving' ? 'Saving…' : saveState === 'failed' ? 'Save failed' : saveState === 'saved' ? 'Saved' : ' ';

  if (loading) return <main className="loading-screen"><div className="loading-mark">a</div><p>Opening your workspace…</p></main>;

  if (!user) return (
    <main className="login-screen">
      <div className="login-card">
        <div className="brand-mark">a</div><p className="eyebrow">YOUR SHARED WORKSPACE</p>
        <h1>Good ideas<br />start somewhere.</h1>
        <p className="login-copy">A calm space for the notes, plans, and documents you make with your team.</p>
        <div className="login-actions">
          <p className="field-label">Enter the demo workspace as</p>
          <button className="person-choice" disabled={busy} onClick={() => void signIn('alex@demo.local')}><span className="avatar avatar-gold">A</span><span><b>Alex Demo</b><small>alex@demo.local · owner</small></span><span className="choice-arrow">↗</span></button>
          <button className="person-choice" disabled={busy} onClick={() => void signIn('sam@demo.local')}><span className="avatar avatar-blue">S</span><span><b>Sam Demo</b><small>sam@demo.local · collaborator</small></span><span className="choice-arrow">↗</span></button>
          <p className="demo-note">Demo access only · no password needed</p>
        </div>
        {error && <p className="error-message">{error}</p>}
        <div className="login-footer">Ajaia <span>·</span> Notes, made together</div>
      </div>
      <div className="login-art" aria-hidden="true"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-paper"><div className="art-paper-head"/><div className="art-line wide"/><div className="art-line"/><div className="art-highlight"/><div className="art-line short"/><div className="art-line wide"/><div className="art-sticky">make<br />room for<br /><i>good ideas.</i></div></div><div className="art-caption">A LITTLE SPACE<br />TO THINK CLEARLY</div></div>
    </main>
  );

  return (
    <main className="workspace">
      <aside className="sidebar">
        <div className="sidebar-top"><div className="brand-lockup"><span className="brand-mark small">a</span><span>ajaia</span></div><button className="icon-button new-button" onClick={() => void createDocument()} disabled={busy} aria-label="New document"><Icon name="plus" /></button></div>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <button className="sidebar-create" onClick={() => void createDocument()} disabled={busy}><Icon name="plus" /> New document <span>⌘ N</span></button>
        <label className="search-field"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your docs" /></label>
        <div className="sidebar-section"><span>LIBRARY</span></div>
        <nav className="filter-nav" aria-label="Document filters">
          <button className={filter === 'all' ? 'selected' : ''} onClick={() => setFilter('all')}><span className="nav-glyph">▦</span> All documents <small>{documents.length}</small></button>
          <button className={filter === 'owned' ? 'selected' : ''} onClick={() => setFilter('owned')}><span className="nav-glyph">▤</span> Created by me</button>
          <button className={filter === 'shared' ? 'selected' : ''} onClick={() => setFilter('shared')}><span className="nav-glyph">♧</span> Shared with me</button>
        </nav>
        <div className="sidebar-section docs-heading"><span>RECENT DOCUMENTS</span><button onClick={() => void createDocument()} aria-label="Create document">+</button></div>
        <div className="document-list">
          {filteredDocuments.map((doc) => <button key={doc.id} className={`document-link ${active?.id === doc.id ? 'active' : ''}`} onClick={() => void openDocument(doc)}><Icon name="doc" /><span className="document-link-text">{doc.title}</span>{doc.ownership === 'shared' && <span className="shared-dot" title="Shared with you">•</span>}</button>)}
          {!filteredDocuments.length && <p className="empty-list">{documents.length ? 'No matches here.' : 'Your documents will show up here.'}</p>}
        </div>
        <div className="sidebar-bottom"><div className="user-avatar">{user.displayName.slice(0, 1).toUpperCase()}</div><div className="user-details"><b>{user.displayName}</b><small>{user.email}</small></div><button className="logout-button" onClick={() => void signOut()} title="Sign out">↗</button></div>
      </aside>

      <section className="main-panel">
        <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> {active?.ownership === 'shared' ? 'Shared with me' : 'My documents'}{active && <><span>/</span><b>{active.title || 'Untitled document'}</b></>}</div><div className="topbar-actions">{active && active.role !== 'viewer' && <><button className="rename-button" onClick={() => { titleInputRef.current?.focus(); titleInputRef.current?.select(); }} aria-label="Rename document">Rename</button><button className="save-button" onClick={() => void saveNow()} aria-label="Save document">Save</button></>}<span className={`save-indicator ${saveState}`}>{saveState === 'saving' && <i />}{statusText}</span>{saveState === 'failed' && <button className="retry-button" onClick={retryCurrentSave}><Icon name="retry" /> Retry</button>}{active && <button className="share-button" onClick={() => void showSharing()}><Icon name="share" /> Share</button>}<button className="avatar avatar-small" title={user.displayName}>{user.displayName.slice(0, 1).toUpperCase()}</button></div></header>
        {error && <div className="inline-error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss"><Icon name="close" /></button></div>}
        {active ? <div className="editor-scroll"><article className="document-sheet">
          <div className="document-meta"><span className={active.ownership === 'shared' ? 'ownership-chip shared' : 'ownership-chip'}>{active.ownership === 'shared' ? '↗ Shared with you' : '◈ Your document'}</span><span className="meta-dot">·</span><span>{active.role === 'owner' ? 'Owner' : active.role === 'editor' ? 'Can edit' : 'View only'}</span><span className="meta-spacer"/><button className="import-button" onClick={() => fileRef.current?.click()} disabled={active.role === 'viewer' || busy}><Icon name="upload" /> Import</button><input ref={fileRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" hidden onChange={(event) => void chooseFile(event)} /></div>
          <input ref={titleInputRef} className="title-input" value={title} maxLength={200} onChange={(event) => handleTitleChange(event.target.value)} readOnly={active.role === 'viewer'} aria-label="Document title" placeholder="Untitled document" />
          <div className="editor-toolbar" aria-label="Formatting toolbar">
            <select aria-label="Text style" defaultValue="p" disabled={active.role === 'viewer'} onChange={(event) => runFormat({ preventDefault: () => undefined } as ReactMouseEvent<HTMLButtonElement>, 'formatBlock', event.target.value)}><option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option></select>
            <span className="toolbar-divider"/>
            <button onMouseDown={(event) => runFormat(event, 'bold')} disabled={active.role === 'viewer'} aria-label="Bold"><b>B</b></button><button onMouseDown={(event) => runFormat(event, 'italic')} disabled={active.role === 'viewer'} aria-label="Italic"><i>I</i></button><button onMouseDown={(event) => runFormat(event, 'underline')} disabled={active.role === 'viewer'} aria-label="Underline"><u>U</u></button>
            <span className="toolbar-divider"/>
            <button onMouseDown={(event) => runFormat(event, 'insertUnorderedList')} disabled={active.role === 'viewer'} aria-label="Bulleted list">☷</button><button onMouseDown={(event) => runFormat(event, 'insertOrderedList')} disabled={active.role === 'viewer'} aria-label="Numbered list">1.</button>
          </div>
          <div key={active.id} ref={editorRef} className={`rich-editor ${active.role === 'viewer' ? 'read-only' : ''}`} contentEditable={active.role !== 'viewer'} suppressContentEditableWarning role="textbox" aria-label="Document content" aria-multiline="true" onInput={handleEditorInput} onPaste={handleEditorPaste} onBlur={handleEditorInput} />
          <footer className="document-footer"><span>Changes save automatically</span><span>·</span><span>{active.ownership === 'shared' ? 'Shared document' : 'Private to you'}</span></footer>
        </article></div> : <div className="welcome-panel"><div className="welcome-mark">✳</div><p className="eyebrow">A CLEAN PAGE, A CLEAR MIND</p><h1>What would you like<br/>to make room for?</h1><p className="welcome-copy">Create a document to start collecting your thoughts.<br/>Everything saves quietly as you work.</p><button className="primary-button" onClick={() => void createDocument()} disabled={busy}><Icon name="plus"/> Create a document</button><div className="welcome-hint">or <button onClick={() => fileRef.current?.click()}>bring in a text or Markdown file</button><input ref={fileRef} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" hidden onChange={(event) => void chooseFile(event)} /></div></div>}
      </section>

      {shareOpen && active && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShareOpen(false); }}><section className="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title"><div className="modal-head"><div><p className="eyebrow">COLLABORATION</p><h2 id="share-title">Share this document</h2></div><button className="icon-button" onClick={() => setShareOpen(false)} aria-label="Close"><Icon name="close"/></button></div><p className="modal-description">Give someone a place in the conversation.</p>{active.role === 'owner' && <form className="share-form" onSubmit={(event) => void share(event)}><input type="email" required value={shareEmail} onChange={(event) => setShareEmail(event.target.value)} placeholder="name@example.com" aria-label="Email address"/><select value={shareRole} onChange={(event) => setShareRole(event.target.value as 'editor' | 'viewer')} aria-label="Access role"><option value="editor">Can edit</option><option value="viewer">Can view</option></select><button className="primary-button" disabled={busy}>Invite</button></form>}<div className="member-list"><p className="field-label">PEOPLE WITH ACCESS</p>{owner && <div className="member-row"><span className="avatar avatar-gold">{owner.displayName.slice(0, 1)}</span><span className="member-name"><b>{owner.displayName}</b><small>{owner.email}</small></span><span className="member-role">Owner</span></div>}{members.map((member) => <div className="member-row" key={member.userId}><span className="avatar avatar-blue">{member.displayName.slice(0, 1)}</span><span className="member-name"><b>{member.displayName}</b><small>{member.email}</small></span><span className="member-role">{member.role === 'editor' ? 'Can edit' : 'Can view'}</span></div>)}</div><p className="share-footnote">Only known workspace users can be added.</p></section></div>}
    </main>
  );
}
