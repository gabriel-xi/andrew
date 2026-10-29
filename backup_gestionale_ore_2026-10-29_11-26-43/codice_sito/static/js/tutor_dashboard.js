/**
 * Tutor Personal Dashboard, Course Binding & Multi-Contract Management
 */

import { state, elements } from './state.js';
import { apiCall } from './api.js';
import { showToast, escapeHtml, escapeJsString, formatDisplayDate, formatHours, openBackdropModal, closeBackdropModal } from './ui.js';

export async function loadTutorDashboard() {
  const empId = state.currentEmployeeId || (state.currentUser ? state.currentUser.id : null);
  if (!empId) return;

  try {
    const res = await apiCall(`/api/tutors/${empId}/dashboard`);
    if (res.status === "ok") {
      state.tutorDashboardData = res;
      renderTutorHero(res.tutor, res.metrics, res.contracts);
      renderTutorAssignedCourses(res.assigned_courses);
      renderTutorContracts(res.contracts);
    }
  } catch (err) {
    console.error("Errore caricamento tutor dashboard:", err);
  }
}

export function renderTutorHero(tutor, metrics, contracts) {
  if (!tutor) return;

  const heroAvatar = document.getElementById("tutorHeroAvatar");
  const heroName = document.getElementById("tutorHeroName");
  const heroRoleBadge = document.getElementById("tutorHeroRoleBadge");
  const heroEmail = document.getElementById("tutorHeroEmail");
  const heroContractBadge = document.getElementById("tutorHeroContractBadge");
  const heroWeeklyHours = document.getElementById("tutorHeroWeeklyHours");
  const heroCoursesCount = document.getElementById("tutorHeroCoursesCount");
  const heroBankBalance = document.getElementById("tutorHeroBankBalance");

  if (heroAvatar) heroAvatar.textContent = (tutor.name || "T").substring(0, 2).toUpperCase();
  if (heroName) heroName.textContent = tutor.name || "Tutor";
  if (heroEmail) heroEmail.textContent = tutor.email || "Nessuna email registrata";

  if (heroRoleBadge) {
    heroRoleBadge.className = tutor.role === "admin" ? "user-role-pill role-admin" : "user-role-pill role-tutor";
    heroRoleBadge.textContent = tutor.role === "admin" ? "👑 Admin & Tutor" : "🎓 Tutor d'aula";
  }

  const activeContracts = (contracts || []).filter(c => c.status === "Attivo");
  if (heroContractBadge) {
    heroContractBadge.textContent = `${activeContracts.length} Contratti Attivi`;
  }

  if (heroWeeklyHours) {
    const totWeekly = metrics ? metrics.tot_contracted_weekly_hours : 0;
    heroWeeklyHours.textContent = `${totWeekly.toFixed(1)} h/sett`;
  }

  if (heroCoursesCount) {
    const cCount = metrics ? metrics.assigned_courses_count : 0;
    heroCoursesCount.textContent = `${cCount} ${cCount === 1 ? 'Corso' : 'Corsi'}`;
  }

  if (heroBankBalance) {
    const s = state.dashboardData && state.dashboardData.summary;
    const balance = (s && typeof s.ore_rimanenti === "number") ? s.ore_rimanenti : 0;
    heroBankBalance.textContent = `${balance >= 0 ? '+' : ''}${balance.toFixed(1)} h`;
    heroBankBalance.className = `tutor-stat-val ${balance >= 0 ? 'text-green' : 'text-yellow'}`;
  }
}

