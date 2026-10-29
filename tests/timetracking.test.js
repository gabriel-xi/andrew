import test from 'node:test';
import assert from 'node:assert/strict';
import {duration,validateTimecard} from '../src/timetracking.js';
test('turni diurni con pausa',()=>{
 assert.equal(duration('09:00','17:00','12:00','13:00'),420);
 assert.equal(duration('09:00','17:00','07:00','08:00'),480);
});
test('turni a cavallo di mezzanotte',()=>{
 assert.equal(duration('22:00','06:00'),480);
 assert.equal(duration('22:00','06:00','02:00','03:00'),420);
 const card=validateTimecard({work_date:'2026-10-29',
  scheduled_start:'22:00',scheduled_end:'06:00',
  actual_start:'22:00',actual_end:'07:00'});
 assert.equal(card.delta_minutes,60);
});
test('rifiuta dati non validi',()=>{
 assert.throws(()=>duration('25:00','06:00'));
 assert.throws(()=>validateTimecard({work_date:'2026-02-30'}));
});
