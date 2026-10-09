import { describe,it,expect } from 'vitest';
import { requiresContact,nepalTimestamp } from '../src/lib/trainingAppointment';
const request={status:'pending',preferred_date:'2030-01-07',preferred_start:'10:00:00',preferred_end:'12:00:00',scheduled_at:null};
describe('training appointment agreement',()=>{
 it('converts Nepal times to the actual instant',()=>expect(nepalTimestamp('2030-01-07T10:00')).toBe('2030-01-07T04:15:00.000Z'));
 it('accepts a shorter session inside the requested window',()=>expect(requiresContact(request,'2030-01-07T04:30Z','2030-01-07T05:30Z')).toBe(false));
 it('requires agreement for a different day or either window boundary',()=>{for(const [start,end] of [['2030-01-08T04:15Z','2030-01-08T05:15Z'],['2030-01-07T04:00Z','2030-01-07T05:00Z'],['2030-01-07T05:15Z','2030-01-07T06:30Z']])expect(requiresContact(request,start!,end!)).toBe(true);});
 it('requires agreement when changing an already accepted time within the preferred window',()=>expect(requiresContact({...request,status:'scheduled',scheduled_at:'2030-01-07T04:15Z',scheduled_end_at:'2030-01-07T05:15Z'},'2030-01-07T04:30Z','2030-01-07T05:30Z')).toBe(true));
 it('allows saving instructions for the same accepted time',()=>expect(requiresContact({...request,status:'scheduled',scheduled_at:'2030-01-07T04:15Z',scheduled_end_at:'2030-01-07T05:15Z'},'2030-01-07T04:15Z','2030-01-07T05:15Z')).toBe(false));
 it('keeps legacy free-text requests schedulable',()=>expect(requiresContact({status:'pending',scheduled_at:null},'2030-01-07T04:15Z','2030-01-07T05:15Z')).toBe(false));
});
