import { api,bindForm } from './shared.js';
bindForm('form',async data=>{await api('/api/auth/register','POST',data);location.replace('/login.html');});
