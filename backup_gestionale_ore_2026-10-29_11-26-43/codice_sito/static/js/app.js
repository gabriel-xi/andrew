/**
 * Master Application Orchestrator & Event Dispatcher (v2.0)
 */

import { state, elements } from './state.js';
import { apiCall } from './api.js';
import { showToast, escapeHtml, escapeJsString, formatDisplayDate, formatHours, openBackdropModal, closeBackdropModal } from './ui.js';
import * as Auth from './auth.js';
import * as TimeTracking from './timetracking.js';
import * as Courses from './courses.js';
import * as Calendar from './calendar.js';
import * as Importer from './calendar_importer.js';
import * as Dashboard from './dashboard.js';
import * as Employees from './employees.js';
import * as Documents from './documents.js';
import * as TutorDashboard from './tutor_dashboard.js';

// =============================================================
// GLOBAL REFRESH CONTROLLER
// =============================================================

export async function refreshCurrentView(notify = false) {
  if (!state.currentUser && (!state.profiles || state.profiles.length === 0)) {
    return;
  }

  try {
    await Promise.all([
      Calendar.loadMasterSchedule(),
      Courses.checkSystemDiscrepancies(),
      Dashboard.loadDashboard(),
      Courses.loadCourses(),
      TutorDashboard.loadTutorDashboard(),
      TimeTracking.loadWeeklySchedule(),
      Courses.loadMonthlyCoursesReport(),
      TimeTracking.loadHistoryTable(),
      Calendar.loadOfficialCalendars(),
      Documents.loadDocuments()
    ]);

    Employees.renderEmployeesGrid();
    await Employees.loadTrashEmployees();

    if (state.currentUser && state.currentUser.role === "admin") {
      await Employees.loadAdminHoursOverview();
    }

    if (notify) {
      showToast("Dati aggiornati con successo!", "info");
    }
  } catch (err) {
    console.error("Errore refresh viste:", err);
  }
}

// =============================================================
// WINDOW EXPORTS FOR DYNAMIC HTML STRING TEMPLATES
// =============================================================

window.openCourseModal = (course) => Courses.openCourseModal(course);
window.editCourseById = async (id) => {
  let c = state.courses.find(item => Number(item.id) === Number(id));
  if (!c) {
    const res = await apiCall(`/api/courses?employee_id=all`);
    if (res && res.courses) {
      state.courses = res.courses;
      c = state.courses.find(item => Number(item.id) === Number(id));
    }
  }
  if (!c && id) {
    try {
      const single = await apiCall(`/api/courses/${id}`);
      if (single && single.course) c = single.course;
    } catch(e) {}
  }
  if (c) {
    Courses.openCourseModal(c);
  } else {
    showToast("Dati del corso non disponibili", "error");
  }
};
window.handleDeleteCourse = (id) => Courses.handleDeleteCourse(id, refreshCurrentView);
window.openCourseDetail = (id) => Courses.openCourseDetail(id);
window.backToCoursesList = () => Courses.backToCoursesList();
window.toggleCourseContractIntegration = (id) => Courses.toggleCourseContractIntegration(id);
window.openContractScheduleModal = (id) => Employees.openContractScheduleModal(id);
window.filterCourseCalendarByDocente = (docente) => {
  Courses.switchCourseSubpane("courseSubpaneCalendar");
  if (elements.courseSubFilterDocente) {
    elements.courseSubFilterDocente.value = docente;
  }
};

