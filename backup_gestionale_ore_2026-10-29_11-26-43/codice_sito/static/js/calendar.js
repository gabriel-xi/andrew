/**
 * Course Calendars, Sessions, Rescheduling & Teacher Conflict Detection
 */

import { state, elements } from './state.js';
import { apiCall } from './api.js';
import { showToast, escapeHtml, formatDisplayDate, formatHours } from './ui.js';

export async function loadOfficialCalendars() {
  try {
    const [calsData, confsData, docData] = await Promise.all([
      apiCall("/api/course-calendars"),
      apiCall("/api/course-calendars/conflicts"),
      apiCall("/api/course-calendars/docenti")
    ]);

    if (calsData.status === "ok") state.officialCalendars = calsData.calendars || [];
    if (confsData.status === "ok") {
      state.officialConflicts = confsData.conflicts || [];
      renderOfficialConflictsBanner(state.officialConflicts);
    }
    if (docData.status === "ok") state.docentiList = docData.docenti || [];

    populateOfficialCalendarSelect();
    populateDocentiDatalist();

    if (state.officialCalendars.length > 0 && !state.selectedCalendarId) {
      state.selectedCalendarId = state.officialCalendars[0].id;
    }
    if (state.selectedCalendarId) {
      await loadCalendarDetail(state.selectedCalendarId);
    }
  } catch (err) {
    console.error("Calendars load error:", err);
  }
}

export function populateOfficialCalendarSelect() {
  if (!elements.selectOfficialCalendar) return;
  elements.selectOfficialCalendar.innerHTML = "";

  if (state.officialCalendars.length === 0) {
    elements.selectOfficialCalendar.innerHTML = `<option value="">Nessun calendario corsi presente</option>`;
    return;
  }

  state.officialCalendars.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id;
    const confTag = c.conflicts_count > 0 ? ` ⚠️ [${c.conflicts_count} conflitti]` : '';
    opt.textContent = `${c.title} (${c.course_code || 'ID ' + c.course_id})${confTag}`;
    if (c.id === state.selectedCalendarId) opt.selected = true;
    elements.selectOfficialCalendar.appendChild(opt);
  });
}

export function populateDocentiDatalist() {
  if (!elements.datalistDocenti) return;
  elements.datalistDocenti.innerHTML = "";
  state.docentiList.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d;
    elements.datalistDocenti.appendChild(opt);
  });
}

export async function loadCalendarDetail(calId) {
  state.selectedCalendarId = calId;
  try {
    const data = await apiCall(`/api/course-calendars/${calId}`);
    if (data.status === "ok") {
      state.currentCalendarDetail = data.calendar;
      renderCalendarCardHeader(data.calendar);
      renderCalendarSessionsTable();
    }
  } catch (err) {
    showToast("Errore caricamento dettaglio calendario", "error");
  }
}

export function renderCalendarCardHeader(cal) {
  if (!elements.calendarInfoCard) return;

  if (elements.calCardCourseCode) elements.calCardCourseCode.textContent = cal.course_code || `CORSO ID ${cal.course_id}`;
  if (elements.calCardTitle) elements.calCardTitle.textContent = cal.title;
  if (elements.calCardStatusBadge) {
    elements.calCardStatusBadge.textContent = cal.status;
    elements.calCardStatusBadge.className = `badge ${cal.status === 'In Corso' ? 'badge-info' : 'badge-gray'}`;
  }
  if (elements.calCardCourseName) elements.calCardCourseName.textContent = cal.course_name;
  if (elements.calMetaAulaDates) elements.calMetaAulaDates.textContent = `${formatDisplayDate(cal.start_date)} - ${formatDisplayDate(cal.expected_end_date)}`;
  if (elements.calMetaExpectedEnd) elements.calMetaExpectedEnd.textContent = formatDisplayDate(cal.expected_end_date);
  if (elements.calMetaStageDates) {
    elements.calMetaStageDates.textContent = cal.stage_start_date ? `${formatDisplayDate(cal.stage_start_date)} - ${formatDisplayDate(cal.stage_end_date)}` : "Non pianificato";
  }
  if (elements.calMetaStageTutor) elements.calMetaStageTutor.textContent = cal.stage_tutor_name || "Non assegnato";
  if (elements.calMetaTotalHours) elements.calMetaTotalHours.textContent = `${formatHours(cal.total_hours)} h`;
  if (elements.calMetaHoursBreakdown) {
    elements.calMetaHoursBreakdown.textContent = `Aula: ${formatHours(cal.total_aula_hours)}h | Stage: ${formatHours(cal.total_stage_hours)}h`;
  }
  if (elements.calMetaSessionsCount) elements.calMetaSessionsCount.textContent = `${cal.sessions ? cal.sessions.length : 0} sessioni totali`;

  if (elements.calMetaConflictsNotice) {
    if (cal.conflicts_count > 0) {
      elements.calMetaConflictsNotice.style.display = "block";
      elements.calMetaConflictsNotice.textContent = `⚠️ Rilevate ${cal.conflicts_count} sovrapposizioni orarie docenti da risolvere!`;
    } else {
      elements.calMetaConflictsNotice.style.display = "none";
    }
  }

  if (elements.calNotesBox && elements.calCardNotesText) {
    if (cal.notes) {
      elements.calNotesBox.style.display = "block";
      elements.calCardNotesText.textContent = cal.notes;
    } else {
      elements.calNotesBox.style.display = "none";
    }
  }
}

