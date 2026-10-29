import test from 'node:test';
import assert from 'node:assert/strict';
import {createXlsx,parseXlsx,interpretWorkRows} from '../src/xlsx.js';
test('export/import XLSX rileva registro dal secondo foglio',()=>{
 const file=createXlsx([
   {name:'Riepilogo',headers:['Voce','Valore'],rows:[['Saldo',5]]},
   {name:'Movimenti',headers:['Data','Tipo','Ore','Nota'],rows:[['2026-10-29','maturata',3,'Test']]}
 ]);
 assert.equal(parseXlsx(file,1)[1][1],5);
 const movements=interpretWorkRows(parseXlsx(file,2));
 assert.equal(movements.records[0].hours,3);
 assert.equal(movements.records[0].kind,'credit');
});