window.openEntryModal = (entry) => TimeTracking.openEntryModal(entry);
window.openEntryModalForSede = () => TimeTracking.openEntryModalForSede();
window.openEntryModalForCourse = (cid, date, sStart, sEnd, mod) => TimeTracking.openEntryModalForCourse(cid, date, sStart, sEnd, mod);
window.openEntryModalForDate = (date) => TimeTracking.openEntryModalForDate(date);
window.openEntryModalForMonth = (my) => TimeTracking.openEntryModalForMonth(my);
window.registerTutorFromSession = (id) => Calendar.registerTutorFromSession(id);
window.handleSyncTutorCourseEntries = (id) => Courses.handleSyncTutorCourseEntries(id);
window.openAttendanceModal = (courseId) => Courses.openAttendanceModal(courseId);
window.editEntryById = (id) => {
  const entry = state.entries.find(e => e.id === id);
  if (entry) {
    TimeTracking.openEntryModal(entry);
  } else if (state.weeklySchedule) {
    const all = state.weeklySchedule.days.flatMap(d => d.entries || []);
    const found = all.find(e => e.id === id);
    if (found) TimeTracking.openEntryModal(found);
  }
};
window.deleteEntryById = (id) => TimeTracking.deleteEntryById(id, refreshCurrentView);
window.filterByMonthAndSwitch = (monthYear) => {
  const timeTabBtn = document.querySelector('[data-tab="tab-timetracking"]');
  if (timeTabBtn) timeTabBtn.click();
  const histSubtab = document.querySelector('[data-subpane="subpane-history"]');
  if (histSubtab) histSubtab.click();
  if (elements.filterMonth) {
    elements.filterMonth.value = monthYear;
    state.filterMonth = monthYear;
  }
  TimeTracking.loadHistoryTable();
};

window.switchActiveUser = (id) => Auth.switchActiveUser(id, refreshCurrentView);
window.handleSoftDeleteEmployee = (id, name) => Employees.handleSoftDeleteEmployee(id, name, refreshCurrentView);
window.handleRestoreEmployee = (id) => Employees.handleRestoreEmployee(id, refreshCurrentView);
window.handlePermanentDeleteEmployee = (id) => Employees.handlePermanentDeleteEmployee(id, refreshCurrentView);

window.openEditSessionModalById = (id) => Calendar.openSessionModal(id);
window.handleDeleteSessionById = async (id) => {
  await Calendar.deleteCalendarSessionById(id, async () => {
    if (state.selectedCourseDetailId) {
      await Courses.loadCourseDetailData(state.selectedCourseDetailId);
    }
    if (state.selectedCalendarId) {
      await Calendar.loadCalendarDetail(state.selectedCalendarId);
    }
    await Calendar.loadMasterSchedule();
    await Courses.loadCourses();
  });
};
window.deleteCalendarSessionById = window.handleDeleteSessionById;
window.openRescheduleModalById = (id) => Calendar.openRescheduleModalById(id);
window.openCourseDetailAddSession = () => Calendar.openSessionModal(null, "aula");

window.handleDeleteDocument = (id) => Documents.handleDeleteDocument(id);
window.handleDeleteCourseDocument = (id) => Documents.handleDeleteDocument(id, () => {
  if (state.selectedCourseDetailId) Documents.loadCourseDocuments(state.selectedCourseDetailId);
});

// Tutor Dashboard & Multi-Contract Window Exports
window.openAssignCourseModal = () => TutorDashboard.openAssignCourseModal();
window.closeAssignCourseModal = () => TutorDashboard.closeAssignCourseModal();
window.handleAssignCourseToMe = (id) => TutorDashboard.handleAssignCourseToMe(id);
window.handleUnassignCourseFromMe = (id) => TutorDashboard.handleUnassignCourseFromMe(id);
window.toggleCourseAccordion = (id) => TutorDashboard.toggleCourseAccordion(id);
window.openContractModal = (c) => TutorDashboard.openContractModal(c);
window.editContractById = (id) => {
  const ct = state.tutorDashboardData?.contracts?.find(c => c.id === id);
  TutorDashboard.openContractModal(ct);
};
window.openRenewContractModal = (id) => TutorDashboard.openRenewContractModal(id);
window.handleDeleteContract = (id) => TutorDashboard.handleDeleteContract(id);

// =============================================================
// EVENT LISTENERS INITIALIZATION
// =============================================================