export function renderCalendarSessionsTable() {
  if (!elements.calendarSessionsTableBody) return;
  elements.calendarSessionsTableBody.innerHTML = "";

  if (!state.currentCalendarDetail || !state.currentCalendarDetail.sessions) {
    elements.calendarSessionsTableBody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-3">Nessuna sessione presente.</td></tr>`;
    return;
  }

  let sessions = [...state.currentCalendarDetail.sessions];

  // Filtro fase
  if (state.calendarPhaseFilter && state.calendarPhaseFilter !== "all") {
    sessions = sessions.filter(s => s.phase === state.calendarPhaseFilter);
  }

  // Filtro ricerca
  if (state.calendarSearchQuery) {
    const q = state.calendarSearchQuery.toLowerCase();
    sessions = sessions.filter(s =>
      (s.docente && s.docente.toLowerCase().includes(q)) ||
      (s.modulo && s.modulo.toLowerCase().includes(q)) ||
      (s.date && s.date.includes(q)) ||
      (s.tutor_name && s.tutor_name.toLowerCase().includes(q))
    );
  }

  if (elements.sessionsFilteredCount) {
    elements.sessionsFilteredCount.textContent = `${sessions.length} visualizzate su ${state.currentCalendarDetail.sessions.length}`;
  }

  if (sessions.length === 0) {
    elements.calendarSessionsTableBody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-3">Nessuna sessione corrisponde ai filtri selezionati.</td></tr>`;
    return;
  }

  const isAdmin = state.currentUser && state.currentUser.role === "admin";

  sessions.forEach((s, idx) => {
    const tr = document.createElement("tr");
    const isConflict = s.conflicts && s.conflicts.length > 0;
    if (isConflict) tr.className = "row-conflict-highlight";

    const phaseBadge = s.phase === "aula"
      ? `<span class="badge badge-phase-aula">AULA</span>`
      : `<span class="badge badge-phase-stage">STAGE</span>`;

    const statusBadge = `<span class="badge ${s.status === 'rinviata' ? 'badge-yellow' : (s.status === 'annullata' ? 'badge-danger' : 'badge-green')}">${s.status.toUpperCase()}</span>`;

    const confMsg = isConflict ? s.conflicts.map(c => c.warning_message).join(" | ") : "";

    tr.innerHTML = `
      <td class="text-center text-muted font-bold">${idx + 1}</td>
      <td class="text-center font-bold">${formatDisplayDate(s.date)} <div class="text-xs text-muted">${s.day_of_week}</div></td>
      <td class="text-center font-bold">${s.start_time} - ${s.end_time}</td>
      <td class="text-center">${phaseBadge}</td>
      <td><strong>${escapeHtml(s.modulo || '—')}</strong></td>
      <td class="text-right font-bold">${formatHours(s.hours)}</td>
      <td>${s.phase === 'aula' ? `👨‍🏫 <strong>${escapeHtml(s.docente || 'Non assegnato')}</strong>` : `🎓 ${escapeHtml(s.tutor_name || 'Tutor stage')}`}</td>
      <td class="text-center">
        ${statusBadge}
        ${isConflict ? `<div class="conflict-table-indicator mt-1" title="${escapeHtml(confMsg)}">⚠️ Sovrapposizione</div>` : ''}
      </td>
      <td class="text-center">
        <button class="btn-icon" title="Rinvia o Annulla lezione" onclick="window.openRescheduleModalById(${s.id})">🔄</button>
        ${isAdmin ? `
          <button class="btn-icon" title="Modifica" onclick="window.openEditSessionModalById(${s.id})">✏️</button>
          <button class="btn-icon" title="Elimina" onclick="window.deleteCalendarSessionById(${s.id})">🗑️</button>
        ` : ''}
      </td>
    `;
    elements.calendarSessionsTableBody.appendChild(tr);
  });
}

export function renderOfficialConflictsBanner(conflicts) {
  if (!elements.officialConflictBanner) return;

  if (!conflicts || conflicts.length === 0) {
    elements.officialConflictBanner.style.display = "none";
    if (elements.navConflictDot) elements.navConflictDot.style.display = "none";
    return;
  }

  elements.officialConflictBanner.style.display = "block";
  if (elements.navConflictDot) elements.navConflictDot.style.display = "inline-block";
  if (elements.conflictCountBadge) elements.conflictCountBadge.textContent = `${conflicts.length} Sovrapposizion${conflicts.length === 1 ? 'e' : 'i'}`;

  if (elements.conflictListItems) {
    elements.conflictListItems.innerHTML = "";
    conflicts.forEach(c => {
      const item = document.createElement("div");
      item.className = "conflict-item-card";
      item.innerHTML = `
        <div>
          <span class="conflict-tag-badge">⚠️ ${escapeHtml(c.conflict_type)}</span>
          <strong>${escapeHtml(c.docente)}</strong> — Data: <strong>${formatDisplayDate(c.date)}</strong> (${escapeHtml(c.overlap_range)})
          <div class="text-sm text-muted mt-1">
            Collusione tra <em>${escapeHtml(c.course_name)}</em> e <em>${escapeHtml(c.conflicting_course_name)}</em>
          </div>
        </div>
      `;
      elements.conflictListItems.appendChild(item);
    });
  }
}