export function renderTutorAssignedCourses(courses) {
  const container = document.getElementById("tutorAssignedCoursesContainer");
  if (!container) return;

  container.innerHTML = "";

  if (!courses || courses.length === 0) {
    container.innerHTML = `
      <div class="content-box text-center p-4">
        <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📚</div>
        <h4 class="font-bold">Nessun corso attualmente abbinato</h4>
        <p class="text-sm text-muted mt-1 max-w-lg mx-auto">
          Non sei ancora stato abbinato a nessun corso come tutor. Clicca sul pulsante qui sotto per visualizzare i corsi disponibili e abbinarti con un clic.
        </p>
        <button class="btn btn-purple font-bold mt-3" onclick="window.openAssignCourseModal()">
          🔗 + Scegli e Abbina un Corso
        </button>
      </div>
    `;
    return;
  }

  courses.forEach(c => {
    const item = document.createElement("div");
    item.className = "tutor-accordion-item";
    item.id = `tutorCourseItem-${c.id}`;

    const hasIntegration = !!c.integrates_with_contract;
    const sessions = c.sessions || [];
    const sessionsCount = sessions.length;

    item.innerHTML = `
      <div class="tutor-accordion-header" onclick="window.toggleCourseAccordion(${c.id})">
        <div class="d-flex items-center gap-2 flex-wrap">
          <span class="course-color-pill" style="background-color: ${c.color || '#2563EB'}; width: 14px; height: 14px; border-radius: 4px; display: inline-block;"></span>
          <strong style="font-size: 1.05rem; color: var(--navy);">${escapeHtml(c.name)}</strong>
          <span class="text-xs text-muted">(${escapeHtml(c.code || 'N/D')})</span>
          <span class="badge ${c.status === 'Attivo' ? 'badge-info' : 'badge-gray'}">${c.status}</span>
          ${hasIntegration ? '<span class="badge badge-success" style="font-size:11px;" title="Le ore d\'ufficio e da tutor si svolgono nelle stesse ore: calcolate senza duplicazioni">🔗 Integrato Ufficio</span>' : '<span class="badge badge-gray" style="font-size:11px;" title="Orario corso separato da quello d\'ufficio: controllo rigoroso sovrapposizioni">⚖️ Non Integrato</span>'}
        </div>

        <div class="d-flex items-center gap-3">
          <div class="text-right d-none d-sm-block">
            <div style="font-size: 0.85rem; font-weight: 700;">
              ${c.hours_worked.toFixed(1)} / ${c.total_allocated_hours.toFixed(1)} h
            </div>
            <div class="text-xs text-muted">
              ${c.progress_pct}% svolto &bull; ${sessionsCount} lezioni
            </div>
          </div>
          <span class="accordion-chevron" id="accordionChevron-${c.id}">▼</span>
        </div>
      </div>

      <div class="tutor-accordion-body" id="tutorAccordionBody-${c.id}">
        <!-- Quick Course Metadata & Actions -->
        <div class="d-flex justify-between items-center flex-wrap gap-2 mb-3 pb-2" style="border-bottom: 1px solid var(--border-color);">
          <div>
            <span class="text-sm"><strong>👨‍🏫 Docente Referente:</strong> ${c.docente_referente ? escapeHtml(c.docente_referente) : 'Non assegnato'}</span>
            ${c.notes ? `<span class="text-sm text-muted ml-3"><em>${escapeHtml(c.notes)}</em></span>` : ''}
          </div>

          <div class="d-flex items-center gap-2 flex-wrap">
            <button class="btn btn-outline btn-sm font-bold" onclick="window.toggleCourseContractIntegration(${c.id})" title="Commuta integrazione con orario contrattuale d'ufficio">
              ${hasIntegration ? '🔗 Disintegra da Ore Ufficio' : '🔗 Integra con Ore Ufficio'}
            </button>
            <button class="btn btn-primary btn-sm font-bold" onclick="window.openAttendanceModal(${c.id})" title="Carica file Excel o CSV con le date e le ore di presenza già compilate">
              📂 Carica File Presenze
            </button>
            <button class="btn btn-outline btn-sm" onclick="window.openCourseDetail(${c.id})" title="Apri scheda dettagliata e archivio documenti">
              🔍 Scheda Completa Corso
            </button>
            <button class="btn btn-outline-danger btn-sm font-bold" onclick="window.handleUnassignCourseFromMe(${c.id})" title="Rimuovi il tuo abbinamento da questo corso">
              ❌ Rimuovi Abbinamento
            </button>
          </div>
        </div>

        <!-- Course Sessions Calendar Table -->
        <h5 class="font-bold text-sm mb-2" style="color: var(--navy);">📅 Calendario Lezioni, Moduli Didattici & Test di Fine Modulo</h5>
        
        ${sessionsCount === 0 ? `
          <div class="alert alert-info p-2 text-sm">
            Nessuna sessione o calendario inserito per questo corso. Puoi importare o generare il calendario dalla scheda completa del corso.
          </div>
        ` : `
          <div class="table-responsive">
            <table class="data-table data-table-sm" style="width: 100%; font-size: 0.85rem;">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Giorno</th>
                  <th>Orario</th>
                  <th class="text-right">Ore</th>
                  <th>Modulo / Argomento Didattico</th>
                  <th>Docente</th>
                  <th>Fase</th>
                  <th class="text-center">Test Finale Modulo</th>
                  <th class="text-center">Azione</th>
                </tr>
              </thead>
              <tbody>
                ${sessions.map(s => {
                  const isRegistered = Boolean(s.has_tutor_entry);
                  const regHours = s.tutor_entry_hours != null ? s.tutor_entry_hours : s.hours;
                  return `
                  <tr style="${s.is_module_test ? 'background-color: rgba(234, 179, 8, 0.08);' : ''}">
                    <td><strong>${formatDisplayDate(s.date)}</strong></td>
                    <td>${escapeHtml(s.day_of_week || '')}</td>
                    <td>${escapeHtml(s.start_time)} - ${escapeHtml(s.end_time)}</td>
                    <td class="text-right font-bold">${formatHours(s.hours)}</td>
                    <td><strong>${escapeHtml(s.modulo || 'Lezione d\'aula')}</strong></td>
                    <td>${escapeHtml(s.docente || '-')}</td>
                    <td><span class="badge ${s.phase === 'aula' ? 'badge-info' : 'badge-purple'}">${s.phase === 'aula' ? 'Aula' : 'Stage'}</span></td>
                    <td class="text-center">
                      ${s.is_module_test ? `
                        <span class="badge" style="background: #FEF3C7; color: #92400E; border: 1px solid #FDE68A; font-weight: 700; padding: 2px 8px;">
                          📝 Test Modulo
                        </span>
                      ` : '<span class="text-muted text-xs">&mdash;</span>'}
                    </td>
                    <td class="text-center">
                      ${isRegistered ? `
                        <button class="btn btn-success btn-xs font-bold" onclick="window.openDailyPresenceModal(${c.id}, ${s.id})" title="Presenza già registrata (${regHours.toFixed(1)}h). Clicca per visualizzare o modificare">
                          ✔️ Presenza OK
                        </button>
                      ` : `
                        <button class="btn btn-outline-primary btn-xs font-bold" onclick="window.openDailyPresenceModal(${c.id}, ${s.id})" title="Registra la tua presenza per questa giornata">
                          ➕ Presenza
                        </button>
                      `}
                    </td>
                  </tr>
                `}).join('')}
              </tbody>
            </table>
          </div>
        `}
      </div>
    `;

    container.appendChild(item);
  });
}

export function toggleCourseAccordion(courseId) {
  const body = document.getElementById(`tutorAccordionBody-${courseId}`);
  const chevron = document.getElementById(`accordionChevron-${courseId}`);
  if (!body) return;

  const isOpen = body.classList.contains("open");
  if (isOpen) {
    body.classList.remove("open");
    if (chevron) chevron.classList.remove("open");
  } else {
    body.classList.add("open");
    if (chevron) chevron.classList.add("open");
  }
}

