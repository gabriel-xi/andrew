/**
 * Dashboard KPIs, Balance Hours, Ferie Conversions, Monthly Grid & Chart.js
 */

import { state, elements } from './state.js';
import { apiCall } from './api.js';
import { formatHours, formatDisplayDate } from './ui.js';

export async function loadDashboard() {
  if (!state.currentEmployeeId) return;
  try {
    const data = await apiCall(`/api/dashboard?employee_id=${state.currentEmployeeId}`);
    if (data.status === "ok") {
      state.dashboardData = data.data;
      renderDashboard();
    }
  } catch (err) {
    console.error("Dashboard load err:", err);
  }
}

export function renderDashboard() {
  const d = state.dashboardData;
  if (!d) return;

  const emp = d.employee;
  const s = d.summary;

  if (elements.dashEmpName) elements.dashEmpName.textContent = emp.name;
  if (elements.dashEmpRole) elements.dashEmpRole.textContent = emp.role === "admin" ? "Amministratore & Tutor d'aula" : "Tutor d'aula";
  if (elements.badgeStdDay) elements.badgeStdDay.textContent = `Giornata standard: ${emp.standard_day_hours}h`;
  if (elements.badgeShortDay) elements.badgeShortDay.textContent = `Giornata breve: ${emp.short_day_hours}h`;
  if (elements.badgePtWeek) elements.badgePtWeek.textContent = `Part-time: ${emp.part_time_week_hours}h/sett`;

  if (elements.kpiAccreditate) elements.kpiAccreditate.textContent = formatHours(s.totale_ore_accreditate);
  if (elements.kpiMaturate) elements.kpiMaturate.textContent = `+${formatHours(s.totale_ore_maturate)}`;
  if (elements.kpiUtilizzate) elements.kpiUtilizzate.textContent = `-${formatHours(s.totale_ore_utilizzate)}`;
  if (elements.kpiRimanenti) elements.kpiRimanenti.textContent = formatHours(s.ore_rimanenti);

  if (elements.kpiStatusBadge) {
    if (s.ore_rimanenti > 0) {
      elements.kpiStatusBadge.textContent = "✓ In Attivo (Ore disponibili)";
      elements.kpiStatusBadge.className = "kpi-status-badge badge-green";
    } else if (s.ore_rimanenti === 0) {
      elements.kpiStatusBadge.textContent = "• Pareggio (0 ore)";
      elements.kpiStatusBadge.className = "kpi-status-badge badge-info";
    } else {
      elements.kpiStatusBadge.textContent = "⚠️ In Debito Ore";
      elements.kpiStatusBadge.className = "kpi-status-badge badge-yellow";
    }
  }

  if (elements.convFerie7h) elements.convFerie7h.textContent = `${s.ferie_7h.toFixed(2)} gg`;
  if (elements.convFerie4h) elements.convFerie4h.textContent = `${s.ferie_4h.toFixed(2)} gg`;
  if (elements.convSett18h) elements.convSett18h.textContent = `${s.settimane_18h.toFixed(2)} sett.`;

  // Monthly Table
  if (elements.tbodyMonthlySummary) {
    elements.tbodyMonthlySummary.innerHTML = "";
    let totUtil = 0, totMat = 0, totSaldo = 0;

    d.monthly_stats.forEach(m => {
      totUtil += m.ore_utilizzate;
      totMat += m.ore_maturate;
      totSaldo += m.saldo_mese;

      const tr = document.createElement("tr");
      let statusBadge = m.status === "Consolidato" ? "badge-info" : (m.status === "In corso" ? "badge-green" : "badge-gray");

      tr.innerHTML = `
        <td class="font-bold">${m.month_year}</td>
        <td class="text-right ${m.ore_utilizzate > 0 ? 'cell-utilizzata' : ''}">${formatHours(m.ore_utilizzate)}</td>
        <td class="text-right ${m.ore_maturate > 0 ? 'cell-maturata' : ''}">${formatHours(m.ore_maturate)}</td>
        <td class="text-right font-bold">${m.saldo_mese > 0 ? '+' : ''}${formatHours(m.saldo_mese)}</td>
        <td class="text-right font-bold">${formatHours(m.ore_rimaste_progressive)}</td>
        <td class="text-center"><span class="badge ${statusBadge}">${m.status}</span></td>
        <td class="text-center">
          <button class="btn btn-outline btn-sm" onclick="window.filterByMonthAndSwitch('${m.month_year}')">
            ${m.entries_count} gg
          </button>
        </td>
      `;
      elements.tbodyMonthlySummary.appendChild(tr);
    });

    if (elements.totSummaryUtilizzate) elements.totSummaryUtilizzate.textContent = formatHours(totUtil);
    if (elements.totSummaryMaturate) elements.totSummaryMaturate.textContent = formatHours(totMat);
    if (elements.totSummarySaldo) elements.totSummarySaldo.textContent = `${totSaldo > 0 ? '+' : ''}${formatHours(totSaldo)}`;
    if (elements.totSummaryRimanenti) elements.totSummaryRimanenti.textContent = formatHours(s.ore_rimanenti);
  }

  updateDonutChart();
}

