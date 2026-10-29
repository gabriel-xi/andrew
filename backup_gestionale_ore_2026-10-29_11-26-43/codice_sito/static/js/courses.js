/**
 * Courses Management, Quota Tracking & Course Hierarchical Sub-pages
 */

import { state, elements } from './state.js';
import { apiCall } from './api.js';
import { showToast, escapeHtml, escapeJsString, formatDisplayDate, formatHours, openBackdropModal, closeBackdropModal, formatFileSize } from './ui.js';

export async function loadCourses() {
  if (!state.currentEmployeeId) return;
  try {
    const data = await apiCall(`/api/courses?employee_id=${state.currentEmployeeId}`);
    if (data.status === "ok") {
      state.courses = data.courses;
      renderCoursesGrid();
      populateCourseSelects();
    }
  } catch (err) {
    console.error("Courses load err:", err);
  }
}

export function renderCoursesGrid() {
  if (!elements.coursesGrid) return;
  elements.coursesGrid.innerHTML = "";

  if (state.courses.length === 0) {
    elements.coursesGrid.innerHTML = `
      <div class="content-box text-center" style="grid-column: 1/-1; padding: 3rem;">
        <h3>Nessun corso inserito</h3>
        <p class="text-muted mt-1">Aggiungi il tuo primo corso per monitorare il monte ore stabilito.</p>
        <button class="btn btn-purple mt-2" onclick="window.openCourseModal()">+ Aggiungi Corso</button>
      </div>
    `;
    return;
  }

  const isAdmin = state.currentUser && state.currentUser.role === "admin";

  state.courses.forEach(c => {
    const card = document.createElement("div");
    card.className = "course-card";
    card.dataset.courseId = c.id;
    card.id = `courseCard-${c.id}`;

    const hasTutor = !!c.employee_id;
    const tutorProfile = state.profiles.find(p => p.id === c.employee_id);
    const tutorDisplay = hasTutor 
      ? escapeHtml(c.employee_name || (tutorProfile ? tutorProfile.name : "Tutor Assegnato"))
      : `<span class="badge" style="background:#fef3c7; color:#92400e; border:1px solid #fde68a;">🟡 Nessun tutor (Da abbinare)</span> <button class="btn btn-outline btn-xs" style="padding:2px 8px; font-size:11px; margin-left:4px;" onclick="window.editCourseById(${c.id})">+ Assegna Tutor</button>`;
    const docenteInfo = c.docente_referente ? escapeHtml(c.docente_referente) : "Non assegnato";

    card.innerHTML = `
      <div class="course-card-top">
        <div>
          <div class="d-flex items-center gap-1">
            <span class="course-color-pill" style="background-color: ${c.color || '#2563EB'};"></span>
            <span class="badge ${c.status === 'Attivo' ? 'badge-info' : 'badge-gray'}">${c.status}</span>
            ${c.integrates_with_contract ? '<span class="badge badge-success" style="font-size:11px;" title="Integrato con orario contrattuale d\'ufficio (nessuna sovrapposizione)">🔗 Integrato Ufficio</span>' : ''}
            ${!hasTutor ? '<span class="badge" style="background:#fef3c7; color:#92400e; border:1px solid #fde68a; font-size:11px;">Da abbinare</span>' : ''}
          </div>
          <h3 class="course-title mt-1" style="cursor: pointer;" onclick="window.openCourseDetail(${c.id})" title="Clicca per aprire la gestione completa del corso">${escapeHtml(c.name)}</h3>
          <div class="course-code">${escapeHtml(c.code || 'Nessun codice')}</div>
        </div>
        <div class="d-flex items-center gap-1">
          <button class="btn-icon" onclick="window.editCourseById(${c.id})" title="Modifica dati corso">⚙️</button>
          ${isAdmin ? `
            <button class="btn-icon" style="color: #ef4444;" onclick="window.handleDeleteCourse(${c.id})" title="Elimina corso">🗑️</button>
          ` : ''}
        </div>
      </div>

      <div class="course-progress-section">
        <div class="progress-labels">
          <span>Avanzamento Monte Ore:</span>
          <span><strong>${c.hours_worked.toFixed(1)} / ${c.total_allocated_hours.toFixed(1)} h</strong> (${c.progress_pct}%)</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${c.progress_pct}%; background-color: ${c.color || '#2563EB'};"></div>
        </div>
      </div>

      <div class="course-stats-grid">
        <div class="course-stat-box">
          <span class="course-stat-lbl">Monte Ore Stabilito</span>
          <span class="course-stat-val">${c.total_allocated_hours.toFixed(1)} h</span>
        </div>
        <div class="course-stat-box">
          <span class="course-stat-lbl">Ore Ancora da Svolgere</span>
          <span class="course-stat-val text-green">${c.hours_remaining.toFixed(1)} h</span>
        </div>
      </div>

      <div class="mt-2 text-sm" style="display:flex; flex-direction:column; gap:4px; background:var(--bg-tertiary); padding:8px 12px; border-radius:6px;">
        <div><strong>🎓 Tutor:</strong> <span>${tutorDisplay}</span></div>
        <div><strong>👨‍🏫 Docente/i:</strong> <span>${docenteInfo}</span></div>
      </div>

      <p class="text-muted text-sm mt-2">
        <em>${escapeHtml(c.notes || 'Nessuna nota aggiuntiva.')}</em>
      </p>

      <div class="course-card-actions mt-auto pt-3">
        <button class="btn btn-primary btn-block font-bold mb-2" onclick="window.openCourseDetail(${c.id})" title="Apri sotto-pagine: docenti, tutor, archivio file e variazione calendario">
          🔍 Gestisci Corso & Calendario ➔
        </button>
        <div class="d-flex justify-between items-center gap-2 flex-wrap">
          <button class="btn btn-outline btn-sm flex-1" onclick="window.openEntryModalForCourse(${c.id})">
            ➕ Registra Ore
          </button>
          ${isAdmin ? `
            <button class="btn btn-outline-danger btn-sm font-bold" onclick="window.handleDeleteCourse(${c.id})" title="Elimina questo corso dal gestionale">
              🗑️ Elimina Corso
            </button>
          ` : ''}
        </div>
      </div>
    `;

    elements.coursesGrid.appendChild(card);
  });
}

export function populateCourseSelects() {
  if (elements.entryCourse) {
    elements.entryCourse.innerHTML = '<option value="">Nessun corso (Attività d\'ufficio / Permesso)</option>';
  }
  if (elements.filterCourse) {
    elements.filterCourse.innerHTML = '<option value="">Tutti i Corsi</option>';
  }

  state.courses.forEach(c => {
    if (elements.entryCourse) {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.total_allocated_hours}h)`;
      elements.entryCourse.appendChild(opt);
    }
    if (elements.filterCourse) {
      const optF = document.createElement("option");
      optF.value = c.id;
      optF.textContent = c.name;
      elements.filterCourse.appendChild(optF);
    }
  });
}

export function openCourseModal(course = null) {
  if (!elements.formCourse) return;
  elements.formCourse.reset();

  if (elements.courseEmployeeId) {
    elements.courseEmployeeId.innerHTML = '<option value="">-- Nessun Tutor Assegnato (Assegna in seguito) --</option>';
    (state.profiles || []).forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.role === 'admin' ? 'Admin' : 'Tutor'})`;
      elements.courseEmployeeId.appendChild(opt);
    });
    elements.courseEmployeeId.value = course ? (course.employee_id || "") : "";
  }

  if (course) {
    elements.courseModalTitle.textContent = "⚙️ Modifica Dati Corso";
    elements.editCourseId.value = course.id;
    elements.courseName.value = course.name || "";
    elements.courseCode.value = course.code || "";
    elements.courseTotalHours.value = (course.total_allocated_hours !== undefined && course.total_allocated_hours !== null) ? course.total_allocated_hours : "100.0";
    elements.courseColor.value = course.color || "#2563EB";
    elements.courseStatus.value = course.status || "Attivo";
    elements.courseNotes.value = course.notes || "";
    if (elements.courseEmployeeId) elements.courseEmployeeId.value = course.employee_id ? course.employee_id : "";
    if (elements.courseDocente) elements.courseDocente.value = course.docente_referente || "";
    if (elements.courseIntegratesWithContract) {
      elements.courseIntegratesWithContract.checked = Boolean(course.integrates_with_contract);
    }
  } else {
    elements.courseModalTitle.textContent = "➕ Nuovo Corso";
    elements.editCourseId.value = "";
    elements.courseTotalHours.value = "100.0";
    elements.courseColor.value = "#2563EB";
    elements.courseStatus.value = "Attivo";
    if (elements.courseEmployeeId) elements.courseEmployeeId.value = "";
    if (elements.courseDocente) elements.courseDocente.value = "";
    if (elements.courseIntegratesWithContract) {
      elements.courseIntegratesWithContract.checked = false;
    }
  }

  if (elements.courseModalBackdrop) elements.courseModalBackdrop.classList.add("show");
}

