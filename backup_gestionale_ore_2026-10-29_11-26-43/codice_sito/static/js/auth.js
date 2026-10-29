/**
 * Authentication, Session Persistence & Role-Based Navigation
 */

import { state, elements } from './state.js';
import { apiCall } from './api.js';
import { showToast, escapeHtml } from './ui.js';

export function showAuthCard(which) {
  const loader = document.getElementById("authLoadingPlaceholder");
  if (loader) loader.style.display = "none";

  const authScreen = document.getElementById("authScreenContainer");
  if (authScreen) authScreen.style.display = "flex";

  const appEl = document.getElementById("app");
  if (appEl) appEl.style.display = "none";

  const setupCard = document.getElementById("authSetupAdminCard");
  const loginCard = document.getElementById("authLoginCard");
  const tutorCard = document.getElementById("authRegisterTutorCard");

  if (setupCard) setupCard.style.display = which === "setup-admin" ? "block" : "none";
  if (loginCard) loginCard.style.display = which === "login" ? "block" : "none";
  if (tutorCard) tutorCard.style.display = which === "register-tutor" ? "block" : "none";

  if (elements.authAdminError) {
    elements.authAdminError.style.display = "none";
    elements.authAdminError.textContent = "";
  }
  if (elements.authLoginError) {
    elements.authLoginError.style.display = "none";
    elements.authLoginError.textContent = "";
  }
  if (elements.authTutorError) {
    elements.authTutorError.style.display = "none";
    elements.authTutorError.textContent = "";
  }
}

export function enterAuthenticatedApp(user) {
  state.currentUser = user;
  state.currentEmployeeId = user.id;
  if (user.token) {
    state.token = user.token;
    localStorage.setItem("bt_auth_token", user.token);
  }

  localStorage.setItem("bt_user_session", JSON.stringify({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    is_tutor: user.is_tutor
  }));

  const loader = document.getElementById("authLoadingPlaceholder");
  if (loader) loader.style.display = "none";

  const authScreen = document.getElementById("authScreenContainer");
  if (authScreen) authScreen.style.display = "none";

  const appEl = document.getElementById("app");
  if (appEl) appEl.style.display = "block";

  if (elements.authScreenContainer) elements.authScreenContainer.style.display = "none";
  if (elements.mainAppContainer) elements.mainAppContainer.style.display = "block";

  try {
    updateNavBarProfile();
  } catch (err) {
    console.error("Errore updateNavBarProfile:", err);
  }
}

