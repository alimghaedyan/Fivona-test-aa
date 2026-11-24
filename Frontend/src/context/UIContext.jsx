import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, Trash2, X } from 'lucide-react';

const UIContext = createContext(null);

export function UIProvider({ children }) {
  const [toastData, setToastData] = useState(null);
  const [confirmData, setConfirmData] = useState(null);
  const toastTimer = useRef(null);
  const resolver = useRef(null);

  const toast = useCallback((message, kind = 'success') => {
    clearTimeout(toastTimer.current);
    setToastData({ message, kind, show: true });
    toastTimer.current = setTimeout(() => setToastData((t) => (t ? { ...t, show: false } : t)), 3200);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      resolver.current = resolve;
      setConfirmData({
        title: opts.title || 'تأیید',
        message: opts.message || '',
        confirmText: opts.confirmText || 'تأیید',
        cancelText: opts.cancelText || 'انصراف',
        danger: opts.danger !== false,
        icon: opts.icon,
      });
    });
  }, []);

  const closeConfirm = useCallback((value) => {
    setConfirmData(null);
    const r = resolver.current; resolver.current = null;
    if (r) r(value);
  }, []);

  useEffect(() => {
    if (!confirmData) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeConfirm(false); }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [confirmData, closeConfirm]);

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm]);

  const ToastIcon = toastData?.kind === 'error' ? AlertCircle : toastData?.kind === 'info' ? Info : CheckCircle2;
  const ConfirmIcon = confirmData?.icon === 'trash-2' || !confirmData?.icon ? Trash2 : Trash2;

  return (
    <UIContext.Provider value={value}>
      {children}
      <div className={`toast ${toastData?.kind || 'success'}${toastData?.show ? ' show' : ''}`} role="status" aria-live="polite">
        {toastData && (
          <>
            <ToastIcon />
            <span>{toastData.message}</span>
          </>
        )}
      </div>
      {confirmData && (
        <div className="modal open" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle" aria-describedby="confirmMsg"
          onMouseDown={(e) => { if (e.target === e.currentTarget) closeConfirm(false); }}>
          <div className="modal-card narrow">
            <div className="confirm-ic"><ConfirmIcon /></div>
            <h3 id="confirmTitle">{confirmData.title}</h3>
            <p id="confirmMsg">{confirmData.message}</p>
            <div className="modal-actions center">
              <button type="button" className="btn ghost" onClick={() => closeConfirm(false)} autoFocus>{confirmData.cancelText}</button>
              <button type="button" className={`btn ${confirmData.danger ? 'danger' : 'primary'}`} onClick={() => closeConfirm(true)}>{confirmData.confirmText}</button>
            </div>
          </div>
        </div>
      )}
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used inside UIProvider');
  return ctx;
}

/** پنجره گفتگوی عمومی با بستن با Escape و کلیک بیرون */
export function Modal({ id, title, onClose, children, wide = false, narrow = false, labelledBy, describedBy, cardClass, role = 'dialog' }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);

  return (
    <div className="modal open" id={id} role={role} aria-modal="true" aria-labelledby={labelledBy || `${id}Title`} aria-describedby={describedBy}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal-card${wide ? ' wide' : ''}${narrow ? ' narrow' : ''}${cardClass ? ` ${cardClass}` : ''}`}>
        {title != null && (
          <div className="modal-head">
            {typeof title === 'string' ? <h3 id={labelledBy || `${id}Title`}>{title}</h3> : title}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="بستن"><X /></button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
