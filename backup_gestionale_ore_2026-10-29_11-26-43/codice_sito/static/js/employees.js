/**
 * Team Management, Roles & 72-Hour Trash / Recovery Window
 */

import { state, elements } from './state.js';
import { apiCall } from './api.js';
import { showToast, escapeHtml, formatHours } from './ui.js';

export function renderEmployeesGrid() {
  if (!elements.employeesGrid) return;
  elements.employeesGrid.innerHTML = "";

  const currentUserId = state.currentUser ? state.currentUser.id : null;
  const adminCount = state.profiles.filter(p => p.role === "admin").length;

  state.profiles.forEach(emp => {
    const isCurrent = emp.id === state.currentEmployeeId;
    const isSelf = emp.id === currentUserId;
    const isOnlyAdmin = emp.role === "admin" && adminCount <= 1;
    const roleLbl = emp.role === "admin" ? (emp.is_tutor ? "👑 Admin + 🎓 Tutor" : "👑 Admin (Supervisore)") : "🎓 Tutor";

    const card = document.createElement("div");
    card.className = "employee-card";

    card.innerHTML = `
      <div class="employee-card-header">
        <div>
          <h3 style="margin: 0; font-size: 1.15rem;">${escapeHtml(emp.name)}</h3>
          <span class="text-muted text-xs d-block mb-1">${escapeHtml(emp.email || '')}</span>
          <span class="user-role-pill ${emp.role === 'admin' ? 'role-admin' : 'role-tutor'}">
            ${roleLbl}
          </span>
        </div>
        <span class="badge ${isCurrent ? 'badge-green' : 'badge-gray'}">
          ${isCurrent ? 'Profilo Attivo' : ''}
        </span>
      </div>

      <div class="employee-stats-list">
        <div class="employee-stat-row">
          <span class="text-muted">Banca Ore Iniziale:</span>
          <strong>${formatHours(emp.initial_bank_hours)} h</strong>
        </div>
        <div class="employee-stat-row">
          <span class="text-muted">Orario Contratto Ufficio:</span>
          <strong>${emp.contract_office_start || '09:00'} - ${emp.contract_office_end || '13:00'}</strong>
        </div>
        <div class="employee-stat-row">
          <span class="text-muted">Giorni Contratto:</span>
          <strong>${(emp.contract_office_days || 'lun,mar,mer,gio,ven').toUpperCase()}</strong>
        </div>
        <div class="employee-stat-row">
          <span class="text-muted">Ruolo Funzionale:</span>
          <strong class="${emp.is_tutor ? 'text-primary' : 'text-purple'}">${emp.is_tutor ? 'Abilitato a Tutoraggio' : 'Solo Amministrazione'}</strong>
        </div>
      </div>

      <div class="d-flex justify-between items-center gap-2 mt-auto pt-2 flex-wrap" style="border-top: 1px solid var(--border-color);">
        <div class="d-flex gap-1">
          <button class="btn btn-outline btn-sm" onclick="window.switchActiveUser(${emp.id})">
            ${isCurrent ? '✓ In Uso' : 'Visualizza Dati'}
          </button>
          <button class="btn btn-outline btn-sm font-bold" onclick="window.openContractScheduleModal(${emp.id})" title="Configura l'orario lavorativo da contratto d'ufficio">
            🏛️ Orario
          </button>
        </div>
        ${!isSelf && !isOnlyAdmin ? `
          <button class="btn btn-outline-danger btn-sm" onclick="window.handleSoftDeleteEmployee(${emp.id}, '${escapeHtml(emp.name)}')" title="Sposta nel Cestino (ripristinabile per 3 giorni)">
            🗑️ Elimina
          </button>
        ` : ''}
      </div>
    `;

    elements.employeesGrid.appendChild(card);
  });
}