export function renderTutorContracts(contracts) {
  const grid = document.getElementById("tutorContractsGrid");
  if (!grid) return;

  grid.innerHTML = "";

  if (!contracts || contracts.length === 0) {
    grid.innerHTML = `
      <div class="content-box text-center p-4" style="grid-column: 1/-1;">
        <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">📜</div>
        <h4 class="font-bold">Nessun contratto lavorativo registrato</h4>
        <p class="text-sm text-muted mt-1 max-w-lg mx-auto">
          Aggiungi i tuoi contratti in vigore per specificare la tipologia contrattuale (indeterminato, CO.CO.CO, ritenuta d'acconto, P.IVA, ecc.) e gli orari lavorativi d'ufficio stabiliti.
        </p>
        <button class="btn btn-primary font-bold mt-3" onclick="window.openContractModal()">
          ➕ Aggiungi Contratto Lavorativo
        </button>
      </div>
    `;
    return;
  }

  contracts.forEach(ct => {
    const card = document.createElement("div");
    card.className = "contract-card";
    card.id = `contractCard-${ct.id}`;

    const daysFormatted = (ct.work_days || "lun,mar,mer,gio,ven")
      .split(",")
      .map(d => {
        const map = { lun: "Lun", mar: "Mar", mer: "Mer", gio: "Gio", ven: "Ven", sab: "Sab", dom: "Dom" };
        return map[d.trim().toLowerCase()] || d;
      })
      .join(", ");

    const validityText = ct.end_date 
      ? `Dal ${formatDisplayDate(ct.start_date || '')} al ${formatDisplayDate(ct.end_date)}`
      : (ct.start_date ? `Dal ${formatDisplayDate(ct.start_date)} (A tempo indeterminato)` : "A tempo indeterminato (senza scadenza)");

    const statusBadgeClass = ct.status === "Attivo" 
      ? "badge-success" 
      : (ct.status === "In rinnovo" ? "badge-warning" : (ct.status === "Rinnovato" ? "badge-info" : "badge-gray"));

    card.innerHTML = `
      <div class="contract-card-header">
        <div>
          <div class="d-flex items-center gap-2 flex-wrap mb-1">
            <span class="badge ${statusBadgeClass}">${ct.status}</span>
            <span class="badge badge-purple" style="font-weight: 700;">${escapeHtml(ct.contract_type)}</span>
            ${ct.contract_regime ? `<span class="badge badge-gray">${escapeHtml(ct.contract_regime)}</span>` : ''}
          </div>
          <h4 class="contract-card-title">${escapeHtml(ct.title)}</h4>
        </div>
      </div>

      <div class="contract-detail-row">
        <span class="contract-detail-lbl">🗓️ Validità:</span>
        <span>${escapeHtml(validityText)}</span>
      </div>

      ${ct.has_fixed_schedule ? `
        <div class="contract-detail-row">
          <span class="contract-detail-lbl">⏰ Orario Sede:</span>
          <span class="font-bold text-navy" style="font-size: 0.86rem;">
            ${escapeHtml(ct.schedule_summary_text || `${ct.work_start_time || '09:00'} - ${ct.work_end_time || '13:00'} (${daysFormatted})`)}
          </span>
        </div>
        ${(ct.lunch_break_start && ct.lunch_break_end) ? `
          <div class="contract-detail-row">
            <span class="contract-detail-lbl">🥪 Pausa Pranzo:</span>
            <span>${escapeHtml(ct.lunch_break_start)} - ${escapeHtml(ct.lunch_break_end)}</span>
          </div>
        ` : ''}
        <div class="contract-hours-badge">
          <span class="text-sm font-bold" style="color: var(--navy);">⏱️ Monte Ore Contrattuale:</span>
          <span><strong>${(ct.daily_hours || 3.6).toFixed(1)} h/giorno medio</strong> &bull; <strong style="color: var(--primary);">${(ct.weekly_hours || 18.0).toFixed(1)} h/sett</strong></span>
        </div>
      ` : `
        <div class="contract-detail-row">
          <span class="contract-detail-lbl">⏰ Orario Lavorativo:</span>
          <span class="text-muted font-bold" style="color: #7C3AED;">
            🤝 Flessibile / A progetto (senza orario fisso prestabilito)
          </span>
        </div>
        <div class="contract-hours-badge" style="background: rgba(124, 58, 237, 0.05); border: 1px dashed #C4B5FD;">
          <span class="text-sm font-bold" style="color: var(--navy);">⏱️ Gestione Ore:</span>
          <span class="badge badge-purple font-bold">Flessibile &bull; Ore a consuntivo (opzionali)</span>
        </div>
      `}

      ${ct.renewal_notes ? `
        <div class="contract-renewal-box">
          <strong>🔄 Rinnovo / Variazione:</strong> ${escapeHtml(ct.renewal_notes)}
        </div>
      ` : ''}

      ${ct.notes ? `
        <p class="text-xs text-muted mt-1" style="font-style: italic;">
          ${escapeHtml(ct.notes)}
        </p>
      ` : ''}

      <div class="contract-card-footer">
        <button class="btn btn-outline btn-sm font-bold" onclick="window.editContractById(${ct.id})" title="Modifica condizioni o orari del contratto">
          ✏️ Modifica
        </button>
        <button class="btn btn-outline btn-sm font-bold" onclick="window.openRenewContractModal(${ct.id})" title="Registra rinnovo o proroga contratto">
          🔄 Rinnova / Proroga
        </button>
        <button class="btn btn-outline-danger btn-sm font-bold" onclick="window.handleDeleteContract(${ct.id})" title="Elimina questo contratto">
          🗑️ Elimina
        </button>
      </div>
    `;

    grid.appendChild(card);
  });
}

export async function openAssignCourseModal() {
  const modal = document.getElementById("modalAssignCourseBackdrop");
  const listContainer = document.getElementById("availableCoursesList");
  if (!modal || !listContainer) return;

  listContainer.innerHTML = '<div class="p-3 text-center text-muted">Caricamento corsi disponibili...</div>';
  openBackdropModal(modal);

  try {
    const res = await apiCall(`/api/courses?employee_id=all`);
    const allCourses = res.courses || [];
    const myId = state.currentEmployeeId || (state.currentUser ? state.currentUser.id : null);

    // Available courses: unassigned or belonging to someone else
    const available = allCourses.filter(c => c.employee_id !== myId);

    if (available.length === 0) {
      listContainer.innerHTML = `
        <div class="p-3 text-center text-muted">
          Tutti i corsi registrati nel sistema sono già abbinati al tuo profilo!
        </div>
      `;
      return;
    }

    listContainer.innerHTML = "";
    available.forEach(c => {
      const row = document.createElement("div");
      row.className = "d-flex justify-between items-center p-3";
      row.style.background = "var(--bg-card)";
      row.style.border = "1px solid var(--border-color)";
      row.style.borderRadius = "var(--radius-sm)";

      const hasTutor = !!c.employee_id;
      const tutorLabel = hasTutor ? `Assegnato a ${escapeHtml(c.tutor_name || 'Altro Tutor')}` : `🟡 Nessun tutor (Da abbinare)`;

      row.innerHTML = `
        <div class="d-flex items-center gap-2">
          <span class="course-color-pill" style="background-color: ${c.color || '#2563EB'}; width: 12px; height: 12px; border-radius: 3px;"></span>
          <div>
            <strong style="color: var(--navy); display: block;">${escapeHtml(c.name)}</strong>
            <span class="text-xs text-muted">${escapeHtml(c.code || 'N/D')} &bull; Monte Ore: ${c.total_allocated_hours}h &bull; <span class="${hasTutor ? 'text-muted' : 'text-amber font-bold'}">${tutorLabel}</span></span>
          </div>
        </div>

        <button class="btn btn-purple btn-sm font-bold" onclick="window.handleAssignCourseToMe(${c.id})">
          🔗 Abbina a Me
        </button>
      `;

      listContainer.appendChild(row);
    });
  } catch (err) {
    listContainer.innerHTML = `<div class="p-3 text-center text-red">Errore nel caricamento dei corsi: ${escapeHtml(err.message)}</div>`;
  }
}

export function closeAssignCourseModal() {
  const modal = document.getElementById("modalAssignCourseBackdrop");
  if (modal) closeBackdropModal(modal);
}

