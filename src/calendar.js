import { isDate } from './db.js';

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
export function validateEvent(data) {
  if (!data || typeof data !== 'object') throw new Error('Dati evento mancanti');
  const date = data.event_date;
  const start = data.start_time;
  const end = data.end_time;
  if (!isDate(date)) throw new Error('Data non valida (AAAA-MM-GG)');
  if (!timeRegex.test(start || '') || !timeRegex.test(end || '') || start >= end) {
    throw new Error('Intervallo orario non valido');
  }
  const courseId = Number(data.course_id);
  if (!Number.isSafeInteger(courseId) || courseId <= 0) throw new Error('Corso non valido');
  const title = String(data.title || '').trim();
  if (!title || title.length > 180) throw new Error('Titolo obbligatorio (massimo 180 caratteri)');
  const tutorId = data.tutor_id ? Number(data.tutor_id) : null;
  if (tutorId && (!Number.isSafeInteger(tutorId) || tutorId <= 0)) throw new Error('Tutor non valido');
  const instructor = String(data.instructor || '').trim();
  if (instructor.length > 180) throw new Error('Docente troppo lungo');
  const phase = data.phase || 'aula';
  const status = data.status || 'confirmed';
  if (!['aula', 'stage'].includes(phase)) throw new Error('Fase non valida');
  if (!['confirmed', 'completed', 'postponed', 'cancelled'].includes(status)) throw new Error('Stato non valido');
  const calendarId = data.calendar_id ? Number(data.calendar_id) : null;
  if(calendarId && (!Number.isSafeInteger(calendarId) || calendarId <= 0)) throw new Error('Calendario non valido');
  const module=String(data.module||'').trim().slice(0,180);
  const postponedTo=data.postponed_to||null;
  if(postponedTo && !isDate(postponedTo))throw new Error('Nuova data di rinvio non valida');
  const testFlag=[true,1,'true','on','1'].includes(data.is_module_test)?1:0;
  return {
    course_id: courseId, event_date: date, start_time: start, end_time: end, title,
    instructor, tutor_id: tutorId, phase, status, notes: String(data.notes || '').slice(0, 5000),
    calendar_id:calendarId,module,is_module_test:testFlag,postponed_to:postponedTo,
    reschedule_reason:String(data.reschedule_reason||'').trim().slice(0,1000)
  };
}
export function findConflicts(db, event, excludedId = 0) {
  if (event.status === 'cancelled' || event.status === 'postponed') return [];
  return db.prepare(
    "SELECT id,title,event_date,start_time,end_time,instructor,tutor_id FROM calendar_events " +
    "WHERE event_date=? AND start_time<? AND end_time>? AND id<>? " +
    "AND status NOT IN ('cancelled','postponed') " +
    "AND ((?<>'' AND instructor=? COLLATE NOCASE) OR (? IS NOT NULL AND tutor_id=?))"
  ).all(event.event_date, event.end_time, event.start_time, excludedId,
    event.instructor, event.instructor, event.tutor_id, event.tutor_id);
}