export function openCourseCalendarModal(calId = null) {
  if (!elements.formCourseCalendar) return;
  elements.formCourseCalendar.reset();

  if (elements.calModalCourseId) {
    elements.calModalCourseId.innerHTML = `<option value="">-- Seleziona Corso --</option>`;
    state.courses.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.code ? c.code + ' - ' : ''}${c.name}`;
      elements.calModalCourseId.appendChild(opt);
    });
  }

  if (elements.calModalStageTutorId) {
    elements.calModalStageTutorId.innerHTML = `<option value="">-- Seleziona Tutor di Stage --</option>`;
    state.profiles.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.role})`;
      elements.calModalStageTutorId.appendChild(opt);
    });
  }

  if (calId && state.currentCalendarDetail) {
    const c = state.currentCalendarDetail;
    elements.courseCalendarModalTitle.textContent = "⚙️ Modifica Calendario Ufficiale";
    elements.courseCalendarId.value = c.id;
    if (elements.calModalCourseId) elements.calModalCourseId.value = c.course_id;
    elements.calModalTitle.value = c.title;
    elements.calModalStartDate.value = c.start_date;
    elements.calModalExpectedEndDate.value = c.expected_end_date;
    elements.calModalStageStartDate.value = c.stage_start_date || "";
    elements.calModalStageEndDate.value = c.stage_end_date || "";
    if (elements.calModalStageTutorId) elements.calModalStageTutorId.value = c.stage_tutor_id || "";
    elements.calModalStatus.value = c.status || "In Corso";
    elements.calModalNotes.value = c.notes || "";
  } else {
    elements.courseCalendarModalTitle.textContent = "➕ Nuovo Calendario Ufficiale Corso";
    elements.courseCalendarId.value = "";
    elements.calModalStatus.value = "In Programmazione";
  }

  if (elements.modalCourseCalendarBackdrop) elements.modalCourseCalendarBackdrop.classList.add("show");
}

export function closeCourseCalendarModal() {
  if (elements.modalCourseCalendarBackdrop) elements.modalCourseCalendarBackdrop.classList.remove("show");
}

export async function handleSaveCourseCalendar(e, onSaved) {
  e.preventDefault();

  const calId = elements.courseCalendarId.value;
  const payload = {
    course_id: parseInt(elements.calModalCourseId.value),
    title: elements.calModalTitle.value.trim(),
    start_date: elements.calModalStartDate.value,
    expected_end_date: elements.calModalExpectedEndDate.value,
    stage_start_date: elements.calModalStageStartDate.value || null,
    stage_end_date: elements.calModalStageEndDate.value || null,
    stage_tutor_id: elements.calModalStageTutorId.value ? parseInt(elements.calModalStageTutorId.value) : null,
    status: elements.calModalStatus.value,
    notes: elements.calModalNotes.value.trim()
  };

  try {
    if (calId) {
      await apiCall(`/api/course-calendars/${calId}`, "PUT", payload);
    } else {
      await apiCall("/api/course-calendars", "POST", payload);
    }
    closeCourseCalendarModal();
    showToast("Calendario salvato con successo!", "success");
    if (onSaved) await onSaved();
  } catch (err) {
    showToast(err.message || "Errore nel salvataggio", "error");
  }
}

export async function handleDeleteCourseCalendar(calId, onDeleted) {
  if (!confirm("Sei sicuro di voler eliminare questo calendario e tutte le sue lezioni?")) return;
  try {
    await apiCall(`/api/course-calendars/${calId}`, "DELETE");
    showToast("Calendario eliminato.", "info");
    if (onDeleted) await onDeleted();
  } catch (err) {
    showToast(err.message || "Errore nella cancellazione", "error");
  }
}

export function openSessionModal(sessionId = null, defaultPhase = "aula") {
  if (!elements.formCalendarSession) return;
  elements.formCalendarSession.reset();

  if (elements.sessModalCalId) {
    elements.sessModalCalId.innerHTML = "";
    state.officialCalendars.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.title} (${c.course_name})`;
      if (c.id === state.selectedCalendarId) opt.selected = true;
      elements.sessModalCalId.appendChild(opt);
    });
  }

  if (elements.sessModalTutorId) {
    elements.sessModalTutorId.innerHTML = `<option value="">-- Seleziona Tutor --</option>`;
    state.profiles.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.role})`;
      elements.sessModalTutorId.appendChild(opt);
    });
  }

  const allSessions = (state.currentCalendarDetail && state.currentCalendarDetail.sessions)
    ? state.currentCalendarDetail.sessions
    : (state.currentCourseCalendar && state.currentCourseCalendar.sessions ? state.currentCourseCalendar.sessions : []);

  if (sessionId && allSessions.length > 0) {
    const s = allSessions.find(item => item.id === sessionId);
    if (s) {
      elements.sessionModalTitle.textContent = "✏️ Modifica Sessione Calendario";
      elements.sessModalId.value = s.id;
      if (elements.sessModalCalId) elements.sessModalCalId.value = s.calendar_id;
      updateSessionModalPhase(s.phase);
      elements.sessModalDate.value = s.date;
      elements.sessModalStartTime.value = s.start_time;
      elements.sessModalEndTime.value = s.end_time;
      elements.sessModalHours.value = s.hours;
      if (elements.sessModalDocente) elements.sessModalDocente.value = s.docente || "";
      if (elements.sessModalModulo) elements.sessModalModulo.value = s.modulo || "";
      if (elements.sessModalTutorId) elements.sessModalTutorId.value = s.tutor_id || "";
      elements.sessModalNotes.value = s.notes || "";
      if (elements.sessModalIsModuleTest) elements.sessModalIsModuleTest.checked = !!s.is_module_test;
    }
  } else {
    elements.sessionModalTitle.textContent = "➕ Aggiungi Sessione Calendario";
    elements.sessModalId.value = "";
    if (state.selectedCalendarId && elements.sessModalCalId) {
      elements.sessModalCalId.value = state.selectedCalendarId;
    }
    updateSessionModalPhase(defaultPhase);
    elements.sessModalDate.value = new Date().toISOString().split("T")[0];
    elements.sessModalStartTime.value = "08:30";
    elements.sessModalEndTime.value = "13:30";
    elements.sessModalHours.value = "5.0";
    if (elements.sessModalIsModuleTest) elements.sessModalIsModuleTest.checked = false;
  }

  if (elements.modalCalendarSessionBackdrop) elements.modalCalendarSessionBackdrop.classList.add("show");
}

