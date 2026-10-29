/**
 * Document Repository, Course Files & Uploads
 */

import { state, elements } from './state.js';
import { apiCall } from './api.js';
import { showToast, escapeHtml, formatFileSize } from './ui.js';

export function getFileIcon(filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (ext === "pdf") return { icon: "📄", cls: "file-icon-pdf", label: "PDF" };
  if (["xlsx", "xls", "csv"].includes(ext)) return { icon: "📊", cls: "file-icon-excel", label: "EXCEL" };
  if (["doc", "docx"].includes(ext)) return { icon: "📝", cls: "file-icon-word", label: "WORD" };
  if (["png", "jpg", "jpeg", "webp"].includes(ext)) return { icon: "🖼️", cls: "file-icon-image", label: "IMG" };
  return { icon: "📁", cls: "file-icon-generic", label: ext.toUpperCase() || "FILE" };
}

export function handleDocFileSelected() {
  if (!elements.inputDocFile) return;
  const file = elements.inputDocFile.files[0];
  if (file && elements.dropzoneDocText) {
    elements.dropzoneDocText.innerHTML = `
      ✅ File selezionato: <strong>${escapeHtml(file.name)}</strong> (${formatFileSize(file.size)})
    `;
    if (elements.docUploadTitle && !elements.docUploadTitle.value) {
      elements.docUploadTitle.value = file.name.replace(/\.[^/.]+$/, "");
    }
  }
}

export function openUploadDocModal(defaultCourseId = null) {
  if (!elements.formDocumentUpload) return;
  elements.formDocumentUpload.reset();

  if (elements.dropzoneDocText) {
    elements.dropzoneDocText.innerHTML = `📁 Trascina qui il file (Excel, PDF, Word, Immagini) o <span class="text-primary underline">sfoglia</span>`;
  }

  if (elements.docUploadEmployee) {
    elements.docUploadEmployee.innerHTML = '<option value="">-- Generale / Nessun Dipendente --</option>';
    state.profiles.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (${p.role === 'admin' ? 'Admin' : 'Tutor'})`;
      if (p.id === state.currentEmployeeId) opt.selected = true;
      elements.docUploadEmployee.appendChild(opt);
    });
  }

  if (elements.docUploadCourse) {
    elements.docUploadCourse.innerHTML = '<option value="">-- Nessun Corso Specifico --</option>';
    state.courses.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.code || 'Senza codice'})`;
      if (defaultCourseId && c.id === defaultCourseId) opt.selected = true;
      elements.docUploadCourse.appendChild(opt);
    });
  }

  if (elements.modalDocumentUploadBackdrop) elements.modalDocumentUploadBackdrop.classList.add("show");
}

export function closeUploadDocModal() {
  if (elements.modalDocumentUploadBackdrop) elements.modalDocumentUploadBackdrop.classList.remove("show");
}

export async function handleUploadDocument(e, onUploaded) {
  e.preventDefault();
  const file = elements.inputDocFile ? elements.inputDocFile.files[0] : null;
  if (!file) {
    showToast("Seleziona prima un file da caricare", "warning");
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("title", elements.docUploadTitle.value.trim());
  formData.append("employee_id", elements.docUploadEmployee.value || "");
  formData.append("course_id", elements.docUploadCourse.value || "");
  formData.append("category", elements.docUploadCategory.value);
  formData.append("uploaded_by", state.currentUser ? state.currentUser.name : "Admin");
  formData.append("notes", elements.docUploadNotes.value.trim());

  const submitBtn = document.getElementById("btnSubmitUploadDoc");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Caricamento in corso...";
  }

  try {
    const data = await apiCall("/api/documents/upload", "POST", formData, true);
    if (data.status === "ok") {
      closeUploadDocModal();
      showToast(`Documento '${data.document.title}' caricato con successo!`, "success");
      await loadDocuments();
      if (onUploaded) await onUploaded(data.document);
    }
  } catch (err) {
    showToast(err.message || "Errore durante il caricamento del file", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "📤 Avvia Caricamento";
    }
  }
}