export async function handleAssignCourseToMe(courseId) {
  const myId = state.currentEmployeeId || (state.currentUser ? state.currentUser.id : null);
  if (!myId) return;

  try {
    const res = await apiCall(`/api/courses/${courseId}/assign-tutor`, "POST", { employee_id: myId });
    if (res.status === "ok") {
      showToast("Corso abbinato con successo al tuo profilo tutor!", "success");
      closeAssignCourseModal();
      await loadTutorDashboard();
      // Also refresh courses grid and master schedule
      if (state.courses) {
        const found = state.courses.find(c => c.id === courseId);
        if (found) found.employee_id = myId;
      }
    }
  } catch (err) {
    showToast(err.message || "Errore durante l'abbinamento del corso", "error");
  }
}

export async function handleUnassignCourseFromMe(courseId) {
  if (!confirm("Sei sicuro di voler rimuovere il tuo abbinamento da questo corso? Il corso rimarrà nel gestionale come 'Da abbinare'.")) return;

  try {
    const res = await apiCall(`/api/courses/${courseId}/assign-tutor`, "POST", { employee_id: null });
    if (res.status === "ok") {
      showToast("Abbinamento al corso rimosso.", "info");
      await loadTutorDashboard();
    }
  } catch (err) {
    showToast(err.message || "Errore durante la rimozione dell'abbinamento", "error");
  }
}

const WEEKDAYS = [
  { code: "lun", label: "Lunedì", defaultStart: "09:00", defaultEnd: "13:00" },
  { code: "mar", label: "Martedì", defaultStart: "09:00", defaultEnd: "13:00" },
  { code: "mer", label: "Mercoledì", defaultStart: "09:00", defaultEnd: "13:00" },
  { code: "gio", label: "Giovedì", defaultStart: "09:00", defaultEnd: "13:00" },
  { code: "ven", label: "Venerdì", defaultStart: "09:00", defaultEnd: "11:00" },
  { code: "sab", label: "Sabato", defaultStart: "09:00", defaultEnd: "13:00" }
];

function calcDayNetHours(start, end, lunchStart, lunchEnd) {
  if (!start || !end || !start.includes(":") || !end.includes(":")) return 0.0;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const gross = (eh * 60 + em) - (sh * 60 + sm);
  if (gross <= 0) return 0.0;
  let lunch = 0;
  if (lunchStart && lunchEnd && lunchStart.includes(":") && lunchEnd.includes(":")) {
    const [lsh, lsm] = lunchStart.split(":").map(Number);
    const [leh, lem] = lunchEnd.split(":").map(Number);
    const lm = (leh * 60 + lem) - (lsh * 60 + lsm);
    if (lm > 0) lunch = lm;
  }
  return Math.max(0, Math.round(((gross - lunch) / 60.0) * 100) / 100);
}

export function renderContractDayScheduleRows(schedDetails = null) {
  const tbody = document.getElementById("contractScheduleDaysTbody");
  if (!tbody) return;

  const defaultDetails = {
    lun: { active: true, start: "09:00", end: "13:00", lunch_start: "", lunch_end: "" },
    mar: { active: true, start: "09:00", end: "13:00", lunch_start: "", lunch_end: "" },
    mer: { active: true, start: "09:00", end: "13:00", lunch_start: "", lunch_end: "" },
    gio: { active: true, start: "09:00", end: "13:00", lunch_start: "", lunch_end: "" },
    ven: { active: true, start: "09:00", end: "11:00", lunch_start: "", lunch_end: "" },
    sab: { active: false, start: "09:00", end: "13:00", lunch_start: "", lunch_end: "" }
  };

  const details = schedDetails || defaultDetails;

  tbody.innerHTML = WEEKDAYS.map(day => {
    const d = details[day.code] || {
      active: day.code !== "sab",
      start: day.defaultStart,
      end: day.defaultEnd,
      lunch_start: "",
      lunch_end: ""
    };
    const active = !!d.active;
    const start = d.start || day.defaultStart;
    const end = d.end || day.defaultEnd;
    const lStart = d.lunch_start || "";
    const lEnd = d.lunch_end || "";
    const hours = active ? calcDayNetHours(start, end, lStart, lEnd) : 0.0;

    return `
      <tr class="contract-day-row ${active ? '' : 'day-disabled'}" data-day="${day.code}">
        <td style="padding: 7px 10px;">
          <label class="checkbox-label font-bold" style="cursor: pointer; display: flex; align-items: center; gap: 0.35rem; margin-bottom: 0;">
            <input type="checkbox" class="contract-day-active-chk" data-day="${day.code}" ${active ? 'checked' : ''}>
            <span>${day.label}</span>
          </label>
        </td>
        <td style="padding: 7px 8px;">
          <input type="time" class="time-input-sm contract-day-start" data-day="${day.code}" value="${start}" ${active ? '' : 'disabled'}>
        </td>
        <td style="padding: 7px 8px;">
          <input type="time" class="time-input-sm contract-day-end" data-day="${day.code}" value="${end}" ${active ? '' : 'disabled'}>
        </td>
        <td style="padding: 7px 8px;">
          <div class="d-flex items-center gap-1">
            <input type="time" class="time-input-sm contract-day-lstart" data-day="${day.code}" placeholder="--:--" value="${lStart}" ${active ? '' : 'disabled'} title="Inizio pausa pranzo (opzionale)">
            <span class="text-muted text-xs">&ndash;</span>
            <input type="time" class="time-input-sm contract-day-lend" data-day="${day.code}" placeholder="--:--" value="${lEnd}" ${active ? '' : 'disabled'} title="Fine pausa pranzo (opzionale)">
          </div>
        </td>
        <td style="padding: 7px 10px; text-align: right;">
          <span class="badge ${active ? 'badge-purple' : 'badge-gray'} font-bold contract-day-hours-badge" data-day="${day.code}">
            ${active ? `${hours.toFixed(1)}h` : '—'}
          </span>
        </td>
      </tr>
    `;
  }).join("");

  attachContractDayEventListeners();
  updateContractLiveHours();
}

function attachContractDayEventListeners() {
  const tbody = document.getElementById("contractScheduleDaysTbody");
  if (!tbody) return;

  tbody.querySelectorAll(".contract-day-active-chk").forEach(chk => {
    chk.addEventListener("change", (e) => {
      const code = e.target.dataset.day;
      const row = tbody.querySelector(`.contract-day-row[data-day="${code}"]`);
      if (row) {
        const isChecked = e.target.checked;
        if (isChecked) {
          row.classList.remove("day-disabled");
        } else {
          row.classList.add("day-disabled");
        }
        row.querySelectorAll("input[type='time']").forEach(inp => {
          inp.disabled = !isChecked;
        });
      }
      updateContractLiveHours();
    });
  });

  tbody.querySelectorAll("input[type='time']").forEach(inp => {
    inp.addEventListener("input", updateContractLiveHours);
  });
}

