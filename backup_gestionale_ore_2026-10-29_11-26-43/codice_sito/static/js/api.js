/**
 * Unified API Client for REST requests with token injection and error handling
 */

import { state } from './state.js';
import { showToast } from './ui.js';

export async function apiCall(endpoint, method = "GET", body = null, isFormData = false) {
  const headers = {};

  if (!isFormData) {
    headers["Content-Type"] = "application/json";
  }

  // Inject session token if available
  if (state.token) {
    headers["Authorization"] = `Bearer ${state.token}`;
  }

  const options = {
    method,
    headers,
    credentials: "same-origin"
  };

  if (body) {
    options.body = isFormData ? body : JSON.stringify(body);
  }

  try {
    const res = await fetch(endpoint, options);
    const data = await res.json().catch(() => ({ status: "error", message: `Risposta non valida (${res.status})` }));

    if (!res.ok) {
      if (res.status === 401) {
        showToast(data.message || "Sessione scaduta o non valida. Effettua nuovamente il login.", "danger");
      } else if (res.status === 403) {
        showToast(data.message || "Azione non consentita: permessi insufficienti.", "warning");
      } else if (res.status === 429) {
        showToast(data.message || "Troppe richieste. Riprova tra poco.", "warning");
      }
      throw new Error(data.message || `Errore server (${res.status})`);
    }

    return data;
  } catch (err) {
    console.error(`[API Error] ${method} ${endpoint}:`, err);
    throw err;
  }
}