export function closeCourseModal() {
  if (elements.courseModalBackdrop) elements.courseModalBackdrop.classList.remove("show");
}

export async function handleSaveCourse(e, onSaved) {
  e.preventDefault();

  const courseId = elements.editCourseId.value;
  const rawEmpId = elements.courseEmployeeId ? elements.courseEmployeeId.value : "";
  const payload = {
    employee_id: rawEmpId ? parseInt(rawEmpId, 10) : null,
    name: elements.courseName.value.trim(),
    code: elements.courseCode.value.trim(),
    total_allocated_hours: parseFloat(elements.courseTotalHours.value),
    color: elements.courseColor.value,
    status: elements.courseStatus.value,
    docente_referente: elements.courseDocente ? elements.courseDocente.value.trim() : "",
    notes: elements.courseNotes.value.trim(),
    integrates_with_contract: elements.courseIntegratesWithContract ? (elements.courseIntegratesWithContract.checked ? 1 : 0) : 0
  };

  try {
    if (courseId) {
      await apiCall(`/api/courses/${courseId}`, "PUT", payload);
    } else {
      await apiCall("/api/courses", "POST", payload);
    }

    closeCourseModal();
    showToast(courseId ? "Corso modificato con successo!" : "Corso creato con successo!", "success");
    if (state.selectedCourseDetailId && parseInt(courseId) === state.selectedCourseDetailId) {
      await loadCourseDetailData(state.selectedCourseDetailId);
    }
    if (onSaved) await onSaved();
  } catch (err) {
    showToast(err.message || "Errore nel salvataggio", "error");
  }
}

export async function handleDeleteCourse(id, onDeleted) {
  if (!confirm("Sei sicuro di voler eliminare questo corso e tutti i suoi calendari e sessioni collegate?")) return;
  const numId = Number(id);
  try {
    await apiCall(`/api/courses/${numId}`, "DELETE");
    showToast("Corso eliminato dal gestionale.", "info");

    // Optimistic state and DOM update immediately
    state.courses = (state.courses || []).filter(c => Number(c.id) !== numId);
    const cardEl = document.getElementById(`courseCard-${numId}`) || document.querySelector(`[data-course-id="${numId}"]`);
    if (cardEl) {
      cardEl.remove();
    }
    if (state.courses.length === 0 && elements.coursesGrid) {
      renderCoursesGrid();
    }
    populateCourseSelects();

    // If currently viewing details of this deleted course, return to list view
    if (Number(state.selectedCourseDetailId) === numId) {
      backToCoursesList();
    }

    if (onDeleted) await onDeleted();
  } catch (err) {
    showToast(err.message || "Errore nella cancellazione del corso", "error");
  }
}

export function switchCourseSubpane(targetId) {
  state.activeCourseSubpane = targetId;
  elements.courseSubtabButtons.forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-coursesubpane") === targetId);
  });
  elements.courseSubpanes.forEach(p => {
    p.classList.toggle("active", p.id === targetId);
  });
  if (targetId === "courseSubpaneCalendar" && state.currentCourseCalendar) {
    renderCourseDetailSessions(state.currentCourseCalendar);
  }
}

