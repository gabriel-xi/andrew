export default function register(router) {
  router.add('GET','/api/db/status',({db,send}) => {
    const check=db.prepare('PRAGMA integrity_check').get();
    send(200,{status:'ok',database:check.integrity_check === 'ok' ? 'ok' : 'check_required'});
  },'admin');
}
