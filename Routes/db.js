import {bankSummary} from '../src/me.js';
export default function register(router) {
  router.add('GET','/api/db/status',({db,send}) => {
    const check=db.prepare('PRAGMA integrity_check').get();
    send(200,{status:'ok',database:check.integrity_check === 'ok' ? 'ok' : 'check_required'});
  },'admin');
  router.add('GET','/api/admin/migration/reconciliation',({db,send})=>{
    const users=db.prepare('SELECT id,name,initial_bank_hours FROM users ORDER BY id').all();
    const ledger=db.prepare("SELECT user_id,entry_type,SUM(ABS(hours)) AS total FROM legacy_work_history WHERE entry_type IN ('maturata','utilizzata') GROUP BY user_id,entry_type").all();
    const grouped=new Map();
    for(const item of ledger){
      const totals=grouped.get(item.user_id)||{credit:0,debit:0};
      if(item.entry_type==='maturata')totals.credit=item.total;
      else totals.debit=item.total;
      grouped.set(item.user_id,totals);
    }
    const values=users.filter(u=>db.prepare('SELECT 1 FROM legacy_work_history WHERE user_id=? LIMIT 1').get(u.id)).map(u=>{
      const legacy=grouped.get(u.id)||{credit:0,debit:0};
      const expected=u.initial_bank_hours+legacy.credit-legacy.debit;
      const actual=bankSummary(db,u.id).balance;
      return {user_id:u.id,name:u.name,expected,actual,difference:Math.round((actual-expected)*100000)/100000};
    });
    const counts=db.prepare("SELECT legacy_table,COUNT(*) AS n FROM legacy_unmapped_records GROUP BY legacy_table").all();
    send(200,{status:'ok',users:values,mismatches:values.filter(x=>Math.abs(x.difference)>0.00001).length,unmapped:counts});
  },'admin');
}
