import { isDate } from './db.js';
export function validateWorkEntry(data) {
  if (!isDate(data?.work_date)) throw new Error('Data di lavoro non valida');
  const hours = Number(data?.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new Error('Ore non valide (0-24)');
  if (!['credit', 'debit'].includes(data.kind)) throw new Error('Tipo movimento non valido');
  const courseId = data.course_id ? Number(data.course_id) : null;
  if (courseId && (!Number.isSafeInteger(courseId) || courseId <= 0)) throw new Error('Corso non valido');
  return { work_date: data.work_date, hours, kind: data.kind, course_id: courseId,
    note: String(data.note || '').trim().slice(0, 1000) };
}
export function bankSummary(db, userId) {
  const totals = db.prepare("SELECT " +
    "COALESCE(SUM(CASE WHEN kind='credit' THEN hours ELSE 0 END),0) AS credit, " +
    "COALESCE(SUM(CASE WHEN kind='debit' THEN hours ELSE 0 END),0) AS debit " +
    "FROM work_entries WHERE user_id=?").get(userId);
  return { ...totals, balance: totals.credit - totals.debit };
}