export function openContractModal(contract = null) {
  const modal = document.getElementById("modalContractBackdrop");
  const form = document.getElementById("formContract");
  const titleEl = document.getElementById("modalContractTitle");
  if (!modal || !form) return;

  form.reset();

  const contractIdEl = document.getElementById("contractId");
  const titleInput = document.getElementById("contractTitle");
  const typeSelect = document.getElementById("contractType");
  const regimeInput = document.getElementById("contractRegime");
  const startInput = document.getElementById("contractStartDate");
  const endInput = document.getElementById("contractEndDate");
  const noEndDateChk = document.getElementById("contractNoEndDate");
  const statusSelect = document.getElementById("contractStatus");
  const hasFixedChk = document.getElementById("contractHasFixedSchedule");
  const renewalNotesInput = document.getElementById("contractRenewalNotes");
  const notesInput = document.getElementById("contractNotes");

  if (contract) {
    if (titleEl) titleEl.textContent = "✏️ Modifica Contratto Lavorativo";
    if (contractIdEl) contractIdEl.value = contract.id;
    if (titleInput) titleInput.value = contract.title || "";
    if (typeSelect) typeSelect.value = contract.contract_type || "Indeterminato";
    if (regimeInput) regimeInput.value = contract.contract_regime || "";
    if (startInput) startInput.value = contract.start_date || "";
    if (endInput) {
      endInput.value = contract.end_date || "";
      endInput.disabled = !contract.end_date;
    }
    if (noEndDateChk) noEndDateChk.checked = !contract.end_date;
    if (statusSelect) statusSelect.value = contract.status || "Attivo";
    if (renewalNotesInput) renewalNotesInput.value = contract.renewal_notes || "";
    if (notesInput) notesInput.value = contract.notes || "";

    const hasFixed = contract.has_fixed_schedule !== false && contract.has_fixed_schedule !== 0;
    if (hasFixedChk) hasFixedChk.checked = hasFixed;

    renderContractDayScheduleRows(contract.schedule_details);
  } else {
    if (titleEl) titleEl.textContent = "➕ Aggiungi Nuovo Contratto Lavorativo";
    if (contractIdEl) contractIdEl.value = "";
    if (titleInput) titleInput.value = "Contratto Lavorativo";
    if (typeSelect) typeSelect.value = "Indeterminato";
    if (regimeInput) regimeInput.value = "Ritenuta d'Acconto";
    if (noEndDateChk) noEndDateChk.checked = true;
    if (endInput) {
      endInput.value = "";
      endInput.disabled = true;
    }
    if (statusSelect) statusSelect.value = "Attivo";
    if (hasFixedChk) hasFixedChk.checked = true;

    renderContractDayScheduleRows(null);
  }

  updateContractLiveHours();
  openBackdropModal(modal);
}

export function closeContractModal() {
  const modal = document.getElementById("modalContractBackdrop");
  if (modal) closeBackdropModal(modal);
}

export function updateContractLiveHours() {
  const hasFixedChk = document.getElementById("contractHasFixedSchedule");
  const hasFixed = hasFixedChk ? hasFixedChk.checked : true;
  const schedContainer = document.getElementById("contractScheduleDaysContainer");
  const flexibleNotice = document.getElementById("contractFlexibleNotice");

  if (schedContainer && flexibleNotice) {
    if (hasFixed) {
      schedContainer.style.display = "block";
      flexibleNotice.style.display = "none";
    } else {
      schedContainer.style.display = "none";
      flexibleNotice.style.display = "block";
    }
  }

  const liveText = document.getElementById("contractLiveWeeklyTotalText");
  const breakdown = document.getElementById("contractLiveScheduleBreakdown");

  if (!hasFixed) {
    if (liveText) liveText.textContent = "0.0 h / Flessibile";
    if (breakdown) breakdown.textContent = "Ore opzionali / a consuntivo (nessun orario fisso da contratto)";
    return;
  }

  const tbody = document.getElementById("contractScheduleDaysTbody");
  if (!tbody) return;

  let totalWeekly = 0.0;
  const parts = [];

  WEEKDAYS.forEach(day => {
    const row = tbody.querySelector(`.contract-day-row[data-day="${day.code}"]`);
    if (!row) return;

    const chk = row.querySelector(".contract-day-active-chk");
    const active = chk ? chk.checked : false;
    const start = row.querySelector(".contract-day-start")?.value || "09:00";
    const end = row.querySelector(".contract-day-end")?.value || "13:00";
    const lStart = row.querySelector(".contract-day-lstart")?.value || "";
    const lEnd = row.querySelector(".contract-day-lend")?.value || "";
    const badge = row.querySelector(".contract-day-hours-badge");

    if (active) {
      const h = calcDayNetHours(start, end, lStart, lEnd);
      totalWeekly += h;
      if (badge) {
        badge.className = "badge badge-purple font-bold contract-day-hours-badge";
        badge.textContent = `${h.toFixed(1)}h`;
      }
      parts.push(`${day.label.slice(0, 3)} ${start}-${end} (${h.toFixed(1)}h)`);
    } else {
      if (badge) {
        badge.className = "badge badge-gray font-bold contract-day-hours-badge";
        badge.textContent = "—";
      }
    }
  });

  if (liveText) {
    liveText.textContent = `${totalWeekly.toFixed(1)} h / settimana`;
  }
  if (breakdown) {
    breakdown.textContent = parts.length > 0 ? parts.join(" • ") : "Nessuna giornata attiva selezionata";
  }
}

