/**
 * Lightweight XLSX reader/writer for tabular workbook exchange.
 * ZIP format: PKZIP, deflate/store, no ZIP64 or encrypted archives.
 * XML parser is intentionally restricted to worksheet cells; not an XML DOM parser.
 * Never execute formulas or evaluate XML. Reject oversized archives.
 */
import { inflateRawSync } from 'node:zlib';

const MAX_FILE=12*1024*1024;
const MAX_XML=24*1024*1024;
function xml(value) {
 return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  .replaceAll('"','&quot;').replaceAll("'","&apos;");
}
function unxml(value) {
 return String(value ?? '').replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g,(_,entity)=>{
  if(entity[0]==='#'){
   const code=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):parseInt(entity.slice(1),10);
   return code>=0 && code<=0x10ffff?String.fromCodePoint(code):'';
  }
  return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[entity]||'';
 });
}
const crcTable=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?(0xedb88320^(c>>>1)):(c>>>1);t.push(c>>>0);}return t;})();
function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function zipArchive(files){
 const locals=[],centrals=[];let pos=0;
 for(const [name,value] of files){
  const filename=Buffer.from(name,'utf8'),data=Buffer.isBuffer(value)?value:Buffer.from(value,'utf8');
  const crc=crc32(data),local=Buffer.alloc(30),central=Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0,6);local.writeUInt16LE(0,8);
  local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);
  local.writeUInt16LE(filename.length,26);
  locals.push(local,filename,data);
  central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
  central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);
  central.writeUInt16LE(filename.length,28);central.writeUInt32LE(pos,42);
  centrals.push(central,filename);
  pos+=local.length+filename.length+data.length;
 }
 const center=Buffer.concat(centrals),end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);
 end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);
 end.writeUInt32LE(center.length,12);end.writeUInt32LE(pos,16);
 return Buffer.concat([...locals,center,end]);
}
function colLetters(index) {
 let text='',n=index+1;
 while(n>0){n--;text=String.fromCharCode(65+n%26)+text;n=Math.floor(n/26);}
 return text;
}
function sheetXML(headers,rows) {
 const all=[headers,...rows];let out='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
 out+='<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>';
 for(let i=0;i<all.length;i++){
  out+='<row r="'+(i+1)+'">';
  for(let k=0;k<all[i].length;k++){
   const cell=all[i][k],ref=colLetters(k)+(i+1);
   if(cell===null||cell===undefined||cell===''){continue;}
   if(typeof cell==='number'&&Number.isFinite(cell)){
    out+='<c r="'+ref+'"><v>'+cell+'</v></c>';
   }else{
    out+='<c r="'+ref+'" t="inlineStr"><is><t xml:space="preserve">'+xml(cell)+'</t></is></c>';
   }
  }
  out+='</row>';
 }
 return out+'</sheetData></worksheet>';
}
export function createXlsx(sheets) {
 if(!Array.isArray(sheets)||sheets.length===0||sheets.length>20)throw Error('Fogli non validi');
 const files=[],types=[],rels=[],books=[];
 sheets.forEach((s,i)=>{
  if(!Array.isArray(s.headers)||!Array.isArray(s.rows))throw Error('Dati foglio non validi');
  const n=i+1;
  files.push(['xl/worksheets/sheet'+n+'.xml',sheetXML(s.headers,s.rows)]);
  types.push('<Override PartName="/xl/worksheets/sheet'+n+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
  rels.push('<Relationship Id="rId'+n+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+n+'.xml"/>');
  books.push('<sheet name="'+xml(String(s.name||'Foglio '+n).slice(0,31))+'" sheetId="'+n+'" r:id="rId'+n+'"/>');
 });
 files.push(['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+types.join('')+'</Types>']);
 files.push(['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>']);
 files.push(['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+books.join('')+'</sheets></workbook>']);
 files.push(['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+rels.join('')+'</Relationships>']);
 return zipArchive(files);
}
function zipFiles(buffer){
 if(!Buffer.isBuffer(buffer) || buffer.length>MAX_FILE || buffer.length<22)throw Error('File Excel non valido o troppo grande');
 const min=Math.max(0,buffer.length-22-65535);let eocd=-1;
 for(let n=buffer.length-22;n>=min;n--)if(buffer.readUInt32LE(n)===0x06054b50){eocd=n;break;}
 if(eocd<0)throw Error('Archivio XLSX non valido');
 const count=buffer.readUInt16LE(eocd+10),offset=buffer.readUInt32LE(eocd+16),files=new Map();
 if(count>200||offset>=buffer.length)throw Error('Archivio non supportato');
 let cursor=offset;
 for(let n=0;n<count;n++){
  if(cursor+46>buffer.length||buffer.readUInt32LE(cursor)!==0x02014b50)throw Error('ZIP corrotto');
  const method=buffer.readUInt16LE(cursor+10),size=buffer.readUInt32LE(cursor+20),raw=buffer.readUInt32LE(cursor+24);
  const fn=buffer.readUInt16LE(cursor+28),extra=buffer.readUInt16LE(cursor+30),comment=buffer.readUInt16LE(cursor+32);
  const local=buffer.readUInt32LE(cursor+42),name=buffer.subarray(cursor+46,cursor+46+fn).toString('utf8');
  cursor+=46+fn+extra+comment;
  if(!name.startsWith('xl/worksheets/') && name!=='xl/sharedStrings.xml')continue;
  if(raw>MAX_XML||size>MAX_FILE||local+30>buffer.length)throw Error('Elemento XLSX troppo grande');
  if(buffer.readUInt32LE(local)!==0x04034b50)throw Error('ZIP interno corrotto');
  const localName=buffer.readUInt16LE(local+26),localExtra=buffer.readUInt16LE(local+28);
  const start=local+30+localName+localExtra,end=start+size;
  if(end>buffer.length)throw Error('Archivio XLSX incompleto');
  const encoded=buffer.subarray(start,end);
  let content;
  if(method===0)content=encoded;
  else if(method===8)content=inflateRawSync(encoded,{maxOutputLength:MAX_XML});
  else throw Error('Compressione Excel non supportata');
  if(content.length>MAX_XML)throw Error('XML Excel troppo grande');
  files.set(name,content.toString('utf8'));
 }
 return files;
}
function stringsFromXml(source) {
 if(!source)return [];
 const values=[];
 for(const m of source.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)){
  let content='';
  for(const t of m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g))content+=unxml(t[1]);
  values.push(content);
 }
 return values;
}
function cellIndex(reference) {
 const match=/^([A-Z]+)[0-9]+$/.exec(reference||'');
 if(!match)return null;
 let index=0;for(const letter of match[1])index=index*26+(letter.charCodeAt(0)-64);
 return index-1;
}
export function parseXlsx(buffer,sheetNumber=1) {
 const files=zipFiles(buffer),sheet=files.get('xl/worksheets/sheet'+sheetNumber+'.xml');
 if(!sheet)throw Error('Nessun primo foglio nel file Excel');
 const strings=stringsFromXml(files.get('xl/sharedStrings.xml'));
 const rows=[];
 for(const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)){
  const cells=[];
  for(const match of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
   const attributes=match[1],reference=/\br="([^"]+)"/.exec(attributes)?.[1],
      index=cellIndex(reference);
   if(index===null||index>70)continue;
   const type=/\bt="([^"]+)"/.exec(attributes)?.[1]||'n';
   const body=match[2]||'';
   const raw=/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1]||'';
   let value;
   if(type==='s')value=strings[Number(raw)]??'';
   else if(type==='inlineStr')value=[...body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(x=>unxml(x[1])).join('');
   else if(type==='n' && raw!=='')value=Number(raw);
   else value=unxml(raw);
   cells[index]=value;
  }
  rows.push(cells);
  if(rows.length>50000)throw Error('Troppi record nel file');
 }
 return rows;
}
export function parseCsv(text) {
 const input=String(text||'').replace(/^\ufeff/,'');
 const separator=input.split(/\r?\n/,1)[0].includes(';')?';':',';
 const rows=[];let current=[],field='',quoted=false;
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(quoted){
   if(c==='"'&&input[i+1]==='"'){field+='"';i++;}
   else if(c==='"')quoted=false;
   else field+=c;
  }else if(c==='"' && field==='')quoted=true;
  else if(c===separator){current.push(field);field='';}
  else if(c==='\r'||c==='\n'){
   if(c==='\r'&&input[i+1]==='\n')i++;
   current.push(field);field='';
   if(current.some(x=>String(x).trim()!==''))rows.push(current);
   current=[];
  }else field+=c;
 }
 if(quoted)throw Error('CSV non valido: virgolette aperte');
 current.push(field);if(current.some(x=>String(x).trim()!==''))rows.push(current);
 if(rows.length>50000)throw Error('CSV troppo grande');
 return rows;
}
export function excelDate(value){
 if(typeof value==='number' && Number.isFinite(value) && value>=1 && value<=2958465){
  const date=new Date(Date.UTC(1899,11,30)+Math.round(value)*86400000);
  return date.toISOString().slice(0,10);
 }
 const text=String(value||'').trim();
 if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
 const match=/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(text);
 if(match)return match[3]+'-'+match[2].padStart(2,'0')+'-'+match[1].padStart(2,'0');
 return null;
}
export function interpretWorkRows(rows) {
 const normalize=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
 const index=rows.findIndex((r,i)=>i<20 && r.some(x=>['data','date','giorno'].includes(normalize(x))) && r.some(x=>['ore','hours','quantita'].includes(normalize(x))));
 if(index<0)throw Error('Il file deve contenere colonne Data e Ore.');
 const headings=rows[index].map(normalize),find=names=>headings.findIndex(h=>names.includes(h));
 const dateIndex=find(['data','date','giorno']),hoursIndex=find(['ore','hours','quantita']),
   kindIndex=find(['tipo','type','movimento']),noteIndex=find(['note','causale','descrizione']);
 const records=[],skipped=[];
 for(let j=index+1;j<rows.length;j++){
  const r=rows[j],date=excelDate(r[dateIndex]),raw=String(r[hoursIndex]??'').replace(',','.').trim(),hours=Number(raw);
  const label=normalize(kindIndex>=0?r[kindIndex]:'');
  let kind=['credito','credit','maturata','straordinario','+'].includes(label)?'credit':
    ['debito','debit','utilizzata','permesso','-'].includes(label)?'debit':null;
  if(!kind&&kindIndex<0&&Number.isFinite(hours))kind=hours<0?'debit':'credit';
  if(!date||!Number.isFinite(hours)||hours===0||!kind){skipped.push(j+1);continue;}
  records.push({work_date:date,kind,hours:Math.abs(hours),
    note:noteIndex<0?'':String(r[noteIndex]||'').slice(0,1000)});
  if(records.length>50000)throw Error('Troppi movimenti nel file');
 }
 return {records,skipped,header_row:index+1};
}