export async function checkAuthStatus() {
  try {
    const data = await apiCall("/api/auth/profiles");
    state.profiles = data.profiles || [];

    if (data.needs_setup || state.profiles.length === 0) {
      localStorage.removeItem("bt_user_session");
      localStorage.removeItem("bt_auth_token");
      state.currentUser = null;
      state.token = "";
      showAuthCard("setup-admin");
      return false;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const queryToken = urlParams.get("auth_token");
    if (queryToken) {
      state.token = queryToken;
      localStorage.setItem("bt_auth_token", queryToken);
    }

    const savedToken = state.token || localStorage.getItem("bt_auth_token");
    if (savedToken) {
      state.token = savedToken;
    }

    // Prova a recuperare la sessione attiva (da token localStorage o cookie di sessione persistente)
    try {
      const meRes = await apiCall("/api/auth/me");
      if (meRes && meRes.status === "ok" && meRes.user) {
        if (!meRes.user.token && savedToken) {
          meRes.user.token = savedToken;
        }
        enterAuthenticatedApp(meRes.user);
        return true;
      }
    } catch (authErr) {
      console.warn("Sessione non attiva o scaduta:", authErr);
    }

    localStorage.removeItem("bt_user_session");
    localStorage.removeItem("bt_auth_token");
    state.currentUser = null;
    state.token = "";
    showAuthCard("login");
    return false;
  } catch (err) {
    console.error("Errore verifica autenticazione:", err);
    showAuthCard("login");
    return false;
  }
}

export async function loadProfiles() {
  try {
    const data = await apiCall("/api/auth/profiles");
    if (data.status === "ok") {
      state.profiles = data.profiles || [];
      if (state.currentUser) {
        const refreshed = state.profiles.find(p => p.id === state.currentUser.id);
        if (refreshed) {
          state.currentUser = refreshed;
          updateNavBarProfile();
        }
      }
    }
  } catch (err) {
    console.error("Errore refresh profili:", err);
  }
}

export async function handleAuthLogin(e, onLoginSuccess) {
  e.preventDefault();
  if (elements.authLoginError) {
    elements.authLoginError.style.display = "none";
    elements.authLoginError.textContent = "";
  }

  const identifier = elements.authLoginIdentifier.value.trim();
  const password = elements.authLoginPassword.value.trim();

  if (!identifier || !password) {
    if (elements.authLoginError) {
      elements.authLoginError.textContent = "Compila entrambi i campi: Nome e Cognome (o Email) e Password.";
      elements.authLoginError.style.display = "block";
    }
    return;
  }

  try {
    const data = await apiCall("/api/auth/login", "POST", { identifier, password });
    if (data.status === "ok" && data.user) {
      enterAuthenticatedApp(data.user);
      showToast(`Accesso effettuato! Benvenuto/a, ${data.user.name}.`, "success");
      await loadProfiles();
      if (typeof onLoginSuccess === "function") {
        await onLoginSuccess();
      }
    }
  } catch (err) {
    if (elements.authLoginError) {
      elements.authLoginError.textContent = err.message || "Credenziali non corrette.";
      elements.authLoginError.style.display = "block";
    }
  }
}

export async function handleAuthSetupAdmin(e, onSetupSuccess) {
  e.preventDefault();
  if (elements.authAdminError) {
    elements.authAdminError.style.display = "none";
    elements.authAdminError.textContent = "";
  }

  const name = elements.authAdminName.value.trim();
  const email = elements.authAdminEmail.value.trim();
  const password = elements.authAdminPassword.value.trim();
  const confirm = elements.authAdminPasswordConfirm.value.trim();
  const role = elements.authAdminRole ? elements.authAdminRole.value : "admin";
  const isTutor = role === "admin" ? (elements.authAdminIsTutor ? elements.authAdminIsTutor.checked : false) : true;

  if (!name || !email || !password) {
    if (elements.authAdminError) {
      elements.authAdminError.textContent = "I campi Nome, Email e Password sono obbligatori.";
      elements.authAdminError.style.display = "block";
    }
    return;
  }

  if (password.length < 6) {
    if (elements.authAdminError) {
      elements.authAdminError.textContent = "La password deve contenere almeno 6 caratteri.";
      elements.authAdminError.style.display = "block";
    }
    return;
  }

  if (password !== confirm) {
    if (elements.authAdminError) {
      elements.authAdminError.textContent = "Le password inserite non coincidono.";
      elements.authAdminError.style.display = "block";
    }
    return;
  }

  try {
    const data = await apiCall("/api/auth/setup-admin", "POST", {
      name,
      email,
      password,
      role,
      is_tutor: isTutor
    });

    if (data.status === "ok" && data.user) {
      const roleText = data.user.role === "admin" ? (data.user.is_tutor ? "Amministratore & Tutor" : "Amministratore") : "Tutor";
      showToast(`👑 Registrazione Avvenuta Con Successo! Ruolo: ${roleText}.`, "success");
      enterAuthenticatedApp(data.user);
      await loadProfiles();
      if (typeof onSetupSuccess === "function") {
        await onSetupSuccess();
      }
    }
  } catch (err) {
    if (elements.authAdminError) {
      elements.authAdminError.textContent = err.message || "Errore nella registrazione.";
      elements.authAdminError.style.display = "block";
    }
  }
}

export async function handleAuthRegisterTutor(e, onRegisterSuccess) {
  e.preventDefault();
  if (elements.authTutorError) {
    elements.authTutorError.style.display = "none";
    elements.authTutorError.textContent = "";
  }

  const name = elements.authTutorName.value.trim();
  const email = elements.authTutorEmail.value.trim();
  const password = elements.authTutorPassword.value.trim();
  const confirm = elements.authTutorPasswordConfirm.value.trim();
  const role = elements.authTutorRole ? elements.authTutorRole.value : "tutor";
  const isTutor = role === "admin" ? (elements.authTutorIsTutor ? elements.authTutorIsTutor.checked : false) : true;

  if (!name || !email || !password) {
    if (elements.authTutorError) {
      elements.authTutorError.textContent = "Tutti i campi obbligatori devono essere compilati.";
      elements.authTutorError.style.display = "block";
    }
    return;
  }

  if (password.length < 6) {
    if (elements.authTutorError) {
      elements.authTutorError.textContent = "La password deve contenere almeno 6 caratteri.";
      elements.authTutorError.style.display = "block";
    }
    return;
  }

  if (password !== confirm) {
    if (elements.authTutorError) {
      elements.authTutorError.textContent = "Le password inserite non coincidono.";
      elements.authTutorError.style.display = "block";
    }
    return;
  }

  try {
    const data = await apiCall("/api/auth/register", "POST", {
      name,
      email,
      password,
      role,
      is_tutor: isTutor
    });

    if (data.status === "ok" && data.user) {
      const roleText = data.user.role === "admin" ? (data.user.is_tutor ? "Amministratore & Tutor" : "Amministratore") : "Tutor";
      showToast(`🎓 Registrazione Avvenuta Con Successo! Ruolo: ${roleText}.`, "success");
      enterAuthenticatedApp(data.user);
      await loadProfiles();
      if (typeof onRegisterSuccess === "function") {
        await onRegisterSuccess();
      }
    }
  } catch (err) {
    if (elements.authTutorError) {
      elements.authTutorError.textContent = err.message || "Errore nella registrazione.";
      elements.authTutorError.style.display = "block";
    }
  }
}

export async function handleLogout() {
  try {
    if (state.token) {
      await apiCall("/api/auth/logout", "POST").catch(() => {});
    }
  } catch (e) {
    // Ignore error
  }
  localStorage.removeItem("bt_user_session");
  localStorage.removeItem("bt_auth_token");
  localStorage.removeItem("active_user_id");
  state.currentUser = null;
  state.currentEmployeeId = null;
  state.token = "";

  if (elements.authLoginPassword) elements.authLoginPassword.value = "";
  showAuthCard("login");
  showToast("Disconnessione effettuata con successo.", "info");
}

export function switchMainTab(tabId) {
  elements.tabButtons.forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tabId);
  });
  elements.tabPanes.forEach(p => {
    p.classList.toggle("active", p.id === tabId);
  });
}