export function closeSessionModal() {
  if (elements.modalCalendarSessionBackdrop) elements.modalCalendarSessionBackdrop.classList.remove("show");
}

export function updateSessionModalPhase(phase) {
  if (phase === "aula") {
    if (elements.radioPhaseAula) elements.radioPhaseAula.checked = true;
    if (elements.labelPhaseAula) elements.labelPhaseAula.classList.add("active");
    if (elements.labelPhaseStage) elements.labelPhaseStage.classList.remove("active");
    if (elements.sessAulaFields) elements.sessAulaFields.style.display = "block";
    if (elements.sessStageFields) elements.sessStageFields.style.display = "none";
    checkLiveSessionConflict();
  } else {
    if (elements.radioPhaseStage) elements.radioPhaseStage.checked = true;
    if (elements.labelPhaseStage) elements.labelPhaseStage.classList.add("active");
    if (elements.labelPhaseAula) elements.labelPhaseAula.classList.remove("active");
    if (elements.sessAulaFields) elements.sessAulaFields.style.display = "none";
    if (elements.sessStageFields) elements.sessStageFields.style.display = "block";
    if (elements.sessModalConflictAlert) elements.sessModalConflictAlert.style.display = "none";
  }
}

export function recalculateSessionModalHours() {
  const start = elements.sessModalStartTime.value;
  const end = elements.sessModalEndTime.value;
  if (!start || !end) return;

  try {
    const [h1, m1] = start.split(":").map(Number);
    const [h2, m2] = end.split(":").map(Number);
    const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
    const hrs = Math.max(0, mins / 60);
    elements.sessModalHours.value = hrs.toFixed(2);
  } catch (e) {
    elements.sessModalHours.value = "0.0";
  }
}

export async function checkLiveSessionConflict() {
  const isAula = elements.radioPhaseAula && elements.radioPhaseAula.checked;
  if (!isAula) {
    if (elements.sessModalConflictAlert) elements.sessModalConflictAlert.style.display = "none";
    return;
  }

  const docente = elements.sessModalDocente ? elements.sessModalDocente.value.trim() : "";
  const dateStr = elements.sessModalDate ? elements.sessModalDate.value : "";
  const startTime = elements.sessModalStartTime ? elements.sessModalStartTime.value : "08:30";
  const endTime = elements.sessModalEndTime ? elements.sessModalEndTime.value : "13:30";
  const excludeId = elements.sessModalId ? elements.sessModalId.value : "";

  if (!docente || !dateStr) {
    if (elements.sessModalConflictAlert) elements.sessModalConflictAlert.style.display = "none";
    return;
  }

  try {
    const url = `/api/course-calendars/check-conflict?docente=${encodeURIComponent(docente)}&date=${dateStr}&start_time=${startTime}&end_time=${endTime}${excludeId ? `&exclude_id=${excludeId}` : ''}`;
    const data = await apiCall(url);

    if (data.status === "ok" && data.has_conflict) {
      const conf = data.conflicts[0];
      if (elements.sessModalConflictAlert) elements.sessModalConflictAlert.style.display = "block";
      if (elements.sessModalConflictText) {
        elements.sessModalConflictText.textContent = conf.warning_message || `Il docente '${docente}' ha già lezione in questo orario.`;
      }
    } else {
      if (elements.sessModalConflictAlert) elements.sessModalConflictAlert.style.display = "none";
    }
  } catch (e) {
    console.error("Errore verifica conflitti:", e);
  }
}

export async function handleSaveSession(e, onSaved) {
  e.preventDefault();

  const sessionId = elements.sessModalId.value ? parseInt(elements.sessModalId.value) : null;
  const calendarId = parseInt(elements.sessModalCalId.value);
  if (!calendarId) {
    showToast("Seleziona un calendario di destinazione", "error");
    return;
  }

  const phase = elements.radioPhaseAula.checked ? "aula" : "stage";
  const docente = phase === "aula" ? elements.sessModalDocente.value.trim() : "";
  const modulo = phase === "aula" ? elements.sessModalModulo.value.trim() : "";
  const tutorId = phase === "stage" && elements.sessModalTutorId.value ? parseInt(elements.sessModalTutorId.value) : null;

  if (phase === "aula" && !docente) {
    showToast("Nella fase aula è obbligatorio specificare il docente", "error");
    return;
  }

  const isModuleTest = (phase === "aula" && elements.sessModalIsModuleTest)
    ? (elements.sessModalIsModuleTest.checked ? 1 : 0)
    : 0;

  const payload = {
    phase: phase,
    date: elements.sessModalDate.value,
    start_time: elements.sessModalStartTime.value,
    end_time: elements.sessModalEndTime.value,
    hours: parseFloat(elements.sessModalHours.value),
    docente: docente,
    modulo: modulo,
    tutor_id: tutorId,
    is_module_test: isModuleTest,
    notes: elements.sessModalNotes.value.trim()
  };

  try {
    if (sessionId) {
      await apiCall(`/api/course-calendars/sessions/${sessionId}`, "PUT", payload);
    } else {
      await apiCall(`/api/course-calendars/${calendarId}/sessions`, "POST", payload);
    }

    closeSessionModal();
    showToast("Sessione salvata!", "success");
    if (onSaved) await onSaved();
  } catch (err) {
    showToast(err.message || "Errore nel salvataggio della sessione", "error");
  }
}

export async function deleteCalendarSessionById(id, onDeleted) {
  if (!confirm("Sei sicuro di voler eliminare questa lezione dal calendario?")) return;
  try {
    await apiCall(`/api/course-calendars/sessions/${id}`, "DELETE");
    showToast("Sessione eliminata.", "info");
    if (onDeleted) await onDeleted();
  } catch (err) {
    showToast(err.message || "Errore nella cancellazione", "error");
  }
}

