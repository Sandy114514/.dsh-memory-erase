/**
 * Browser half of the Memory Erase Protocol.
 *
 * Registers one frame-wide overlay. It polls the Host half for the marked
 * removable drive, asks the user before touching anything, and on confirmation
 * plays the white-out sequence while the Host erases the displayed Session.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-memory-erase',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useRef, useState } = React;

    const ROUTE = '/plugin/memory-erase';
    const OVERLAY_ID = 'memory-erase';
    const POLL_MS = 1400;

    const zh = {
      'dialog.eyebrow': 'MEMORY ERASE PROTOCOL',
      'dialog.title': '要删除全部记忆吗？',
      'dialog.lede': '检测到被授权的移动存储介质。这个装置只为一件事而存在——',
      'dialog.ledeStrong': '让此刻的对话，连同它的全部内容，一起消失。',
      'dialog.device': '存储介质',
      'dialog.session': '当前会话',
      'dialog.untitled': '未命名的对话',
      'dialog.warning': '此操作不可撤销。当前显示的会话、它的事件记录与全部上下文都将被抹除，界面会重新回到空白的对话。',
      'dialog.yes': '是，删除全部记忆',
      'dialog.no': '否，保留记忆',
      'dialog.busy': '正在抹除…',
      'dialog.busyHint': '正在归档会话、清除记录并准备空白对话。请不要关闭页面。',
      'dialog.error': '抹除没有完成',
      'dialog.live': '已激活',
      'dialog.notLive': '未激活',
      'context.title': '上下文余量',
      'context.line': '已用 {used} / {total} tokens · 剩余 {percent}%',
      'context.unknown': '上下文信息暂不可用（会话尚未在 Host 中激活）。',
      'context.dismiss': '收起',
      'context.note': '没有删除任何内容。记忆仍在。',
      'whiteout': '愿你有一天能和你最重要的人相遇',
      'whiteout.sub': '记忆删除完成',
      'device.unnamed': '未命名介质',
      'entry.title': '记忆删除协议',
    };

    const en = {
      'dialog.eyebrow': 'MEMORY ERASE PROTOCOL',
      'dialog.title': 'Erase all memories?',
      'dialog.lede': 'An authorized removable drive is connected. This device exists for one purpose —',
      'dialog.ledeStrong': 'to make this conversation, and everything in it, disappear.',
      'dialog.device': 'Storage',
      'dialog.session': 'Current conversation',
      'dialog.untitled': 'Untitled conversation',
      'dialog.warning': 'This cannot be undone. The displayed Session, its event log, and all of its context will be erased, and the view returns to a blank conversation.',
      'dialog.yes': 'Yes, erase all memories',
      'dialog.no': 'No, keep memories',
      'dialog.busy': 'Erasing…',
      'dialog.busyHint': 'Archiving the Session, clearing its record, and preparing a blank conversation. Do not close the page.',
      'dialog.error': 'The erase did not complete',
      'dialog.live': 'active',
      'dialog.notLive': 'not active',
      'context.title': 'Context remaining',
      'context.line': '{used} / {total} tokens used · {percent}% left',
      'context.unknown': 'Context information is unavailable (the Session is not active on the Host yet).',
      'context.dismiss': 'Dismiss',
      'context.note': 'Nothing was deleted. The memories are still here.',
      'whiteout': 'May you meet the one most important to you, one day.',
      'whiteout.sub': 'Memory erase complete',
      'device.unnamed': 'Unnamed volume',
      'entry.title': 'Memory Erase Protocol',
    };

    const STYLE_ID = '@local/dsh-memory-erase/overlay.css';
    const CSS = `
      .dme-root { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center;
        box-sizing: border-box; pointer-events: auto; padding: 16px;
        font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans SC", sans-serif; }
      .dme-scrim { position: absolute; inset: 0; background: color-mix(in srgb, #0b1020 46%, transparent);
        backdrop-filter: blur(6px) saturate(0.9); -webkit-backdrop-filter: blur(6px) saturate(0.9);
        animation: dme-scrim-in .28s ease-out both; }
      .dme-card { position: relative; width: min(480px, calc(100vw - 32px)); max-height: min(86vh, 720px); overflow: auto;
        box-sizing: border-box; padding: 26px 26px 20px; border-radius: 22px; color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
        box-shadow: 0 28px 80px rgb(6 12 32 / 34%), 0 2px 8px rgb(6 12 32 / 16%);
        animation: dme-card-in .34s cubic-bezier(.2,.9,.2,1) both; }
      .dme-card:before { content: ""; position: absolute; inset: 0 0 auto; height: 4px; border-radius: 22px 22px 0 0;
        background: linear-gradient(90deg, #8fb6ff, #ff9fbe 55%, #c9b8ff); }
      .dme-eyebrow { display: flex; align-items: center; gap: 8px; margin: 2px 0 14px;
        font-size: 11px; letter-spacing: .18em; font-weight: 650; color: var(--dsw-alias-label-secondary); }
      .dme-dot { width: 6px; height: 6px; border-radius: 50%; background: #ff7a9c; box-shadow: 0 0 0 4px rgb(255 122 156 / 18%);
        animation: dme-pulse 1.6s ease-in-out infinite; }
      .dme-title { margin: 0 0 10px; font-size: 22px; line-height: 1.35; font-weight: 700; letter-spacing: .01em; }
      .dme-lede { margin: 0 0 18px; font-size: 13.5px; line-height: 1.75; color: var(--dsw-alias-label-secondary); }
      .dme-lede strong { color: var(--dsw-alias-label-primary); font-weight: 600; }
      .dme-facts { display: grid; gap: 8px; margin: 0 0 16px; padding: 12px 14px; border-radius: 14px;
        background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); }
      .dme-fact { display: flex; gap: 12px; align-items: baseline; font-size: 12.5px; line-height: 1.5; min-width: 0; }
      .dme-fact dt { flex: none; width: 68px; color: var(--dsw-alias-label-secondary); }
      .dme-fact dd { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 560; }
      .dme-fact dd code { font-size: 11.5px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
      .dme-warning { display: flex; gap: 9px; margin: 0 0 18px; padding: 11px 12px; border-radius: 12px;
        font-size: 12.5px; line-height: 1.65; color: var(--dsw-alias-state-warn-primary);
        background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 9%, transparent);
        border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 24%, transparent); }
      .dme-warning svg { flex: none; margin-top: 2px; }
      .dme-actions { display: flex; flex-direction: column; gap: 8px; }
      .dme-btn { appearance: none; width: 100%; border-radius: 12px; padding: 11px 16px; font: inherit; font-size: 13.5px;
        font-weight: 600; line-height: 1.4; cursor: pointer; transition: transform .12s ease, background .16s ease, border-color .16s ease; }
      .dme-btn:active { transform: translateY(1px); }
      .dme-btn:focus-visible { outline: 3px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 45%, transparent); outline-offset: 2px; }
      .dme-btn[disabled] { cursor: default; opacity: .62; }
      .dme-btn-danger { color: #fff; border: 1px solid #e75a7c;
        background: linear-gradient(180deg, #ef6f8f, #dd5478); box-shadow: 0 6px 18px rgb(221 84 120 / 28%); }
      .dme-btn-danger:not([disabled]):hover { background: linear-gradient(180deg, #e86184, #d0476b); }
      .dme-btn-quiet { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2);
        border: 1px solid var(--dsw-alias-border-l2); }
      .dme-btn-quiet:not([disabled]):hover { background: var(--dsw-alias-bg-overlay); }
      .dme-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 14px;
        font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .dme-foot code { font-size: 10.5px; opacity: .82; }
      .dme-busy { display: flex; align-items: center; gap: 10px; margin: 2px 0 16px; padding: 12px 14px; border-radius: 12px;
        background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); font-size: 12.5px; line-height: 1.6; }
      .dme-spinner { width: 15px; height: 15px; flex: none; border-radius: 50%;
        border: 2px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 30%, transparent);
        border-top-color: var(--dsw-alias-brand-primary); animation: dme-spin .8s linear infinite; }
      .dme-error { margin: 0 0 14px; padding: 11px 12px; border-radius: 12px; font-size: 12.5px; line-height: 1.65;
        color: var(--dsw-alias-state-error-primary);
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
        border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 22%, transparent); }
      .dme-toast { position: fixed; left: 50%; bottom: calc(92px + env(safe-area-inset-bottom, 0px)); z-index: 2147482990;
        transform: translateX(-50%); width: min(430px, calc(100vw - 32px)); box-sizing: border-box;
        padding: 13px 15px 12px; border-radius: 16px; color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
        box-shadow: 0 18px 48px rgb(6 12 32 / 26%); animation: dme-toast-in .3s cubic-bezier(.2,.9,.2,1) both; }
      .dme-toast-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
      .dme-toast-title { font-size: 12.5px; font-weight: 650; letter-spacing: .01em; }
      .dme-toast-close { appearance: none; border: 0; background: transparent; color: var(--dsw-alias-label-secondary);
        font: inherit; font-size: 11.5px; cursor: pointer; padding: 2px 4px; border-radius: 6px; }
      .dme-toast-close:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
      .dme-meter { height: 6px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); overflow: hidden; }
      .dme-meter > span { display: block; height: 100%; border-radius: 999px;
        background: linear-gradient(90deg, #7fb2ff, #9c8bff 60%, #ffb3c7); transition: width .4s ease; }
      .dme-toast-line { margin-top: 8px; font-size: 12px; line-height: 1.55; color: var(--dsw-alias-label-secondary);
        display: flex; justify-content: space-between; gap: 10px; }
      .dme-toast-note { margin-top: 6px; font-size: 11px; color: var(--dsw-alias-label-secondary); opacity: .85; }
      .dme-entry { appearance: none; display: inline-flex; align-items: center; justify-content: center;
        width: 28px; height: 28px; padding: 0; border-radius: var(--dsw-radius-sm, 8px); cursor: pointer;
        color: var(--dsw-alias-label-secondary); background: transparent; border: 0; }
      .dme-entry:hover { background: var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2)); color: var(--dsw-alias-label-primary); }
      .dme-entry:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
      .dme-whiteout { position: fixed; inset: 0; z-index: 2147483600; display: grid; place-items: center; overflow: hidden;
        background: #ffffff; animation: dme-white 6.2s cubic-bezier(.4,0,.2,1) both; }
      .dme-whiteout-glow { position: absolute; width: 140vmax; height: 140vmax; border-radius: 50%;
        background: radial-gradient(circle, rgb(255 236 242 / 55%) 0%, rgb(255 255 255 / 0%) 60%, #ffffff 78%);
        animation: dme-glow 6.2s ease-out both; }
      .dme-quote { position: relative; margin: 0; padding: 0 28px; max-width: 900px; text-align: center;
        color: #1a1a1f; animation: dme-quote 6.2s ease both; }
      .dme-quote p { margin: 0; font-family: "Songti SC", "Noto Serif SC", "Source Han Serif SC", "SimSun", serif;
        font-size: clamp(20px, 3.1vw, 34px); line-height: 1.9; letter-spacing: .12em; font-weight: 500;
        text-shadow: 0 1px 0 rgb(255 255 255 / 60%); }
      .dme-quote small { display: block; margin-top: 22px; font-size: 11.5px; letter-spacing: .42em;
        color: rgb(26 26 31 / 52%); font-family: system-ui, sans-serif; }
      .dme-quote mark { display: block; width: 34px; height: 1px; margin: 20px auto 0;
        background: rgb(26 26 31 / 28%); border: 0; }
      @keyframes dme-scrim-in { from { opacity: 0 } to { opacity: 1 } }
      @keyframes dme-card-in { from { opacity: 0; transform: translateY(10px) scale(.985) } to { opacity: 1; transform: none } }
      @keyframes dme-toast-in { from { opacity: 0; transform: translate(-50%, 8px) } to { opacity: 1; transform: translate(-50%, 0) } }
      @keyframes dme-pulse { 0%,100% { opacity: 1 } 50% { opacity: .45 } }
      @keyframes dme-spin { to { transform: rotate(360deg) } }
      @keyframes dme-white {
        0% { opacity: 0; background: #ffffff }
        12%, 82% { opacity: 1 }
        100% { opacity: 0 }
      }
      @keyframes dme-glow {
        0% { opacity: 1; transform: scale(.4) }
        30% { opacity: .9; transform: scale(1.05) }
        100% { opacity: .9; transform: scale(1.25) }
      }
      @keyframes dme-quote {
        0%, 16% { opacity: 0; transform: translateY(10px) }
        30%, 76% { opacity: 1; transform: none }
        92%, 100% { opacity: 0; transform: translateY(-6px) }
      }
      @media (prefers-reduced-motion: reduce) {
        .dme-scrim, .dme-card, .dme-toast, .dme-dot { animation: none !important; }
      }
    `;

    function installStyle() {
      if (typeof document === 'undefined') return () => {};
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`) !== null) return () => {};
      const tag = document.createElement('style');
      tag.dataset.plugin = '@local/dsh-memory-erase';
      tag.dataset.pluginCss = STYLE_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return () => tag.remove();
    }

    function interpolate(text, vars) {
      if (vars === undefined) return text;
      return text.replace(/\{(\w+)\}/g, (match, key) => (vars[key] === undefined ? match : String(vars[key])));
    }

    function makeTranslator(ctx) {
      return (key, vars) => {
        let id = 'zh';
        try {
          const locale = ctx.get('locale');
          id = locale?.getSnapshot?.()?.id ?? locale?.getLocale?.()?.id ?? 'zh';
        } catch {
          id = 'zh';
        }
        const dict = id === 'en' ? en : zh;
        return interpolate(dict[key] ?? zh[key] ?? key, vars);
      };
    }

    function formatTokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
      if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
      if (value >= 10_000) return `${(value / 1000).toFixed(1)}k`;
      if (value >= 1000) return `${(value / 1000).toFixed(2)}k`;
      return String(Math.round(value));
    }

    /** Resolve the Session the main view currently displays. */
    function useCurrentSessionId(useSessions) {
      const fromStore = typeof useSessions === 'function'
        ? useSessions((state) => {
            if (state === undefined || state.byId === undefined) return undefined;
            const entry = Object.values(state.byId).find((session) => (session?.retainedBy?.mainView ?? 0) > 0);
            return entry?.id;
          })
        : undefined;
      return fromStore;
    }

    async function readJson(response) {
      try {
        return await response.json();
      } catch {
        return null;
      }
    }

    function Dot() {
      return h('span', { className: 'dme-dot', 'aria-hidden': true });
    }

    function ShieldIcon() {
      return h(
        'svg',
        { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', {
          d: 'M8 1.8 3.2 3.4v4.1c0 3 2 5.2 4.8 6.7 2.8-1.5 4.8-3.7 4.8-6.7V3.4L8 1.8Z',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinejoin: 'round',
        }),
        h('path', { d: 'M8 6v3.4', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
        h('circle', { cx: 8, cy: 5, r: 0.85, fill: 'currentColor' }),
      );
    }

    function DeviceFacts({ device, title, t }) {
      const label = device.volumeLabel ?? device.markerId ?? t('device.unnamed');
      return h(
        'dl',
        { className: 'dme-facts' },
        h(
          'div',
          { className: 'dme-fact' },
          h('dt', null, t('dialog.device')),
          h('dd', null, `${device.drive}  ·  ${label}  `, h('code', null, device.markerFile)),
        ),
        h(
          'div',
          { className: 'dme-fact' },
          h('dt', null, t('dialog.session')),
          h('dd', { title: title ?? t('dialog.untitled') }, title ?? t('dialog.untitled')),
        ),
      );
    }

    function ConfirmCard({ device, sessionId, onKeep, onErase, t }) {
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const yesRef = useRef(null);

      useEffect(() => {
        yesRef.current?.focus?.();
      }, []);

      useEffect(() => {
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
          document.body.style.overflow = previous;
        };
      }, []);

      const confirm = async () => {
        setError(null);
        const response = await onErase();
        if (response?.ok === true) return;
        setBusy(false);
        setError(response ?? { code: 'unknown', message: t('dialog.error') });
      };

      return h(
        'div',
        {
          className: 'dme-root',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'dme-title',
        },
        h('div', { className: 'dme-scrim' }),
        h(
          'div',
          { className: 'dme-card' },
          h('div', { className: 'dme-eyebrow' }, h(Dot), t('dialog.eyebrow')),
          h('h2', { className: 'dme-title', id: 'dme-title' }, t('dialog.title')),
          h(
            'p',
            { className: 'dme-lede' },
            `${t('dialog.lede')} `,
            h('strong', null, t('dialog.ledeStrong')),
          ),
          h(DeviceFacts, { device, title: device.sessionTitle, t }),
          h('div', { className: 'dme-warning' }, h(ShieldIcon), h('span', null, t('dialog.warning'))),
          busy ? h('div', { className: 'dme-busy' }, h('span', { className: 'dme-spinner' }), h('span', null, t('dialog.busyHint'))) : null,
          error !== null
            ? h(
                'div',
                { className: 'dme-error', role: 'alert' },
                h('strong', null, t('dialog.error')),
                h('div', null, error.message ?? String(error)),
                error.code === undefined ? null : h('code', null, error.code),
              )
            : null,
          h(
            'div',
            { className: 'dme-actions' },
            h(
              'button',
              {
                type: 'button',
                ref: yesRef,
                className: 'dme-btn dme-btn-danger',
                disabled: busy,
                onClick: () => {
                  setBusy(true);
                  void confirm();
                },
              },
              busy ? t('dialog.busy') : t('dialog.yes'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'dme-btn dme-btn-quiet',
                disabled: busy,
                onClick: onKeep,
              },
              t('dialog.no'),
            ),
          ),
          h(
            'div',
            { className: 'dme-foot' },
            h('code', null, `${device.drive}\\${device.markerFile}`),
            h('span', null, sessionId === undefined ? '·' : `#${String(sessionId).slice(-8)}`),
          ),
        ),
      );
    }

    function ContextNotice({ session, onDismiss, t }) {
      const context = session?.context;
      const available = context?.available === true;
      const percent = available ? Math.round(context.remainingRatio * 100) : 0;
      return h(
        'div',
        { className: 'dme-toast', role: 'status', 'aria-live': 'polite' },
        h(
          'div',
          { className: 'dme-toast-head' },
          h('span', { className: 'dme-toast-title' }, t('context.title')),
          h('button', { type: 'button', className: 'dme-toast-close', onClick: onDismiss }, t('context.dismiss')),
        ),
        available
          ? h(
              React.Fragment,
              null,
              h('div', { className: 'dme-meter', 'aria-hidden': true }, h('span', { style: { width: `${percent}%` } })),
              h(
                'div',
                { className: 'dme-toast-line' },
                h('span', null, t('context.line', {
                  used: formatTokens(context.usedTokens),
                  total: formatTokens(context.contextWindow),
                  percent: String(percent),
                })),
                h('span', null, `${formatTokens(context.remainingTokens)} left`),
              ),
            )
          : h('div', { className: 'dme-toast-line' }, h('span', null, t('context.unknown'))),
        h('div', { className: 'dme-toast-note' }, t('context.note')),
      );
    }

    function useDebugProbe(useSessions, currentSessionId) {
      const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).get('memoryEraseDebug') === '1';
      const [state, setState] = useState(null);
      const sessionRef = useRef(currentSessionId);
      sessionRef.current = currentSessionId;
      const store = typeof useSessions === 'function' ? useSessions((value) => value) : undefined;
      const ids = store?.ids;
      const byId = store?.byId;
      useEffect(() => {
        if (!enabled) return undefined;
        let cancelled = false;
        const tick = async () => {
          let remote = null;
          try {
            const response = await fetch(`${ROUTE}/debug`, { cache: 'no-store', credentials: 'same-origin' });
            remote = await readJson(response);
          } catch {
            remote = null;
          }
          if (!cancelled) setState({ remote, ids, byId, currentSessionId: sessionRef.current });
        };
        void tick();
        const timer = window.setInterval(() => void tick(), 3000);
        return () => {
          cancelled = true;
          window.clearInterval(timer);
        };
      }, [enabled, ids, byId]);
      return enabled ? state : null;
    }

    function DebugPill({ debug }) {
      const byId = debug?.byId;
      const retained = byId === undefined
        ? []
        : Object.values(byId)
            .filter((row) => (row?.retainedBy?.mainView ?? 0) > 0)
            .map((row) => row.id);
      return h(
        'div',
        {
          style: {
            position: 'fixed', left: 10, bottom: 10, zIndex: 2147483601, maxWidth: 460,
            padding: '8px 10px', borderRadius: 10, background: 'rgb(10 14 24 / 88%)', color: '#e8eeff',
            font: '11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre-wrap',
            pointerEvents: 'none',
          },
        },
        `hook session : ${debug?.currentSessionId ?? 'undefined'}\n`
          + `mainView    : ${retained.join(', ') || '(none)'}\n`
          + `store.ids   : ${(debug?.ids ?? []).slice(-6).join(', ') || '(none)'}\n`
          + `host live   : ${(debug?.remote?.live ?? []).join(', ') || '(none)'}\n`
          + `device      : ${debug?.remote?.device?.digest ?? '(none)'}`,
      );
    }

    function Whiteout({ text, sub }) {      return h(
        'div',
        { className: 'dme-whiteout', 'aria-live': 'assertive' },
        h('div', { className: 'dme-whiteout-glow' }),
        h(
          'figure',
          { className: 'dme-quote' },
          h('p', null, text),
          h('mark'),
          h('small', null, sub),
        ),
      );
    }

    function EraseEntryButton({ ctx, t }) {
      const [busy, setBusy] = useState(false);
      return h(
        'button',
        {
          type: 'button',
          className: 'dme-entry',
          title: t('entry.title'),
          'aria-label': t('entry.title'),
          disabled: busy,
          onClick: async () => {
            setBusy(true);
            try {
              await fetch(`${ROUTE}/rearm`, { method: 'POST', cache: 'no-store', credentials: 'same-origin' });
            } catch {
              // The overlay poll will pick the device up on its next tick.
            }
            window.setTimeout(() => setBusy(false), 1200);
          },
        },
        h(
          'svg',
          { width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
          h('rect', { x: 5.2, y: 3.4, width: 5.6, height: 2.2, rx: 0.7, fill: 'currentColor', opacity: 0.55 }),
          h('rect', {
            x: 4.2, y: 5.2, width: 7.6, height: 8.4, rx: 1.6,
            stroke: 'currentColor', strokeWidth: 1.2, fill: 'none',
          }),
          h('path', { d: 'M6.6 8.2h2.8M6.6 10.6h1.8', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
        ),
      );
    }

    function MemoryEraseOverlay(props) {
      const t = makeTranslator(props.ctx);
      const currentSessionId = useCurrentSessionId(props.useSessions);
      const debug = useDebugProbe(props.useSessions, currentSessionId);
      const [device, setDevice] = useState(null);
      const [session, setSession] = useState(null);
      const [dismissedDigest, setDismissedDigest] = useState(null);
      const [contextOpen, setContextOpen] = useState(false);
      const [phase, setPhase] = useState('idle');
      const alive = useRef(true);
      const sessionIdRef = useRef(undefined);
      sessionIdRef.current = currentSessionId;

      useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
        };
      }, []);

      useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();

        const tick = async () => {
          const query = sessionIdRef.current === undefined ? '' : `?sessionId=${encodeURIComponent(sessionIdRef.current)}`;
          try {
            const response = await fetch(`${ROUTE}/status${query}`, {
              cache: 'no-store',
              signal: controller.signal,
              credentials: 'same-origin',
            });
            if (!response.ok) throw new Error(`status ${response.status}`);
            const payload = await readJson(response);
            if (cancelled || !alive.current) return;
            setDevice(payload?.device ?? null);
            setSession(payload?.session ?? null);
          } catch {
            // The Host half may still be activating; the next tick retries.
          }
        };

        void tick();
        const timer = window.setInterval(() => {
          void tick();
        }, POLL_MS);
        return () => {
          cancelled = true;
          controller.abort();
          window.clearInterval(timer);
        };
      }, []);

      useEffect(() => {
        if (device === null) {
          setContextOpen(false);
          setDismissedDigest(null);
        }
      }, [device]);

      const acknowledge = () => {
        if (device === null) return;
        setDismissedDigest(device.digest);
        void fetch(`${ROUTE}/ack`, { method: 'POST', cache: 'no-store', credentials: 'same-origin' }).catch(() => undefined);
      };

      const erase = async () => {
        try {
          const response = await fetch(`${ROUTE}/erase`, {
            method: 'POST',
            cache: 'no-store',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sessionId: sessionIdRef.current ?? null }),
          });
          const payload = await readJson(response);
          if (response.ok && payload?.ok === true) {
            setPhase('whiteout');
            if (typeof payload.successorSessionId === 'string' && payload.successorSessionId !== '') {
              props.ctx.get('uiWorkspace')?.openSession?.(payload.successorSessionId);
            }
            window.setTimeout(() => {
              if (!alive.current) return;
              setPhase('idle');
              setDevice(null);
              setContextOpen(false);
              setDismissedDigest(null);
            }, 6200);
            return { ok: true };
          }
          return {
            ok: false,
            code: payload?.code ?? payload?.error ?? `http-${response.status}`,
            message: payload?.message ?? t('dialog.error'),
          };
        } catch (error) {
          return { ok: false, code: 'network', message: error instanceof Error ? error.message : String(error) };
        }
      };

      const showDialog =
        phase === 'erasing' ||
        phase === 'whiteout' ||
        (device !== null && device.acknowledged === false && device.digest !== dismissedDigest);
      const showContext = phase === 'idle' && contextOpen && device !== null && device.digest === dismissedDigest;

      return h(
        React.Fragment,
        null,
        showDialog && device !== null
          ? h(ConfirmCard, {
              key: device.digest,
              device: { ...device, sessionTitle: session?.title ?? undefined },
              sessionId: currentSessionId,
              onKeep: () => {
                acknowledge();
                setPhase('idle');
                setContextOpen(true);
              },
              onErase: erase,
              t,
            })
          : null,
        phase === 'whiteout' ? h(Whiteout, { text: t('whiteout'), sub: t('whiteout.sub') }) : null,
        showContext ? h(ContextNotice, { session, onDismiss: () => setContextOpen(false), t }) : null,
        debug === null ? null : h(DebugPill, { debug }),
      );
    }

    return {
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply(ctx) {
        const t = makeTranslator(ctx);
        ctx.effect(() => installStyle(), 'memory-erase: overlay styles');
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: OVERLAY_ID, order: 1200 },
            (props) => h(MemoryEraseOverlay, { ctx, t, ...props }),
          ),
        );
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            { name: 'sidebar.footer.action', id: OVERLAY_ID, order: 60 },
            () => h(EraseEntryButton, { ctx, t }),
          ),
        );
      },
    };
  },
});
