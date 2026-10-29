import { bankSummary } from '../src/me.js';
export default function register(router) {
  router.add('GET','/api/health',({send}) => send(200,{status:'ok',application:'Unisic'}),'public');
  router.add('GET','/api/home',({db,user,send}) => {
    const courses = db.prepare('SELECT COUNT(*) AS n FROM courses').get().n;
    const events = db.prepare('SELECT COUNT(*) AS n FROM calendar_events WHERE event_date >= date(\'now\') AND status=\'confirmed\'').get().n;
    send(200,{status:'ok',user,summary:{courses,upcoming_events:events,...bankSummary(db,user.id)}});
  });
  router.add('GET','/api/admin/overview',({db,send}) => {
    const users = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    const courses = db.prepare('SELECT COUNT(*) AS n FROM courses').get().n;
    const entries = db.prepare('SELECT COUNT(*) AS n FROM work_entries').get().n;
    send(200,{status:'ok',users,courses,entries});
  },'admin');
}