export async function loadDocuments(notify = false) {
  try {
    const data = await apiCall("/api/documents");
    if (data.status === "ok") {
      state.documents = data.documents || [];
      populateDocumentFilterOptions();
      renderDocumentsTable();
      if (notify) showToast("Archivio documenti sincronizzato!", "success");
    }
  } catch (err) {
    console.error("Errore caricamento documenti:", err);
  }
}

export function populateDocumentFilterOptions() {
  if (elements.filterDocEmployee) {
    const currentVal = elements.filterDocEmployee.value;
    elements.filterDocEmployee.innerHTML = '<option value="all">Tutti i dipendenti</option>';
    state.profiles.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      elements.filterDocEmployee.appendChild(opt);
    });
    if (currentVal) elements.filterDocEmployee.value = currentVal;
  }

  if (elements.filterDocCourse) {
    const currentVal = elements.filterDocCourse.value;
    elements.filterDocCourse.innerHTML = '<option value="all">Tutti i corsi</option>';
    state.courses.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      elements.filterDocCourse.appendChild(opt);
    });
    if (currentVal) elements.filterDocCourse.value = currentVal;
  }
}

export function renderDocumentsTable() {
  if (!elements.tbodyDocuments) return;

  const isAdmin = state.currentUser && state.currentUser.role === "admin";
  let docs = state.documents;

  if (state.docEmployeeFilter && state.docEmployeeFilter !== "all") {
    const empId = parseInt(state.docEmployeeFilter);
    docs = docs.filter(d => d.employee_id === empId);
  }

  if (state.docCourseFilter && state.docCourseFilter !== "all") {
    const cId = parseInt(state.docCourseFilter);
    docs = docs.filter(d => d.course_id === cId);
  }

  if (state.docCategoryFilter && state.docCategoryFilter !== "all") {
    docs = docs.filter(d => d.category === state.docCategoryFilter);
  }

  if (state.docSearchQuery && state.docSearchQuery.trim()) {
    const q = state.docSearchQuery.toLowerCase().trim();
    docs = docs.filter(d => 
      (d.title && d.title.toLowerCase().includes(q)) ||
      (d.filename && d.filename.toLowerCase().includes(q)) ||
      (d.employee_name && d.employee_name.toLowerCase().includes(q)) ||
      (d.course_name && d.course_name.toLowerCase().includes(q)) ||
      (d.notes && d.notes.toLowerCase().includes(q))
    );
  }

  if (elements.docsCountLabel) {
    elements.docsCountLabel.textContent = `Visualizzati ${docs.length} documenti su ${state.documents.length} totali`;
  }

  if (docs.length === 0) {
    elements.tbodyDocuments.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-4 text-muted">
          ${state.documents.length === 0 ? 'Nessun documento caricato nell\'archivio.' : 'Nessun documento trovato con i filtri attuali.'}
        </td>
      </tr>
    `;
    return;
  }

  elements.tbodyDocuments.innerHTML = "";
  docs.forEach(doc => {
    const iconMeta = getFileIcon(doc.filename);
    const dateFormatted = doc.created_at ? doc.created_at.replace("T", " ").substring(0, 16) : "-";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-center">
        <span class="file-type-icon ${iconMeta.cls}" title="${iconMeta.label}">
          ${iconMeta.icon}
        </span>
      </td>
      <td>
        <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(doc.title || doc.filename)}</div>
        <div class="text-muted text-sm d-flex items-center gap-2">
          <span>📁 ${escapeHtml(doc.filename)}</span>
          ${doc.notes ? `<span title="${escapeHtml(doc.notes)}">💬 <em>${escapeHtml(doc.notes)}</em></span>` : ''}
        </div>
      </td>
      <td>
        ${doc.employee_name ? `
          <span class="user-role-pill role-tutor" style="font-size: 0.8rem; padding: 2px 8px;">
            👤 ${escapeHtml(doc.employee_name)}
          </span>
        ` : '<span class="text-muted text-sm">— Generale —</span>'}
      </td>
      <td>
        ${doc.course_name ? `
          <span class="badge" style="background-color: var(--bg-tertiary); color: var(--text-primary); border: 1px solid var(--border-color); font-size: 0.8rem;">
            📚 ${escapeHtml(doc.course_name)}
          </span>
        ` : '<span class="text-muted text-sm">— Nessun corso —</span>'}
      </td>
      <td>
        <span class="category-pill">${escapeHtml(doc.category || 'Generale')}</span>
      </td>
      <td class="text-muted text-sm">${formatFileSize(doc.file_size)}</td>
      <td class="text-muted text-sm">${dateFormatted}</td>
      <td class="text-center">
        <div class="d-flex items-center justify-center gap-1">
          <a href="/api/documents/${doc.id}/download" class="btn btn-outline btn-sm font-bold" title="Scarica file" download>
            📥 Scarica
          </a>
          ${isAdmin ? `
            <button class="btn btn-outline btn-sm text-red" onclick="window.handleDeleteDocument(${doc.id})" title="Elimina file">
              🗑️
            </button>
          ` : ''}
        </div>
      </td>
    `;
    elements.tbodyDocuments.appendChild(tr);
  });
}

