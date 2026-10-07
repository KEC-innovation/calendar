import { useEffect,useId,useRef } from 'react';
import { createPortal } from 'react-dom';
export function Modal({title,open,onClose,children}:{title:string;open:boolean;onClose:()=>void;children:React.ReactNode}){
 const closeRef=useRef<HTMLButtonElement>(null);const dialogRef=useRef<HTMLElement>(null);const onCloseRef=useRef(onClose);const titleId=useId();
 useEffect(()=>{onCloseRef.current=onClose;},[onClose]);
 useEffect(()=>{
  if(!open)return;const previous=document.activeElement as HTMLElement|null;const overflow=document.body.style.overflow;document.body.style.overflow='hidden';closeRef.current?.focus();
  const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape')onCloseRef.current();if(event.key==='Tab'){const controls=dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary');const visible=Array.from(controls||[]).filter(node=>node.getClientRects().length);const first=visible[0],last=visible.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};
  window.addEventListener('keydown',onKey);return()=>{window.removeEventListener('keydown',onKey);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus();};
 },[open]);
 if(!open)return null;
 // Escape container-query ancestors so fixed dialogs cover the viewport.
 return createPortal(<div className="modal-backdrop" role="presentation" onMouseDown={event=>event.target===event.currentTarget&&onClose()}><section ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}><header><h2 id={titleId}>{title}</h2><button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">×</button></header>{children}</section></div>,document.body);
}
