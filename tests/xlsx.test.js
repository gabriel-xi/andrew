import test from 'node:test';
import assert from 'node:assert/strict';
import {createXlsx,parseXlsx,parseCsv,interpretWorkRows,excelDate} from '../src/xlsx.js';

test('XLSX multi-foglio in memoria senza dipendenze',()=>{
 const book=createXlsx([
  {name:'Riepilogo',headers:['Campo','Valore'],rows:[['Saldo iniziale',124]]},
  {name:'Registro movimenti',headers:['Data','Tipo','Ore','Nota'],rows:[
   ['2026-10-29','maturata',4.5,'Tutoraggio & aula <B>'],
   ['2026-10-30','utilizzata',2,'Permesso'],
   ['2026-11-01','maturata',1,'=1+1']]}
 ]);
 assert.match(book.subarray(0,2).toString(),'PK');
 assert.equal(parseXlsx(book,1)[1][1],124);
 assert.deepEqual(parseXlsx(book,2)[1],['2026-10-29','maturata',4.5,'Tutoraggio & aula <B>']);
 const interpreted=interpretWorkRows(parseXlsx(book,2));
 assert.equal(interpreted.records.length,3);
 assert.equal(interpreted.records[2].note,'=1+1');
 assert.equal(interpreted.records[1].kind,'debit');
});
test('CSV Unicode, quoting e date Excel',()=>{
 const rows=parseCsv('Data;Tipo;Ore;Nota\r\n"29/10/2026";maturata;"3,5";"Progetto; aula"\r\n');
 assert.equal(interpretWorkRows(rows).records[0].hours,3.5);
 assert.equal(interpretWorkRows(rows).records[0].note,'Progetto; aula');
 assert.equal(excelDate(1),'1899-12-31');
 assert.throws(()=>parseXlsx(Buffer.from('not excel')),/non valido/);
});
