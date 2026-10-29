import {api,auth,$,clear,stat,empty,infoRow,hours,formatDate,node} from './shared.js';
const user=await auth();
const data=await api('/api/reports/overview'),summary=data.bank;
clear('stats').append(
 stat('Saldo banca ore',hours(summary.balance), '◷','#b39bff','Crediti e debiti aggiornati'),
 stat('Corsi attivi',data.courses.active||0,'▤','#65e0b2','Su '+data.courses.total+' corsi totali'),
 stat('Sessioni pianificate',data.events.total||0,'▦','#54e5ee','In archivio'),
 stat('Lezioni completate',data.events.done||0,'✓','#eac783','Attività concluse')
);
const upcoming=clear('upcoming');if(!data.upcoming.length)upcoming.append(empty('Nessuna lezione programmata'));
for(const e of data.upcoming)upcoming.append(infoRow('▦',e.title,e.course_title+' • '+formatDate(e.event_date),e.start_time+'–'+e.end_time));
const visual=clear('balance');
visual.append(node('p','muted','Saldo disponibile'),node('div','balance-big',hours(summary.balance)));
const positive=Math.max(0,summary.credit),negative=Math.max(0,summary.debit),total=Math.max(positive+negative,1);
const meter=node('div','meter'),positiveBar=node('span'),negativeBar=node('span','debit');
positiveBar.style.width=(positive/total*100)+'%';negativeBar.style.width=(negative/total*100)+'%';
meter.append(positiveBar,negativeBar);visual.append(meter,node('p','muted','Maturate: '+hours(summary.credit)+' · Utilizzate: '+hours(summary.debit)));
const recent=clear('recent');recent.append(node('h3','','Ultimi movimenti'));
if(!data.my_entries.length)recent.append(empty('Nessun movimento registrato'));
for(const e of data.my_entries)recent.append(infoRow(e.kind==='credit'?'↗':'↘',formatDate(e.work_date),e.kind==='credit'?'Ore maturate':'Ore utilizzate',(e.kind==='credit'?'+':'−')+hours(e.hours)));
const shortcuts=clear('shortcuts');
for(const [label,link,icon,desc] of [['Nuovo corso','courses','▤','Gestione formazione'],['Calendario','calendar','▦','Sessioni e disponibilità'],['Banca ore','me','◷','Movimenti e saldo'],['Archivio','documents','▣','Documenti e allegati']]){
 const a=node('a','shortcut');a.href='/'+link+'.html';a.append(node('span','symbol',icon),node('strong','',label),node('small','',desc));shortcuts.append(a);
}