export function openRescheduleModalById(sessionId) {
  const cal = state.currentCalendarDetail || state.currentCourseCalendar;
  if (!cal || !cal.sessions) return;
  const s = cal.sessions.find(item => item.id === sessionId);
  if (!s) return;

  elements.reschedSessionId.value = s.id;
  elements.reschedPrevCourse.textContent = cal.course_name || cal.title || "Corso";
  elements.reschedPrevPhaseBadge.textContent = s.phase.toUpperCase();
  elements.reschedPrevPhaseBadge.className = `badge ${s.phase === 'aula' ? 'badge-phase-aula' : 'badge-phase-stage'}`;
  elements.reschedPrevDate.textContent = formatDisplayDate(s.date);
  elements.reschedPrevTime.textContent = `${s.start_time} - ${s.end_time}`;
  elements.reschedPrevDocente.textContent = s.docente || "—";
  elements.reschedPrevModulo.textContent = s.modulo || "—";

  elements.reschedStatusSelect.value = s.status || "rinviata";
  elements.reschedReason.value = s.reschedule_reason || "";
  elements.reschedNewDate.value = s.rescheduled_to_date || "";
  elements.reschedNewStart.value = s.rescheduled_to_start || s.start_time;
  elements.reschedNewEnd.value = s.rescheduled_to_end || s.end_time;
  elements.reschedConflictAlert.style.display = "none";

  updateRescheduleModalFields();
  if (elements.modalRescheduleSessionBackdrop) elements.modalRescheduleSessionBackdrop.classList.add("show");
}

export function closeRescheduleModal() {
  if (elements.modalRescheduleSessionBackdrop) elements.modalRescheduleSessionBackdrop.classList.remove("show");
}

export function updateRescheduleModalFields() {
  const status = elements.reschedStatusSelect.value;
  if (status === "rinviata") {
    if (elements.reschedDetailsContainer) elements.reschedDetailsContainer.style.display = "block";
    checkLiveRescheduleConflict();
  } else {
    if (elements.reschedDetailsContainer) elements.reschedDetailsContainer.style.display = "none";
    if (elements.reschedConflictAlert) elements.reschedConflictAlert.style.display = "none";
  }
}

export async function checkLiveRescheduleConflict() {
  const status = elements.reschedStatusSelect.value;
  if (status !== "rinviata") {
    elements.reschedConflictAlert.style.display = "none";
    return;
  }

  const sessionId = parseInt(elements.reschedSessionId.value);
  if (!sessionId || !state.currentCalendarDetail) return;
  const s = state.currentCalendarDetail.sessions.find(item => item.id === sessionId);
  if (!s || s.phase !== "aula" || !s.docente) {
    elements.reschedConflictAlert.style.display = "none";
    return;
  }

  const newDate = elements.reschedNewDate.value;
  const newStart = elements.reschedNewStart.value || "08:30";
  const newEnd = elements.reschedNewEnd.value || "13:30";

  if (!newDate) {
    elements.reschedConflictAlert.style.display = "none";
    return;
  }

  try {
    const url = `/api/course-calendars/check-conflict?docente=${encodeURIComponent(s.docente)}&date=${newDate}&start_time=${newStart}&end_time=${newEnd}&exclude_id=${sessionId}`;
    const data = await apiCall(url);

    if (data.status === "ok" && data.has_conflict) {
      const conf = data.conflicts[0];
      elements.reschedConflictAlert.style.display = "block";
      elements.reschedConflictText.textContent = conf.warning_message || `Il docente '${s.docente}' risulta già occupato nella data/orario proposta!`;
    } else {
      elements.reschedConflictAlert.style.display = "none";
    }
  } catch (e) {
    console.error("Errore verifica conflitto rinvio:", e);
  }
}

export async function handleSaveReschedule(e, onSaved) {
  e.preventDefault();

  const sessionId = parseInt(elements.reschedSessionId.value);
  if (!sessionId) return;

  const status = elements.reschedStatusSelect.value;
  const reason = elements.reschedReason.value.trim();

  const rescheduleData = {
    reschedule_reason: reason,
    rescheduled_to_date: status === "rinviata" ? elements.reschedNewDate.value : null,
    rescheduled_to_start: status === "rinviata" ? elements.reschedNewStart.value : null,
    rescheduled_to_end: status === "rinviata" ? elements.reschedNewEnd.value : null
  };

  try {
    await apiCall(`/api/course-calendars/sessions/${sessionId}/status`, "POST", {
      status: status,
      reschedule_data: rescheduleData
    });

    closeRescheduleModal();
    showToast(`Stato lezione aggiornato a: ${status.toUpperCase()}`, "success");
    if (onSaved) await onSaved();
  } catch (err) {
    showToast(err.message || "Errore aggiornamento stato", "error");
  }
}

// -------------------------------------------------------------
// MASTER COURSE CALENDAR (HOMEPAGE & DAY-BY-DAY ALIGNMENT)
// -------------------------------------------------------------

