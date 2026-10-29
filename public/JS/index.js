import { api } from './shared.js';
const message=document.getElementById('message');
try{const d=await api('/api/auth/setup-status');if(d.needs_setup)message.textContent='Primo accesso: registra l’amministratore con la chiave di configurazione.';}catch{} 