export async function openCourseDetail(courseId) {
  state.selectedCourseDetailId = courseId;
  if (elements.coursesListView) elements.coursesListView.style.display = "none";
  if (elements.courseDetailView) {
    elements.courseDetailView.style.display = "block";
    elements.courseDetailView.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  switchCourseSubpane("courseSubpaneOverview");
  await loadCourseDetailData(courseId);
}

export function backToCoursesList() {
  state.selectedCourseDetailId = null;
  if (elements.courseDetailView) elements.courseDetailView.style.display = "none";
  if (elements.coursesListView) elements.coursesListView.style.display = "block";
  loadCourses();
  loadMonthlyCoursesReport();
}

export async function loadCourseDetailData(courseId) {
  try {
    let course = state.courses.find(c => c.id === courseId);
    if (!course) {
      const data = await apiCall(`/api/courses?employee_id=all`);
      if (data.status === "ok") {
        state.courses = data.courses;
        course = state.courses.find(c => c.id === courseId);
      }
    }
    if (!course) {
      showToast("Corso non trovato", "error");
      backToCoursesList();
      return;
    }

    if (elements.detailCourseTitle) elements.detailCourseTitle.textContent = course.name;
    if (elements.detailCourseCode) elements.detailCourseCode.textContent = course.code || `ID ${course.id}`;
    if (elements.detailCourseColorPill) elements.detailCourseColorPill.style.backgroundColor = course.color || "#2563EB";
    if (elements.detailCourseStatus) {
      elements.detailCourseStatus.textContent = course.status || "Attivo";
      elements.detailCourseStatus.className = `badge ${course.status === 'Attivo' ? 'badge-info' : 'badge-gray'}`;
    }
    if (elements.detailCourseNotes) elements.detailCourseNotes.textContent = course.notes || "Nessuna nota aggiuntiva.";
    if (elements.detailCourseTotalHours) elements.detailCourseTotalHours.textContent = `${course.total_allocated_hours.toFixed(1)} h`;
    if (elements.detailCourseWorkedHours) elements.detailCourseWorkedHours.textContent = `${course.hours_worked.toFixed(1)} h`;
    if (elements.detailCourseRemainingHours) elements.detailCourseRemainingHours.textContent = `${course.hours_remaining.toFixed(1)} h`;
    if (elements.detailCourseProgressPct) elements.detailCourseProgressPct.textContent = `${course.progress_pct}%`;
    if (elements.courseDetailPastSessionsBadge) {
      elements.courseDetailPastSessionsBadge.textContent = course.calendar_past_count || 0;
    }

    if (elements.detailOverviewProgressText) {
      elements.detailOverviewProgressText.textContent = `${course.hours_worked.toFixed(1)} / ${course.total_allocated_hours.toFixed(1)} h (${course.progress_pct}%)`;
    }
    if (elements.detailOverviewProgressBar) {
      elements.detailOverviewProgressBar.style.width = `${course.progress_pct}%`;
      elements.detailOverviewProgressBar.style.backgroundColor = course.color || "#2563EB";
    }

    // Badge & Button Integrazione Contrattuale d'Ufficio
    const isIntegrated = Boolean(course.integrates_with_contract);
    if (elements.detailCourseContractBadge) {
      if (isIntegrated) {
        elements.detailCourseContractBadge.style.display = "inline-flex";
        elements.detailCourseContractBadge.className = "badge badge-success";
        elements.detailCourseContractBadge.textContent = "🔗 Integrato con Orario Contratto";
        elements.detailCourseContractBadge.title = "Nessuna sovrapposizione d'orario e nessun conteggio doppio con le ore d'ufficio.";
      } else {
        elements.detailCourseContractBadge.style.display = "inline-flex";
        elements.detailCourseContractBadge.className = "badge badge-gray";
        elements.detailCourseContractBadge.textContent = "⚠️ Non integrato (Orari separati)";
        elements.detailCourseContractBadge.title = "Controllo sovrapposizioni orarie attivo. Le ore d'aula si sommano a quelle d'ufficio.";
      }
    }

    if (elements.btnCourseDetailToggleContract) {
      if (isIntegrated) {
        elements.btnCourseDetailToggleContract.className = "btn btn-sm btn-contract-integrated font-bold";
        elements.btnCourseDetailToggleContract.innerHTML = "🔗 Integrato con Ufficio (Attivo)";
        elements.btnCourseDetailToggleContract.title = "Clicca per disattivare l'integrazione con l'orario contrattuale d'ufficio";
      } else {
        elements.btnCourseDetailToggleContract.className = "btn btn-sm btn-contract-unintegrated font-bold";
        elements.btnCourseDetailToggleContract.innerHTML = "🔗 Integra con ore contrattuali";
        elements.btnCourseDetailToggleContract.title = "Clicca per unire le ore del corso con quelle dell'orario lavorativo d'ufficio";
      }
    }

    const hasTutor = !!course.employee_id;
    const tutorProfile = state.profiles.find(p => p.id === course.employee_id);
    const tutorName = hasTutor 
      ? (course.employee_name || (tutorProfile ? tutorProfile.name : `Tutor #${course.employee_id}`))
      : "Non assegnato (Da abbinare)";

    if (elements.detailTutorFullName) {
      if (hasTutor) {
        elements.detailTutorFullName.textContent = tutorName;
      } else {
        elements.detailTutorFullName.innerHTML = `<span style="color:#d97706;">⚠️ Nessun tutor assegnato</span> <button class="btn btn-sm btn-outline ml-2" onclick="window.editCourseById(${course.id})">+ Assegna Tutor</button>`;
      }
    }
    if (elements.detailTutorEmail) elements.detailTutorEmail.textContent = (hasTutor && tutorProfile && tutorProfile.email) ? `Email: ${tutorProfile.email}` : "Email: Non specificata";
    if (elements.detailTutorAvatar) elements.detailTutorAvatar.textContent = hasTutor ? (tutorName || "T").charAt(0).toUpperCase() : "?";
    if (elements.detailMetaTutorName) {
      if (hasTutor) {
        elements.detailMetaTutorName.textContent = tutorName;
      } else {
        elements.detailMetaTutorName.innerHTML = `<span style="color:#d97706;">Da assegnare</span> <button class="btn btn-xs btn-outline ml-1" onclick="window.editCourseById(${course.id})">+ Assegna</button>`;
      }
    }

    const [calsData, confsData] = await Promise.all([
      apiCall("/api/course-calendars"),
      apiCall("/api/course-calendars/conflicts")
    ]);

    if (calsData.status === "ok") state.officialCalendars = calsData.calendars || [];
    if (confsData.status === "ok") state.officialConflicts = confsData.conflicts || [];

    const calSummary = state.officialCalendars.find(c => c.course_id === courseId);
    if (calSummary) {
      state.selectedCalendarId = calSummary.id;
      const detData = await apiCall(`/api/course-calendars/${calSummary.id}`);
      if (detData.status === "ok") {
        state.currentCourseCalendar = detData.calendar;
        state.currentCalendarDetail = detData.calendar;
        renderCourseCalendarOverview(detData.calendar);
        renderCourseDocentiTable(detData.calendar);
        renderCourseDetailSessions(detData.calendar);
      }
    } else {
      state.currentCourseCalendar = null;
      state.selectedCalendarId = null;
      renderEmptyCourseCalendarState();
    }
  } catch (err) {
    console.error("Errore caricamento dati dettaglio corso:", err);
  }
}

export function renderCourseCalendarOverview(cal) {
  if (!cal) return;

  if (elements.detailMetaAulaDates) {
    elements.detailMetaAulaDates.textContent = `Dal ${formatDisplayDate(cal.start_date)} al ${formatDisplayDate(cal.expected_end_date)}`;
  }
  if (elements.detailMetaAulaHours) {
    elements.detailMetaAulaHours.textContent = `${formatHours(cal.total_aula_hours || 0)} ore d'aula (${cal.aula_sessions?.length || 0} lezioni)`;
  }

  if (elements.detailMetaStageDates) {
    if (cal.stage_start_date && cal.stage_end_date) {
      elements.detailMetaStageDates.textContent = `Dal ${formatDisplayDate(cal.stage_start_date)} al ${formatDisplayDate(cal.stage_end_date)}`;
    } else if (cal.stage_start_date) {
      elements.detailMetaStageDates.textContent = `Dal ${formatDisplayDate(cal.stage_start_date)}`;
    } else {
      elements.detailMetaStageDates.textContent = "Date da definire";
    }
  }
  if (elements.detailMetaStageHours) {
    elements.detailMetaStageHours.textContent = `${formatHours(cal.total_stage_hours || 0)} ore stage (${cal.stage_sessions?.length || 0} giornate)`;
  }

  const conflictsCount = cal.conflicts_count || 0;
  if (elements.detailMetaConflictStatus) {
    if (conflictsCount > 0) {
      elements.detailMetaConflictStatus.innerHTML = `<span class="text-yellow font-bold">⚠️ ${conflictsCount} sovrapposizion${conflictsCount === 1 ? 'e' : 'i'} da risolvere!</span>`;
    } else {
      elements.detailMetaConflictStatus.innerHTML = `<span class="text-green font-bold">✓ Nessun conflitto docente</span>`;
    }
  }

  // Sezione Panoramica Test di Fine Modulo
  const moduleTests = cal.module_tests || [];
  const testsBadge = elements.detailModuleTestsBadge || document.getElementById("detailModuleTestsBadge");
  const testsTbody = elements.tbodyModuleTestsOverview || document.getElementById("tbodyModuleTestsOverview");

  if (testsBadge) {
    testsBadge.textContent = `${moduleTests.length} Test Programmat${moduleTests.length === 1 ? 'o' : 'i'}`;
  }

  if (testsTbody) {
    if (moduleTests.length === 0) {
      testsTbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center text-muted py-3">
            Nessun test di fine modulo individuato in questo corso.
          </td>
        </tr>
      `;
    } else {
      testsTbody.innerHTML = moduleTests.map(mt => `
        <tr>
          <td><strong>📅 ${mt.display_date || formatDisplayDate(mt.date)}</strong></td>
          <td><span class="text-muted font-bold">${escapeHtml(mt.day_of_week || '')}</span></td>
          <td>🕒 ${escapeHtml(mt.start_time || '')} - ${escapeHtml(mt.end_time || '')}</td>
          <td><span class="badge badge-purple font-bold">📖 ${escapeHtml(mt.modulo || '')}</span></td>
          <td><strong>👨‍🏫 ${escapeHtml(mt.docente || 'Non assegnato')}</strong></td>
          <td class="text-center"><span class="badge badge-info">${mt.hours || 0} ore</span></td>
          <td class="text-center"><span class="badge badge-success">📝 Verifica Programmata</span></td>
        </tr>
      `).join("");
    }
  }
}

export function renderCourseDocentiTable(cal) {
  if (!elements.detailTbodyDocenti) return;

  if (!cal || !cal.sessions || cal.sessions.length === 0) {
    elements.detailTbodyDocenti.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-3 text-muted">
          Nessuna lezione registrata in questo corso.
        </td>
      </tr>
    `;
    return;
  }

  const aulaSessions = cal.sessions.filter(s => s.phase === "aula");
  const docMap = new Map();

  aulaSessions.forEach(s => {
    const docName = s.docente ? s.docente.trim() : "Docente non specificato";
    const modName = s.modulo ? s.modulo.trim() : "Modulo generale";
    const key = `${docName}__${modName}`;

    if (!docMap.has(key)) {
      docMap.set(key, {
        docente: docName,
        modulo: modName,
        cf: s.codice_fiscale || "-",
        hours: 0,
        sessionsCount: 0,
        startTimes: new Set()
      });
    }
    const item = docMap.get(key);
    item.hours += (s.hours || 0);
    item.sessionsCount++;
    if (s.start_time) item.startTimes.add(s.start_time);
  });

  const docList = Array.from(docMap.values());
  elements.detailTbodyDocenti.innerHTML = "";

  docList.forEach(d => {
    const tr = document.createElement("tr");
    let fascia = "Mattina (08:30 - 13:30)";
    if (Array.from(d.startTimes).some(t => parseInt(t.split(":")[0]) >= 14)) {
      fascia = "Pomeriggio";
    }

    const testSession = (cal.module_tests || []).find(mt => 
      (mt.modulo || "").trim().toUpperCase() === d.modulo.trim().toUpperCase()
    );
    const testDateDisplay = testSession
      ? `<span class="badge-test-modulo" title="Test programmato il ${testSession.display_date || formatDisplayDate(testSession.date)}">📝 ${testSession.display_date || formatDisplayDate(testSession.date)} (${testSession.day_of_week || ''})</span>`
      : `<span class="text-muted text-xs">—</span>`;

    tr.innerHTML = `
      <td><strong>👨‍🏫 ${escapeHtml(d.docente)}</strong></td>
      <td><code>${escapeHtml(d.cf)}</code></td>
      <td><span class="badge" style="background:var(--bg-tertiary); color:var(--text-primary); border:1px solid var(--border-color);">📖 ${escapeHtml(d.modulo)}</span></td>
      <td class="text-right"><strong>${d.hours.toFixed(1)} h</strong> <small class="text-muted">(${d.sessionsCount} lez.)</small></td>
      <td class="text-center"><span class="badge badge-info">${fascia}</span></td>
      <td class="text-center">${testDateDisplay}</td>
      <td class="text-center">
        <button class="btn btn-outline btn-sm font-bold" onclick="window.filterCourseCalendarByDocente('${escapeJsString(d.docente)}')">
          🔍 Filtra Date
        </button>
      </td>
    `;
    elements.detailTbodyDocenti.appendChild(tr);
  });
}

export function populateCourseSubFilters(cal) {
  if (!elements.courseSubFilterDocente || !elements.courseSubFilterModulo) return;
  const sessions = (cal && cal.sessions) ? cal.sessions : [];

  const docenti = Array.from(new Set(sessions.map(s => (s.docente || "").trim()).filter(Boolean))).sort();
  const moduli = Array.from(new Set(sessions.map(s => (s.modulo || "").trim()).filter(Boolean))).sort();

  const curDoc = elements.courseSubFilterDocente.value;
  elements.courseSubFilterDocente.innerHTML = `<option value="all">Tutti i Docenti (${docenti.length})</option>`;
  docenti.forEach(d => {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    if (d === curDoc) opt.selected = true;
    elements.courseSubFilterDocente.appendChild(opt);
  });

  const curMod = elements.courseSubFilterModulo.value;
  elements.courseSubFilterModulo.innerHTML = `<option value="all">Tutti i Moduli (${moduli.length})</option>`;
  moduli.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    if (m === curMod) opt.selected = true;
    elements.courseSubFilterModulo.appendChild(opt);
  });
}