export async function loadCourseDocuments(courseId) {
  if (!elements.detailTbodyDocuments) return;
  try {
    const data = await apiCall(`/api/documents?course_id=${courseId}`);
    if (data.status === "ok") {
      renderCourseDocumentsTable(data.documents || []);
    }
  } catch (err) {
    console.error("Errore caricamento documenti del corso:", err);
  }
}

export function renderCourseDocumentsTable(docs) {
  if (!elements.detailTbodyDocuments) return;
  const isAdmin = state.currentUser && state.currentUser.role === "admin";

  if (!docs || docs.length === 0) {
    elements.detailTbodyDocuments.innerHTML = `
      <tr>
        <td colspan="7" class="text-center py-4 text-muted">
          Nessun documento caricato per questo corso.
        </td>
      </tr>
    `;
    return;
  }

  elements.detailTbodyDocuments.innerHTML = "";
  docs.forEach(doc => {
    const iconMeta = getFileIcon(doc.filename);
    const dateFormatted = doc.created_at ? doc.created_at.replace("T", " ").substring(0, 16) : "-";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-center">
        <span class="file-type-icon ${iconMeta.cls}" title="${iconMeta.label}">
          ${iconMeta.icon}
        </span>
      </td>
      <td>
        <div style="font-weight: 600; color: var(--text-primary);">${escapeHtml(doc.title || doc.filename)}</div>
        <div class="text-muted text-sm d-flex items-center gap-2">
          <span>📁 ${escapeHtml(doc.filename)}</span>
          ${doc.notes ? `<span title="${escapeHtml(doc.notes)}">💬 <em>${escapeHtml(doc.notes)}</em></span>` : ''}
        </div>
      </td>
      <td>
        <span class="category-pill">${escapeHtml(doc.category || 'Generale')}</span>
      </td>
      <td>
        ${doc.employee_name ? `
          <span class="user-role-pill role-tutor" style="font-size: 0.8rem; padding: 2px 8px;">
            👤 ${escapeHtml(doc.employee_name)}
          </span>
        ` : '<span class="text-muted text-sm">— Docenti / Tutti —</span>'}
      </td>
      <td class="text-muted text-sm">${formatFileSize(doc.file_size)}</td>
      <td class="text-muted text-sm">${dateFormatted}</td>
      <td class="text-center">
        <div class="d-flex items-center justify-center gap-1">
          <a href="/api/documents/${doc.id}/download" class="btn btn-outline btn-sm" title="Scarica file" download>
            📥 Scarica
          </a>
          ${isAdmin ? `
            <button class="btn btn-outline btn-sm text-red" onclick="window.handleDeleteCourseDocument(${doc.id})" title="Elimina file">
              🗑️
            </button>
          ` : ''}
        </div>
      </td>
    `;
    elements.detailTbodyDocuments.appendChild(tr);
  });
}

export async function handleDeleteDocument(docId, onDeleted) {
  if (!confirm("Sei sicuro di voler eliminare questo documento dall'archivio?")) return;
  try {
    await apiCall(`/api/documents/${docId}`, "DELETE");
    showToast("Documento eliminato.", "info");
    await loadDocuments();
    if (onDeleted) await onDeleted();
  } catch (err) {
    showToast(err.message || "Errore durante la cancellazione", "error");
  }
}