export async function handleSaveContract(e) {
  if (e) e.preventDefault();

  const empId = state.currentEmployeeId || (state.currentUser ? state.currentUser.id : null);
  if (!empId) return;

  const contractId = document.getElementById("contractId")?.value;
  const title = document.getElementById("contractTitle")?.value.trim();
  const contract_type = document.getElementById("contractType")?.value;
  const contract_regime = document.getElementById("contractRegime")?.value.trim();
  const start_date = document.getElementById("contractStartDate")?.value || null;
  const noEndDate = document.getElementById("contractNoEndDate")?.checked;
  const end_date = noEndDate ? null : (document.getElementById("contractEndDate")?.value || null);
  const status = document.getElementById("contractStatus")?.value || "Attivo";
  const renewal_notes = document.getElementById("contractRenewalNotes")?.value.trim();
  const notes = document.getElementById("contractNotes")?.value.trim();

  const hasFixedChk = document.getElementById("contractHasFixedSchedule");
  const has_fixed_schedule = hasFixedChk ? (hasFixedChk.checked ? 1 : 0) : 1;

  if (!title) {
    showToast("Inserisci un titolo per il contratto", "warning");
    return;
  }

  let schedule_details = {};
  let work_days = "";

  if (has_fixed_schedule === 1) {
    const tbody = document.getElementById("contractScheduleDaysTbody");
    const activeCodes = [];
    if (tbody) {
      WEEKDAYS.forEach(day => {
        const row = tbody.querySelector(`.contract-day-row[data-day="${day.code}"]`);
        if (!row) return;
        const active = row.querySelector(".contract-day-active-chk")?.checked || false;
        const start = row.querySelector(".contract-day-start")?.value || "09:00";
        const end = row.querySelector(".contract-day-end")?.value || "13:00";
        const lunch_start = row.querySelector(".contract-day-lstart")?.value || "";
        const lunch_end = row.querySelector(".contract-day-lend")?.value || "";
        const hours = active ? calcDayNetHours(start, end, lunch_start, lunch_end) : 0.0;

        if (active) activeCodes.push(day.code);

        schedule_details[day.code] = {
          code: day.code,
          label: day.label,
          active,
          start,
          end,
          lunch_start,
          lunch_end,
          hours
        };
      });
    }
    work_days = activeCodes.join(",");
  }

  const payload = {
    title,
    contract_type,
    contract_regime,
    start_date,
    end_date,
    status,
    has_fixed_schedule,
    work_days,
    schedule_details,
    renewal_notes,
    notes
  };

  try {
    if (contractId) {
      await apiCall(`/api/contracts/${contractId}`, "PUT", payload);
      showToast("Contratto lavorativo aggiornato con successo!", "success");
    } else {
      await apiCall(`/api/employees/${empId}/contracts`, "POST", payload);
      showToast("Nuovo contratto lavorativo creato con successo!", "success");
    }
    closeContractModal();
    await loadTutorDashboard();
    if (typeof window.loadMasterSchedule === "function") {
      await window.loadMasterSchedule();
    }
  } catch (err) {
    showToast(err.message || "Errore nel salvataggio del contratto", "error");
  }
}

export async function handleDeleteContract(contractId) {
  if (!confirm("Sei sicuro di voler eliminare questo contratto lavorativo?")) return;

  try {
    await apiCall(`/api/contracts/${contractId}`, "DELETE");
    showToast("Contratto eliminato con successo.", "info");
    await loadTutorDashboard();
  } catch (err) {
    showToast(err.message || "Errore durante l'eliminazione del contratto", "error");
  }
}

export function openRenewContractModal(contractId) {
  const contracts = state.tutorDashboardData?.contracts || [];
  const ct = contracts.find(c => c.id === contractId);
  if (!ct) return;

  openContractModal(ct);

  const statusSelect = document.getElementById("contractStatus");
  const renewalNotesInput = document.getElementById("contractRenewalNotes");
  if (statusSelect) statusSelect.value = "In rinnovo";
  if (renewalNotesInput) {
    if (!renewalNotesInput.value) {
      renewalNotesInput.value = `Rinnovo contrattuale registrato il ${new Date().toLocaleDateString('it-IT')}`;
    }
    renewalNotesInput.focus();
  }
}

export function initTutorDashboardEvents() {
  const btnOpenAssign = document.getElementById("btnOpenAssignCourseModal");
  if (btnOpenAssign) btnOpenAssign.addEventListener("click", openAssignCourseModal);

  const btnCloseAssign = document.getElementById("btnCloseAssignCourseModal");
  if (btnCloseAssign) btnCloseAssign.addEventListener("click", closeAssignCourseModal);

  const btnCancelAssign = document.getElementById("btnCancelAssignCourseModal");
  if (btnCancelAssign) btnCancelAssign.addEventListener("click", closeAssignCourseModal);

  const btnOpenAddContract = document.getElementById("btnOpenAddContractModal");
  if (btnOpenAddContract) btnOpenAddContract.addEventListener("click", () => openContractModal(null));

  const btnCloseContract = document.getElementById("btnCloseContractModal");
  if (btnCloseContract) btnCloseContract.addEventListener("click", closeContractModal);

  const btnCancelContract = document.getElementById("btnCancelContractModal");
  if (btnCancelContract) btnCancelContract.addEventListener("click", closeContractModal);

  const formContract = document.getElementById("formContract");
  if (formContract) formContract.addEventListener("submit", handleSaveContract);

  const noEndDateChk = document.getElementById("contractNoEndDate");
  const endInput = document.getElementById("contractEndDate");
  if (noEndDateChk && endInput) {
    noEndDateChk.addEventListener("change", () => {
      endInput.disabled = noEndDateChk.checked;
      if (noEndDateChk.checked) endInput.value = "";
    });
  }

  // Fixed schedule vs flexible toggle
  const hasFixedChk = document.getElementById("contractHasFixedSchedule");
  if (hasFixedChk) {
    hasFixedChk.addEventListener("change", updateContractLiveHours);
  }

  // Contract type smart auto-toggle (CO.CO.CO / P.IVA -> flexible)
  const contractTypeSel = document.getElementById("contractType");
  if (contractTypeSel) {
    contractTypeSel.addEventListener("change", (e) => {
      const isFlexibleType = ["CO.CO.CO", "Partita IVA", "Collaborazione"].includes(e.target.value);
      if (hasFixedChk) {
        hasFixedChk.checked = !isFlexibleType;
        updateContractLiveHours();
      }
    });
  }

  // Preset button: Standard 09:00 - 13:00
  const btnPreset = document.getElementById("btnApplyPresetStandardHours");
  if (btnPreset) {
    btnPreset.addEventListener("click", () => {
      renderContractDayScheduleRows({
        lun: { active: true, start: "09:00", end: "13:00", lunch_start: "", lunch_end: "" },
        mar: { active: true, start: "09:00", end: "13:00", lunch_start: "", lunch_end: "" },
        mer: { active: true, start: "09:00", end: "13:00", lunch_start: "", lunch_end: "" },
        gio: { active: true, start: "09:00", end: "13:00", lunch_start: "", lunch_end: "" },
        ven: { active: true, start: "09:00", end: "13:00", lunch_start: "", lunch_end: "" },
        sab: { active: false, start: "09:00", end: "13:00", lunch_start: "", lunch_end: "" }
      });
      showToast("Orario standard 09:00 - 13:00 (Lun-Ven) applicato", "info");
    });
  }

  // Switch to contracts subtab button
  const btnGoToContracts = document.getElementById("btnGoToContracts");
  if (btnGoToContracts) {
    btnGoToContracts.addEventListener("click", () => {
      const contractSubtab = document.querySelector('[data-subpane="subpane-contracts"]');
      if (contractSubtab) contractSubtab.click();
    });
  }

  // Top nav contracts button
  const btnTopNav = document.getElementById("btnNavOpenContractSchedule");
  if (btnTopNav) {
    btnTopNav.addEventListener("click", () => {
      const timeTab = document.querySelector('[data-tab="tab-timetracking"]');
      if (timeTab) timeTab.click();
      const contractSubtab = document.querySelector('[data-subpane="subpane-contracts"]');
      if (contractSubtab) contractSubtab.click();
    });
  }

  // Daily Presence Modal Event Handlers
  const btnCloseDaily = document.getElementById("btnCloseDailyPresenceModal");
  if (btnCloseDaily) btnCloseDaily.addEventListener("click", closeDailyPresenceModal);

  const btnCancelDaily = document.getElementById("btnCancelDailyPresence");
  if (btnCancelDaily) btnCancelDaily.addEventListener("click", closeDailyPresenceModal);

  const btnSaveDaily = document.getElementById("btnSaveDailyPresence");
  if (btnSaveDaily) btnSaveDaily.addEventListener("click", saveDailyPresence);

  const btnDelDaily = document.getElementById("btnDeleteDailyPresence");
  if (btnDelDaily) btnDelDaily.addEventListener("click", deleteDailyPresence);

  const startInp = document.getElementById("dailyPresActualStart");
  if (startInp) startInp.addEventListener("input", () => updateDailyPresenceCalculatedHours());

  const endInp = document.getElementById("dailyPresActualEnd");
  if (endInp) endInp.addEventListener("input", () => updateDailyPresenceCalculatedHours());

  const btnDownloadTpl = document.getElementById("btnDownloadAttendanceTemplate");
  if (btnDownloadTpl) btnDownloadTpl.addEventListener("click", () => downloadCourseAttendanceTemplate());
}