export async function openQuickEntryModalForSession(sessionId) {
  try {
    let session = null;
    if (state.masterScheduleData && state.masterScheduleData.days) {
      for (const d of state.masterScheduleData.days) {
        if (d.sessions) {
          const found = d.sessions.find(s => s.id === sessionId);
          if (found) { session = found; break; }
        }
      }
    }
    if (!session && state.weeklySchedule && state.weeklySchedule.days) {
      for (const d of state.weeklySchedule.days) {
        if (d.calendar_sessions) {
          const found = d.calendar_sessions.find(s => s.id === sessionId);
          if (found) { session = found; break; }
        }
      }
    }

    if (session && session.course_id && window.openDailyPresenceModal) {
      window.openDailyPresenceModal(session.course_id, session.id);
      return;
    }

    if (window.openEntryModal) {
      window.openEntryModal();
    }
    if (session) {
      if (elements.entryDate) elements.entryDate.value = session.date;
      if (elements.entryCourse) elements.entryCourse.value = session.course_id;
      if (elements.entrySchedStart) elements.entrySchedStart.value = session.start_time;
      if (elements.entrySchedEnd) elements.entrySchedEnd.value = session.end_time;
      if (elements.entryActStart) elements.entryActStart.value = session.start_time;
      if (elements.entryActEnd) elements.entryActEnd.value = session.end_time;
      if (elements.entryHours) elements.entryHours.value = session.hours;
      if (elements.entryActivityType) elements.entryActivityType.value = session.phase === 'stage' ? 'Tutoraggio stage' : "Tutoraggio d'aula";
      if (elements.entryCausale) elements.entryCausale.value = `Lezione calendario: ${session.modulo || ''}`;
      if (elements.entryNote) elements.entryNote.value = `Docente: ${session.docente || ''} - Materia: ${session.modulo || ''}`;
      if (window.recalculateModalVariance) window.recalculateModalVariance();
    }
  } catch (err) {
    console.error("Quick entry error:", err);
  }
}
window.openQuickEntryModalForSession = openQuickEntryModalForSession;

export function registerTutorFromSession(sessionId) {
  openQuickEntryModalForSession(sessionId);
}
window.registerTutorFromSession = registerTutorFromSession;

export async function loadMasterSchedule() {
  await loadMasterAulaGrid();
}

export async function loadMasterAulaGrid() {
  try {
    console.log("[loadMasterAulaGrid] fetching grid data...");
    const params = new URLSearchParams();
    if (state.currentEmployeeId) {
      params.append("employee_id", state.currentEmployeeId);
    }
    if (state.aulaGridDocenteFilter && state.aulaGridDocenteFilter !== "all") {
      params.append("docente", state.aulaGridDocenteFilter);
    }
    if (state.aulaGridMonthFilter && state.aulaGridMonthFilter !== "all") {
      params.append("month", state.aulaGridMonthFilter);
    }
    if (state.aulaGridStatusFilter && state.aulaGridStatusFilter !== "all") {
      params.append("status", state.aulaGridStatusFilter);
    }

    const url = `/api/reports/master-aula-grid?${params.toString()}`;
    const data = await apiCall(url);
    console.log("[loadMasterAulaGrid] data received:", data ? data.status : "null", data ? data.total_dates : 0);
    if (data.status === "ok") {
      state.aulaGridData = data;
      renderMasterAulaGrid();
    }
  } catch (err) {
    console.error("Master aula grid load error:", err);
  }
}