export function renderCourseDetailSessions(cal = state.currentCourseCalendar) {
  if (!elements.courseDetailSessionsTbody) return;

  if (!cal || !cal.sessions || cal.sessions.length === 0) {
    renderEmptyCourseCalendarState();
    return;
  }

  populateCourseSubFilters(cal);

  const docFilter = state.courseSubDocenteFilter || "all";
  const modFilter = state.courseSubModuloFilter || "all";
  const phaseFilter = state.courseSubPhaseFilter || "all";
  const query = (state.courseSubSearchQuery || "").toLowerCase().trim();

  let filtered = cal.sessions.filter(s => {
    if (docFilter !== "all" && s.docente !== docFilter) return false;
    if (modFilter !== "all" && s.modulo !== modFilter) return false;
    if (phaseFilter === "aula" && s.phase !== "aula") return false;
    if (phaseFilter === "stage" && s.phase !== "stage") return false;
    if (phaseFilter === "tests" && !s.is_module_test) return false;
    if (phaseFilter === "conflicts" && !s.has_conflict) return false;

    if (query) {
      const mDoc = (s.docente || "").toLowerCase().includes(query);
      const mMod = (s.modulo || "").toLowerCase().includes(query);
      const mTut = (s.tutor_name || "").toLowerCase().includes(query);
      const mDate = (s.date || "").includes(query);
      const mDay = (s.day_of_week || "").toLowerCase().includes(query);
      const mNotes = (s.notes || "").toLowerCase().includes(query);
      if (!mDoc && !mMod && !mTut && !mDate && !mDay && !mNotes) return false;
    }
    return true;
  });

  if (elements.courseDetailSessionsCount) {
    elements.courseDetailSessionsCount.textContent = `Mostrate: ${filtered.length} di ${cal.sessions.length} sessioni`;
  }

  if (filtered.length === 0) {
    elements.courseDetailSessionsTbody.innerHTML = `
      <tr>
        <td colspan="9" class="text-center py-4 text-muted">
          Nessuna sessione corrisponde ai filtri selezionati.
        </td>
      </tr>
    `;
    return;
  }

  elements.courseDetailSessionsTbody.innerHTML = "";
  filtered.forEach(s => {
    const tr = document.createElement("tr");
    tr.id = `courseSessionRow-${s.id}`;
    if (s.has_conflict) tr.classList.add("row-has-conflict");
    if (s.is_module_test) tr.classList.add("row-is-module-test");

    const phaseBadge = s.phase === "aula"
      ? `<span class="badge-phase-aula">🎓 AULA</span>`
      : `<span class="badge-phase-stage">💼 STAGE</span>`;

    const docenteDisplay = s.phase === "aula"
      ? (s.docente ? `<strong>👨‍🏫 ${escapeHtml(s.docente)}</strong>` : `<span class="text-muted">Docente non assegnato</span>`)
      : `<span class="text-muted text-sm">— Stage</span>`;

    const testBadge = s.is_module_test
      ? `<div class="mt-1"><span class="badge-test-modulo">📝 Test Finale di Modulo</span></div>`
      : "";

    const moduloDisplay = s.phase === "aula"
      ? (s.modulo ? `<div>📖 <strong>${escapeHtml(s.modulo)}</strong></div>${testBadge}` : `<span class="text-muted">—</span>`)
      : `<span class="text-muted text-sm">— Stage</span>`;

    const tutorDisplay = s.tutor_name
      ? `<span>${escapeHtml(s.tutor_name)}</span>`
      : `<span class="text-muted text-sm">—</span>`;

    let statusBadge = `<span class="badge badge-success">✅ Confermata</span>`;
    let rescheduleNotice = "";

    if (s.status === "rinviata") {
      statusBadge = `<span class="badge badge-warning">🔄 Rinviata</span>`;
      const newD = s.rescheduled_to_date ? formatDisplayDate(s.rescheduled_to_date) : "Data TBD";
      const newT = (s.rescheduled_to_start && s.rescheduled_to_end) ? ` ${s.rescheduled_to_start}-${s.rescheduled_to_end}` : "";
      const reason = s.reschedule_reason ? ` — <em>${escapeHtml(s.reschedule_reason)}</em>` : "";
      rescheduleNotice = `<div class="text-xs text-amber font-bold mt-1">↳ Nuova data: ${newD}${newT}${reason}</div>`;
    } else if (s.status === "annullata") {
      statusBadge = `<span class="badge badge-danger">❌ Annullata</span>`;
      const reason = s.reschedule_reason ? ` (${escapeHtml(s.reschedule_reason)})` : "";
      rescheduleNotice = `<div class="text-xs text-danger font-bold mt-1">Lezione annullata${reason}</div>`;
    } else if (s.status === "svolta") {
      statusBadge = `<span class="badge badge-info">☑️ Svolta</span>`;
    }

    let conflictCell = "";
    if (s.has_conflict) {
      const confMsg = s.conflicts && s.conflicts[0] ? s.conflicts[0].warning_message : "Sovrapposizione oraria docente!";
      conflictCell = `
        <span class="badge badge-danger" title="${escapeHtml(confMsg)}">⚠️ SOVRAPPOSIZIONE!</span>
        <div class="text-xs text-danger mt-1 font-bold">${escapeHtml(confMsg)}</div>
      `;
    } else {
      conflictCell = `<span class="badge badge-success text-xs font-bold">✓ Regolare</span>`;
    }

    tr.innerHTML = `
      <td>
        <strong>${formatDisplayDate(s.date)}</strong>
        <div class="text-muted text-xs font-bold">${s.day_of_week || ''}</div>
      </td>
      <td>${phaseBadge}</td>
      <td>
        <strong>${s.start_time} - ${s.end_time}</strong>
        <div class="text-muted text-xs">(${s.hours} ore)</div>
      </td>
      <td>${docenteDisplay}</td>
      <td>${moduloDisplay}</td>
      <td>${tutorDisplay}</td>
      <td>
        ${statusBadge}
        ${rescheduleNotice}
      </td>
      <td>${conflictCell}</td>
      <td class="text-center admin-col">
        <div class="d-flex justify-center gap-1 flex-wrap">
          <button class="btn btn-sm btn-outline-primary font-bold" title="Modifica data, orari o dettagli di questa lezione" onclick="window.openEditSessionModalById(${s.id})">
            ✏️ Varia
          </button>
          <button class="btn btn-sm btn-outline font-bold" title="Rinvia ad altra data o annulla" onclick="window.openRescheduleModalById(${s.id})">
            🔄 Rinvia
          </button>
          <button class="btn btn-sm btn-danger font-bold" title="Elimina definitivamente questa lezione dal calendario" onclick="window.handleDeleteSessionById(${s.id})">
            🗑️ Elimina
          </button>
        </div>
      </td>
    `;
    elements.courseDetailSessionsTbody.appendChild(tr);
  });
}

export function renderEmptyCourseCalendarState() {
  if (elements.courseDetailSessionsCount) elements.courseDetailSessionsCount.textContent = "Mostrate: 0 sessioni";
  if (elements.courseDetailSessionsTbody) {
    elements.courseDetailSessionsTbody.innerHTML = `
      <tr>
        <td colspan="9" class="text-center py-4 text-muted">
          <div style="font-size: 1.05rem; font-weight: 600; margin-bottom: 0.35rem; color: var(--navy);">📅 Nessun calendario attivo per questo corso</div>
          <p class="text-sm text-muted mb-3">Carica il file Excel con lezioni, orari e docenti o aggiungi una singola lezione manualmente.</p>
          <button type="button" class="btn btn-primary btn-sm font-bold" onclick="window.openCourseDetailAddSession()">
            ➕ Nuova Lezione / Giornata
          </button>
        </td>
      </tr>
    `;
  }
}