export function updateDonutChart() {
  const ctx = document.getElementById("donutChart");
  if (!ctx || !window.Chart) return;

  const s = state.dashboardData ? state.dashboardData.summary : { totale_ore_utilizzate: 0, ore_rimanenti: 0 };
  const utilized = Math.max(0, s.totale_ore_utilizzate || 0);
  const remaining = Math.max(0, s.ore_rimanenti || 0);
  const totalHours = utilized + remaining;

  if (state.chartInstance) {
    state.chartInstance.destroy();
  }

  const isDark = state.theme === "dark";

  if (totalHours <= 0) {
    // Elegant neutral placeholder ring when no hours are registered yet
    state.chartInstance = new window.Chart(ctx, {
      type: "doughnut",
      data: {
        labels: ["Nessuna ora registrata nel periodo"],
        datasets: [{
          data: [1],
          backgroundColor: [isDark ? "#334155" : "#E2E8F0"],
          borderWidth: 1,
          borderColor: isDark ? "#1E293B" : "#CBD5E1"
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: {
              color: isDark ? "#94A3B8" : "#64748B",
              font: { family: "-apple-system, sans-serif", size: 12, weight: "600" },
              padding: 16
            }
          },
          tooltip: {
            enabled: false
          }
        },
        cutout: "68%"
      }
    });
    return;
  }

  state.chartInstance = new window.Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Ore Utilizzate (Debito)", "Ore Rimaste (Credito)"],
      datasets: [{
        data: [utilized, remaining],
        backgroundColor: ["#EAB308", "#16A34A"],
        hoverBackgroundColor: ["#CA8A04", "#15803D"],
        borderWidth: 2,
        borderColor: isDark ? "#1E293B" : "#FFFFFF"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: isDark ? "#F8FAFC" : "#1E293B",
            font: { family: "-apple-system, sans-serif", size: 12, weight: "bold" },
            padding: 16
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const val = context.parsed;
              const pct = totalHours > 0 ? ((val / totalHours) * 100).toFixed(1) : 0;
              return ` ${context.label}: ${val.toFixed(1)} h (${pct}%)`;
            }
          }
        }
      },
      cutout: "68%"
    }
  });
}

export function renderCalendarGrid() {
  const d = state.dashboardData;
  if (!d || !elements.calendarMonthGrid) return;

  elements.calendarMonthGrid.innerHTML = "";
  const selectedMonth = elements.calMonthFilter ? elements.calMonthFilter.value : "ALL";

  const monthsToRender = d.monthly_stats.filter(m => {
    return selectedMonth === "ALL" || m.month_year === selectedMonth;
  });

  monthsToRender.forEach(m => {
    const card = document.createElement("div");
    card.className = "month-block";

    let netHours = m.ore_maturate - m.ore_utilizzate;
    let netBadgeClass = netHours >= 0 ? "badge-green" : "badge-yellow";

    let rowsHtml = "";
    if (m.entries && m.entries.length > 0) {
      m.entries.forEach(e => {
        let rowClass = "cell-ordinario";
        let tipoLabel = "Ordinaria";
        if (e.type === "utilizzata") {
          rowClass = "cell-utilizzata";
          tipoLabel = "Utilizzata";
        } else if (e.type === "maturata") {
          rowClass = "cell-maturata";
          tipoLabel = "Maturata";
        } else if (e.type === "presenza_corso" || e.course_id) {
          rowClass = "cell-corso";
          tipoLabel = "Corso";
        }

        rowsHtml += `
          <tr class="${rowClass}">
            <td class="text-center font-bold">${formatDisplayDate(e.date)}</td>
            <td class="text-right font-bold">${formatHours(e.hours)}</td>
            <td class="text-center"><span class="badge-mini badge-${tipoLabel.toLowerCase()}">${tipoLabel}</span></td>
            <td class="text-center" style="width: 45px;">
              <button class="btn-icon" title="Modifica" onclick="window.editEntryById(${e.id})">✏️</button>
            </td>
          </tr>
        `;
      });
    } else {
      rowsHtml = `
        <tr>
          <td colspan="4" class="text-center text-muted" style="padding: 1.5rem 0.5rem;">
            Nessun movimento
          </td>
        </tr>
      `;
    }

    card.innerHTML = `
      <div class="month-block-header">
        <h4 class="month-block-title">${m.month_year}</h4>
        <span class="badge ${netBadgeClass}">${netHours > 0 ? '+' : ''}${formatHours(netHours)}</span>
      </div>
      <div class="month-block-table-wrapper">
        <table class="month-block-table">
          <thead>
            <tr>
              <th class="text-center">Data</th>
              <th class="text-right">Ore</th>
              <th class="text-center">Tipo</th>
              <th class="text-center">Azioni</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
      <div class="month-block-footer">
        <div>Progressivo: <strong>${formatHours(m.ore_rimaste_progressive)}</strong></div>
        <button class="btn btn-outline btn-sm" onclick="window.openEntryModalForMonth('${m.month_year}')">+ Aggiungi</button>
      </div>
    `;

    elements.calendarMonthGrid.appendChild(card);
  });
}

