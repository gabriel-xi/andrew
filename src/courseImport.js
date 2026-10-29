import { excelDate,parseXlsx,parseCsv } from './xlsx.js';
import { isDate } from './db.js';

const norm=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
 .trim().toLowerCase().replace(/\s+/g,' ');
const mapStatus=v=>{
 const s=norm(v);
 return s==='annullata'||s==='cancelled'?'cancelled':
  s==='svolta'||s==='completata'||s==='completed'?'completed':
  s==='rinviata'||s==='postponed'?'postponed':'confirmed';
};
function clock(v){
 if(typeof v==='number' && Number.isFinite(v) && v>=0 && v<1){
  const minutes=Math.round(v*1440)%1440;
  return String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
 }
 const match=/(\d{1,2})[:.](\d{2})/.exec(String(v||'').trim());
 if(!match)return null;
 const h=Number(match[1]),m=Number(match[2]);
 return h<24&&m<60?String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'):null;
}
function columns(row){
 const headers=row.map(norm);
 const pos=keys=>headers.findIndex(h=>keys.includes(h));
 return {
  date:pos(['data','giorno','date','data lezione']),
  start:pos(['inizio','dalle','ora inizio','orario inizio','start','start time']),
  end:pos(['fine','alle','ora fine','orario fine','end','end time']),
  slot:pos(['orario','fascia oraria','orario lezione']),
  title:pos(['attivita','lezione','titolo','argomento']),
  module:pos(['modulo','materia','moduli']),
  instructor:pos(['docente','insegnante','formatore','teacher']),
  tutor:pos(['tutor','tutor id']),
  phase:pos(['fase','tipologia','phase']),
  status:pos(['stato','status']),
  notes:pos(['note','descrizione','causale']),
  test:pos(['test','test finale','verifica']),
 };
}
function parseRows(rows){
 let header=-1,cols=null;
 for(let i=0;i<Math.min(rows.length,30);i++){
  const parsed=columns(rows[i]);
  if(parsed.date>=0 && ((parsed.start>=0 && parsed.end>=0)||parsed.slot>=0)){
   header=i;cols=parsed;break;
  }
 }
 if(header<0)throw Error('Non trovo le colonne Data e Inizio/Fine oppure Orario');
 const records=[],skipped=[];
 for(let i=header+1;i<rows.length;i++){
  const row=rows[i],value=key=>cols[key]===-1?null:row[cols[key]];
  const date=excelDate(value('date'));
  let start=clock(value('start')),end=clock(value('end'));
  if((!start||!end) && value('slot')){
   const clocks=String(value('slot')).match(/\d{1,2}[:.]\d{2}/g)||[];
   if(clocks.length>=2){start=clock(clocks[0]);end=clock(clocks[1]);}
  }
  if(!isDate(date)||!start||!end||start>=end){skipped.push(i+1);continue;}
  const module=String(value('module')||'').trim().slice(0,180);
  const instructor=String(value('instructor')||'').trim().slice(0,180);
  const rawTutor=value('tutor'),tutor=/^\d+$/.test(String(rawTutor))?Number(rawTutor):null;
  const phase=norm(value('phase'))==='stage'?'stage':'aula';
  const title=String(value('title')||module||(phase==='stage'?'Stage':'Lezione')).trim().slice(0,180);
  records.push({
   event_date:date,start_time:start,end_time:end,title,
   module,instructor,tutor_id:tutor,phase,status:mapStatus(value('status')),
   notes:String(value('notes')||'').slice(0,2500),
   is_module_test:['si','sì','true','yes','1','x'].includes(norm(value('test')))?1:0
  });
  if(records.length>2500)throw Error('Massimo 2500 lezioni per file');
 }
 return {records,skipped,header_row:header+1};
}
export function parseCalendarData(buffer,contentType=''){
 if(!Buffer.isBuffer(buffer)||buffer.length===0)throw Error('File vuoto');
 if(buffer.length>8*1024*1024)throw Error('File troppo grande');
 if(buffer[0]===0x50&&buffer[1]===0x4b){
  let last;
  for(let n=1;n<=8;n++){
   try{return parseRows(parseXlsx(buffer,n));}
   catch(error){last=error;}
  }
  throw Error(last?.message||'Foglio calendario non trovato');
 }
 if(contentType.startsWith('text/csv')||contentType.startsWith('text/plain')||
  contentType==='application/octet-stream')return parseRows(parseCsv(buffer.toString('utf8')));
 throw Error('Formato non supportato: carica CSV o XLSX');
}
export function internalConflicts(events){
 const collisions=[],buckets=new Map();
 for(const e of events){
  if(['cancelled','postponed'].includes(e.status))continue;
  const keys=[e.instructor?'D:'+norm(e.instructor):null,e.tutor_id?'T:'+e.tutor_id:null].filter(Boolean);
  for(const key of keys){
   const lookup=e.event_date+':'+key;
   const others=buckets.get(lookup)||[];
   for(const prior of others)if(prior.start_time<e.end_time && prior.end_time>e.start_time){
    collisions.push({event:e.title,other:prior.title,date:e.event_date,resource:key});
   }
   others.push(e);buckets.set(lookup,others);
  }
 }
 return collisions;
}
