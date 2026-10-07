import {describe,it,expect} from 'vitest';
import {chooseInterval} from '../src/lib/availabilityTimeline';
import type {AvailabilityResult} from '../src/types/domain';
const day='2030-01-07';const now=new Date('2026-10-06');
const block=(a:string,b:string)=>({startsAt:`${day}T${a}+05:45`,endsAt:`${day}T${b}+05:45`});
const data:AvailabilityResult={equipmentId:'x',date:day,timezone:'Asia/Kathmandu',busy:[],openingHours:{openTime:'09:00',closeTime:'19:00',bookable:true}};
describe('two-click interval selection',()=>{
 it('selects the first through last block',()=>expect(chooseInterval(data,block('09:00','09:30'),block('10:00','10:30'),360,now)).toEqual({start:`${day}T09:00`,end:`${day}T10:30`,issue:null}));
 it('supports clicking in reverse order',()=>expect(chooseInterval(data,block('10:00','10:30'),block('09:00','09:30'),360,now).start).toBe(`${day}T09:00`));
 it('rejects an occupied gap between two free blocks',()=>expect(chooseInterval({...data,busy:[block('09:30','10:00')]},block('09:00','09:30'),block('10:00','10:30'),360,now).issue).toMatch(/reservation/));
 it('rejects equipment duration excess',()=>expect(chooseInterval(data,block('09:00','09:30'),block('10:00','10:30'),60,now).issue).toMatch(/up to 1 hour/));
 it('preserves short free blocks split by reservations',()=>expect(chooseInterval({...data,busy:[block('09:15','09:45')]},block('09:00','09:15'),block('09:00','09:15'),360,now).end).toBe(`${day}T09:15`));
});