// =============================================================
// DAILY SESSION PRESENCE MODAL & ACTIONS
// =============================================================

function timeStrToMinutes(t) {
  if (!t || typeof t !== "string" || !t.includes(":")) return 0;
  const [h, m] = t.split(":").map(x => parseInt(x, 10));
  return (isNaN(h) ? 0 : h * 60) + (isNaN(m) ? 0 : m);
}

export function openDailyPresenceModal(courseId, sessionId) {
  const assigned = (state.tutorDashboardData && state.tutorDashboardData.assigned_courses) || [];
  const course = assigned.find(c => c.id === courseId) || (state.courses || []).find(c => c.id === courseId);
  if (!course) {
    showToast("Corso non trovato", "warning");
    return;
  }

  const session = (course.sessions || []).find(s => s.id === sessionId);
  if (!session) {
    showToast("Sessione del corso non trovata", "warning");
    return;
  }

  const isEdit = Boolean(session.has_tutor_entry);

  // Hidden tracking fields
  const courseIdInput = document.getElementById("dailyPresCourseId");
  const sessionIdInput = document.getElementById("dailyPresSessionId");
  const entryIdInput = document.getElementById("dailyPresEntryId");
  const dateInput = document.getElementById("dailyPresDate");

  if (courseIdInput) courseIdInput.value = course.id;
  if (sessionIdInput) sessionIdInput.value = session.id;
  if (entryIdInput) entryIdInput.value = session.tutor_entry_id || "";
  if (dateInput) dateInput.value = session.date;

  // Header & Info
  const title = document.getElementById("dailyPresTitle");
  const icon = document.getElementById("dailyPresIcon");
  const badgeCourse = document.getElementById("dailyPresCourseBadge");
  const badgePhase = document.getElementById("dailyPresPhaseBadge");
  const dateDisplay = document.getElementById("dailyPresDateDisplay");
  const moduloDisplay = document.getElementById("dailyPresModulo");
  const docenteDisplay = document.getElementById("dailyPresDocente");
  const schedTime = document.getElementById("dailyPresSchedTime");
  const schedHours = document.getElementById("dailyPresSchedHours");
  const existingAlert = document.getElementById("dailyPresExistingAlert");
  const btnDelete = document.getElementById("btnDeleteDailyPresence");
  const btnSave = document.getElementById("btnSaveDailyPresence");

  if (title) title.textContent = isEdit ? "✔️ Presenza Lezione (Registrata)" : "📋 Registra Presenza Giornaliera";
  if (icon) icon.textContent = isEdit ? "✔️" : "📋";
  if (badgeCourse) badgeCourse.textContent = `${course.code ? '[' + course.code + '] ' : ''}${course.name}`;
  if (badgePhase) {
    badgePhase.textContent = session.phase === "aula" ? "Aula" : "Stage";
    badgePhase.className = session.phase === "aula" ? "badge badge-info" : "badge badge-purple";
  }
  if (dateDisplay) dateDisplay.textContent = `${formatDisplayDate(session.date)} (${session.day_of_week || ''})`;
  if (moduloDisplay) moduloDisplay.textContent = session.modulo || "Lezione d'aula";
  if (docenteDisplay) docenteDisplay.textContent = session.docente ? session.docente : "— Non specificato —";
  if (schedTime) schedTime.textContent = `${session.start_time} - ${session.end_time}`;
  if (schedHours) schedHours.textContent = session.hours;

  if (existingAlert) existingAlert.style.display = isEdit ? "block" : "none";
  if (btnDelete) btnDelete.style.display = isEdit ? "inline-flex" : "none";

  // Time Inputs
  const startInput = document.getElementById("dailyPresActualStart");
  const endInput = document.getElementById("dailyPresActualEnd");
  const noteInput = document.getElementById("dailyPresNote");

  if (startInput) startInput.value = (isEdit && session.tutor_entry_start) ? session.tutor_entry_start : session.start_time;
  if (endInput) endInput.value = (isEdit && session.tutor_entry_end) ? session.tutor_entry_end : session.end_time;
  if (noteInput) noteInput.value = (isEdit && session.tutor_entry_note) ? session.tutor_entry_note : "";

  // Integration notice badge
  const integBadge = document.getElementById("dailyPresIntegrationBadge");
  if (integBadge) {
    integBadge.innerHTML = course.integrates_with_contract
      ? `<span class="badge badge-success text-xs" title="Lavoro integrato con ore da contratto: conteggio senza duplicazioni">🔗 Integrato Ufficio</span>`
      : `<span class="badge badge-gray text-xs" title="Orario separato da ufficio">⚖️ Non Integrato</span>`;
  }

  updateDailyPresenceCalculatedHours(isEdit);
  openBackdropModal("modalDailyPresenceBackdrop");
}

