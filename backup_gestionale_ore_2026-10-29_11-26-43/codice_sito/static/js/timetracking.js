/**
 * Weekly Timetable, Daily Work Entries & Excel/CSV Sync
 */

import { state, elements } from './state.js';
import { apiCall } from './api.js';
import { showToast, escapeHtml, formatDisplayDate, formatHours } from './ui.js';

export function parseTimeHours(t1, t2) {
  if (!t1 || !t2) return 0;
  try {
    const [h1, m1] = t1.split(":").map(Number);
    const [h2, m2] = t2.split(":").map(Number);
    const mins = (h2 * 60 + m2) - (h1 * 60 + m1);
    return Math.max(0, mins / 60);
  } catch (e) {
    return 0;
  }
}

export async function loadWeeklySchedule() {
  if (!state.currentEmployeeId) return;
  try {
    const data = await apiCall(`/api/reports/weekly-schedule?employee_id=${state.currentEmployeeId}&date=${state.currentWeekTargetDate}`);
    if (data.status === "ok") {
      state.weeklySchedule = data.schedule;
      renderWeeklyGrid(data.schedule);
    }
  } catch (err) {
    console.error("Weekly load error:", err);
  }
}

export function renderWeeklyGrid(sched) {
  if (!elements.weeklyScheduleLabel) return;

  if (sched.tot_scheduled === 0 && sched.first_course_date) {
    elements.weeklyScheduleLabel.innerHTML = `
      <span>${escapeHtml(sched.label)}</span>
      <button class="btn btn-xs btn-outline-primary" style="margin-left: 0.75rem; vertical-align: middle;" onclick="window.jumpToWeeklyDate('${sched.first_course_date}')">
        🚀 Salta al primo corso (${formatDisplayDate(sched.first_course_date)})
      </button>
    `;
  } else {
    elements.weeklyScheduleLabel.textContent = sched.label;
  }

  elements.weeklySchedHours.textContent = `Previste: ${sched.tot_scheduled.toFixed(1)}h`;
  elements.weeklyActHours.textContent = `Svolte: ${sched.tot_actual.toFixed(1)}h`;

  const variance = sched.net_variance;
  elements.weeklyVariance.textContent = `Delta: ${variance > 0 ? '+' : ''}${variance.toFixed(1)}h`;
  elements.weeklyVariance.className = variance >= 0 ? "badge badge-green" : "badge badge-yellow";

  elements.weeklyDaysGrid.innerHTML = "";

  sched.days.forEach(day => {
    const col = document.createElement("div");
    col.className = `day-column ${day.is_today ? 'is-today' : ''}`;

    let lessonsHtml = "";
    const hasEntries = day.entries && day.entries.length > 0;
    const hasCalSessions = day.calendar_sessions && day.calendar_sessions.length > 0;

    if (hasEntries) {
      day.entries.forEach(e => {
        const isUtil = e.type === "utilizzata";
        const isMat = e.type === "maturata";
        const color = e.course_color || "#2563EB";

        let varianceBadge = "";
        if (isMat && e.hours > 0) {
          varianceBadge = `<span class="lesson-variance-tag badge-green">+${e.hours.toFixed(1)}h Posticipata</span>`;
        } else if (isUtil && e.hours > 0) {
          varianceBadge = `<span class="lesson-variance-tag badge-yellow">-${e.hours.toFixed(1)}h Anticipata</span>`;
        }

        lessonsHtml += `
          <div class="lesson-card" style="border-left-color: ${color};">
            <span class="lesson-course-badge" style="color: ${color};">
              📚 ${escapeHtml(e.course_name || e.activity_type || 'Lezione')}
            </span>
            <div class="lesson-time-row">
              <span>Prev: <strong>${e.scheduled_start || '09:00'} - ${e.scheduled_end || '13:00'}</strong></span>
              <span>(${e.scheduled_hours || 4}h)</span>
            </div>
            <div class="lesson-time-row">
              <span>Eff: <strong>${e.actual_start || '09:00'} - ${e.actual_end || '13:00'}</strong></span>
              <span>(${e.actual_hours || e.hours}h)</span>
            </div>
            <div>${varianceBadge}</div>
            <div class="d-flex justify-between items-center mt-1">
              <span class="text-muted text-sm">${escapeHtml(e.causale || '')}</span>
              <button class="btn-icon" onclick="window.editEntryById(${e.id})" title="Modifica">✏️</button>
            </div>
          </div>
        `;
      });
    }

    if (hasCalSessions) {
      day.calendar_sessions.forEach(s => {
        const alreadyRegistered = day.entries && day.entries.some(e => e.course_id === s.course_id);
        if (!alreadyRegistered) {
          const color = s.course_color || "#2563EB";
          lessonsHtml += `
            <div class="lesson-card" style="border-left-color: ${color}; background: #f0fdf4; border: 1px solid #bbf7d0;">
              <div class="d-flex justify-between items-center">
                <span class="lesson-course-badge" style="color: ${color};">📚 ${escapeHtml(s.course_name)}</span>
                <span class="badge badge-success" style="font-size: 0.68rem; padding: 0.15rem 0.35rem;">Pianificato</span>
              </div>
              <div class="lesson-time-row mt-1">
                <span>Orario: <strong>${escapeHtml(s.start_time)} - ${escapeHtml(s.end_time)}</strong></span>
                <span><strong>(${s.hours}h)</strong></span>
              </div>
              <div class="text-xs text-muted" style="margin-top: 0.2rem;">📖 ${escapeHtml(s.modulo || '')}</div>
              <div class="text-xs" style="color: #166534; margin-top: 0.15rem;">👨‍🏫 Docente: <strong>${escapeHtml(s.docente || '')}</strong></div>
              <div class="lesson-card-actions mt-2 pt-1">
                <button type="button" class="btn btn-xs btn-primary font-bold" onclick="window.openQuickEntryModalForSession(${s.id})" title="Registra la tua presenza a questa lezione">
                  ✅ Presenza
                </button>
                <button type="button" class="btn btn-xs btn-outline-warning" onclick="window.openRescheduleModalById(${s.id})" title="Rinvia ad altra data o varia docente">
                  🔄 Variazione
                </button>
              </div>
            </div>
          `;
        }
      });
    }

    if (!hasEntries && !hasCalSessions) {
      lessonsHtml = `
        <div class="empty-day-state">
          Nessuna lezione o attività registrata
        </div>
      `;
    }

    col.innerHTML = `
      <div class="day-header">
        <div class="day-dow">${day.day_of_week}</div>
        <div class="day-date">${day.display_date}</div>
      </div>
      <div class="day-lessons-list">
        ${lessonsHtml}
      </div>
      <div class="day-footer">
        <button class="btn btn-outline btn-sm" onclick="window.openEntryModalForDate('${day.date}')" style="width:100%;">
          ➕ Aggiungi
        </button>
      </div>
    `;

    elements.weeklyDaysGrid.appendChild(col);
  });
}