export function renderMasterAulaGrid() {
  const data = state.aulaGridData;
  if (!data) return;

  const badge = elements.aulaGridSummaryBadge || document.getElementById("aulaGridSummaryBadge");
  if (badge) {
    badge.textContent = `${data.total_dates} giornate d'aula | ${data.total_sessions} lezioni (${data.total_hours}h totali)`;
  }

  // Populate Months dropdown
  const monthSel = elements.selectAulaGridMonth || document.getElementById("selectAulaGridMonth");
  if (monthSel && monthSel.options.length <= 1 && data.available_months) {
    monthSel.innerHTML = `<option value="all">Tutti i Mesi (${data.available_months.length})</option>`;
    data.available_months.forEach(m => {
      const opt = document.createElement("option");
      opt.value = m.value;
      opt.textContent = m.label;
      if (m.value === state.aulaGridMonthFilter) opt.selected = true;
      monthSel.appendChild(opt);
    });
  }

  // Populate Docenti dropdown
  const docSel = elements.selectAulaGridDocente || document.getElementById("selectAulaGridDocente");
  if (docSel && docSel.options.length <= 1 && data.available_docenti) {
    docSel.innerHTML = `<option value="all">Tutti i Docenti (${data.available_docenti.length})</option>`;
    data.available_docenti.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = d;
      if (d === state.aulaGridDocenteFilter) opt.selected = true;
      docSel.appendChild(opt);
    });
  }

  // Build Table Header (Date, Contracts & Office, Courses, Daily Total)
  const theadRow = elements.aulaGridTheadRow || document.getElementById("aulaGridTheadRow");
  if (theadRow) {
    theadRow.innerHTML = "";

    // 1. Column 1: Date & Day of week
    const dateTh = document.createElement("th");
    dateTh.className = "aula-sticky-date-th";
    dateTh.innerHTML = `📅 Giornata / Data`;
    theadRow.appendChild(dateTh);

    // 2. Column 2: Active Contracts & Office Schedule (with Lunch Break)
    const contractTh = document.createElement("th");
    contractTh.className = "aula-contract-th";
    contractTh.innerHTML = `
      <div style="font-weight: 800; color: var(--navy); font-size: 0.95rem;">🏛️ Contratti Attivi & Sede</div>
      <div class="text-xs text-muted font-bold">Orario da contratto & 🥪 Pausa pranzo</div>
    `;
    theadRow.appendChild(contractTh);

    // 3. Courses Columns (ED 01, ED 02, etc.)
    (data.courses || []).forEach(c => {
      const th = document.createElement("th");
      th.className = "aula-course-th";
      th.style.borderTop = `4px solid ${c.color || '#2563EB'}`;
      th.innerHTML = `
        <div class="aula-course-th-content">
          <span class="aula-ed-badge">${escapeHtml(c.ed_code || 'ED')}</span>
          <div class="aula-course-th-title">${escapeHtml(c.name)}</div>
          <div class="text-xs text-muted font-bold">${escapeHtml(c.code || '')}</div>
          <div class="aula-course-th-meta">⏱️ ${c.total_aula_hours}h Aula (${c.sessions_count} lezioni)</div>
        </div>
      `;
      theadRow.appendChild(th);
    });

    // 4. Daily Effective Worked Hours Column
    const summaryTh = document.createElement("th");
    summaryTh.className = "aula-summary-th";
    summaryTh.innerHTML = `
      <div style="font-weight: 800; color: var(--navy); font-size: 0.95rem;">⏱️ Ore Lavorate del Giorno</div>
      <div class="text-xs text-muted font-bold">Totale con integrazione corsi</div>
    `;
    theadRow.appendChild(summaryTh);
  }

  // Build Table Rows (One row per shared Date)
  const tbody = elements.aulaGridTableBody || document.getElementById("aulaGridTableBody");
  if (!tbody) {
    console.warn("aulaGridTableBody not found in DOM");
    return;
  }
  tbody.innerHTML = "";

  const query = (state.aulaGridSearchQuery || "").toLowerCase().trim();
  let filteredRows = data.rows || [];

  if (query) {
    filteredRows = filteredRows.filter(row => {
      if (row.display_date.includes(query) || row.day_of_week.toLowerCase().includes(query)) return true;
      const allSessionsInRow = Object.values(row.courses || {}).flat();
      return allSessionsInRow.some(s => 
        (s.modulo && s.modulo.toLowerCase().includes(query)) ||
        (s.docente && s.docente.toLowerCase().includes(query)) ||
        (s.ed_code && s.ed_code.toLowerCase().includes(query)) ||
        (s.course_name && s.course_name.toLowerCase().includes(query))
      );
    });
  }

  if (filteredRows.length === 0) {
    const colCount = (data.courses || []).length + 3;
    tbody.innerHTML = `
      <tr>
        <td colspan="${colCount}" class="text-center py-5 text-muted">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">🔍</div>
          <strong>Nessuna lezione o giornata d'aula trovata con i filtri attuali.</strong>
        </td>
      </tr>
    `;
    return;
  }

  filteredRows.forEach(row => {
    const tr = document.createElement("tr");
    if (row.is_today) tr.className = "row-is-today";

    // 1. Sticky Date Column
    let dateHtml = `
      <td class="aula-sticky-date-td">
        <div class="aula-date-display">${row.display_date}</div>
        <div class="aula-date-dow">${row.day_of_week}</div>
        ${row.is_today ? `<span class="aula-today-pill">OGGI</span>` : ''}
      </td>
    `;

    // 2. Contract & Office Schedule & Lunch Break Column
    const cInfo = row.contract_info || {};
    let contractHtml = "";
    if (cInfo.has_contract) {
      contractHtml = `
        <td class="aula-contract-td">
          <div class="d-flex items-center gap-1 mb-1 flex-wrap">
            <span class="badge badge-purple font-bold" style="font-size: 10px; max-width: 100%; white-space: normal;" title="${escapeHtml(cInfo.contract_title || '')}">
              ${escapeHtml(cInfo.contract_title || 'Contratto')}
            </span>
          </div>
          <div class="aula-contract-schedule">
            ⏰ <strong>${escapeHtml(cInfo.schedule_text || '09:00 - 13:00')}</strong>
          </div>
          <div class="mt-1">
            <span class="aula-contract-lunch">
              🥪 <strong>Pausa:</strong> ${escapeHtml(cInfo.lunch_text || 'Continuato')}
            </span>
          </div>
          <div class="text-xs text-muted font-bold mt-1">
            🏢 ${cInfo.contract_hours.toFixed(1)}h sede
          </div>
        </td>
      `;
    } else {
      contractHtml = `
        <td class="aula-contract-td is-off-contract">
          <div class="text-muted" style="font-style: italic; font-size: 0.82rem;">⚪ Fuori orario contrattuale</div>
          <div class="text-xs text-muted mt-1">🥪 Pausa: Non prevista</div>
        </td>
      `;
    }

    // 3. Each Course Column
    let coursesHtml = "";
    (data.courses || []).forEach(c => {
      const courseSessions = (row.courses && row.courses[c.id]) ? row.courses[c.id] : [];
      if (courseSessions.length > 0) {
        const cardsHtml = courseSessions.map(s => {
          const color = s.course_color || '#2563EB';
          const isRegistered = s.has_tutor_entry;
          const isTest = !!s.is_module_test;
          return `
            <div class="aula-session-card ${s.is_past ? 'is-past' : ''} ${isTest ? 'is-test-session' : ''}" style="border-left-color: ${isTest ? '#7C3AED' : color};">
              <div class="aula-card-top">
                <span class="aula-ed-tag">${escapeHtml(s.ed_code)}</span>
                <span class="aula-time-tag">🕒 ${escapeHtml(s.start_time)} - ${escapeHtml(s.end_time)}</span>
                <span class="aula-hours-badge">${s.hours}h</span>
              </div>
              ${isTest ? `
                <div class="d-flex items-center gap-1 my-1">
                  <span class="aula-test-badge" title="Test di verifica finale per il modulo: ${escapeHtml(s.modulo || '')}">
                    📝 TEST DI MODULO
                  </span>
                </div>
              ` : ''}
              <div class="aula-modulo-text">
                📖 <strong>${escapeHtml(s.modulo || 'Modulo')}</strong>
              </div>
              <div class="aula-docente-text">
                👨‍🏫 <strong>Docente:</strong> ${s.docente ? escapeHtml(s.docente) : '<span class="text-muted">— Non assegnato —</span>'}
              </div>
              <div class="aula-card-actions">
                <button type="button" class="btn btn-xs ${isRegistered ? 'btn-success' : 'btn-outline-primary'}" onclick="window.registerTutorFromSession(${s.id})" title="${isRegistered ? 'Presenza già registrata nel tuo registro ore' : 'Registra presenza tutor per questa lezione'}">
                  ${isRegistered ? '✔️ Presenza OK' : '✅ Presenza Tutor'}
                </button>
                <button type="button" class="btn btn-xs btn-outline-warning" onclick="window.openRescheduleModalById(${s.id})" title="Rinvia ad altra data o varia docente">
                  🔄 Variazione
                </button>
              </div>
            </div>
          `;
        }).join("");

        coursesHtml += `<td class="aula-session-td">${cardsHtml}</td>`;
      } else {
        coursesHtml += `<td class="aula-empty-td"><span>—</span></td>`;
      }
    });

    // 4. Daily Effective Worked Hours & Integration Summary Column
    const totalHours = (typeof cInfo.total_worked_hours === "number") ? cInfo.total_worked_hours : 0;
    let summaryHtml = `
      <td class="aula-summary-td">
        <div class="aula-summary-hours">
          ${totalHours.toFixed(1)} <span style="font-size: 0.85rem; font-weight: 600;">h</span>
        </div>
        <div class="mt-1">
          <span class="badge ${cInfo.badge_class || 'badge-gray'}" style="font-size: 10px; font-weight: 700;">
            ${escapeHtml(cInfo.integration_lbl || '')}
          </span>
        </div>
        ${cInfo.has_entry ? `
          <div class="text-xs text-green font-bold mt-2" title="Presenza già registrata nel tuo registro ore">
            ✓ ${cInfo.registered_hours.toFixed(1)}h in Banca Ore
          </div>
        ` : `
          <button type="button" class="btn btn-outline btn-xs font-bold mt-2" onclick="window.openEntryModalForDate('${row.date}')" title="Registra la giornata nel tuo registro ore">
            ➕ Registra Ore
          </button>
        `}
      </td>
    `;

    tr.innerHTML = dateHtml + contractHtml + coursesHtml + summaryHtml;
    tbody.appendChild(tr);
  });
}