export function initCourseDetailCalendarFilterEvents() {
  if (elements.courseSubFilterDocente) {
    elements.courseSubFilterDocente.addEventListener("change", (e) => {
      state.courseSubDocenteFilter = e.target.value;
      renderCourseDetailSessions();
    });
  }
  if (elements.courseSubFilterModulo) {
    elements.courseSubFilterModulo.addEventListener("change", (e) => {
      state.courseSubModuloFilter = e.target.value;
      renderCourseDetailSessions();
    });
  }
  if (elements.courseSubFilterPhase) {
    elements.courseSubFilterPhase.addEventListener("change", (e) => {
      state.courseSubPhaseFilter = e.target.value;
      renderCourseDetailSessions();
    });
  }
  if (elements.courseSubSearchInput) {
    let debounce;
    elements.courseSubSearchInput.addEventListener("input", (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        state.courseSubSearchQuery = e.target.value;
        renderCourseDetailSessions();
      }, 250);
    });
  }
}

export async function loadMonthlyCoursesReport() {
  if (!elements.tbodyMonthlyCourses) return;
  const month = elements.courseReportMonthSelect ? elements.courseReportMonthSelect.value : "";
  try {
    const data = await apiCall(`/api/reports/monthly-courses?employee_id=${state.currentEmployeeId}&month_year=${encodeURIComponent(month)}`);
    if (data.status === "ok") {
      renderMonthlyCoursesTable(data.report);
    }
  } catch (err) {
    console.error("Monthly courses err:", err);
  }
}

