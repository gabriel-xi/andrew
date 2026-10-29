import { api,bindForm } from './shared.js';
bindForm('form',async data=>{await api('/api/auth/login','POST',data);location.replace('/homepage.html');});