export function jumpToWeeklyDate(dateStr) {
  state.currentWeekTargetDate = dateStr;
  loadWeeklySchedule();
}
window.jumpToWeeklyDate = jumpToWeeklyDate;

export function handlePrevWeek(onRefresh) {
  const cur = new Date(state.currentWeekTargetDate);
  cur.setDate(cur.getDate() - 7);
  state.currentWeekTargetDate = cur.toISOString().split("T")[0];
  if (onRefresh) onRefresh();
}

export function handleCurrentWeek(onRefresh) {
  state.currentWeekTargetDate = new Date().toISOString().split("T")[0];
  if (onRefresh) onRefresh();
}

export function handleNextWeek(onRefresh) {
  const cur = new Date(state.currentWeekTargetDate);
  cur.setDate(cur.getDate() + 7);
  state.currentWeekTargetDate = cur.toISOString().split("T")[0];
  if (onRefresh) onRefresh();
}

export function setEntryModalMode(mode) {
  state.entryCurrentMode = mode;
  if (elements.btnEntryModeSede) {
    elements.btnEntryModeSede.classList.toggle("active", mode === "sede");
  }
  if (elements.btnEntryModeCourse) {
    elements.btnEntryModeCourse.classList.toggle("active", mode === "course");
  }

  const activeProfile = (state.profiles || []).find(p => p.id === state.currentEmployeeId);
  const defStart = activeProfile?.contract_office_start || "09:00";
  const defEnd = activeProfile?.contract_office_end || "13:00";

  if (mode === "sede") {
    if (elements.entryModeHelperNotice) {
      elements.entryModeHelperNotice.innerHTML = `🏢 <strong>Lavoro in Sede:</strong> Registra la tua giornata ordinaria in ufficio/sede (segreteria didattica, riunioni, preparazione). Gli straordinari rispetto all'orario contrattuale andranno nella Banca Ore.`;
    }
    if (elements.entryCourse) elements.entryCourse.value = "";
    if (elements.entryActivityType) elements.entryActivityType.value = "Lavoro Ordinario";
    if (elements.entryModalTitle) elements.entryModalTitle.textContent = "🏢 Registra Lavoro in Sede (Ufficio)";
    if (elements.entryCourseStart) elements.entryCourseStart.value = "";
    if (elements.entryCourseEnd) elements.entryCourseEnd.value = "";
    if (elements.entryIsIntegrated) elements.entryIsIntegrated.checked = false;
  } else {
    if (elements.entryModeHelperNotice) {
      elements.entryModeHelperNotice.innerHTML = `🎓 <strong>Presenza Corso:</strong> Registra la tua presenza a lezione o tutoraggio per uno specifico corso di formazione. Seleziona il corso e verifica gli orari.`;
    }
    if (elements.entryActivityType) elements.entryActivityType.value = "Tutoraggio d'aula";
    if (elements.entryModalTitle) elements.entryModalTitle.textContent = "🎓 Registra Presenza nel Corso";
    if (elements.entryCourse && !elements.entryCourse.value && state.courses && state.courses.length > 0) {
      elements.entryCourse.value = state.courses[0].id;
      const c = state.courses[0];
      if (elements.entryIsIntegrated) elements.entryIsIntegrated.checked = Boolean(c.integrates_with_contract);
    }
    if (elements.entryCourseStart && !elements.entryCourseStart.value) elements.entryCourseStart.value = defStart;
    if (elements.entryCourseEnd && !elements.entryCourseEnd.value) elements.entryCourseEnd.value = defEnd;
  }
  recalculateBreakdownLive();
}