function setupEventListeners() {
  // Theme Toggle
  if (elements.btnThemeToggle) {
    elements.btnThemeToggle.addEventListener("click", () => {
      state.theme = state.theme === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", state.theme);
      localStorage.setItem("app_theme", state.theme);
      elements.btnThemeToggle.textContent = state.theme === "dark" ? "☀️" : "🌙";
      Dashboard.updateDonutChart();
    });
    elements.btnThemeToggle.textContent = state.theme === "dark" ? "☀️" : "🌙";
  }

  // Navigation Tabs
  elements.tabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      Auth.switchMainTab(target);
      if (target === "tab-master-calendar") {
        Calendar.loadMasterSchedule();
      } else if (target === "tab-courses") {
        Courses.checkSystemDiscrepancies();
        if (state.selectedCourseDetailId) {
          Courses.loadCourseDetailData(state.selectedCourseDetailId);
        } else {
          Courses.loadCourses();
          Courses.loadMonthlyCoursesReport();
        }
      } else if (target === "tab-official-calendars") {
        Calendar.loadOfficialCalendars();
      } else if (target === "tab-documents") {
        Documents.loadDocuments();
      } else if (target === "tab-employees") {
        Employees.renderEmployeesGrid();
        Employees.loadTrashEmployees();
      } else if (target === "tab-admin-hours") {
        Employees.loadAdminHoursOverview();
      } else if (target === "tab-timetracking") {
        TutorDashboard.loadTutorDashboard();
      }
    });
  });

  // Time Tracking Subpanes
  elements.subtabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-subpane");
      state.activeSubpane = targetId;
      elements.subtabButtons.forEach(b => b.classList.toggle("active", b.getAttribute("data-subpane") === targetId));
      elements.subpanes.forEach(p => p.classList.toggle("active", p.id === targetId));

      if (targetId === "subpane-tutor-dashboard" || targetId === "subpane-contracts") {
        TutorDashboard.loadTutorDashboard();
      } else if (targetId === "subpane-weekly") TimeTracking.loadWeeklySchedule();
      else if (targetId === "subpane-dashboard") Dashboard.loadDashboard();
      else if (targetId === "subpane-calendar") Dashboard.renderCalendarGrid();
      else if (targetId === "subpane-history") TimeTracking.loadHistoryTable();
    });
  });

  // Course Detail Subpanes
  elements.courseSubtabButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      Courses.switchCourseSubpane(btn.getAttribute("data-coursesubpane"));
    });
  });

  // Auth Forms
  if (elements.formAuthLogin) {
    elements.formAuthLogin.addEventListener("submit", (e) => Auth.handleAuthLogin(e, refreshCurrentView));
  }
  if (elements.formAuthSetupAdmin) {
    elements.formAuthSetupAdmin.addEventListener("submit", (e) => Auth.handleAuthSetupAdmin(e, refreshCurrentView));
  }
  if (elements.formAuthRegisterTutor) {
    elements.formAuthRegisterTutor.addEventListener("submit", (e) => Auth.handleAuthRegisterTutor(e, refreshCurrentView));
  }

  // Auth Card Navigation Buttons
  if (elements.btnGoToRegisterTutor) elements.btnGoToRegisterTutor.addEventListener("click", () => Auth.showAuthCard("register-tutor"));
  if (elements.btnLoginGoToRegisterTop) elements.btnLoginGoToRegisterTop.addEventListener("click", () => Auth.showAuthCard("register-tutor"));
  if (elements.btnGoToLogin) elements.btnGoToLogin.addEventListener("click", () => Auth.showAuthCard("login"));
  if (elements.btnTutorGoToLoginTop) elements.btnTutorGoToLoginTop.addEventListener("click", () => Auth.showAuthCard("login"));
  if (elements.btnAdminGoToLogin) elements.btnAdminGoToLogin.addEventListener("click", () => Auth.showAuthCard("login"));
  if (elements.btnAdminGoToLoginFooter) elements.btnAdminGoToLoginFooter.addEventListener("click", () => Auth.showAuthCard("login"));

  // Logout & Switch Profile
  if (elements.btnLogout) elements.btnLogout.addEventListener("click", Auth.handleLogout);
  if (elements.btnSwitchProfile) elements.btnSwitchProfile.addEventListener("click", Auth.openSwitchProfileModal);
  if (elements.btnCloseSwitchModal) elements.btnCloseSwitchModal.addEventListener("click", Auth.closeSwitchProfileModal);
  if (elements.btnOpenRegisterTutorModal) elements.btnOpenRegisterTutorModal.addEventListener("click", () => {
    Auth.closeSwitchProfileModal();
    Auth.showAuthCard("register-tutor");
  });

  // Admin View Selector
  if (elements.adminSelectViewEmployee) {
    elements.adminSelectViewEmployee.addEventListener("change", async (e) => {
      const targetId = parseInt(e.target.value);
      if (!targetId) return;
      state.currentEmployeeId = targetId;
      const targetUser = state.profiles.find(p => p.id === targetId);
      showToast(`Stai visualizzando il registro di: ${targetUser ? targetUser.name : 'Dipendente'}`, "info");
      await refreshCurrentView();
    });
  }

  // Week Navigator
  if (elements.btnPrevWeek) elements.btnPrevWeek.addEventListener("click", () => TimeTracking.handlePrevWeek(TimeTracking.loadWeeklySchedule));
  if (elements.btnCurrentWeek) elements.btnCurrentWeek.addEventListener("click", () => TimeTracking.handleCurrentWeek(TimeTracking.loadWeeklySchedule));
  if (elements.btnNextWeek) elements.btnNextWeek.addEventListener("click", () => TimeTracking.handleNextWeek(TimeTracking.loadWeeklySchedule));

  // Dedicated Tutor Action Buttons (In Sede vs Presenza Corso da File)
  if (elements.btnOpenEntrySede) elements.btnOpenEntrySede.addEventListener("click", () => TimeTracking.openEntryModalForSede());
  if (elements.btnOpenEntryCourse) {
    elements.btnOpenEntryCourse.addEventListener("click", () => {
      const assigned = (state.tutorDashboardData && state.tutorDashboardData.assigned_courses) || [];
      const courseId = assigned.length > 0 ? assigned[0].id : (state.selectedCourseDetailId || (state.courses.length > 0 ? state.courses[0].id : null));
      Courses.openAttendanceModal(courseId);
    });
  }
  if (elements.btnEntryModeSede) elements.btnEntryModeSede.addEventListener("click", () => TimeTracking.setEntryModalMode("sede"));
  if (elements.btnEntryModeCourse) elements.btnEntryModeCourse.addEventListener("click", () => TimeTracking.setEntryModalMode("course"));

  // Modals Open/Close
  if (elements.btnOpenNewEntryModal) elements.btnOpenNewEntryModal.addEventListener("click", () => TimeTracking.openEntryModal());
  if (elements.btnMobileFabEntry) elements.btnMobileFabEntry.addEventListener("click", () => TimeTracking.openEntryModal());
  if (elements.btnWeekAddEntryModal) elements.btnWeekAddEntryModal.addEventListener("click", () => TimeTracking.openEntryModal());
  if (elements.btnCloseEntryModal) elements.btnCloseEntryModal.addEventListener("click", TimeTracking.closeEntryModal);
  if (elements.btnCancelEntryModal) elements.btnCancelEntryModal.addEventListener("click", TimeTracking.closeEntryModal);
  if (elements.formEntry) elements.formEntry.addEventListener("submit", (e) => TimeTracking.handleSaveEntry(e, refreshCurrentView));

  // Time Variance recalculation
  ["entrySchedStart", "entrySchedEnd", "entryActStart", "entryActEnd"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", TimeTracking.recalculateModalVariance);
  });

  // Live Entry Modal Breakdown Listeners
  ["entryDate", "entryOfficeStart", "entryOfficeEnd", "entryLunchStart", "entryLunchEnd", "entryCourseStart", "entryCourseEnd"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", TimeTracking.recalculateBreakdownLive);
      el.addEventListener("change", TimeTracking.recalculateBreakdownLive);
    }
  });
  if (elements.entryIsIntegrated) {
    elements.entryIsIntegrated.addEventListener("change", TimeTracking.recalculateBreakdownLive);
  }
  if (elements.entryCourse) {
    elements.entryCourse.addEventListener("change", (e) => {
      const cid = e.target.value;
      if (cid) {
        const selCourse = state.courses.find(c => Number(c.id) === Number(cid));
        if (elements.entryIsIntegrated && selCourse) {
          elements.entryIsIntegrated.checked = Boolean(selCourse.integrates_with_contract);
        }
        if (elements.entryActivityType) elements.entryActivityType.value = "Tutoraggio d'aula";
        if (elements.entryCourseStart && !elements.entryCourseStart.value) {
          elements.entryCourseStart.value = elements.entryOfficeStart ? elements.entryOfficeStart.value : "09:00";
        }
        if (elements.entryCourseEnd && !elements.entryCourseEnd.value) {
          elements.entryCourseEnd.value = elements.entryOfficeEnd ? elements.entryOfficeEnd.value : "13:00";
        }
      } else {
        if (elements.entryIsIntegrated) elements.entryIsIntegrated.checked = false;
        if (elements.entryActivityType) elements.entryActivityType.value = "Lavoro Ordinario";
        if (elements.entryCourseStart) elements.entryCourseStart.value = "";
        if (elements.entryCourseEnd) elements.entryCourseEnd.value = "";
      }
      TimeTracking.recalculateBreakdownLive();
    });
  }

  // Contract Schedule Modal Listeners
  if (elements.btnNavOpenContractSchedule) {
    elements.btnNavOpenContractSchedule.addEventListener("click", () => {
      Employees.openContractScheduleModal(state.currentUser ? state.currentUser.id : state.currentEmployeeId);
    });
  }
  if (elements.btnCloseContractScheduleModal) {
    elements.btnCloseContractScheduleModal.addEventListener("click", Employees.closeContractScheduleModal);
  }
  if (elements.btnCancelContractScheduleModal) {
    elements.btnCancelContractScheduleModal.addEventListener("click", Employees.closeContractScheduleModal);
  }
  if (elements.formContractSchedule) {
    elements.formContractSchedule.addEventListener("submit", (e) => Employees.handleSaveContractSchedule(e, refreshCurrentView));
  }
  ["contractOfficeStart", "contractOfficeEnd", "contractLunchStart", "contractLunchEnd"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", Employees.updateContractDailyHoursPreview);
  });
  document.querySelectorAll("input[name='contractDayOfWeek']").forEach(cb => {
    cb.addEventListener("change", Employees.updateContractDailyHoursPreview);
  });

  // Course Modals
  if (elements.btnOpenNewCourseModal) elements.btnOpenNewCourseModal.addEventListener("click", () => Courses.openCourseModal());
  if (elements.btnAddCourseBtn) elements.btnAddCourseBtn.addEventListener("click", () => Courses.openCourseModal());
  if (elements.btnCloseCourseModal) elements.btnCloseCourseModal.addEventListener("click", Courses.closeCourseModal);
  if (elements.btnCancelCourseModal) elements.btnCancelCourseModal.addEventListener("click", Courses.closeCourseModal);
  if (elements.formCourse) elements.formCourse.addEventListener("submit", (e) => Courses.handleSaveCourse(e, refreshCurrentView));
  if (elements.btnBackToCoursesList) elements.btnBackToCoursesList.addEventListener("click", Courses.backToCoursesList);

  // History Filters (Debounced instant search)
  if (elements.filterSearch) {
    let searchDebounce;
    elements.filterSearch.addEventListener("input", () => {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(TimeTracking.loadHistoryTable, 300);
    });
  }
  if (elements.filterMonth) elements.filterMonth.addEventListener("change", TimeTracking.loadHistoryTable);
  if (elements.filterCourse) elements.filterCourse.addEventListener("change", TimeTracking.loadHistoryTable);
  if (elements.filterType) elements.filterType.addEventListener("change", TimeTracking.loadHistoryTable);
  if (elements.btnResetFilters) {
    elements.btnResetFilters.addEventListener("click", () => {
      if (elements.filterSearch) elements.filterSearch.value = "";
      if (elements.filterMonth) elements.filterMonth.value = "";
      if (elements.filterCourse) elements.filterCourse.value = "";
      if (elements.filterType) elements.filterType.value = "";
      TimeTracking.loadHistoryTable();
    });
  }

  // Export / Import Excel
  if (elements.btnQuickExportExcel) elements.btnQuickExportExcel.addEventListener("click", TimeTracking.downloadExcel);
  if (elements.btnExportExcelFromHistory) elements.btnExportExcelFromHistory.addEventListener("click", TimeTracking.downloadExcel);
  if (elements.btnToolExportExcel) elements.btnToolExportExcel.addEventListener("click", TimeTracking.downloadExcel);
  if (elements.btnExportCSV) elements.btnExportCSV.addEventListener("click", TimeTracking.downloadCSV);
  if (elements.btnToolExportCSV) elements.btnToolExportCSV.addEventListener("click", TimeTracking.downloadCSV);
