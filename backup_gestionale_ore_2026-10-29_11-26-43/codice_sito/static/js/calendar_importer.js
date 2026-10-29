/**
 * Excel & Google Sheets Course Calendar Importer & Pre-check
 */

import { state, elements } from './state.js';
import { apiCall } from './api.js';
import { showToast, escapeHtml, formatDisplayDate, formatFileSize } from './ui.js';

export function openImportCalendarModal(targetCourseId = null) {
  resetImportCalendarModal();

  // Populate Target Course Select
  if (elements.importTargetCourseSelect) {
    elements.importTargetCourseSelect.innerHTML = `<option value="new">➕ Crea come Nuovo Corso</option>`;
    (state.courses || []).forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.code || 'Senza codice'})`;
      elements.importTargetCourseSelect.appendChild(opt);
    });

    if (targetCourseId) {
      elements.importTargetCourseSelect.value = targetCourseId;
      const matched = (state.courses || []).find(c => c.id === parseInt(targetCourseId, 10));
      if (matched && elements.importCourseMatchHint) {
        elements.importCourseMatchHint.innerHTML = `🎯 Il calendario verrà associato al corso: <strong>${escapeHtml(matched.name)}</strong> (${escapeHtml(matched.code || '')}).`;
        elements.importCourseMatchHint.style.display = "block";
      }
    }
  }

  if (elements.importCourseTutor) {
    elements.importCourseTutor.innerHTML = '<option value="">-- Nessun Tutor (Assegna in seguito) --</option>';
    state.profiles.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.role === 'admin' ? 'Admin' : 'Tutor'})`;
      elements.importCourseTutor.appendChild(opt);
    });
    elements.importCourseTutor.value = "";
  }

  if (elements.modalImportCalendarBackdrop) elements.modalImportCalendarBackdrop.classList.add("show");
}

export function openImportCalendarModalForCourse(courseId) {
  openImportCalendarModal(courseId);
}
window.openImportCalendarModal = openImportCalendarModal;
window.openImportCalendarModalForCourse = openImportCalendarModalForCourse;

export function closeImportCalendarModal() {
  if (elements.modalImportCalendarBackdrop) elements.modalImportCalendarBackdrop.classList.remove("show");
}

export function resetImportCalendarModal() {
  state.importedCalendarData = null;
  if (elements.inputCalFile) elements.inputCalFile.value = "";
  if (elements.dropzoneCalText) {
    elements.dropzoneCalText.innerHTML = `📁 Trascina qui il file del corso (Excel .xlsx o Google Sheets .csv) oppure <span class="text-primary underline">sfoglia dal computer</span>`;
  }
  if (elements.importStepDropzone) elements.importStepDropzone.style.display = "block";
  if (elements.calImportLoading) elements.calImportLoading.style.display = "none";
  if (elements.calImportPreviewSection) elements.calImportPreviewSection.style.display = "none";
  if (elements.btnResetImportFile) elements.btnResetImportFile.style.display = "none";
  if (elements.btnConfirmImportCal) elements.btnConfirmImportCal.disabled = true;
  if (elements.importConflictAlert) elements.importConflictAlert.style.display = "none";
  if (elements.importCourseMatchHint) elements.importCourseMatchHint.style.display = "none";
  if (elements.importTargetCourseSelect) elements.importTargetCourseSelect.value = "new";
}

export async function handleCalendarFileSelected() {
  const file = elements.inputCalFile.files[0];
  if (!file) return;

  if (elements.dropzoneCalText) {
    elements.dropzoneCalText.innerHTML = `📄 File selezionato: <strong>${escapeHtml(file.name)}</strong> (${formatFileSize(file.size)})`;
  }
  if (elements.calImportLoading) elements.calImportLoading.style.display = "block";

  const formData = new FormData();
  formData.append("file", file);

  try {
    const data = await apiCall("/api/course-calendars/parse-file", "POST", formData, true);
    if (elements.calImportLoading) elements.calImportLoading.style.display = "none";

    if (data.status === "ok") {
      state.importedCalendarData = data.preview;
      renderCalendarImportPreview(data.preview, data.potential_conflicts || []);
    } else {
      showToast(data.message || "Errore nella lettura del file calendario", "error");
    }
  } catch (err) {
    if (elements.calImportLoading) elements.calImportLoading.style.display = "none";
    showToast(err.message || "Errore durante l'analisi del file", "error");
  }
}

