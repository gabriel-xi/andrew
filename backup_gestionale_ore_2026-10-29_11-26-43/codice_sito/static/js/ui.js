/**
 * UI Utilities, Formatters, Sanitization & Toasts
 */

import { elements } from './state.js';

export function escapeHtml(text) {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function escapeJsString(str) {
  if (!str) return "";
  return String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"');
}

export function formatDisplayDate(dateStr) {
  if (!dateStr) return "-";
  const parts = String(dateStr).split("-");
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

export function formatHours(val) {
  if (val === null || val === undefined || isNaN(val)) return "0,00";
  return Number(val).toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export function showToast(message, type = "info") {
  const container = elements.toastContainer || document.getElementById("toastContainer");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("fade-out");
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 4000);
}

export function openBackdropModal(modalEl) {
  const el = typeof modalEl === "string" ? document.getElementById(modalEl) : modalEl;
  if (el) {
    el.classList.add("show");
    el.style.display = "flex";
  }
}

export function closeBackdropModal(modalEl) {
  const el = typeof modalEl === "string" ? document.getElementById(modalEl) : modalEl;
  if (el) {
    el.classList.remove("show");
    el.style.display = "none";
  }
}