export function openEntryModal(entry = null, initialMode = "sede") {
  if (!elements.formEntry) return;
  elements.formEntry.reset();

  if (elements.entryEmployee) {
    elements.entryEmployee.innerHTML = "";
    (state.profiles || []).forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.role === 'admin' ? 'Admin' : 'Tutor'})`;
      elements.entryEmployee.appendChild(opt);
    });
    elements.entryEmployee.value = state.currentEmployeeId;
  }

  // Populate courses select
  if (elements.entryCourse) {
    elements.entryCourse.innerHTML = `<option value="">-- Nessun Corso (Lavoro Ordinario in Sede) --</option>`;
    state.courses.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.ed_code ? '[' + c.ed_code + '] ' : ''}${c.code ? c.code + ' - ' : ''}${c.name}${c.integrates_with_contract ? ' 🔗 (Integrato)' : ''}`;
      elements.entryCourse.appendChild(opt);
    });
  }

  const activeProfile = (state.profiles || []).find(p => p.id === state.currentEmployeeId);
  const defStart = activeProfile?.contract_office_start || "09:00";
  const defEnd = activeProfile?.contract_office_end || "13:00";
  const defLunchStart = activeProfile?.contract_lunch_start || "";
  const defLunchEnd = activeProfile?.contract_lunch_end || "";

  if (elements.lblContractOfficeHint) {
    elements.lblContractOfficeHint.textContent = `Contratto: ${defStart} - ${defEnd}`;
  }

  if (entry) {
    elements.entryModalTitle.textContent = "✏️ Modifica Giornata / Lezione";
    elements.entryId.value = entry.id;
    if (elements.entryEmployee) elements.entryEmployee.value = entry.employee_id;
    if (elements.entryCourse) elements.entryCourse.value = entry.course_id || "";
    elements.entryDate.value = entry.date;
    if (elements.entryExitDate) elements.entryExitDate.value = entry.exit_date || entry.date;
    elements.entryActivityType.value = entry.activity_type || "Tutoraggio d'aula";

    if (elements.entryOfficeStart) elements.entryOfficeStart.value = entry.office_start || entry.scheduled_start || defStart;
    if (elements.entryOfficeEnd) elements.entryOfficeEnd.value = entry.office_end || entry.scheduled_end || defEnd;
    if (elements.entryLunchStart) elements.entryLunchStart.value = entry.lunch_break_start || "";
    if (elements.entryLunchEnd) elements.entryLunchEnd.value = entry.lunch_break_end || "";
    if (elements.entryCourseStart) elements.entryCourseStart.value = entry.course_start || (entry.course_id ? (entry.actual_start || defStart) : "");
    if (elements.entryCourseEnd) elements.entryCourseEnd.value = entry.course_end || (entry.course_id ? (entry.actual_end || defEnd) : "");

    const courseObj = state.courses.find(c => Number(c.id) === Number(entry.course_id));
    if (elements.entryIsIntegrated) {
      elements.entryIsIntegrated.checked = entry.is_integrated !== undefined 
        ? Boolean(entry.is_integrated) 
        : Boolean(courseObj ? courseObj.integrates_with_contract : 0);
    }

    elements.entrySchedStart.value = entry.scheduled_start || defStart;
    elements.entrySchedEnd.value = entry.scheduled_end || defEnd;
    elements.entryActStart.value = entry.actual_start || defStart;
    elements.entryActEnd.value = entry.actual_end || defEnd;
    elements.entryHours.value = entry.hours;
    elements.entryType.value = entry.type;
    elements.entryCausale.value = entry.causale || "";
    elements.entryNote.value = entry.note || "";
    setEntryModalMode(entry.course_id ? "course" : "sede");
  } else {
    elements.entryId.value = "";
    elements.entryDate.value = new Date().toISOString().split("T")[0];
    if (elements.entryExitDate) elements.entryExitDate.value = elements.entryDate.value;
    if (elements.entryOfficeStart) elements.entryOfficeStart.value = defStart;
    if (elements.entryOfficeEnd) elements.entryOfficeEnd.value = defEnd;
    if (elements.entryLunchStart) elements.entryLunchStart.value = defLunchStart;
    if (elements.entryLunchEnd) elements.entryLunchEnd.value = defLunchEnd;

    elements.entrySchedStart.value = defStart;
    elements.entrySchedEnd.value = defEnd;
    elements.entryActStart.value = defStart;
    elements.entryActEnd.value = defEnd;
    elements.entryHours.value = "0.0";
    elements.entryType.value = "ordinaria";
    elements.entryCausale.value = initialMode === "sede" ? "Lavoro in Sede" : "Tutoraggio d'aula";
    elements.entryNote.value = "";

    if (initialMode === "course" && state.courses.length > 0) {
      const firstCourse = state.courses[0];
      if (elements.entryIsIntegrated) elements.entryIsIntegrated.checked = Boolean(firstCourse.integrates_with_contract);
      if (elements.entryCourseStart) elements.entryCourseStart.value = defStart;
      if (elements.entryCourseEnd) elements.entryCourseEnd.value = defEnd;
    } else {
      if (elements.entryCourseStart) elements.entryCourseStart.value = "";
      if (elements.entryCourseEnd) elements.entryCourseEnd.value = "";
      if (elements.entryIsIntegrated) elements.entryIsIntegrated.checked = false;
    }

    setEntryModalMode(initialMode);
  }

  recalculateBreakdownLive();
  if (elements.entryModalBackdrop) elements.entryModalBackdrop.classList.add("show");
}