export function renderMonthlyCoursesTable(report) {
  if (!elements.tbodyMonthlyCourses) return;
  elements.tbodyMonthlyCourses.innerHTML = "";

  if (!report || report.courses.length === 0) {
    elements.tbodyMonthlyCourses.innerHTML = `
      <tr>
        <td colspan="7" class="text-center text-muted" style="padding: 2rem;">
          Nessun dato registrato per questo mese.
        </td>
      </tr>
    `;
    return;
  }

  report.courses.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="font-bold">${escapeHtml(c.code || '-')}</td>
      <td>
        <span class="course-color-pill" style="background-color: ${c.color};"></span>
        <strong>${escapeHtml(c.name)}</strong>
      </td>
      <td class="text-right font-bold">${formatHours(c.total_allocated_hours)}</td>
      <td class="text-right font-bold ${c.month_hours > 0 ? 'text-primary' : ''}">${formatHours(c.month_hours)}</td>
      <td class="text-right font-bold text-green">${formatHours(c.total_worked)}</td>
      <td class="text-right font-bold ${c.hours_remaining < 0 ? 'text-red' : ''}">${formatHours(c.hours_remaining)}</td>
      <td class="text-center font-bold">${c.progress_pct}%</td>
    `;
    elements.tbodyMonthlyCourses.appendChild(tr);
  });

  if (elements.totCourseAllocated) elements.totCourseAllocated.textContent = formatHours(report.totals.allocated);
  if (elements.totCourseMonthHours) elements.totCourseMonthHours.textContent = formatHours(report.totals.month_worked);
  if (elements.totCourseWorked) elements.totCourseWorked.textContent = formatHours(report.totals.worked);
  if (elements.totCourseRemaining) elements.totCourseRemaining.textContent = formatHours(report.totals.remaining);
}

// -------------------------------------------------------------
// SYSTEM INTEGRITY & DISCREPANCY AUDITOR
// -------------------------------------------------------------

export async function checkSystemDiscrepancies() {
  try {
    const data = await apiCall("/api/system/discrepancies");
    if (data.status === "ok") {
      state.systemDiscrepancies = data.discrepancies || [];
      renderDiscrepancyBanner();
    }
  } catch (err) {
    console.error("Discrepancies check error:", err);
  }
}

export function renderDiscrepancyBanner() {
  const container = elements.systemDiscrepancyContainer;
  if (!container) return;

  if (!state.systemDiscrepancies || state.systemDiscrepancies.length === 0) {
    container.style.display = "none";
    container.innerHTML = "";
    return;
  }

  container.style.display = "block";
  container.innerHTML = "";

  state.systemDiscrepancies.forEach((d, idx) => {
    const card = document.createElement("div");
    card.className = "card p-3 mb-3";
    card.style.cssText = "background: #fffbeb; border: 1.5px solid #f59e0b; border-radius: 8px; box-shadow: 0 2px 4px rgba(245, 158, 11, 0.1);";

    let detailsText = "";
    if (d.type === "duplicate_course_code") {
      const c1 = d.courses[0] || {};
      const c2 = d.courses[1] || {};
      detailsText = `Il gestionale ha rilevato <strong>${d.courses.length} schede corso distinte</strong> con lo stesso codice <strong>${escapeHtml(d.code)}</strong>: `
        + `una creata con nome <em>"${escapeHtml(c1.name)}"</em> (${c1.sessions_count || 0} lezioni caricate) `
        + `e una con nome <em>"${escapeHtml(c2.name)}"</em> (${c2.sessions_count || 0} lezioni caricate). `
        + `Questa duplicazione altera i conteggi complessivi del monte ore.`;
    } else {
      detailsText = escapeHtml(d.description || d.title);
    }

    card.innerHTML = `
      <div class="d-flex items-center justify-between flex-wrap gap-3">
        <div class="d-flex items-center gap-3">
          <span style="font-size: 2.2rem; line-height: 1;">⚠️</span>
          <div>
            <div class="d-flex items-center gap-2">
              <strong style="color: #b45309; font-size: 1.05rem;">Controllo Coerenza Dati: Discrepanza rilevata nel gestionale!</strong>
              <span class="badge badge-warning" style="background: #fef3c7; color: #b45309; border: 1px solid #fde68a;">Azione Richiesta</span>
            </div>
            <div class="text-sm mt-1" style="color: #78350f;">
              ${detailsText}
            </div>
          </div>
        </div>
        <div>
          <button type="button" class="btn btn-warning" onclick="window.openResolveDiscrepancyModal(${idx})" style="font-weight: 600; white-space: nowrap; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            🛠️ Risolvi e Unifica Corso
          </button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

export function openResolveDiscrepancyModal(idx) {
  const d = state.systemDiscrepancies[idx];
  if (!d) return;

  state.selectedDiscrepancy = d;

  if (elements.discrepancyModalDescription) {
    elements.discrepancyModalDescription.innerHTML = `
      <strong>🔍 Anomalia rilevata dal sistema:</strong><br>
      Codice corso <strong>${escapeHtml(d.code)}</strong> presente in ${d.courses.length} schede diverse:
      <ul style="margin: 0.5rem 0 0.5rem 1.25rem; padding: 0;">
        ${d.courses.map(c => `
          <li>
            <strong>${escapeHtml(c.name)}</strong> (ID #${c.id}) — ${c.sessions_count > 0 ? `📅 <strong>${c.sessions_count} lezioni</strong> caricate nel calendario` : '⚪ Scheda vuota (0 lezioni)'}
          </li>
        `).join("")}
      </ul>
      Scegli come desideri che il gestionale le unifichi:
    `;
  }

  // Populate Radio Options
  if (elements.discrepancyRadioGroup && d.courses.length >= 2) {
    const c1 = d.courses[0];
    const c2 = d.courses[1];
    const combinedName = `${c1.name} - ${c2.name}`;

    elements.discrepancyRadioGroup.innerHTML = `
      <label class="card p-2 d-flex items-center gap-2 cursor-pointer" style="border: 1.5px solid var(--border-color); border-radius: 6px;">
        <input type="radio" name="discrepancyNameChoice" value="${escapeHtml(c1.name)}" checked>
        <div>
          <strong>Mantieni il nome inserito: "${escapeHtml(c1.name)}"</strong>
          <div class="text-xs text-muted">Mantiene il tuo titolo inserito a mano e vi collega l'intero calendario e tutti i docenti.</div>
        </div>
      </label>

      <label class="card p-2 d-flex items-center gap-2 cursor-pointer" style="border: 1.5px solid var(--border-color); border-radius: 6px;">
        <input type="radio" name="discrepancyNameChoice" value="${escapeHtml(combinedName)}">
        <div>
          <strong>Combina entrambi i nomi: "${escapeHtml(combinedName)}"</strong>
          <div class="text-xs text-muted">Include sia l'avviso che il nome del corso formativo.</div>
        </div>
      </label>

      <label class="card p-2 d-flex items-center gap-2 cursor-pointer" style="border: 1.5px solid var(--border-color); border-radius: 6px;">
        <input type="radio" name="discrepancyNameChoice" value="${escapeHtml(c2.name)}">
        <div>
          <strong>Usa il nome del calendario: "${escapeHtml(c2.name)}"</strong>
          <div class="text-xs text-muted">Usa il nome estratto dal file del calendario.</div>
        </div>
      </label>

      <label class="card p-2 d-flex items-center gap-2 cursor-pointer" style="border: 1.5px solid var(--border-color); border-radius: 6px;">
        <input type="radio" name="discrepancyNameChoice" value="__custom__">
        <div>
          <strong>Scrivi un nome personalizzato...</strong>
        </div>
      </label>
    `;

    const radios = elements.discrepancyRadioGroup.querySelectorAll('input[name="discrepancyNameChoice"]');
    radios.forEach(r => {
      r.addEventListener("change", (e) => {
        if (elements.discrepancyCustomNameBox) {
          elements.discrepancyCustomNameBox.style.display = e.target.value === "__custom__" ? "block" : "none";
          if (e.target.value === "__custom__" && elements.inputDiscrepancyCustomName) {
            elements.inputDiscrepancyCustomName.focus();
          }
        }
      });
    });
  }

  if (elements.discrepancyCustomNameBox) elements.discrepancyCustomNameBox.style.display = "none";
  if (elements.inputDiscrepancyCustomName) elements.inputDiscrepancyCustomName.value = "";

  if (elements.modalResolveDiscrepancyBackdrop) {
    elements.modalResolveDiscrepancyBackdrop.classList.add("show");
  }
}
window.openResolveDiscrepancyModal = openResolveDiscrepancyModal;

export function closeResolveDiscrepancyModal() {
  if (elements.modalResolveDiscrepancyBackdrop) {
    elements.modalResolveDiscrepancyBackdrop.classList.remove("show");
  }
  state.selectedDiscrepancy = null;
}

export async function handleExecuteResolveDiscrepancy() {
  const d = state.selectedDiscrepancy;
  if (!d || !d.courses || d.courses.length < 2) {
    showToast("Nessuna anomalia selezionata per la risoluzione", "warning");
    return;
  }

  const selectedRadio = document.querySelector('input[name="discrepancyNameChoice"]:checked');
  if (!selectedRadio) {
    showToast("Seleziona una delle opzioni di unificazione", "warning");
    return;
  }

  let finalName = selectedRadio.value;
  if (finalName === "__custom__") {
    finalName = elements.inputDiscrepancyCustomName ? elements.inputDiscrepancyCustomName.value.trim() : "";
    if (!finalName) {
      showToast("Inserisci il nome personalizzato desiderato", "warning");
      return;
    }
  }

  const cWithCalendar = d.courses.find(c => c.calendars_count > 0) || d.courses[1];
  const cEmpty = d.courses.find(c => c.id !== cWithCalendar.id) || d.courses[0];

  const primaryId = cWithCalendar.id;
  const secondaryId = cEmpty.id;

  const btn = elements.btnExecuteResolveDiscrepancy;
  btn.disabled = true;
  btn.textContent = "⏳ Applicazione correzione in corso...";

  try {
    const res = await apiCall("/api/system/resolve-discrepancy", "POST", {
      action: "merge_courses",
      primary_course_id: primaryId,
      secondary_course_id: secondaryId,
      target_name: finalName
    });

    if (res.status === "ok") {
      closeResolveDiscrepancyModal();
      showToast(`🎉 Problema risolto! Corsi unificati sotto '${finalName}'.`, "success");
      await loadCourses();
      await loadMonthlyCoursesReport();
      await checkSystemDiscrepancies();
    } else {
      showToast(res.message || "Errore durante la risoluzione", "error");
    }
  } catch (err) {
    showToast(err.message || "Errore di rete durante la risoluzione", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "⚡ Applica Correzione Automatica";
  }
}

export function initDiscrepancyEvents() {
  if (elements.btnCloseResolveDiscrepancyModal) {
    elements.btnCloseResolveDiscrepancyModal.addEventListener("click", closeResolveDiscrepancyModal);
  }
  if (elements.btnCancelResolveDiscrepancy) {
    elements.btnCancelResolveDiscrepancy.addEventListener("click", closeResolveDiscrepancyModal);
  }
  if (elements.btnExecuteResolveDiscrepancy) {
    elements.btnExecuteResolveDiscrepancy.addEventListener("click", handleExecuteResolveDiscrepancy);
  }
  if (elements.btnCourseDetailSyncTutorEntries) {
    elements.btnCourseDetailSyncTutorEntries.addEventListener("click", () => {
      if (state.selectedCourseDetailId) {
        handleSyncTutorCourseEntries(state.selectedCourseDetailId);
      }
    });
  }
}

export async function handleSyncTutorCourseEntries(courseId) {
  try {
    const res = await apiCall(`/api/courses/${courseId}/sync-calendar-entries`, "POST", {
      employee_id: state.currentEmployeeId || 26
    });
    if (res.status === "ok") {
      if (res.synced_count > 0) {
        showToast(`🎉 Sincronizzate ${res.synced_count} presenze tutor (${res.total_synced_hours}h) nella tua Banca Ore!`, "success");
      } else {
        showToast("Tutte le presenze passate risultano già registrate!", "info");
      }
      await loadCourses();
      await loadCourseDetailData(courseId);
      if (window.loadTutorDashboard) await window.loadTutorDashboard();
      if (window.loadMasterSchedule) await window.loadMasterSchedule();
    }
  } catch (err) {
    showToast(err.message || "Errore sincronizzazione presenze", "error");
  }
}


// =============================================================
// COURSE ATTENDANCE IMPORT & INTERACTIVE RECONCILIATION
// =============================================================

export function openAttendanceModal(courseId) {
  const cid = courseId || state.selectedCourseDetailId;
  if (!cid) {
    showToast("Seleziona prima un corso.", "warning");
    return;
  }
  state.selectedCourseDetailId = cid;

  const course = (state.courses || []).find(c => c.id === cid) || 
                 ((state.tutorDashboardData && state.tutorDashboardData.assigned_courses) || []).find(c => c.id === cid);
  if (elements.attendanceModalCourseName) {
    elements.attendanceModalCourseName.textContent = course ? `${course.code ? '[' + course.code + '] ' : ''}${course.name}` : `Corso #${cid}`;
  }

  // Reset modal state
  state.attendanceImportData = null;
  state.attendanceSelectedFile = null;

  if (elements.attendancePhaseUpload) elements.attendancePhaseUpload.style.display = "block";
  if (elements.attendancePhaseReview) elements.attendancePhaseReview.style.display = "none";
  if (elements.attendanceFileSelectedNotice) elements.attendanceFileSelectedNotice.style.display = "none";
  if (elements.inputAttendanceFile) elements.inputAttendanceFile.value = "";
  if (elements.btnProcessAttendanceFile) {
    elements.btnProcessAttendanceFile.style.display = "inline-flex";
    elements.btnProcessAttendanceFile.disabled = true;
    elements.btnProcessAttendanceFile.textContent = "🔍 Analizza & Confronta col Corso";
  }
  if (elements.btnBackToAttendanceUpload) elements.btnBackToAttendanceUpload.style.display = "none";
  if (elements.btnConfirmAttendanceSave) elements.btnConfirmAttendanceSave.style.display = "none";

  openBackdropModal("modalAttendanceImportBackdrop");
}

export function closeAttendanceModal() {
  closeBackdropModal("modalAttendanceImportBackdrop");
  state.attendanceImportData = null;
  state.attendanceSelectedFile = null;
}

export function handleAttendanceFileSelected(file) {
  if (!file) return;
  state.attendanceSelectedFile = file;

  if (elements.attendanceSelectedFileName) elements.attendanceSelectedFileName.textContent = file.name;
  if (elements.attendanceSelectedFileSize) elements.attendanceSelectedFileSize.textContent = formatFileSize(file.size);
  if (elements.attendanceFileSelectedNotice) elements.attendanceFileSelectedNotice.style.display = "flex";
  if (elements.btnProcessAttendanceFile) elements.btnProcessAttendanceFile.disabled = false;
}

export function resetAttendanceFile() {
  state.attendanceSelectedFile = null;
  if (elements.inputAttendanceFile) elements.inputAttendanceFile.value = "";
  if (elements.attendanceFileSelectedNotice) elements.attendanceFileSelectedNotice.style.display = "none";
  if (elements.btnProcessAttendanceFile) elements.btnProcessAttendanceFile.disabled = true;
}

export async function processAttendanceFile() {
  if (!state.attendanceSelectedFile) {
    showToast("Seleziona prima un file.", "warning");
    return;
  }

  const courseId = state.selectedCourseDetailId;
  if (!courseId) return;

  const btn = elements.btnProcessAttendanceFile;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Analisi e confronto in corso...";
  }

  try {
    const formData = new FormData();
    formData.append("file", state.attendanceSelectedFile);

    const data = await apiCall(`/api/courses/${courseId}/parse-attendance-file`, "POST", formData, true);

    if (data.status === "ok") {
      state.attendanceImportData = data;
      showToast(`Estratte ${data.total_entries} giornate (${data.total_hours}h totali)`, "info");

      // Switch to Review Phase
      if (elements.attendancePhaseUpload) elements.attendancePhaseUpload.style.display = "none";
      if (elements.attendancePhaseReview) elements.attendancePhaseReview.style.display = "block";
      if (elements.btnProcessAttendanceFile) elements.btnProcessAttendanceFile.style.display = "none";
      if (elements.btnBackToAttendanceUpload) elements.btnBackToAttendanceUpload.style.display = "inline-flex";
      if (elements.btnConfirmAttendanceSave) elements.btnConfirmAttendanceSave.style.display = "inline-flex";

      renderAttendanceReviewTable();
    } else {
      showToast(data.message || "Errore durante l'analisi del file", "error");
    }
  } catch (err) {
    showToast(err.message || "Errore di caricamento file", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🔍 Analizza & Confronta col Corso";
    }
  }
}

export function renderAttendanceReviewTable() {
  const data = state.attendanceImportData;
  if (!data || !elements.tbodyAttendanceReview) return;

  // Update Summary Stats
  const entries = data.entries || [];
  const selectedEntries = entries.filter(e => e.selected);
  const totalHours = entries.reduce((acc, e) => acc + (e.hours || 0), 0);
  const matchesCount = entries.filter(e => e.status === "match").length;
  const warningsCount = entries.filter(e => e.status === "warning_hours").length;
  const mismatchesCount = entries.filter(e => e.status === "mismatch").length;

  if (elements.statAttendanceTotalEntries) elements.statAttendanceTotalEntries.textContent = entries.length;
  if (elements.statAttendanceTotalHours) elements.statAttendanceTotalHours.textContent = totalHours.toFixed(1);
  if (elements.statAttendanceFileName) elements.statAttendanceFileName.textContent = data.filename || "--";

  if (elements.statBadgeMatches) {
    elements.statBadgeMatches.textContent = `✅ ${matchesCount} Corrispondenti`;
  }
  if (elements.statBadgeWarnings) {
    elements.statBadgeWarnings.style.display = warningsCount > 0 ? "inline-flex" : "none";
    elements.statBadgeWarnings.textContent = `⚠️ ${warningsCount} Ore Difformi`;
  }
  if (elements.statBadgeMismatches) {
    elements.statBadgeMismatches.style.display = mismatchesCount > 0 ? "inline-flex" : "none";
    elements.statBadgeMismatches.textContent = `❌ ${mismatchesCount} Non nel corso`;
  }

  // Update Confirm Button
  const selHours = selectedEntries.reduce((acc, e) => acc + (e.hours || 0), 0);
  if (elements.btnConfirmAttendanceSave) {
    elements.btnConfirmAttendanceSave.disabled = selectedEntries.length === 0;
    elements.btnConfirmAttendanceSave.innerHTML = `🚀 Conferma & Registra ${selectedEntries.length} Presenze (${selHours.toFixed(1)}h)`;
  }

  // Populate Table Body
  elements.tbodyAttendanceReview.innerHTML = "";

  if (entries.length === 0) {
    elements.tbodyAttendanceReview.innerHTML = `
      <tr>
        <td colspan="6" class="text-center py-4 text-muted">
          Nessuna riga valida estratta dal documento.
        </td>
      </tr>
    `;
    return;
  }

  const courseSessions = data.course_sessions || [];

  entries.forEach(item => {
    const tr = document.createElement("tr");
    if (item.status === "match") tr.className = "row-attendance-match";
    else if (item.status === "warning_hours") tr.className = "row-attendance-warning";
    else tr.className = "row-attendance-mismatch";

    // Build session options for mismatch fixer
    let sessionOptionsHtml = `<option value="">-- Associa a sessione del corso --</option>`;
    courseSessions.forEach(s => {
      const isSel = item.matched_session_id === s.id ? "selected" : "";
      sessionOptionsHtml += `<option value="${s.id}" ${isSel}>${s.display_date} (${s.hours}h) - ${escapeHtml(s.modulo.slice(0, 30))}</option>`;
    });

    let statusHtml = "";
    if (item.status === "match") {
      statusHtml = `
        <span class="badge-success">✅ Corrisponde</span>
        <div class="text-xs text-muted mt-1 font-semibold">${escapeHtml(item.status_detail || '')}</div>
      `;
    } else if (item.status === "warning_hours") {
      statusHtml = `
        <span class="badge-warning">⚠️ Ore difformi (${item.hours}h vs ${item.expected_hours}h)</span>
        <div class="text-xs text-muted mt-1 font-semibold">${escapeHtml(item.status_detail || '')}</div>
      `;
    } else {
      statusHtml = `
        <div class="d-flex flex-col gap-1">
          <div class="d-flex items-center gap-2 flex-wrap">
            <span class="badge-danger">❌ Data non nel corso</span>
            <span class="text-xs text-danger font-semibold">${escapeHtml(item.status_detail || '')}</span>
          </div>
          <div class="d-flex items-center gap-2 mt-1">
            <span class="text-xs font-bold text-primary">👉 Correggi con data del corso:</span>
            <select class="select-fix-session form-select form-select-xs att-row-fix-session" data-row-id="${item.row_id}">
              ${sessionOptionsHtml}
            </select>
          </div>
        </div>
      `;
    }

    tr.innerHTML = `
      <td style="text-align: center; vertical-align: middle;">
        <input type="checkbox" class="att-row-check" data-row-id="${item.row_id}" ${item.selected ? "checked" : ""}>
      </td>
      <td style="vertical-align: middle;">
        <input type="date" class="form-input form-input-sm att-row-date" data-row-id="${item.row_id}" value="${item.date}" style="padding: 0.25rem 0.4rem; font-size: 0.82rem; font-weight: 600;">
        <div class="text-xs text-muted mt-1 font-bold">${escapeHtml(item.day_of_week || '')}</div>
      </td>
      <td style="vertical-align: middle;">
        <input type="number" step="0.5" min="0.5" max="14" class="form-input form-input-sm att-row-hours text-right" data-row-id="${item.row_id}" value="${item.hours}" style="padding: 0.25rem 0.4rem; font-size: 0.85rem; font-weight: 700; width: 70px;">
      </td>
      <td style="vertical-align: middle;">
        <input type="text" class="form-input form-input-sm att-row-modulo" data-row-id="${item.row_id}" value="${escapeHtml(item.modulo || '')}" placeholder="Modulo / Attività" style="padding: 0.25rem 0.4rem; font-size: 0.82rem;">
      </td>
      <td style="vertical-align: middle;">
        ${statusHtml}
      </td>
      <td style="text-align: center; vertical-align: middle;">
        <button type="button" class="btn btn-outline-danger btn-sm att-row-delete" data-row-id="${item.row_id}" title="Elimina riga" style="padding: 0.2rem 0.45rem;">
          🗑️
        </button>
      </td>
    `;

    elements.tbodyAttendanceReview.appendChild(tr);
  });

  // Attach Event Handlers
  elements.tbodyAttendanceReview.querySelectorAll(".att-row-check").forEach(chk => {
    chk.addEventListener("change", (e) => {
      const rid = parseInt(e.target.dataset.rowId);
      const entry = data.entries.find(x => x.row_id === rid);
      if (entry) {
        entry.selected = e.target.checked;
        const selCount = data.entries.filter(x => x.selected).length;
        const selHrs = data.entries.filter(x => x.selected).reduce((acc, x) => acc + x.hours, 0);
        if (elements.btnConfirmAttendanceSave) {
          elements.btnConfirmAttendanceSave.disabled = selCount === 0;
          elements.btnConfirmAttendanceSave.innerHTML = `🚀 Conferma & Registra ${selCount} Presenze (${selHrs.toFixed(1)}h)`;
        }
      }
    });
  });

  elements.tbodyAttendanceReview.querySelectorAll(".att-row-date").forEach(input => {
    input.addEventListener("change", (e) => {
      const rid = parseInt(e.target.dataset.rowId);
      const entry = data.entries.find(x => x.row_id === rid);
      if (!entry) return;

      const newDate = e.target.value;
      entry.date = newDate;

      // Re-check against course sessions
      const matched = (data.course_sessions || []).find(s => s.date === newDate);
      if (matched) {
        entry.status = "match";
        entry.matched_session_id = matched.id;
        entry.display_date = matched.display_date;
        entry.modulo = matched.modulo;
        entry.expected_hours = matched.hours;
        entry.status_detail = `Lezione confermata: ${matched.modulo}`;
      } else {
        entry.status = "mismatch";
        entry.matched_session_id = null;
        entry.status_detail = `Nessuna lezione in calendario il ${newDate}.`;
      }
      renderAttendanceReviewTable();
    });
  });

  elements.tbodyAttendanceReview.querySelectorAll(".att-row-hours").forEach(input => {
    input.addEventListener("input", (e) => {
      const rid = parseInt(e.target.dataset.rowId);
      const entry = data.entries.find(x => x.row_id === rid);
      if (entry) {
        const val = parseFloat(e.target.value) || 0;
        entry.hours = val;
        if (entry.expected_hours) {
          entry.status = Math.abs(val - entry.expected_hours) > 0.01 ? "warning_hours" : "match";
        }
      }
    });
  });

  elements.tbodyAttendanceReview.querySelectorAll(".att-row-modulo").forEach(input => {
    input.addEventListener("input", (e) => {
      const rid = parseInt(e.target.dataset.rowId);
      const entry = data.entries.find(x => x.row_id === rid);
      if (entry) entry.modulo = e.target.value;
    });
  });

  // Re-linking mismatch session dropdown
  elements.tbodyAttendanceReview.querySelectorAll(".att-row-fix-session").forEach(select => {
    select.addEventListener("change", (e) => {
      const rid = parseInt(e.target.dataset.rowId);
      const sid = parseInt(e.target.value);
      if (!sid) return;

      const entry = data.entries.find(x => x.row_id === rid);
      const session = (data.course_sessions || []).find(s => s.id === sid);
      if (entry && session) {
        entry.date = session.date;
        entry.display_date = session.display_date;
        entry.hours = session.hours;
        entry.modulo = session.modulo;
        entry.docente = session.docente;
        entry.matched_session_id = session.id;
        entry.expected_hours = session.hours;
        entry.start_time = session.start_time;
        entry.end_time = session.end_time;
        entry.status = "match";
        entry.status_detail = `Riassegnata a lezione: ${session.modulo} (${session.display_date})`;
        showToast(`Riga ${rid} associata con successo al ${session.display_date}!`, "success");
        renderAttendanceReviewTable();
      }
    });
  });

  elements.tbodyAttendanceReview.querySelectorAll(".att-row-delete").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const rid = parseInt(e.currentTarget.dataset.rowId);
      data.entries = data.entries.filter(x => x.row_id !== rid);
      renderAttendanceReviewTable();
    });
  });
}