export function renderCalendarImportPreview(p, conflicts) {
  if (!p) return;

  // Smart Course Matching & Target Selection
  if (elements.importTargetCourseSelect) {
    const curVal = elements.importTargetCourseSelect.value;
    if (curVal === "new" && p.course_code) {
      const normCode = p.course_code.trim().toUpperCase();
      const matched = (state.courses || []).find(c => (c.code || "").trim().toUpperCase() === normCode);
      if (matched) {
        elements.importTargetCourseSelect.value = matched.id;
        if (elements.importCourseMatchHint) {
          elements.importCourseMatchHint.innerHTML = `✨ <strong>Trovato corso esistente con lo stesso codice:</strong> "${escapeHtml(matched.name)}" (${escapeHtml(matched.code)}). Il calendario verrà associato a questo corso senza creare duplicati.`;
          elements.importCourseMatchHint.style.display = "block";
        }
        if (elements.importCourseName) elements.importCourseName.value = matched.name;
        if (elements.importCourseCode) elements.importCourseCode.value = matched.code;
        if (elements.importCourseTutor && matched.employee_id) elements.importCourseTutor.value = matched.employee_id;
      } else {
        if (elements.importCourseName) elements.importCourseName.value = p.course_name || "Nuovo Corso";
        if (elements.importCourseCode) elements.importCourseCode.value = p.course_code || "";
      }
    } else if (curVal !== "new") {
      const matched = (state.courses || []).find(c => c.id === parseInt(curVal, 10));
      if (matched) {
        if (elements.importCourseMatchHint) {
          elements.importCourseMatchHint.innerHTML = `🎯 Il calendario verrà associato al corso: <strong>${escapeHtml(matched.name)}</strong> (${escapeHtml(matched.code || '')}).`;
          elements.importCourseMatchHint.style.display = "block";
        }
        if (elements.importCourseName) elements.importCourseName.value = matched.name;
        if (elements.importCourseCode) elements.importCourseCode.value = matched.code;
        if (elements.importCourseTutor && matched.employee_id) elements.importCourseTutor.value = matched.employee_id;
      }
    } else {
      if (elements.importCourseName) elements.importCourseName.value = p.course_name || "Nuovo Corso";
      if (elements.importCourseCode) elements.importCourseCode.value = p.course_code || "";
    }
  } else {
    if (elements.importCourseName) elements.importCourseName.value = p.course_name || "Nuovo Corso";
    if (elements.importCourseCode) elements.importCourseCode.value = p.course_code || "";
  }
  if (elements.importCourseHours) elements.importCourseHours.value = p.total_hours || 0;

  if (elements.previewAulaHours) elements.previewAulaHours.textContent = `${p.total_aula_hours}h`;
  if (elements.previewAulaSessionsCount) elements.previewAulaSessionsCount.textContent = `${p.aula_sessions_count} lezioni`;
  if (elements.previewStageHours) elements.previewStageHours.textContent = `${p.total_stage_hours}h`;
  if (elements.previewStageSessionsCount) elements.previewStageSessionsCount.textContent = `${p.stage_sessions_count} giornate`;

  if (elements.previewAulaDates) {
    elements.previewAulaDates.textContent = p.aula_start_date && p.aula_end_date 
      ? `${formatDisplayDate(p.aula_start_date)} - ${formatDisplayDate(p.aula_end_date)}`
      : 'Non programmato';
  }
  if (elements.previewStageDates) {
    elements.previewStageDates.textContent = p.stage_start_date && p.stage_end_date 
      ? `${formatDisplayDate(p.stage_start_date)} - ${formatDisplayDate(p.stage_end_date)}`
      : 'Non programmato';
  }

  // Modules & Docenti Table
  if (elements.previewDocentiCount) elements.previewDocentiCount.textContent = p.modules ? p.modules.length : 0;
  if (elements.previewTbodyModules) {
    elements.previewTbodyModules.innerHTML = "";
    if (p.modules && p.modules.length > 0) {
      p.modules.forEach(m => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${escapeHtml(m.modulo)}</strong></td>
          <td class="text-right">${m.ore}h</td>
          <td>${m.docente ? `👨‍🏫 ${escapeHtml(m.docente)}` : '<span class="text-muted">— Non specificato —</span>'}</td>
          <td class="text-muted text-xs">${escapeHtml(m.cf || '-')}</td>
          <td class="text-center">${m.fascia ? `<span class="badge badge-info">${escapeHtml(m.fascia)}</span>` : '-'}</td>
        `;
        elements.previewTbodyModules.appendChild(tr);
      });
    } else {
      elements.previewTbodyModules.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Nessuna unità formativa trovata.</td></tr>`;
    }
  }

  // Calendar Sessions Table Preview
  if (elements.previewTotalSessionsCount) elements.previewTotalSessionsCount.textContent = p.total_sessions_count || 0;
  if (elements.previewTbodySessions) {
    elements.previewTbodySessions.innerHTML = "";
    const previewList = p.sessions.slice(0, 10);
    previewList.forEach(s => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${formatDisplayDate(s.date)}</strong></td>
        <td>${escapeHtml(s.day_of_week || '-')}</td>
        <td>${escapeHtml(s.time_slot || `${s.start_time} - ${s.end_time}`)}</td>
        <td><span class="badge ${s.phase === 'stage' ? 'badge-purple' : 'badge-info'}">${s.phase.toUpperCase()}</span></td>
        <td>${escapeHtml(s.modulo)}</td>
        <td class="text-right"><strong>${s.hours}h</strong></td>
        <td>${s.docente ? `👨‍🏫 ${escapeHtml(s.docente)}` : '<span class="text-muted">— Stage / Tutor —</span>'}</td>
      `;
      elements.previewTbodySessions.appendChild(tr);
    });
    if (p.sessions.length > 10) {
      const trMore = document.createElement("tr");
      trMore.innerHTML = `<td colspan="7" class="text-center text-muted py-2">... e altre ${p.sessions.length - 10} sessioni caricate nel calendario.</td>`;
      elements.previewTbodySessions.appendChild(trMore);
    }
  }

  // Potential Conflicts check
  if (conflicts && conflicts.length > 0) {
    if (elements.importConflictAlert) elements.importConflictAlert.style.display = "block";
    if (elements.importConflictList) {
      elements.importConflictList.innerHTML = "";
      conflicts.forEach(c => {
        const item = document.createElement("div");
        item.className = "conflict-item";
        item.innerHTML = `
          <div>
            <strong>👨‍🏫 Docente: ${escapeHtml(c.docente)}</strong> — Data: <strong>${formatDisplayDate(c.date)}</strong> (${escapeHtml(c.proposed_time)})
            <div class="text-sm text-muted">In conflitto con il corso '${escapeHtml(c.conflicting_course)}' (${escapeHtml(c.conflicting_time)})</div>
          </div>
        `;
        elements.importConflictList.appendChild(item);
      });
    }
  } else {
    if (elements.importConflictAlert) elements.importConflictAlert.style.display = "none";
  }

  if (elements.calImportPreviewSection) elements.calImportPreviewSection.style.display = "block";
  if (elements.btnResetImportFile) elements.btnResetImportFile.style.display = "inline-block";
  if (elements.btnConfirmImportCal) elements.btnConfirmImportCal.disabled = false;
}

export async function handleConfirmImportCalendar(onImportSuccess) {
  if (!state.importedCalendarData) {
    showToast("Nessun dato di calendario pronto per l'importazione", "warning");
    return;
  }

  const p = state.importedCalendarData;
  const courseName = elements.importCourseName.value.trim();
  const courseCode = elements.importCourseCode.value.trim();
  const rawAssignedTutor = elements.importCourseTutor ? elements.importCourseTutor.value : "";
  const assignedTutorId = rawAssignedTutor ? parseInt(rawAssignedTutor, 10) : null;
  const courseColor = elements.importCourseColor.value || "#2563EB";

  if (!courseName) {
    showToast("Inserisci il nome del corso", "warning");
    return;
  }

  const docentiRef = p.docenti_list && p.docenti_list.length > 0 ? p.docenti_list.join(", ") : "";

  const targetCourseId = elements.importTargetCourseSelect ? elements.importTargetCourseSelect.value : "new";

  const payload = {
    course_id: targetCourseId === "new" ? null : parseInt(targetCourseId, 10),
    employee_id: assignedTutorId,
    course_name: courseName,
    course_code: courseCode,
    total_allocated_hours: p.total_hours,
    color: courseColor,
    docente_referente: docentiRef,
    calendar_title: `Calendario ${courseName} ${courseCode}`.trim(),
    start_date: p.start_date,
    expected_end_date: p.expected_end_date,
    stage_start_date: p.stage_start_date,
    stage_end_date: p.stage_end_date,
    stage_tutor_id: assignedTutorId,
    notes: `Importato da file. Monte ore: ${p.total_hours}h (${p.total_aula_hours}h Aula, ${p.total_stage_hours}h Stage).`,
    sessions: p.sessions
  };

  const btn = elements.btnConfirmImportCal;
  btn.disabled = true;
  btn.textContent = "⏳ Creazione corso in corso...";

  try {
    const data = await apiCall("/api/course-calendars/import", "POST", payload);

    if (data.status === "ok") {
      closeImportCalendarModal();
      showToast(`🎉 Corso '${courseName}' creato con successo! (${data.sessions_created} sessioni caricate nel calendario)`, "success");
      if (onImportSuccess) await onImportSuccess(data.course_id);
    }
  } catch (err) {
    showToast(err.message || "Errore durante la creazione del corso", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "🚀 Conferma & Crea Corso nel Sito";
  }
}

export function initCalendarImporterEvents() {
  if (elements.importTargetCourseSelect) {
    elements.importTargetCourseSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      const p = state.importedCalendarData;
      if (val === "new") {
        if (elements.importCourseMatchHint) elements.importCourseMatchHint.style.display = "none";
        if (p) {
          if (elements.importCourseName) elements.importCourseName.value = p.course_name || "";
          if (elements.importCourseCode) elements.importCourseCode.value = p.course_code || "";
        }
      } else {
        const c = (state.courses || []).find(x => x.id === parseInt(val, 10));
        if (c) {
          if (elements.importCourseName) elements.importCourseName.value = c.name;
          if (elements.importCourseCode) elements.importCourseCode.value = c.code || "";
          if (elements.importCourseTutor) elements.importCourseTutor.value = c.employee_id || "";
          if (elements.importCourseMatchHint) {
            elements.importCourseMatchHint.innerHTML = `🎯 Il calendario verrà associato al corso: <strong>${escapeHtml(c.name)}</strong> (${escapeHtml(c.code || '')}).`;
            elements.importCourseMatchHint.style.display = "block";
          }
        }
      }
    });
  }
}