export function closeDailyPresenceModal() {
  closeBackdropModal("modalDailyPresenceBackdrop");
}

function updateDailyPresenceCalculatedHours(isEditMode = false) {
  const startInput = document.getElementById("dailyPresActualStart");
  const endInput = document.getElementById("dailyPresActualEnd");
  const calcDisplay = document.getElementById("dailyPresCalculatedHours");
  const btnSave = document.getElementById("btnSaveDailyPresence");

  const startMins = timeStrToMinutes(startInput ? startInput.value : "09:00");
  const endMins = timeStrToMinutes(endInput ? endInput.value : "13:00");
  const diffMins = Math.max(0, endMins - startMins);
  const hours = Math.round((diffMins / 60) * 10) / 10;

  if (calcDisplay) calcDisplay.textContent = `${hours.toFixed(1)} h`;
  if (btnSave) {
    const isEdit = isEditMode || (document.getElementById("dailyPresEntryId") && document.getElementById("dailyPresEntryId").value !== "");
    btnSave.textContent = isEdit ? `💾 Salva Modifiche (${hours.toFixed(1)}h)` : `✅ Conferma Presenza (${hours.toFixed(1)}h)`;
  }
}

export async function saveDailyPresence() {
  const courseId = parseInt(document.getElementById("dailyPresCourseId")?.value || "0", 10);
  const sessionId = parseInt(document.getElementById("dailyPresSessionId")?.value || "0", 10);
  const entryId = document.getElementById("dailyPresEntryId")?.value;
  const dateStr = document.getElementById("dailyPresDate")?.value;
  const startVal = document.getElementById("dailyPresActualStart")?.value || "09:00";
  const endVal = document.getElementById("dailyPresActualEnd")?.value || "13:00";
  const noteVal = document.getElementById("dailyPresNote")?.value || "";

  if (!courseId || !dateStr) {
    showToast("Dati della lezione mancanti", "error");
    return;
  }

  const startMins = timeStrToMinutes(startVal);
  const endMins = timeStrToMinutes(endVal);
  if (endMins <= startMins) {
    showToast("L'ora di termine deve essere successiva all'ora di inizio", "warning");
    return;
  }
  const hours = Math.round(((endMins - startMins) / 60) * 10) / 10;

  const btnSave = document.getElementById("btnSaveDailyPresence");
  if (btnSave) {
    btnSave.disabled = true;
    btnSave.textContent = "⏳ Salvataggio...";
  }

  try {
    const empId = state.currentEmployeeId || (state.currentUser ? state.currentUser.id : 26);

    // If existing entry, update it
    if (entryId) {
      const res = await apiCall(`/api/entries/${entryId}`, "PUT", {
        employee_id: empId,
        course_id: courseId,
        date: dateStr,
        actual_start: startVal,
        actual_end: endVal,
        course_start: startVal,
        course_end: endVal,
        hours: hours,
        note: noteVal,
        type: "presenza_corso"
      });
      if (res.status === "ok") {
        showToast(`✔️ Presenza aggiornata con successo (${hours.toFixed(1)}h)!`, "success");
      } else {
        showToast(res.message || "Errore aggiornamento", "error");
      }
    } else {
      // New presence entry
      const assigned = (state.tutorDashboardData && state.tutorDashboardData.assigned_courses) || [];
      const course = assigned.find(c => c.id === courseId);
      const session = (course?.sessions || []).find(s => s.id === sessionId);

      const payload = {
        employee_id: empId,
        course_id: courseId,
        date: dateStr,
        scheduled_start: session?.start_time || startVal,
        scheduled_end: session?.end_time || endVal,
        actual_start: startVal,
        actual_end: endVal,
        course_start: startVal,
        course_end: endVal,
        scheduled_hours: session?.hours || hours,
        actual_hours: hours,
        hours: hours,
        activity_type: session?.phase === "stage" ? "Tutoraggio stage" : "Tutoraggio d'aula",
        causale: `Presenza: ${session?.modulo || 'Lezione corso'}`,
        note: noteVal || (session?.docente ? `Docente: ${session.docente}` : ""),
        type: "presenza_corso",
        is_integrated: course ? Boolean(course.integrates_with_contract) : false
      };

      const res = await apiCall("/api/entries", "POST", payload);
      if (res.status === "ok") {
        showToast(`🎉 Presenza registrata con successo per il ${formatDisplayDate(dateStr)} (${hours.toFixed(1)}h)!`, "success");
      } else {
        showToast(res.message || "Errore registrazione", "error");
      }
    }

    closeDailyPresenceModal();
    await loadTutorDashboard();
    if (window.loadMasterSchedule) await window.loadMasterSchedule();
  } catch (err) {
    showToast(err.message || "Errore durante la registrazione", "error");
  } finally {
    if (btnSave) btnSave.disabled = false;
  }
}

export async function deleteDailyPresence() {
  const entryId = document.getElementById("dailyPresEntryId")?.value;
  if (!entryId) {
    showToast("Nessuna presenza da eliminare", "warning");
    return;
  }

  if (!confirm("Sei sicuro di voler eliminare la registrazione di questa presenza dal tuo registro ore?")) {
    return;
  }

  const btnDelete = document.getElementById("btnDeleteDailyPresence");
  if (btnDelete) btnDelete.disabled = true;

  try {
    const res = await apiCall(`/api/entries/${entryId}`, "DELETE");
    if (res.status === "ok") {
      showToast("🗑️ Presenza rimossa dal registro ore!", "info");
      closeDailyPresenceModal();
      await loadTutorDashboard();
      if (window.loadMasterSchedule) await window.loadMasterSchedule();
    } else {
      showToast(res.message || "Errore eliminazione", "error");
    }
  } catch (err) {
    showToast(err.message || "Errore di connessione", "error");
  } finally {
    if (btnDelete) btnDelete.disabled = false;
  }
}

export function downloadCourseAttendanceTemplate(courseId = null) {
  let cid = courseId;
  if (!cid) {
    const assigned = (state.tutorDashboardData && state.tutorDashboardData.assigned_courses) || [];
    cid = assigned.length > 0 ? assigned[0].id : (state.selectedCourseDetailId || null);
  }
  if (!cid) {
    showToast("Seleziona prima un corso per scaricare il modello", "warning");
    return;
  }
  window.open(`/api/courses/${cid}/attendance-template`, "_blank");
}

window.openDailyPresenceModal = openDailyPresenceModal;
window.closeDailyPresenceModal = closeDailyPresenceModal;
window.saveDailyPresence = saveDailyPresence;
window.deleteDailyPresence = deleteDailyPresence;
window.downloadCourseAttendanceTemplate = downloadCourseAttendanceTemplate;