export function openEntryModalForSede() {
  openEntryModal(null, "sede");
}

export function openEntryModalForCourse(courseId = null, dateStr = null, startTime = null, endTime = null, modulo = null) {
  openEntryModal(null, "course");
  if (courseId && elements.entryCourse) elements.entryCourse.value = courseId;
  if (dateStr && elements.entryDate) elements.entryDate.value = dateStr;
  if (startTime && elements.entrySchedStart) elements.entrySchedStart.value = startTime;
  if (endTime && elements.entrySchedEnd) elements.entrySchedEnd.value = endTime;
  if (startTime && elements.entryActStart) elements.entryActStart.value = startTime;
  if (endTime && elements.entryActEnd) elements.entryActEnd.value = endTime;
  if (modulo && elements.entryNote) elements.entryNote.value = `Modulo: ${modulo}`;
  recalculateModalVariance();
}

export function openEntryModalForDate(dateStr) {
  openEntryModal();
  if (elements.entryDate) elements.entryDate.value = dateStr;
}

export function openEntryModalForMonth(monthYear) {
  openEntryModal();
  try {
    const parts = monthYear.split(" ");
    const monthName = parts[0].toUpperCase();
    const year = parts[1];
    const monthMap = {
      "GENNAIO": "01", "FEBBRAIO": "02", "MARZO": "03", "APRILE": "04",
      "MAGGIO": "05", "GIUGNO": "06", "LUGLIO": "07", "AGOSTO": "08",
      "SETTEMBRE": "09", "OTTOBRE": "10", "NOVEMBRE": "11", "DICEMBRE": "12"
    };
    if (elements.entryDate) elements.entryDate.value = `${year}-${monthMap[monthName] || '01'}-01`;
  } catch (e) {}
}

