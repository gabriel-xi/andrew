import{api,auth,$,clear,node,stat,table,formatDate,hours,empty}from './shared.js';
const user=await auth();
const overview=await api('/api/reports/overview');
clear('reportStats').append(
 stat('Corsi attivi',overview.courses.active||0,'▤','#76e5b5'),
 stat('Lezioni svolte',overview.events.done||0,'✓','#ae9efc'),
 stat('Totale sessioni',overview.events.total||0,'▦','#67daee'),
 stat('Ore disponibili',hours(overview.bank.balance),'◷','#eac783')
);
const month=$('month');month.value=new Date().toISOString().slice(0,7);
async function loadMonth(){
 const report=await api('/api/reports/monthly?month='+encodeURIComponent(month.value));
 const target=clear('monthReport');
 const data=report.days;
 if(!data.length){target.append(empty('Nessun movimento nel mese'));return;}
 const maximum=Math.max(...data.map(x=>Math.abs(x.delta)),1);
 const chart=node('div','chart-bars');
 for(const row of data){
  const bar=node('div','chart-bar');
  bar.style.height=Math.max(8,Math.abs(row.delta)/maximum*145)+'px';
  if(row.delta<0)bar.style.background='linear-gradient(#fa98a9,#a94a75)';
  bar.title=formatDate(row.work_date)+': '+hours(row.delta);
  bar.append(node('small','',row.work_date.slice(-2)));chart.append(bar);
 }
 const movements=node('div');target.append(chart,movements);
 table(movements,['Data','Tipo','Ore','Nota'],report.movements.map(x=>[formatDate(x.work_date),x.kind==='credit'?'Credito':'Debito',hours(x.hours),x.note||'—']));
}
month.addEventListener('change',loadMonth);await loadMonth();
const instructors=(await api('/api/reports/instructors')).instructors;
table('instructors',['Docente','Sessioni','Ore'],instructors.map(i=>[i.instructor,i.sessions,hours(i.hours)]));
const week=await api('/api/reports/weekly');
const weekly=clear('weekly'),slot=node('div');
weekly.append(node('p','muted','Dal '+formatDate(week.from)+' al '+formatDate(week.to)),slot);
table(slot,['Data','Ora','Lezione','Corso'],week.sessions.map(e=>[formatDate(e.event_date),e.start_time+'–'+e.end_time,e.title,e.course_title]));