export async function loadAdminHoursOverview() {
  try {
    const data = await apiCall("/api/admin/hours-overview");
    if (data.status === "ok") {
      const summary = data.data;
      const tutors = summary.tutors || [];
      const docenti = summary.docenti || [];

      let totalTutorHours = 0;
      tutors.forEach(t => { totalTutorHours += (t.total_actual_hours || 0); });
      let totalDocentiHours = 0;
      docenti.forEach(d => { totalDocentiHours += (d.total_hours || 0); });

      if (elements.kpiAdminTotalTutors) elements.kpiAdminTotalTutors.textContent = tutors.length;
      if (elements.kpiAdminTotalTutorHours) elements.kpiAdminTotalTutorHours.textContent = totalTutorHours.toFixed(1) + "h";
      if (elements.kpiAdminTotalDocenti) elements.kpiAdminTotalDocenti.textContent = docenti.length;
      if (elements.kpiAdminTotalDocentiHours) elements.kpiAdminTotalDocentiHours.textContent = totalDocentiHours.toFixed(1) + "h";
      if (elements.badgeCountTutors) elements.badgeCountTutors.textContent = `${tutors.length} tutor`;
      if (elements.badgeCountDocenti) elements.badgeCountDocenti.textContent = `${docenti.length} docenti`;

      // Render Tutors Table
      if (elements.tbodyAdminTutorsSummary) {
        if (tutors.length === 0) {
          elements.tbodyAdminTutorsSummary.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Nessun tutor registrato al momento.</td></tr>`;
        } else {
          elements.tbodyAdminTutorsSummary.innerHTML = tutors.map(t => {
            const coursesList = t.assigned_courses_list && t.assigned_courses_list.length > 0 
              ? t.assigned_courses_list.map(c => `<span class="badge mr-1">${escapeHtml(c)}</span>`).join(" ")
              : '<span class="text-muted text-xs">Nessun corso assegnato</span>';
            const saldoClass = t.saldo_banca_ore >= 0 ? "text-success font-bold" : "text-danger font-bold";

            return `
              <tr>
                <td><strong>${escapeHtml(t.name)}</strong></td>
                <td><span class="text-muted text-sm">${escapeHtml(t.email || '-')}</span></td>
                <td>${coursesList}</td>
                <td class="text-right font-bold">${t.total_actual_hours.toFixed(1)}h</td>
                <td class="text-right text-success">+${t.total_maturate.toFixed(1)}h</td>
                <td class="text-right text-warning">-${t.total_utilizzate.toFixed(1)}h</td>
                <td class="text-right ${saldoClass}">${t.saldo_banca_ore >= 0 ? '+' : ''}${t.saldo_banca_ore.toFixed(1)}h</td>
              </tr>
            `;
          }).join("");
        }
      }

      // Render Docenti Table
      if (elements.tbodyAdminDocentiSummary) {
        if (docenti.length === 0) {
          elements.tbodyAdminDocentiSummary.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">Nessun docente presente nei calendari dei corsi.</td></tr>`;
        } else {
          elements.tbodyAdminDocentiSummary.innerHTML = docenti.map(d => {
            const moduli = d.moduli_list && d.moduli_list.length > 0
              ? d.moduli_list.map(m => `<span class="badge mr-1">${escapeHtml(m)}</span>`).join(" ")
              : '<span class="text-muted text-xs">-</span>';
            const courses = d.courses_list && d.courses_list.length > 0
              ? d.courses_list.map(c => `<span class="badge badge-purple mr-1">${escapeHtml(c)}</span>`).join(" ")
              : '<span class="text-muted text-xs">-</span>';
            const rinvii = (d.lezioni_rinviate || 0) + (d.lezioni_annullate || 0);

            return `
              <tr>
                <td><strong>${escapeHtml(d.docente)}</strong></td>
                <td>${moduli}</td>
                <td>${courses}</td>
                <td class="text-right">${d.sessions_count}</td>
                <td class="text-right font-bold">${d.total_hours.toFixed(1)}h</td>
                <td class="text-right text-success">${d.ore_svolte.toFixed(1)}h</td>
                <td class="text-right text-primary">${d.ore_confermate.toFixed(1)}h</td>
                <td class="text-center">${rinvii > 0 ? `<span class="badge badge-warning">${rinvii} lezioni</span>` : '<span class="text-muted">0</span>'}</td>
              </tr>
            `;
          }).join("");
        }
      }
    }
  } catch (err) {
    console.error("Errore caricamento riepilogo ore admin:", err);
  }
}