export async function confirmAttendanceSave() {
  const data = state.attendanceImportData;
  if (!data || !data.entries) return;

  const selectedEntries = data.entries.filter(e => e.selected);
  if (selectedEntries.length === 0) {
    showToast("Nessuna presenza selezionata da registrare.", "warning");
    return;
  }

  const courseId = state.selectedCourseDetailId;
  if (!courseId) return;

  const btn = elements.btnConfirmAttendanceSave;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Salvataggio in corso...";
  }

  try {
    const res = await apiCall(`/api/courses/${courseId}/confirm-attendance-entries`, "POST", {
      employee_id: state.currentEmployeeId || 26,
      entries: selectedEntries
    });

    if (res.status === "ok") {
      closeAttendanceModal();
      showToast(`🎉 Registrate con successo ${res.saved_count} presenze tutor (${res.total_hours}h) per questo corso!`, "success");
      await loadCourses();
      await loadCourseDetailData(courseId);
      if (window.loadTutorDashboard) await window.loadTutorDashboard();
      if (window.loadMasterSchedule) await window.loadMasterSchedule();
    } else {
      showToast(res.message || "Errore durante il salvataggio", "error");
    }
  } catch (err) {
    showToast(err.message || "Errore di connessione", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
    }
  }
}

export function initAttendanceImportEvents() {
  if (elements.btnOpenAttendanceModal) {
    elements.btnOpenAttendanceModal.addEventListener("click", () => openAttendanceModal());
  }
  if (elements.btnOpenAttendanceModalSecondary) {
    elements.btnOpenAttendanceModalSecondary.addEventListener("click", () => openAttendanceModal());
  }
  if (elements.btnCloseAttendanceModal) {
    elements.btnCloseAttendanceModal.addEventListener("click", closeAttendanceModal);
  }
  if (elements.btnCancelAttendanceModal) {
    elements.btnCancelAttendanceModal.addEventListener("click", closeAttendanceModal);
  }

  // File Dropzone & Input
  if (elements.attendanceDropzone) {
    elements.attendanceDropzone.addEventListener("click", () => {
      if (elements.inputAttendanceFile) elements.inputAttendanceFile.click();
    });
    elements.attendanceDropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      elements.attendanceDropzone.style.borderColor = "var(--primary)";
      elements.attendanceDropzone.style.background = "rgba(37, 99, 235, 0.08)";
    });
    elements.attendanceDropzone.addEventListener("dragleave", () => {
      elements.attendanceDropzone.style.borderColor = "var(--accent-blue)";
      elements.attendanceDropzone.style.background = "var(--bg-subtle)";
    });
    elements.attendanceDropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      elements.attendanceDropzone.style.borderColor = "var(--accent-blue)";
      elements.attendanceDropzone.style.background = "var(--bg-subtle)";
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleAttendanceFileSelected(e.dataTransfer.files[0]);
      }
    });
  }

  if (elements.inputAttendanceFile) {
    elements.inputAttendanceFile.addEventListener("change", (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleAttendanceFileSelected(e.target.files[0]);
      }
    });
  }

  if (elements.btnResetAttendanceFile) {
    elements.btnResetAttendanceFile.addEventListener("click", resetAttendanceFile);
  }

  if (elements.btnProcessAttendanceFile) {
    elements.btnProcessAttendanceFile.addEventListener("click", processAttendanceFile);
  }

  if (elements.btnBackToAttendanceUpload) {
    elements.btnBackToAttendanceUpload.addEventListener("click", () => {
      if (elements.attendancePhaseUpload) elements.attendancePhaseUpload.style.display = "block";
      if (elements.attendancePhaseReview) elements.attendancePhaseReview.style.display = "none";
      if (elements.btnProcessAttendanceFile) elements.btnProcessAttendanceFile.style.display = "inline-flex";
      if (elements.btnBackToAttendanceUpload) elements.btnBackToAttendanceUpload.style.display = "none";
      if (elements.btnConfirmAttendanceSave) elements.btnConfirmAttendanceSave.style.display = "none";
    });
  }

  if (elements.btnAttendanceSelectAll) {
    elements.btnAttendanceSelectAll.addEventListener("click", () => {
      if (state.attendanceImportData && state.attendanceImportData.entries) {
        state.attendanceImportData.entries.forEach(e => e.selected = true);
        renderAttendanceReviewTable();
      }
    });
  }

  if (elements.btnAttendanceDeselectMismatches) {
    elements.btnAttendanceDeselectMismatches.addEventListener("click", () => {
      if (state.attendanceImportData && state.attendanceImportData.entries) {
        state.attendanceImportData.entries.forEach(e => {
          if (e.status === "mismatch") e.selected = false;
        });
        renderAttendanceReviewTable();
      }
    });
  }

  if (elements.btnConfirmAttendanceSave) {
    elements.btnConfirmAttendanceSave.addEventListener("click", confirmAttendanceSave);
  }
}

export async function toggleCourseContractIntegration(courseId) {
  const cid = courseId || state.selectedCourseDetailId;
  if (!cid) {
    showToast("Nessun corso selezionato", "warning");
    return;
  }
  try {
    const res = await apiCall(`/api/courses/${cid}/toggle-contract-integration`, "POST");
    if (res.status === "ok") {
      showToast(res.message || "Stato integrazione aggiornato con successo!", "success");
      const localCourse = state.courses.find(c => Number(c.id) === Number(cid));
      if (localCourse) {
        localCourse.integrates_with_contract = res.integrates_with_contract;
      }
      await loadCourseDetailData(cid);
      renderCourses();
    }
  } catch (err) {
    showToast(err.message || "Errore durante la modifica dell'integrazione contrattuale", "error");
  }
}