async function downloadAuthenticatedFile(url, fallbackFilename = "backup.zip") {
  try {
    showToast("Preparazione archivio di backup in corso...", "info");
    const headers = {};
    if (state.token) {
      headers["Authorization"] = `Bearer ${state.token}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Errore download (${res.status})`);
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    let filename = fallbackFilename;
    const match = disposition.match(/filename="?([^";]+)"?/);
    if (match && match[1]) {
      filename = match[1];
    }
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(blobUrl);
    a.remove();
    showToast("Download backup completato con successo!", "success");
  } catch (err) {
    console.error("Errore download file:", err);
    showToast(err.message || "Impossibile scaricare il file di backup.", "danger");
  }
}

  if (elements.btnAdminDownloadBackup) elements.btnAdminDownloadBackup.addEventListener("click", () => {
    downloadAuthenticatedFile(`/api/admin/backup/download`, "backup_gestionale_ore.zip");
  });
  if (elements.btnToolDownloadBackup) elements.btnToolDownloadBackup.addEventListener("click", () => {
    downloadAuthenticatedFile(`/api/admin/backup/download`, "backup_gestionale_ore.zip");
  });

  // Calendar Modal
  if (elements.btnOpenCreateCalendarModal) elements.btnOpenCreateCalendarModal.addEventListener("click", () => Calendar.openCourseCalendarModal());
  if (elements.btnCloseCourseCalendarModal) elements.btnCloseCourseCalendarModal.addEventListener("click", Calendar.closeCourseCalendarModal);
  if (elements.btnCancelCourseCalendarModal) elements.btnCancelCourseCalendarModal.addEventListener("click", Calendar.closeCourseCalendarModal);
  if (elements.formCourseCalendar) elements.formCourseCalendar.addEventListener("submit", (e) => Calendar.handleSaveCourseCalendar(e, Calendar.loadOfficialCalendars));
  if (elements.selectOfficialCalendar) {
    elements.selectOfficialCalendar.addEventListener("change", (e) => {
      const val = parseInt(e.target.value);
      if (val) Calendar.loadCalendarDetail(val);
    });
  }

  // Session Modal
  if (elements.btnOpenAddSessionModal) elements.btnOpenAddSessionModal.addEventListener("click", () => Calendar.openSessionModal(null, "aula"));
  if (elements.btnCloseSessionModal) elements.btnCloseSessionModal.addEventListener("click", Calendar.closeSessionModal);
  if (elements.btnCancelSessionModal) elements.btnCancelSessionModal.addEventListener("click", Calendar.closeSessionModal);
  if (elements.formCalendarSession) elements.formCalendarSession.addEventListener("submit", (e) => Calendar.handleSaveSession(e, async () => {
    if (state.selectedCourseDetailId) await Courses.loadCourseDetailData(state.selectedCourseDetailId);
    if (state.selectedCalendarId) await Calendar.loadCalendarDetail(state.selectedCalendarId);
    await Calendar.loadMasterSchedule();
    await Courses.loadCourses();
  }));

  if (elements.radioPhaseAula) elements.radioPhaseAula.addEventListener("change", () => Calendar.updateSessionModalPhase("aula"));
  if (elements.radioPhaseStage) elements.radioPhaseStage.addEventListener("change", () => Calendar.updateSessionModalPhase("stage"));
  if (elements.sessModalStartTime) elements.sessModalStartTime.addEventListener("input", () => {
    Calendar.recalculateSessionModalHours();
    Calendar.checkLiveSessionConflict();
  });
  if (elements.sessModalEndTime) elements.sessModalEndTime.addEventListener("input", () => {
    Calendar.recalculateSessionModalHours();
    Calendar.checkLiveSessionConflict();
  });
  if (elements.sessModalDocente) elements.sessModalDocente.addEventListener("input", Calendar.checkLiveSessionConflict);
  if (elements.sessModalDate) elements.sessModalDate.addEventListener("input", Calendar.checkLiveSessionConflict);

  // Reschedule Modal
  if (elements.btnCloseRescheduleModal) elements.btnCloseRescheduleModal.addEventListener("click", Calendar.closeRescheduleModal);
  if (elements.btnCancelRescheduleModal) elements.btnCancelRescheduleModal.addEventListener("click", Calendar.closeRescheduleModal);
  if (elements.reschedStatusSelect) elements.reschedStatusSelect.addEventListener("change", Calendar.updateRescheduleModalFields);
  if (elements.reschedNewDate) elements.reschedNewDate.addEventListener("input", Calendar.checkLiveRescheduleConflict);
  if (elements.reschedNewStart) elements.reschedNewStart.addEventListener("input", Calendar.checkLiveRescheduleConflict);
  if (elements.reschedNewEnd) elements.reschedNewEnd.addEventListener("input", Calendar.checkLiveRescheduleConflict);
  if (elements.formRescheduleSession) elements.formRescheduleSession.addEventListener("submit", (e) => Calendar.handleSaveReschedule(e, async () => {
    if (state.selectedCourseDetailId) await Courses.loadCourseDetailData(state.selectedCourseDetailId);
    if (state.selectedCalendarId) await Calendar.loadCalendarDetail(state.selectedCalendarId);
    await Calendar.loadMasterSchedule();
    await Courses.loadCourses();
  }));

  // Calendar Importer Dropzone & Modal
  if (elements.btnOpenImportCalendarModal) elements.btnOpenImportCalendarModal.addEventListener("click", Importer.openImportCalendarModal);
  if (elements.btnCalImportCalendar) elements.btnCalImportCalendar.addEventListener("click", Importer.openImportCalendarModal);
  if (elements.btnCloseImportCalModal) elements.btnCloseImportCalModal.addEventListener("click", Importer.closeImportCalendarModal);
  if (elements.btnCancelImportCalModal) elements.btnCancelImportCalModal.addEventListener("click", Importer.closeImportCalendarModal);
  if (elements.btnResetImportFile) elements.btnResetImportFile.addEventListener("click", Importer.resetImportCalendarModal);
  if (elements.inputCalFile) elements.inputCalFile.addEventListener("change", Importer.handleCalendarFileSelected);
  if (elements.btnConfirmImportCal) elements.btnConfirmImportCal.addEventListener("click", () => Importer.handleConfirmImportCalendar((newCourseId) => {
    Courses.loadCourses();
    Calendar.loadOfficialCalendars();
    if (newCourseId) Courses.openCourseDetail(newCourseId);
  }));

  // Documents
  if (elements.btnOpenUploadDocModal) elements.btnOpenUploadDocModal.addEventListener("click", () => Documents.openUploadDocModal());
  if (elements.btnCloseUploadDocModal) elements.btnCloseUploadDocModal.addEventListener("click", Documents.closeUploadDocModal);
  if (elements.btnCancelUploadDocModal) elements.btnCancelUploadDocModal.addEventListener("click", Documents.closeUploadDocModal);
  if (elements.inputDocFile) elements.inputDocFile.addEventListener("change", Documents.handleDocFileSelected);
  if (elements.formDocumentUpload) elements.formDocumentUpload.addEventListener("submit", (e) => Documents.handleUploadDocument(e, Documents.loadDocuments));
  if (elements.filterDocEmployee) elements.filterDocEmployee.addEventListener("change", (e) => {
    state.docEmployeeFilter = e.target.value;
    Documents.renderDocumentsTable();
  });
  if (elements.filterDocCourse) elements.filterDocCourse.addEventListener("change", (e) => {
    state.docCourseFilter = e.target.value;
    Documents.renderDocumentsTable();
  });
  if (elements.filterDocCategory) elements.filterDocCategory.addEventListener("change", (e) => {
    state.docCategoryFilter = e.target.value;
    Documents.renderDocumentsTable();
  });
  if (elements.inputSearchDocs) {
    let docDebounce;
    elements.inputSearchDocs.addEventListener("input", (e) => {
      clearTimeout(docDebounce);
      docDebounce = setTimeout(() => {
        state.docSearchQuery = e.target.value;
        Documents.renderDocumentsTable();
      }, 300);
    });
  }

  // Trash & Backup view
  if (elements.btnToggleTrashView) {
    elements.btnToggleTrashView.addEventListener("click", () => {
      if (elements.trashContainer) elements.trashContainer.style.display = "block";
      Employees.loadTrashEmployees();
    });
  }
  if (elements.btnCloseTrashView) {
    elements.btnCloseTrashView.addEventListener("click", () => {
      if (elements.trashContainer) elements.trashContainer.style.display = "none";
    });
  }

  // Course Detail Action: Edit Course Metadata
  if (elements.btnCourseDetailEditMeta) {
    elements.btnCourseDetailEditMeta.addEventListener("click", async () => {
      if (state.selectedCourseDetailId) {
        window.editCourseById(state.selectedCourseDetailId);
      }
    });
  }

  // Course Detail Action: Toggle Contract Integration
  if (elements.btnCourseDetailToggleContract) {
    elements.btnCourseDetailToggleContract.addEventListener("click", () => {
      Courses.toggleCourseContractIntegration(state.selectedCourseDetailId);
    });
  }

  // Course Detail Action: Delete Course
  if (elements.btnCourseDetailDelete) {
    elements.btnCourseDetailDelete.addEventListener("click", () => {
      if (state.selectedCourseDetailId) {
        Courses.handleDeleteCourse(state.selectedCourseDetailId, async () => {
          Courses.backToCoursesList();
          await refreshCurrentView();
        });
      }
    });
  }

  // Course Detail Action: Add Session
  if (elements.btnCourseDetailAddSession) {
    elements.btnCourseDetailAddSession.addEventListener("click", () => {
      Calendar.openSessionModal(null, "aula");
    });
  }

  // Course Detail Action: Change Tutor
  if (elements.btnCourseDetailChangeTutor) {
    elements.btnCourseDetailChangeTutor.addEventListener("click", async () => {
      if (state.selectedCourseDetailId) {
        let c = state.courses.find(item => item.id === state.selectedCourseDetailId);
        if (!c) {
          const res = await apiCall(`/api/courses?employee_id=all`);
          if (res && res.courses) {
            state.courses = res.courses;
            c = state.courses.find(item => item.id === state.selectedCourseDetailId);
          }
        }
        if (c) Courses.openCourseModal(c);
      }
    });
  }

  // Course Detail Action: Import Calendar directly for this course
  if (elements.btnCourseDetailImportFile) {
    elements.btnCourseDetailImportFile.addEventListener("click", () => {
      Importer.openImportCalendarModal(state.selectedCourseDetailId);
    });
  }

  // Module Event Listeners
  Calendar.initMasterCalendarEvents();
  Courses.initDiscrepancyEvents();
  Courses.initAttendanceImportEvents();
  Courses.initCourseDetailCalendarFilterEvents();
  Importer.initCalendarImporterEvents();
  TutorDashboard.initTutorDashboardEvents();
}

// =============================================================
// DOM CONTENT LOADED - APPLICATION BOOTSTRAP
// =============================================================

async function initApp() {
  try {
    setupEventListeners();
  } catch (err) {
    console.error("Errore setupEventListeners:", err);
  }

  try {
    const isAuthenticated = await Auth.checkAuthStatus();
    if (isAuthenticated) {
      await refreshCurrentView();
    }
  } catch (err) {
    console.error("Errore bootstrap applicazione:", err);
    Auth.showAuthCard("login");
  } finally {
    const loader = document.getElementById("authLoadingPlaceholder");
    if (loader) loader.style.display = "none";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