export function updateNavBarProfile() {
  const u = state.currentUser;
  if (!u) return;

  if (elements.navUserName) elements.navUserName.textContent = u.name;
  if (elements.navUserAvatar) elements.navUserAvatar.textContent = u.name.charAt(0).toUpperCase();

  const isAdmin = u.role === "admin";
  const isTutor = Boolean(u.is_tutor);

  if (isAdmin && isTutor) {
    if (elements.navUserRole) {
      elements.navUserRole.textContent = "👑 Admin + 🎓 Tutor";
      elements.navUserRole.className = "user-role-pill role-admin";
    }
  } else if (isAdmin && !isTutor) {
    if (elements.navUserRole) {
      elements.navUserRole.textContent = "👑 Admin (Supervisore)";
      elements.navUserRole.className = "user-role-pill role-admin";
    }
  } else {
    if (elements.navUserRole) {
      elements.navUserRole.textContent = "🎓 Tutor";
      elements.navUserRole.className = "user-role-pill role-tutor";
    }
  }

  // Permessi visibilità
  if (isAdmin && !isTutor) {
    if (elements.tabBtnTimetracking) elements.tabBtnTimetracking.style.display = "none";
    if (elements.tabBtnAdminHours) elements.tabBtnAdminHours.style.display = "inline-block";
    if (elements.tabBtnEmployees) elements.tabBtnEmployees.style.display = "inline-block";
    if (elements.btnOpenNewEntryModal) elements.btnOpenNewEntryModal.style.display = "none";
    if (elements.btnMobileFabEntry) elements.btnMobileFabEntry.style.display = "none";

    const activeTab = document.querySelector(".tab-btn.active");
    if (activeTab && activeTab.dataset.tab === "tab-timetracking") {
      switchMainTab("tab-admin-hours");
    }
  } else if (isAdmin && isTutor) {
    if (elements.tabBtnTimetracking) elements.tabBtnTimetracking.style.display = "inline-block";
    if (elements.tabBtnAdminHours) elements.tabBtnAdminHours.style.display = "inline-block";
    if (elements.tabBtnEmployees) elements.tabBtnEmployees.style.display = "inline-block";
    if (elements.btnOpenNewEntryModal) elements.btnOpenNewEntryModal.style.display = "none";
    if (elements.btnMobileFabEntry) elements.btnMobileFabEntry.style.display = "";
  } else {
    if (elements.tabBtnTimetracking) elements.tabBtnTimetracking.style.display = "inline-block";
    if (elements.tabBtnAdminHours) elements.tabBtnAdminHours.style.display = "none";
    if (elements.tabBtnEmployees) elements.tabBtnEmployees.style.display = "none";
    if (elements.btnOpenNewEntryModal) elements.btnOpenNewEntryModal.style.display = "none";
    if (elements.btnMobileFabEntry) elements.btnMobileFabEntry.style.display = "";

    const activeTab = document.querySelector(".tab-btn.active");
    if (activeTab && (activeTab.dataset.tab === "tab-admin-hours" || activeTab.dataset.tab === "tab-employees")) {
      switchMainTab("tab-master-calendar");
    }
  }

  if (isAdmin) {
    document.body.classList.remove("tutor-mode");
    document.body.classList.add("admin-mode");
    if (elements.adminViewSelectorContainer && elements.adminSelectViewEmployee) {
      elements.adminViewSelectorContainer.style.display = "flex";
      elements.adminSelectViewEmployee.innerHTML = "";
      state.profiles.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.id;
        const roleLbl = p.role === "admin" ? (p.is_tutor ? "👑 Admin + Tutor" : "👑 Admin") : "🎓 Tutor";
        opt.textContent = `${p.name} (${roleLbl})`;
        if (p.id === state.currentEmployeeId) opt.selected = true;
        elements.adminSelectViewEmployee.appendChild(opt);
      });
    }
  } else {
    document.body.classList.remove("admin-mode");
    document.body.classList.add("tutor-mode");
    if (elements.adminViewSelectorContainer) {
      elements.adminViewSelectorContainer.style.display = "none";
    }
  }
}

