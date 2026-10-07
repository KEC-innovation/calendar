import { Children,cloneElement,isValidElement,useState,type ReactElement,type ReactNode,type TableHTMLAttributes } from 'react';
type Element=ReactElement<{children?:ReactNode;'data-sort'?:string|number}>;
function elements(children:ReactNode):Element[]{return Children.toArray(children).filter(isValidElement) as Element[];}
export function sortText(node:ReactNode):string{if(node===null||node===undefined||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(sortText).join(' ');if(isValidElement(node)){const element=node as Element;return element.props['data-sort']!==undefined?String(element.props['data-sort']):sortText(element.props.children);}return '';}
interface Props extends TableHTMLAttributes<HTMLTableElement>{sortKeys?:Array<string|null>;sortKey?:string;ascending?:boolean;onSort?:(key:string,ascending:boolean)=>void}
export function SortableTable({children,sortKeys,sortKey,ascending=true,onSort,...props}:Props){
 const [sort,setSort]=useState<{index:number;ascending:boolean}|null>(null);
 return <table {...props}>{elements(children).map(section=>{
  if(section.type==='thead')return cloneElement(section,{},elements(section.props.children).map(row=>cloneElement(row,{},elements(row.props.children).map((cell,index)=>{
   const label=sortText(cell.props.children);const sortable=label.trim()&&!['Actions','Context'].includes(label)&&(!sortKeys||sortKeys[index]);if(!sortable)return cell;
   const selected=onSort?sortKey===sortKeys?.[index]:sort?.index===index;const direction=onSort?ascending:sort?.ascending;
   return <th key={cell.key||index} aria-sort={selected?(direction?'ascending':'descending'):'none'}><button type="button" className="sort-heading" onClick={()=>{const next=selected?!direction:true;if(onSort)onSort(sortKeys![index]!,next);else setSort({index,ascending:next});}}>{cell.props.children}<span aria-hidden="true">{selected?(direction?' ↑':' ↓'):' ↕'}</span></button></th>;
  }))));
  if(section.type==='tbody'&&sort&&!onSort){const rows=elements(section.props.children);rows.sort((a,b)=>{const value=(row:Element)=>sortText(elements(row.props.children)[sort.index]?.props.children);const raw=(row:Element)=>elements(row.props.children)[sort.index]?.props['data-sort'];const aValue=raw(a),bValue=raw(b);const comparison=typeof aValue==='number'&&typeof bValue==='number'?aValue-bValue:String(aValue??value(a)).localeCompare(String(bValue??value(b)),undefined,{numeric:true,sensitivity:'base'});return comparison*(sort.ascending?1:-1);});return cloneElement(section,{},rows);}
  return section;
 })}</table>;
}