export async function loadTrashEmployees() {
  try {
    const data = await apiCall("/api/employees/trash");
    if (data.status === "ok") {
      const trash = data.trash || [];
      if (elements.trashCountBadge) {
        elements.trashCountBadge.textContent = trash.length;
      }
      if (elements.tbodyTrashEmployees) {
        if (trash.length === 0) {
          elements.tbodyTrashEmployees.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Il cestino è vuoto. Nessun profilo eliminato.</td></tr>`;
        } else {
          elements.tbodyTrashEmployees.innerHTML = trash.map(item => {
            const roleLbl = item.role === 'admin' ? (item.is_tutor ? '👑 Admin + Tutor' : '👑 Admin') : '🎓 Tutor';
            const badgeClass = item.can_restore ? 'badge-success' : 'badge-danger';

            return `
              <tr>
                <td><strong>${escapeHtml(item.name)}</strong></td>
                <td><span class="text-muted text-sm">${escapeHtml(item.email || '-')}</span></td>
                <td><span class="user-role-pill ${item.role === 'admin' ? 'role-admin' : 'role-tutor'}">${roleLbl}</span></td>
                <td><small class="text-muted">${escapeHtml(item.deleted_at || '-')}</small></td>
                <td><span class="badge ${badgeClass}">⏱️ ${escapeHtml(item.time_remaining_str)}</span></td>
                <td class="text-center">
                  ${item.can_restore 
                    ? `<button class="btn btn-sm btn-success" onclick="window.handleRestoreEmployee(${item.id})">🔄 Ripristina</button>`
                    : `<button class="btn btn-sm btn-outline-danger" onclick="window.handlePermanentDeleteEmployee(${item.id})">❌ Elimina Definitivo</button>`
                  }
                </td>
              </tr>
            `;
          }).join("");
        }
      }
    }
  } catch (err) {
    console.error("Errore caricamento cestino:", err);
  }
}

export async function handleRestoreEmployee(id, onRestored) {
  try {
    const data = await apiCall(`/api/employees/${id}/restore`, "POST");
    if (data.status === "ok") {
      showToast("Profilo ripristinato con successo!", "success");
      await loadTrashEmployees();
      if (onRestored) await onRestored();
    }
  } catch (err) {
    showToast(err.message || "Errore nel ripristino del profilo", "error");
  }
}

export async function handlePermanentDeleteEmployee(id, onDeleted) {
  if (!confirm("Confermi l'eliminazione definitiva permanente di questo profilo? I dati associati non potranno più essere recuperati.")) {
    return;
  }
  try {
    await apiCall(`/api/employees/${id}/permanent`, "DELETE");
    showToast("Profilo eliminato definitivamente.", "info");
    await loadTrashEmployees();
    if (onDeleted) await onDeleted();
  } catch (err) {
    showToast(err.message || "Errore eliminazione definitiva", "error");
  }
}

export async function handleSoftDeleteEmployee(id, name, onDeleted) {
  if (!confirm(`Sei sicuro di voler eliminare il profilo di "${name}"?\n\nIl profilo verrà conservato nel Cestino di sicurezza per 3 giorni (72 ore) e potrai ripristinarlo in qualsiasi momento.`)) {
    return;
  }
  try {
    await apiCall(`/api/employees/${id}`, "DELETE");
    showToast(`Profilo "${name}" spostato nel Cestino (backup valido per 3 giorni).`, "warning");
    await loadTrashEmployees();
    if (onDeleted) await onDeleted();
  } catch (err) {
    showToast(err.message || "Errore durante l'eliminazione", "error");
  }
}

export function updateContractDailyHoursPreview() {
  if (!elements.contractOfficeStart || !elements.contractOfficeEnd) return;
  const sStart = elements.contractOfficeStart.value;
  const sEnd = elements.contractOfficeEnd.value;
  const lStart = elements.contractLunchStart ? elements.contractLunchStart.value : "";
  const lEnd = elements.contractLunchEnd ? elements.contractLunchEnd.value : "";

  function tToM(t) {
    if (!t || !t.includes(":")) return null;
    const [h, m] = t.split(":").map(Number);
    return (isNaN(h) || isNaN(m)) ? null : h * 60 + m;
  }

  const sM = tToM(sStart);
  const eM = tToM(sEnd);
  let spanM = (sM !== null && eM !== null && eM > sM) ? (eM - sM) : 0;

  const lsM = tToM(lStart);
  const leM = tToM(lEnd);
  let lunchM = (lsM !== null && leM !== null && leM > lsM) ? (leM - lsM) : 0;
  let netM = Math.max(0, spanM - lunchM);
  let netH = netM / 60;

  const daysCheckboxes = document.querySelectorAll("input[name='contractDayOfWeek']:checked");
  const numDays = daysCheckboxes.length;
  const weeklyH = netH * numDays;

  if (elements.contractScheduleSummaryNotice) {
    elements.contractScheduleSummaryNotice.innerHTML = `<span>⏱️ <strong>${netH.toFixed(1)} ore contrattuali al giorno</strong> (${weeklyH.toFixed(1)} h/settimana su ${numDays} giorni lavorativi)</span>`;
  }
}

export function openContractScheduleModal(empId = null) {
  const targetId = empId || (state.currentUser ? state.currentUser.id : state.currentEmployeeId);
  const emp = (state.profiles || []).find(p => Number(p.id) === Number(targetId)) || state.currentUser;
  if (!emp) {
    showToast("Profilo utente non trovato", "error");
    return;
  }

  if (elements.contractScheduleEmployeeId) elements.contractScheduleEmployeeId.value = emp.id;
  if (elements.contractOfficeStart) elements.contractOfficeStart.value = emp.contract_office_start || "09:00";
  if (elements.contractOfficeEnd) elements.contractOfficeEnd.value = emp.contract_office_end || "13:00";
  if (elements.contractLunchStart) elements.contractLunchStart.value = emp.contract_lunch_start || "";
  if (elements.contractLunchEnd) elements.contractLunchEnd.value = emp.contract_lunch_end || "";

  const activeDays = (emp.contract_office_days || "lun,mar,mer,gio,ven").split(",");
  const daysBoxes = document.querySelectorAll("input[name='contractDayOfWeek']");
  daysBoxes.forEach(cb => {
    cb.checked = activeDays.includes(cb.value);
  });

  updateContractDailyHoursPreview();

  if (elements.modalContractScheduleBackdrop) {
    elements.modalContractScheduleBackdrop.classList.add("show");
  }
}

export function closeContractScheduleModal() {
  if (elements.modalContractScheduleBackdrop) {
    elements.modalContractScheduleBackdrop.classList.remove("show");
  }
}

export async function handleSaveContractSchedule(e, onSaved) {
  if (e && e.preventDefault) e.preventDefault();
  const empId = elements.contractScheduleEmployeeId ? parseInt(elements.contractScheduleEmployeeId.value, 10) : null;
  if (!empId) {
    showToast("ID dipendente mancante", "error");
    return;
  }

  const daysBoxes = document.querySelectorAll("input[name='contractDayOfWeek']:checked");
  const selectedDays = Array.from(daysBoxes).map(cb => cb.value).join(",");

  const payload = {
    contract_office_days: selectedDays || "lun,mar,mer,gio,ven",
    contract_office_start: elements.contractOfficeStart ? elements.contractOfficeStart.value : "09:00",
    contract_office_end: elements.contractOfficeEnd ? elements.contractOfficeEnd.value : "13:00",
    contract_lunch_start: elements.contractLunchStart ? (elements.contractLunchStart.value || null) : null,
    contract_lunch_end: elements.contractLunchEnd ? (elements.contractLunchEnd.value || null) : null
  };

  try {
    const res = await apiCall(`/api/employees/${empId}/contract-schedule`, "PUT", payload);
    if (res.status === "ok") {
      showToast("Orario contrattuale salvato con successo!", "success");

      // Update in local state
      const p = (state.profiles || []).find(item => Number(item.id) === Number(empId));
      if (p) Object.assign(p, res.employee || payload);
      if (state.currentUser && Number(state.currentUser.id) === Number(empId)) {
        Object.assign(state.currentUser, res.employee || payload);
      }

      closeContractScheduleModal();
      renderEmployeesGrid();
      if (onSaved) await onSaved();
    }
  } catch (err) {
    showToast(err.message || "Errore nel salvataggio dell'orario contrattuale", "error");
  }
}