export function openSwitchProfileModal() {
  if (!elements.profilesListContainer) return;
  elements.profilesListContainer.innerHTML = "";

  state.profiles.forEach(p => {
    const isCurrent = p.id === state.currentEmployeeId;
    const item = document.createElement("div");
    item.className = `profile-item ${isCurrent ? 'active' : ''}`;

    item.innerHTML = `
      <div class="d-flex items-center gap-2">
        <div class="user-avatar" style="width:36px; height:36px;">${escapeHtml(p.name.charAt(0).toUpperCase())}</div>
        <div>
          <strong style="display:block; font-size:0.95rem;">${escapeHtml(p.name)}</strong>
          <span class="text-muted text-sm">${p.role === 'admin' ? 'Amministratore del sistema' : 'Tutor d\'aula'}</span>
        </div>
      </div>
      <div class="d-flex items-center gap-2">
        <span class="user-role-pill ${p.role === 'admin' ? 'role-admin' : 'role-tutor'}">
          ${p.role === 'admin' ? '👑 Admin' : '🎓 Tutor'}
        </span>
        <button class="btn btn-sm ${isCurrent ? 'btn-success' : 'btn-outline'}" onclick="window.switchActiveUser(${p.id})">
          ${isCurrent ? '✓ Attivo' : 'Seleziona'}
        </button>
      </div>
    `;

    elements.profilesListContainer.appendChild(item);
  });

  if (elements.switchProfileModalBackdrop) elements.switchProfileModalBackdrop.classList.add("show");
}

export function closeSwitchProfileModal() {
  if (elements.switchProfileModalBackdrop) elements.switchProfileModalBackdrop.classList.remove("show");
}

export async function switchActiveUser(id, onSwitchCallback) {
  const target = state.profiles.find(p => p.id === id);
  if (!target) return;

  // Se l'utente attivo è un tutor e tenta di passare ad admin da un browser, richiede login
  if (target.role === "admin" && state.currentUser && state.currentUser.role !== "admin") {
    closeSwitchProfileModal();
    showToast("Per accedere come Amministratore inserisci la tua password.", "info");
    showAuthCard("login");
    if (elements.authLoginIdentifier) elements.authLoginIdentifier.value = target.email || target.name;
    return;
  }

  state.currentUser = target;
  state.currentEmployeeId = target.id;
  localStorage.setItem("active_user_id", target.id);
  localStorage.setItem("bt_user_session", JSON.stringify(target));
  updateNavBarProfile();
  closeSwitchProfileModal();
  showToast(`Stai operando come ${target.name} (${target.role.toUpperCase()})`, "success");
  if (typeof onSwitchCallback === "function") {
    await onSwitchCallback();
  }
}