export function closeEntryModal() {
  if (elements.entryModalBackdrop) elements.entryModalBackdrop.classList.remove("show");
}

function timeToMinutes(t) {
  if (!t || typeof t !== "string" || !t.includes(":")) return null;
  const parts = t.split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

export function recalculateBreakdownLive() {
  const oStartStr = elements.entryOfficeStart ? elements.entryOfficeStart.value : "09:00";
  const oEndStr = elements.entryOfficeEnd ? elements.entryOfficeEnd.value : "13:00";
  const lStartStr = elements.entryLunchStart ? elements.entryLunchStart.value : "";
  const lEndStr = elements.entryLunchEnd ? elements.entryLunchEnd.value : "";
  const cStartStr = elements.entryCourseStart ? elements.entryCourseStart.value : "";
  const cEndStr = elements.entryCourseEnd ? elements.entryCourseEnd.value : "";
  const isIntegrated = elements.entryIsIntegrated ? elements.entryIsIntegrated.checked : false;

  const oStart = timeToMinutes(oStartStr);
  const oEnd = timeToMinutes(oEndStr);
  const lStart = timeToMinutes(lStartStr);
  const lEnd = timeToMinutes(lEndStr);
  const cStart = timeToMinutes(cStartStr);
  const cEnd = timeToMinutes(cEndStr);

  let officeMins = 0;
  if (oStart !== null && oEnd !== null && oEnd > oStart) {
    officeMins = oEnd - oStart;
  }

  let lunchMins = 0;
  if (lStart !== null && lEnd !== null && lEnd > lStart) {
    lunchMins = lEnd - lStart;
  }

  // Office net of lunch
  let netOfficeMins = officeMins;
  if (officeMins > 0 && lunchMins > 0) {
    const lOfficeOverlapStart = Math.max(oStart, lStart);
    const lOfficeOverlapEnd = Math.min(oEnd, lEnd);
    if (lOfficeOverlapEnd > lOfficeOverlapStart) {
      netOfficeMins = Math.max(0, officeMins - (lOfficeOverlapEnd - lOfficeOverlapStart));
    }
  }

  let courseMins = 0;
  if (cStart !== null && cEnd !== null && cEnd > cStart) {
    courseMins = cEnd - cStart;
  }

  // Overlap between office and course
  let overlapMins = 0;
  if (officeMins > 0 && courseMins > 0) {
    const oLapStart = Math.max(oStart, cStart);
    const oLapEnd = Math.min(oEnd, cEnd);
    if (oLapEnd > oLapStart) {
      overlapMins = oLapEnd - oLapStart;
      // Deduct lunch from overlap if inside
      if (lunchMins > 0) {
        const lLapStart = Math.max(oLapStart, lStart);
        const lLapEnd = Math.min(oLapEnd, lEnd);
        if (lLapEnd > lLapStart) {
          overlapMins = Math.max(0, overlapMins - (lLapEnd - lLapStart));
        }
      }
    }
  }

  let totalWorkedMins = 0;
  let hasConflict = false;
  let conflictMsg = "";

  if (isIntegrated) {
    // Union: office + course - overlap -> NO DOUBLE COUNTING!
    totalWorkedMins = netOfficeMins + courseMins - overlapMins;
    hasConflict = false;
  } else {
    // Separate: office + course
    totalWorkedMins = netOfficeMins + courseMins;
    if (overlapMins > 0 && courseMins > 0 && officeMins > 0) {
      hasConflict = true;
      conflictMsg = `⚠️ <strong>Attenzione Sovrapposizione:</strong> L'orario del corso (${cStartStr}-${cEndStr}) si sovrappone all'orario d'ufficio (${oStartStr}-${oEndStr}) per <strong>${(overlapMins / 60).toFixed(1)} ore</strong>. Abilita <em>"🔗 Integra con ore contrattuali"</em> per unificare le fasce senza conflitti.`;
    }
  }

  const officeHours = netOfficeMins / 60;
  const courseHours = courseMins / 60;
  const lunchHours = lunchMins / 60;
  const overlapHours = overlapMins / 60;
  const totalWorkedHours = totalWorkedMins / 60;

  // Active tutor's contract quota (calcolato dinamicamente sul giorno della settimana dal contratto attivo)
  let contractDailyQuota = 4.0;
  const activeProfile = (state.profiles || []).find(p => p.id === state.currentEmployeeId);
  const selectedDateStr = elements.entryDate ? elements.entryDate.value : "";

  if (selectedDateStr) {
    try {
      const parts = selectedDateStr.split("-").map(Number);
      if (parts.length === 3) {
        const dt = new Date(parts[0], parts[1] - 1, parts[2]);
        const dayIdx = dt.getDay(); // 0=dom, 1=lun, ..., 5=ven, 6=sab
        const dowCodes = ["dom", "lun", "mar", "mer", "gio", "ven", "sab"];
        const code = dowCodes[dayIdx];

        const contracts = (state.tutorDashboardData?.contracts || []).filter(c => c.status === "Attivo");
        let matchedHours = null;
        for (const ct of contracts) {
          if (!ct.has_fixed_schedule) continue;
          if (ct.start_date && selectedDateStr < ct.start_date) continue;
          if (ct.end_date && selectedDateStr > ct.end_date) continue;

          let schedObj = null;
          if (typeof ct.schedule_details === "string" && ct.schedule_details.trim()) {
            try { schedObj = JSON.parse(ct.schedule_details); } catch(e) {}
          } else if (typeof ct.schedule_details === "object") {
            schedObj = ct.schedule_details;
          }

          if (schedObj && schedObj[code] && schedObj[code].active) {
            const h = parseFloat(schedObj[code].hours);
            if (!isNaN(h)) {
              matchedHours = (matchedHours || 0) + h;
            }
          }
        }

        if (matchedHours !== null) {
          contractDailyQuota = matchedHours;
        } else if (dayIdx === 5 && (activeProfile?.part_time_week_hours === 18 || activeProfile?.weekly_hours === 18)) {
          // Contratto standard a 18h: venerdi quota 2 ore
          contractDailyQuota = 2.0;
        } else if (dayIdx === 0 || dayIdx === 6) {
          contractDailyQuota = 0.0;
        } else {
          const contractStartMins = timeToMinutes(activeProfile?.contract_office_start || "09:00");
          const contractEndMins = timeToMinutes(activeProfile?.contract_office_end || "13:00");
          if (contractStartMins !== null && contractEndMins !== null && contractEndMins > contractStartMins) {
            contractDailyQuota = (contractEndMins - contractStartMins) / 60;
          }
        }
      }
    } catch(err) {
      console.warn("Calcolo quota contrattuale giorno fallito:", err);
    }
  }

  const variance = Math.round((totalWorkedHours - contractDailyQuota) * 100) / 100;

  // Update UI Elements
  if (elements.lblOfficeHours) elements.lblOfficeHours.textContent = `${officeHours.toFixed(1)} h`;
  if (elements.lblCourseHours) elements.lblCourseHours.textContent = `${courseHours.toFixed(1)} h`;
  if (elements.lblLunchHours) elements.lblLunchHours.textContent = `${lunchHours.toFixed(1)} h`;
  if (elements.lblOverlapHours) elements.lblOverlapHours.textContent = `${overlapHours.toFixed(1)} h`;
  if (elements.lblTotalWorkedHours) elements.lblTotalWorkedHours.textContent = `${totalWorkedHours.toFixed(1)} h`;

  if (elements.badgeBreakdownIntegrationStatus) {
    if (isIntegrated) {
      elements.badgeBreakdownIntegrationStatus.className = "badge badge-success font-bold";
      elements.badgeBreakdownIntegrationStatus.textContent = "🔗 Integrato (No doppio conteggio)";
    } else {
      elements.badgeBreakdownIntegrationStatus.className = "badge badge-gray font-bold";
      elements.badgeBreakdownIntegrationStatus.textContent = "⚠️ Orari separati";
    }
  }

  if (elements.breakdownSummaryNotice) {
    if (isIntegrated && courseHours > 0) {
      elements.breakdownSummaryNotice.innerHTML = `🔗 <strong>Corso integrato:</strong> Svolte ${officeHours.toFixed(1)}h sede e ${courseHours.toFixed(1)}h corso con ${overlapHours.toFixed(1)}h coincidenti → <strong>${totalWorkedHours.toFixed(1)} ore effettive lavorate</strong> (nessuna duplicazione d'orario).`;
      elements.breakdownSummaryNotice.style.borderLeftColor = "#15803d";
    } else if (courseHours > 0) {
      elements.breakdownSummaryNotice.innerHTML = `📚 Corso non integrato: ${officeHours.toFixed(1)}h sede + ${courseHours.toFixed(1)}h corso = <strong>${totalWorkedHours.toFixed(1)} ore complessive</strong>.`;
      elements.breakdownSummaryNotice.style.borderLeftColor = "#2563eb";
    } else {
      elements.breakdownSummaryNotice.innerHTML = `🏢 Lavoro in sede: <strong>${totalWorkedHours.toFixed(1)} ore effettive</strong> conteggiate.`;
      elements.breakdownSummaryNotice.style.borderLeftColor = "#0284c7";
    }
  }

  if (elements.lblVarianceBadge) {
    if (variance > 0) {
      elements.lblVarianceBadge.className = "badge badge-success font-bold";
      elements.lblVarianceBadge.textContent = `🟢 Straordinario: +${variance.toFixed(1)} h`;
      if (elements.entryType) elements.entryType.value = "maturata";
      if (elements.entryHours) elements.entryHours.value = variance.toFixed(1);
    } else if (variance < 0) {
      elements.lblVarianceBadge.className = "badge badge-warning font-bold";
      elements.lblVarianceBadge.textContent = `🟡 Debito / Permesso: ${variance.toFixed(1)} h`;
      if (elements.entryType) elements.entryType.value = "utilizzata";
      if (elements.entryHours) elements.entryHours.value = Math.abs(variance).toFixed(1);
    } else {
      elements.lblVarianceBadge.className = "badge badge-gray font-bold";
      elements.lblVarianceBadge.textContent = `⚪ Pareggio Contratto (0.0 h)`;
      if (elements.entryType) elements.entryType.value = "ordinaria";
      if (elements.entryHours) elements.entryHours.value = "0.0";
    }
  }

  if (elements.breakdownConflictAlert) {
    if (hasConflict) {
      elements.breakdownConflictAlert.style.display = "block";
      elements.breakdownConflictAlert.innerHTML = conflictMsg;
    } else {
      elements.breakdownConflictAlert.style.display = "none";
    }
  }

  // Compatibility legacy hidden fields
  if (elements.entrySchedStart) elements.entrySchedStart.value = oStartStr || "09:00";
  if (elements.entrySchedEnd) elements.entrySchedEnd.value = oEndStr || "13:00";
  if (elements.entryActStart) elements.entryActStart.value = (cStartStr && courseHours > 0) ? cStartStr : (oStartStr || "09:00");
  if (elements.entryActEnd) elements.entryActEnd.value = (cEndStr && courseHours > 0) ? cEndStr : (oEndStr || "13:00");
}

export const recalculateModalVariance = recalculateBreakdownLive;

export async function handleSaveEntry(e, onSaved) {
  e.preventDefault();

  const entryId = elements.entryId.value;
  const payload = {
    employee_id: parseInt(elements.entryEmployee.value),
    course_id: elements.entryCourse.value ? parseInt(elements.entryCourse.value) : null,
    date: elements.entryDate.value,
    exit_date: elements.entryExitDate ? elements.entryExitDate.value : elements.entryDate.value,
    activity_type: elements.entryActivityType.value,
    scheduled_start: elements.entrySchedStart.value,
    scheduled_end: elements.entrySchedEnd.value,
    actual_start: elements.entryActStart.value,
    actual_end: elements.entryActEnd.value,
    office_start: elements.entryOfficeStart ? elements.entryOfficeStart.value : "09:00",
    office_end: elements.entryOfficeEnd ? elements.entryOfficeEnd.value : "13:00",
    lunch_break_start: (elements.entryLunchStart && elements.entryLunchStart.value) ? elements.entryLunchStart.value : null,
    lunch_break_end: (elements.entryLunchEnd && elements.entryLunchEnd.value) ? elements.entryLunchEnd.value : null,
    course_start: (elements.entryCourseStart && elements.entryCourseStart.value) ? elements.entryCourseStart.value : null,
    course_end: (elements.entryCourseEnd && elements.entryCourseEnd.value) ? elements.entryCourseEnd.value : null,
    is_integrated: (elements.entryIsIntegrated && elements.entryIsIntegrated.checked) ? 1 : 0,
    type: elements.entryType.value,
    hours: parseFloat(elements.entryHours.value),
    causale: elements.entryCausale.value.trim(),
    note: elements.entryNote.value.trim()
  };

  try {
    if (entryId) {
      await apiCall(`/api/entries/${entryId}`, "PUT", payload);
    } else {
      await apiCall("/api/entries", "POST", payload);
    }

    closeEntryModal();
    showToast(entryId ? "Giornata modificata con successo!" : "Giornata registrata con successo!", "success");
    if (onSaved) await onSaved();
  } catch (err) {
    showToast(err.message || "Errore nel salvataggio", "error");
  }
}

export async function deleteEntryById(id, onDeleted) {
  if (!confirm("Sei sicuro di voler eliminare questa giornata di lavoro?")) return;
  try {
    await apiCall(`/api/entries/${id}`, "DELETE");
    showToast("Giornata eliminata.", "info");
    if (onDeleted) await onDeleted();
  } catch (err) {
    showToast(err.message || "Errore nella cancellazione", "error");
  }
}

export async function loadHistoryTable() {
  if (!elements.filterMonth) return;
  const month = elements.filterMonth.value;
  const course = elements.filterCourse.value;
  const type = elements.filterType.value;
  const search = elements.filterSearch.value.trim();

  let url = `/api/entries?employee_id=${state.currentEmployeeId}`;
  if (month) url += `&month_year=${encodeURIComponent(month)}`;
  if (course) url += `&course_id=${encodeURIComponent(course)}`;
  if (type) url += `&type=${encodeURIComponent(type)}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;

  try {
    const data = await apiCall(url);
    if (data.status === "ok") {
      state.entries = data.entries;
      renderHistoryRows(data.entries);
    }
  } catch (err) {
    showToast("Errore nel caricamento del registro", "error");
  }
}

export function renderHistoryRows(entries) {
  if (!elements.tbodyHistory) return;
  elements.tbodyHistory.innerHTML = "";

  if (entries.length === 0) {
    elements.tbodyHistory.innerHTML = `
      <tr>
        <td colspan="11" class="text-center text-muted" style="padding: 2.5rem;">
          Nessuna registrazione trovata per i filtri selezionati.
        </td>
      </tr>
    `;
    elements.histTotUtilizzate.textContent = "0,00";
    elements.histTotMaturate.textContent = "0,00";
    elements.histTotSaldo.textContent = "0,00";
    return;
  }

  let totUtil = 0;
  let totMat = 0;

  entries.forEach((e, index) => {
    const tr = document.createElement("tr");
    const isUtil = e.type === "utilizzata";
    const isMat = e.type === "maturata";

    if (isUtil) totUtil += e.hours;
    if (isMat) totMat += e.hours;

    tr.className = isUtil ? "row-utilizzata" : (isMat ? "row-maturata" : "");
    const courseTag = e.course_name ? `<strong style="color:${e.course_color};">${escapeHtml(e.course_name)}</strong>` : `<span class="text-muted">${e.activity_type || 'Ufficio'}</span>`;

    tr.innerHTML = `
      <td class="text-center text-muted font-bold">${index + 1}</td>
      <td class="text-center font-bold">${formatDisplayDate(e.date)}</td>
      <td class="text-center">${e.day_of_week}</td>
      <td>${courseTag}</td>
      <td class="text-center">${e.scheduled_start || '09:00'} - ${e.scheduled_end || '13:00'}</td>
      <td class="text-center">${e.actual_start || '09:00'} - ${e.actual_end || '13:00'}</td>
      <td class="text-right td-highlight ${isUtil ? 'cell-utilizzata' : ''}">${isUtil ? formatHours(e.hours) : ''}</td>
      <td class="text-right td-highlight ${isMat ? 'cell-maturata' : ''}">${isMat ? formatHours(e.hours) : ''}</td>
      <td class="text-right font-bold">${formatHours(e.running_balance)}</td>
      <td class="text-muted text-sm">${escapeHtml(e.causale || '')} ${escapeHtml(e.note || '')}</td>
      <td class="text-center">
        <button class="btn-icon" title="Modifica" onclick="window.editEntryById(${e.id})">✏️</button>
        <button class="btn-icon" title="Elimina" onclick="window.deleteEntryById(${e.id})">🗑️</button>
      </td>
    `;
    elements.tbodyHistory.appendChild(tr);
  });

  elements.histTotUtilizzate.textContent = formatHours(totUtil);
  elements.histTotMaturate.textContent = formatHours(totMat);
  const remaining = state.dashboardData ? state.dashboardData.summary.ore_rimanenti : 0;
  elements.histTotSaldo.textContent = formatHours(remaining);
}

export function downloadExcel() {
  window.location.href = `/api/export/excel?employee_id=${state.currentEmployeeId}`;
}

export function downloadCSV() {
  window.location.href = `/api/export/csv?employee_id=${state.currentEmployeeId}`;
}