export function initMasterCalendarEvents() {
  if (elements.selectAulaGridMonth) {
    elements.selectAulaGridMonth.addEventListener("change", (e) => {
      state.aulaGridMonthFilter = e.target.value;
      loadMasterAulaGrid();
    });
  }

  if (elements.selectAulaGridDocente) {
    elements.selectAulaGridDocente.addEventListener("change", (e) => {
      state.aulaGridDocenteFilter = e.target.value;
      loadMasterAulaGrid();
    });
  }

  if (elements.selectAulaGridStatus) {
    elements.selectAulaGridStatus.addEventListener("change", (e) => {
      state.aulaGridStatusFilter = e.target.value;
      loadMasterAulaGrid();
    });
  }

  if (elements.inputAulaGridSearch) {
    let debounce;
    elements.inputAulaGridSearch.addEventListener("input", (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.aulaGridSearchQuery = e.target.value;
        renderMasterAulaGrid();
      }, 250);
    });
  }

  if (elements.btnResetAulaGridFilters) {
    elements.btnResetAulaGridFilters.addEventListener("click", () => {
      state.aulaGridMonthFilter = "all";
      state.aulaGridDocenteFilter = "all";
      state.aulaGridStatusFilter = "all";
      state.aulaGridSearchQuery = "";
      if (elements.selectAulaGridMonth) elements.selectAulaGridMonth.value = "all";
      if (elements.selectAulaGridDocente) elements.selectAulaGridDocente.value = "all";
      if (elements.selectAulaGridStatus) elements.selectAulaGridStatus.value = "all";
      if (elements.inputAulaGridSearch) elements.inputAulaGridSearch.value = "";
      loadMasterAulaGrid();
    });
  }

  if (elements.btnAulaGridJumpToday) {
    elements.btnAulaGridJumpToday.addEventListener("click", () => {
      const todayEl = document.querySelector(".row-is-today");
      if (todayEl) {
        todayEl.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        // Find first future row
        const firstFuture = document.querySelector(".aula-session-card:not(.is-past)");
        if (firstFuture) {
          firstFuture.closest("tr").scrollIntoView({ behavior: "smooth", block: "center" });
        } else {
          showToast("Nessuna lezione pianificata per la data odierna", "info");
        }
      }
    });
  }

  if (elements.btnAulaGridSyncAll) {
    elements.btnAulaGridSyncAll.addEventListener("click", async () => {
      const courses = (state.aulaGridData && state.aulaGridData.courses) || [];
      if (courses.length === 0) {
        showToast("Nessun corso attivo da sincronizzare", "warning");
        return;
      }
      elements.btnAulaGridSyncAll.disabled = true;
      elements.btnAulaGridSyncAll.textContent = "⏳ Sincronizzazione...";

      let totalSynced = 0;
      let totalHrs = 0;
      for (const c of courses) {
        try {
          const res = await apiCall(`/api/courses/${c.id}/sync-calendar-entries`, "POST", {
            employee_id: state.currentEmployeeId || 26
          });
          if (res.status === "ok") {
            totalSynced += res.synced_count;
            totalHrs += res.total_synced_hours;
          }
        } catch (e) {
          console.error("Errore sincronizzazione corso:", c.id, e);
        }
      }

      elements.btnAulaGridSyncAll.disabled = false;
      elements.btnAulaGridSyncAll.textContent = "⚡ Sincronizza Presenze";

      if (totalSynced > 0) {
        showToast(`🎉 Sincronizzate ${totalSynced} presenze nel tuo registro ore (${totalHrs}h registrate)!`, "success");
      } else {
        showToast("Tutte le presenze delle lezioni passate risultano già sincronizzate!", "info");
      }
      await loadMasterAulaGrid();
    });
  }
}

