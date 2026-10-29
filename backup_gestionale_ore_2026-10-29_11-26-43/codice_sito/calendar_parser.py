"""
Modulo di parsing per i calendari dei corsi (Excel .xlsx / .xls e Google Sheets .csv / .xlsx).
Estrae automaticamente:
- Denominazione Corso e Codice/Edizione (es. ASSISTENTE FAMILIARE CS 108 ED 280)
- Unità Formative (Moduli, Ore, Docenti, CF, Fascia)
- Monte ore Aula e Stage
- Dettaglio calendario sessione per sessione (Data, Orario, Modulo, Ore, Docente, Fase Aula/Stage)
- Range temporale (Data inizio, fine prevista, periodo aula, periodo stage)
"""

import os
import re
import csv
import io
from datetime import datetime, date
import openpyxl


def parse_time_slot(slot_str):
    """
    Estrae ora inizio e ora fine da stringhe come:
    '08:00 - 14:00', '08:00-14:00', '8:00 - 13:30', '8 - 14'
    """
    if not slot_str:
        return "08:00", "14:00"
    
    slot_clean = str(slot_str).replace("–", "-").replace("—", "-").strip()
    if "-" in slot_clean:
        parts = slot_clean.split("-")
        s_raw, e_raw = parts[0].strip(), parts[1].strip()

        def normalize_t(t):
            t = t.strip()
            if ":" in t:
                pieces = t.split(":")
                try:
                    return f"{int(pieces[0]):02d}:{int(pieces[1]):02d}"
                except ValueError:
                    return t
            elif t.isdigit():
                try:
                    return f"{int(t):02d}:00"
                except ValueError:
                    return t
            return t

        return normalize_t(s_raw), normalize_t(e_raw)
    
    return "08:00", "14:00"


def parse_date_value(val):
    """
    Converte datetime, date o stringa in formato ISO 'YYYY-MM-DD'.
    Supporta: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, YYYY/MM/DD
    """
    if isinstance(val, (datetime, date)):
        return val.strftime("%Y-%m-%d")
    if not val:
        return None
    val_str = str(val).strip()
    if not val_str:
        return None
        
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(val_str[:10], fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def split_course_title(raw_title):
    """
    Separa il nome del corso dal codice / edizione.
    Es. 'ASSISTENTE FAMILIARE CS 108 ED 280'
    -> Name: 'ASSISTENTE FAMILIARE', Code: 'CS 108 ED 280'
    """
    if not raw_title:
        return "Nuovo Corso", ""
    title = str(raw_title).strip()

    # Pattern per riconoscere prefissi come CS, ED, CODICE, EDIZIONE, etc.
    m = re.search(r'\b(CS\s*\d+.*|ED\s*\d+.*|COD\b.*|EDIZ\b.*)$', title, re.IGNORECASE)
    if m:
        c_name = title[:m.start()].strip()
        c_code = title[m.start():].strip()
        if c_name:
            return c_name, c_code
    
    # Se il titolo contiene trattino o slash (es. 'OSS - CS 12')
    if " - " in title:
        parts = title.split(" - ", 1)
        return parts[0].strip(), parts[1].strip()

    return title, ""


def _parse_float_safe(val, default=0.0):
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    val_str = str(val).strip().replace(",", ".")
    try:
        return float(val_str)
    except ValueError:
        return default


def read_file_rows(file_path_or_bytes, filename=""):
    """
    Legge tutte le righe dal file come lista di liste di valori.
    Supporta .xlsx, .xls, .csv e gestisce file multi-foglio individuando il foglio calendario migliore.
    Restituisce (rows, sheet_title).
    """
    if not filename and isinstance(file_path_or_bytes, str):
        filename = os.path.basename(file_path_or_bytes)
    ext = os.path.splitext(filename)[1].lower() if filename else ""

    # Se è un file CSV o testo
    if ext in (".csv", ".txt", ".tsv") or (isinstance(file_path_or_bytes, (str, bytes)) and ext not in (".xlsx", ".xls")):
        if isinstance(file_path_or_bytes, bytes):
            content_str = file_path_or_bytes.decode("utf-8-sig", errors="replace")
        elif isinstance(file_path_or_bytes, str) and os.path.exists(file_path_or_bytes):
            with open(file_path_or_bytes, "r", encoding="utf-8-sig", errors="replace") as f:
                content_str = f.read()
        else:
            content_str = str(file_path_or_bytes)

        lines = content_str.strip().splitlines()
        first_few = "\n".join(lines[:10])
        delimiter = ";" if first_few.count(";") > first_few.count(",") else (
            "\t" if first_few.count("\t") > first_few.count(",") else ","
        )
        reader = csv.reader(io.StringIO(content_str), delimiter=delimiter)
        return [row for row in reader], ""

    # Se è un file Excel .xlsx
    try:
        if isinstance(file_path_or_bytes, bytes):
            wb = openpyxl.load_workbook(io.BytesIO(file_path_or_bytes), data_only=True)
        else:
            wb = openpyxl.load_workbook(file_path_or_bytes, data_only=True)
    except Exception as e:
        if ext == ".xls":
            raise ValueError("I file in formato Excel 97-2003 (.xls) non sono supportati. Salva il file in formato moderno .xlsx o .csv.")
        raise ValueError(f"Impossibile leggere il file Excel: {e}")

    # Individuazione del foglio migliore (in caso di cartelle con fogli multipli o copertine)
    best_sheet = wb.active
    for s_name in wb.sheetnames:
        s = wb[s_name]
        found_kw = False
        for r in range(1, min(15, (s.max_row or 0) + 1)):
            row_str = " ".join(str(s.cell(r, c).value or "") for c in range(1, min(15, (s.max_column or 0) + 1))).upper()
            if "DATA" in row_str and ("GIORNO" in row_str or "ORARIO" in row_str or "DOCENTE" in row_str or "MODULO" in row_str):
                best_sheet = s
                found_kw = True
                break
        if found_kw and len(wb.sheetnames) > 1:
            break

    ws = best_sheet
    rows = []
    for r in range(1, (ws.max_row or 0) + 1):
        row_vals = [ws.cell(r, c).value for c in range(1, (ws.max_column or 0) + 1)]
        rows.append(row_vals)
    return rows, ws.title


def parse_calendar_file(file_path_or_bytes, filename=""):
    """
    Esegue il parsing completo del file calendario.
    Restituisce un dizionario con tutti i dati estratti per l'anteprima e la creazione nel DB.
    """
    res_rows = read_file_rows(file_path_or_bytes, filename)
    if isinstance(res_rows, tuple):
        rows, sheet_title = res_rows
    else:
        rows, sheet_title = res_rows, ""

    if not rows:
        return {
            "status": "error",
            "message": "Il file caricato è vuoto o non contiene dati leggibili."
        }

    # 1. Riconoscimento Titolo e Codice Corso (riga 1 o nome del foglio/file)
    raw_title = ""
    for c in range(min(5, len(rows[0]))):
        val = rows[0][c]
        if val and str(val).strip():
            raw_title = str(val).strip()
            break

    # Se la riga 1 è l'intestazione stessa della tabella (es. DATA, GIORNO, MODULO...), usa il titolo del foglio o il nome del file
    header_keywords = {"DATA", "GIORNO", "ORARIO", "MODULO", "ORE", "DOCENTE", "N°", "N."}
    row0_words = {str(c or "").strip().upper() for c in rows[0]}
    if len(row0_words.intersection(header_keywords)) >= 2 or raw_title.upper() in header_keywords:
        if sheet_title and not sheet_title.lower().startswith("sheet") and not sheet_title.lower().startswith("foglio"):
            raw_title = sheet_title
        elif filename:
            raw_title = os.path.splitext(os.path.basename(filename))[0]

    course_name, course_code = split_course_title(raw_title)

    # 2. Estrazione Unità Formative (Moduli, Ore, Docenti)
    modules = []
    modules_header_found = False
    cal_header_row_idx = None

    for r_idx, row in enumerate(rows):
        if not row:
            continue
        col_0 = str(row[0] or "").strip().upper()
        col_1 = str(row[1] if len(row) > 1 else "" or "").strip().upper()
        col_2 = str(row[2] if len(row) > 2 else "" or "").strip().upper()

        if "UNITA'" in col_0 or "UNITA" in col_0 or "MODULO" in col_0:
            modules_header_found = True
            continue

        if ("DATA" in col_1 or "DATA" in col_0) and ("GIORNO" in col_2 or "ORARIO" in col_2 or "GIORNO" in col_1):
            cal_header_row_idx = r_idx
            break

        if modules_header_found:
            mod_name = str(row[0] or "").strip()
            if not mod_name or mod_name.lower() in ("stage", "totale", "cronogramma"):
                continue
            ore_val = _parse_float_safe(row[1] if len(row) > 1 else None, 0.0)
            doc_name = str(row[4] if len(row) > 4 else "").strip() if len(row) > 4 and row[4] else ""
            cf = str(row[5] if len(row) > 5 else "").strip() if len(row) > 5 and row[5] else ""
            fascia = str(row[6] if len(row) > 6 else "").strip() if len(row) > 6 and row[6] else ""
            
            if ore_val > 0 or doc_name:
                modules.append({
                    "modulo": mod_name,
                    "ore": ore_val,
                    "docente": doc_name,
                    "cf": cf,
                    "fascia": fascia
                })

    if cal_header_row_idx is None:
        # Fallback: cerca qualsiasi riga con 'N°' e 'DATA'
        for r_idx, row in enumerate(rows):
            row_str = " ".join(str(c or "") for c in row).upper()
            if "DATA" in row_str and ("ORARIO" in row_str or "GIORNO" in row_str):
                cal_header_row_idx = r_idx
                break

    if cal_header_row_idx is None:
        return {
            "status": "error",
            "message": "Intestazione del calendario non trovata. Assicurati che il file contenga le colonne: N°, DATA, GIORNO, ORARIO, MODULO, ORE, DOCENTE."
        }

    # 3. Estrazione Sessioni del Calendario con rilevamento dinamico delle colonne
    header_row = [str(c or "").strip().upper() for c in rows[cal_header_row_idx]]
    col_map = {
        "date": 1,
        "day": 2,
        "slot": 3,
        "module": 4,
        "hours": 5,
        "docente": 6
    }
    for idx, col_text in enumerate(header_row):
        if "DATA" in col_text:
            col_map["date"] = idx
        elif "GIORNO" in col_text:
            col_map["day"] = idx
        elif "ORARIO" in col_text or "FASCIA" in col_text:
            col_map["slot"] = idx
        elif "MODULO" in col_text or "UNITA" in col_text or "MATERIA" in col_text:
            col_map["module"] = idx
        elif "ORE" in col_text:
            col_map["hours"] = idx
        elif "DOCENTE" in col_text or "INSEGNANTE" in col_text:
            col_map["docente"] = idx

    sessions = []
    docenti_set = set()

    for r_idx in range(cal_header_row_idx + 1, len(rows)):
        row = rows[r_idx]
        if not row or len(row) < 3:
            continue

        d_idx = col_map["date"]
        raw_date = row[d_idx] if len(row) > d_idx else None
        day_idx = col_map["day"]
        day_name = str(row[day_idx] or "").strip() if len(row) > day_idx else ""
        s_idx = col_map["slot"]
        raw_slot = row[s_idx] if len(row) > s_idx else ""
        m_idx = col_map["module"]
        raw_module = row[m_idx] if len(row) > m_idx else None
        h_idx = col_map["hours"]
        raw_hours = row[h_idx] if len(row) > h_idx else None
        doc_idx = col_map["docente"]
        raw_docente = row[doc_idx] if len(row) > doc_idx else ""

        parsed_date = parse_date_value(raw_date)
        if not parsed_date:
            continue

        mod_str = str(raw_module or "").strip()
        if not mod_str:
            # Giorno senza lezione (es. sabato/domenica vuoti)
            continue

        is_stage = mod_str.upper() == "STAGE"
        start_t, end_t = parse_time_slot(raw_slot)
        hours_val = _parse_float_safe(raw_hours, 0.0)
        docente_str = "" if is_stage else (str(raw_docente or "").strip())

        if docente_str:
            docenti_set.add(docente_str)

        sessions.append({
            "date": parsed_date,
            "day_of_week": day_name,
            "time_slot": str(raw_slot or "").strip(),
            "start_time": start_t,
            "end_time": end_t,
            "phase": "stage" if is_stage else "aula",
            "modulo": mod_str,
            "hours": hours_val,
            "docente": docente_str
        })

    if not sessions:
        return {
            "status": "error",
            "message": "Nessuna sessione di lezione rilevata nella tabella del calendario."
        }

    # Calcolo totali e range date
    aula_sessions = [s for s in sessions if s["phase"] == "aula"]
    stage_sessions = [s for s in sessions if s["phase"] == "stage"]

    total_aula_hours = sum(s["hours"] for s in aula_sessions)
    total_stage_hours = sum(s["hours"] for s in stage_sessions)
    total_hours = total_aula_hours + total_stage_hours

    all_dates = sorted([s["date"] for s in sessions])
    start_date = all_dates[0] if all_dates else None
    expected_end_date = all_dates[-1] if all_dates else None

    aula_dates = sorted([s["date"] for s in aula_sessions]) if aula_sessions else []
    stage_dates = sorted([s["date"] for s in stage_sessions]) if stage_sessions else []

    aula_start = aula_dates[0] if aula_dates else None
    aula_end = aula_dates[-1] if aula_dates else None
    stage_start = stage_dates[0] if stage_dates else None
    stage_end = stage_dates[-1] if stage_dates else None

    # Aggrega docenti anche dai moduli per sicurezza
    for m in modules:
        if m.get("docente"):
            docenti_set.add(m["docente"])

    docenti_list = sorted(list(docenti_set))

    # Identify the last session of each module for the final test
    last_sess_by_mod = {}
    for s in sessions:
        if s.get("phase") == "aula" and s.get("modulo"):
            key = s["modulo"].strip().upper()
            last_sess_by_mod[key] = s

    for s in sessions:
        if s.get("phase") == "aula" and s.get("modulo"):
            key = s["modulo"].strip().upper()
            if last_sess_by_mod.get(key) is s:
                s["is_module_test"] = True
                s["module_test_label"] = f"Test di verifica: {s['modulo']}"
            else:
                s["is_module_test"] = False
                s["module_test_label"] = ""

    return {
        "status": "ok",
        "course_name": course_name,
        "course_code": course_code,
        "raw_title": raw_title,
        "total_hours": round(total_hours, 1),
        "total_aula_hours": round(total_aula_hours, 1),
        "total_stage_hours": round(total_stage_hours, 1),
        "aula_sessions_count": len(aula_sessions),
        "stage_sessions_count": len(stage_sessions),
        "total_sessions_count": len(sessions),
        "start_date": start_date,
        "expected_end_date": expected_end_date,
        "aula_start_date": aula_start,
        "aula_end_date": aula_end,
        "stage_start_date": stage_start,
        "stage_end_date": stage_end,
        "docenti_list": docenti_list,
        "modules": modules,
        "sessions": sessions
    }

# ==============================================================================
# ATTENDANCE / TIMESHEET PARSER WITH COURSE CALENDAR RECONCILIATION
# ==============================================================================

try:
    import xlrd
except ImportError:
    xlrd = None

IT_MONTHS = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4, "maggio": 5, "giugno": 6,
    "luglio": 7, "agosto": 8, "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
    "gen": 1, "feb": 2, "mar": 3, "apr": 4, "mag": 5, "giu": 6,
    "lug": 7, "ago": 8, "set": 9, "ott": 10, "nov": 11, "dic": 12
}

def _parse_it_date_flexible(val, context_year=None):
    """Parses Italian date strings or objects into YYYY-MM-DD."""
    if not val:
        return None
    if isinstance(val, (datetime, date)):
        return val.strftime("%Y-%m-%d")
    
    val_str = str(val).strip()
    if not val_str:
        return None

    # Standard formats
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(val_str[:10], fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass

    # Excel float serial
    try:
        fval = float(val_str)
        if 35000 < fval < 65000:  # Valid Excel date range (1995-2078)
            if xlrd:
                dt = xlrd.xldate_as_datetime(fval, 0)
                return dt.strftime("%Y-%m-%d")
            else:
                base = datetime(1899, 12, 30)
                dt = base + timedelta(days=fval)
                return dt.strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        pass

    # Italian text formats: e.g. "3 Giugno 2026" or "14 maggio"
    m = re.search(r'(\d{1,2})\s+([a-zA-Zàèéìòù]+)(?:\s+(\d{4}))?', val_str)
    if m:
        day = int(m.group(1))
        m_name = m.group(2).lower()
        year = int(m.group(3)) if m.group(3) else (context_year or datetime.now().year)
        if m_name in IT_MONTHS and 1 <= day <= 31:
            month = IT_MONTHS[m_name]
            try:
                return f"{year:04d}-{month:02d}-{day:02d}"
            except Exception:
                pass

    return None


def parse_attendance_document(file_content, filename, course_sessions=None):
    """
    Parses a timesheet/attendance spreadsheet (Excel .xlsx, .xls or .csv)
    and reconciles every date against the official course calendar sessions.
    
    Returns structured analysis with matched, warning and mismatch rows,
    ready for interactive tutor review.
    """
    course_sessions = course_sessions or []
    sessions_by_date = {}
    for s in course_sessions:
        # Group by date (keep first or all)
        sessions_by_date.setdefault(s["date"], []).append(s)

    fn_lower = filename.lower()
    raw_rows = []

    # 1. READ RAW ROWS ACCORDING TO FORMAT
    if fn_lower.endswith(".xlsx"):
        wb = openpyxl.load_workbook(io.BytesIO(file_content), data_only=True)
        for sheetname in wb.sheetnames:
            ws = wb[sheetname]
            for r in range(1, ws.max_row + 1):
                row_vals = [ws.cell(r, c).value for c in range(1, ws.max_column + 1)]
                if any(v is not None and str(v).strip() != "" for v in row_vals):
                    raw_rows.append(row_vals)
    elif fn_lower.endswith(".xls") and xlrd:
        wb = xlrd.open_workbook(file_contents=file_content)
        for sheetname in wb.sheet_names():
            ws = wb.sheet_by_name(sheetname)
            for r in range(ws.nrows):
                row_vals = [ws.cell_value(r, c) for c in range(ws.ncols)]
                if any(v is not None and str(v).strip() != "" for v in row_vals):
                    raw_rows.append(row_vals)
    else:  # CSV or text fallback
        text_content = file_content.decode("utf-8", errors="replace")
        dialect = csv.Sniffer().sniff(text_content[:2048]) if len(text_content) > 50 else csv.excel
        reader = csv.reader(io.StringIO(text_content), dialect)
        for r in reader:
            if any(str(c).strip() for c in r):
                raw_rows.append(r)

    extracted_entries = []

    # 2. CHECK FOR ALLEGATO 14 (TIMESHEET MATRIX: DAYS 1..31 IN COLUMNS)
    is_matrix_format = False
    context_year = None
    context_month = None

    for r_idx, row in enumerate(raw_rows):
        row_str = " ".join(str(c).lower() for c in row if c is not None)
        # Look for month/year metadata: e.g. "Timesheet di (mese e anno)"
        if "timesheet di" in row_str or "mese e anno" in row_str or "periodo di" in row_str:
            for cell in row:
                d = _parse_it_date_flexible(cell)
                if d:
                    context_year = int(d.split("-")[0])
                    context_month = int(d.split("-")[1])
                    break
        
        # Look for sequential day headers: 1, 2, 3 ... 20
        num_day_cols = 0
        day_col_map = {}
        for c_idx, cell in enumerate(row):
            try:
                val_int = int(float(str(cell).strip()))
                if 1 <= val_int <= 31:
                    day_col_map[c_idx] = val_int
                    num_day_cols += 1
            except (ValueError, TypeError):
                pass
        
        # If this row has at least 15 day numbers, it is a monthly timesheet grid!
        if num_day_cols >= 15 and (context_year or len(course_sessions) > 0):
            is_matrix_format = True
            if not context_year:
                # Infer year/month from course sessions
                sample_date = course_sessions[0]["date"] if course_sessions else "2026-06-01"
                context_year = int(sample_date.split("-")[0])
                context_month = int(sample_date.split("-")[1])

            # Now read subsequent rows for hours
            for sub_r in range(r_idx + 1, min(r_idx + 6, len(raw_rows))):
                sub_row = raw_rows[sub_r]
                sub_str = " ".join(str(c) for c in sub_row if c is not None).lower()
                if "totale" in sub_str and not any(str(k) in sub_str for k in ("tutor", "aula", "attività")):
                    continue
                
                for c_idx, day_num in day_col_map.items():
                    if c_idx < len(sub_row):
                        cell_val = sub_row[c_idx]
                        hrs = _parse_float_safe(cell_val, 0.0)
                        # Guardrail: single-day hours must be between 0.5 and 12.0
                        if 0.5 <= hrs <= 12.0:
                            try:
                                entry_date = f"{context_year:04d}-{context_month:02d}-{day_num:02d}"
                                extracted_entries.append({
                                    "date": entry_date,
                                    "hours": hrs,
                                    "start_time": "14:00" if hrs >= 5 else "09:00",
                                    "end_time": "20:00" if hrs >= 5 else f"{9+int(hrs):02d}:00",
                                    "modulo": "Tutoraggio d'aula",
                                    "docente": ""
                                })
                            except Exception:
                                pass
            break

    # 3. IF NOT MATRIX, USE COLUMNAR TABLE PARSING
    if not is_matrix_format:
        date_col = -1
        hours_col = -1
        start_col = -1
        end_col = -1
        mod_col = -1
        doc_col = -1
        header_row_idx = -1

        for r_idx, row in enumerate(raw_rows[:15]):
            # Priorita 1: ricerca colonne specifiche per la presenza giornaliera
            for c_idx, cell in enumerate(row):
                val = str(cell).lower().strip()
                if val in ("data", "date", "giorno", "giornata") and date_col == -1:
                    date_col = c_idx
                elif val in ("ore lezione", "ore presenza", "ore svolte", "ore effettive", "ore giorno", "ore ordinarie") and hours_col == -1:
                    hours_col = c_idx
                elif "inizio" in val or "orario inizio" in val or "dalle" in val:
                    start_col = c_idx
                elif "fine" in val or "orario fine" in val or "alle" in val:
                    end_col = c_idx
                elif "modulo" in val or "unita formativa" in val or "attività" in val or "materia" in val:
                    mod_col = c_idx
                elif "docente" in val or "tutor" in val or "formatore" in val:
                    doc_col = c_idx

            # Priorita 2: solo se non trovata, cerca intestazioni generiche ma ESCLUDE rigorosamente colonne cumulative
            if hours_col == -1:
                for c_idx, cell in enumerate(row):
                    val = str(cell).lower().strip()
                    if val in ("totale ore", "monte ore", "ore totali", "totale", "saldo"):
                        continue
                    if val in ("ore", "h", "durata"):
                        hours_col = c_idx
                        break

            if date_col != -1 and (hours_col != -1 or (start_col != -1 and end_col != -1)):
                header_row_idx = r_idx
                break

        # If header found, parse following rows
        if header_row_idx != -1:
            for r_idx in range(header_row_idx + 1, len(raw_rows)):
                row = raw_rows[r_idx]
                if date_col >= len(row):
                    continue
                d_val = row[date_col]
                d_iso = _parse_it_date_flexible(d_val)
                if not d_iso:
                    continue

                hrs = 0.0
                raw_cell_val = None
                if hours_col != -1 and hours_col < len(row):
                    raw_cell_val = row[hours_col]
                    hrs = _parse_float_safe(raw_cell_val, 0.0)

                s_time = ""
                e_time = ""
                if start_col != -1 and start_col < len(row):
                    s_raw = str(row[start_col] or "").strip()
                    if s_raw:
                        s_time, _ = parse_time_slot(s_raw)
                if end_col != -1 and end_col < len(row):
                    e_raw = str(row[end_col] or "").strip()
                    if e_raw:
                        _, e_time = parse_time_slot(e_raw)

                # Calcola durata esatta da inizio e fine se presenti
                calc_h = None
                if s_time and e_time and s_time != e_time:
                    try:
                        sh, sm = [int(p) for p in s_time.split(":")[:2]]
                        eh, em = [int(p) for p in e_time.split(":")[:2]]
                        diff_h = round((eh*60+em - (sh*60+sm)) / 60.0, 2)
                        if 0 < diff_h <= 12.0:
                            calc_h = diff_h
                    except Exception:
                        pass

                # Rilevamento valori orari anomali (> 12h indicano monte ore cumulativo o totali di modulo)
                is_anomalous = False
                if hrs > 12.0:
                    if calc_h is not None:
                        hrs = calc_h
                    else:
                        is_anomalous = True
                elif hrs == 0.0 and calc_h is not None:
                    hrs = calc_h

                mod_val = str(row[mod_col] or "").strip() if mod_col != -1 and mod_col < len(row) else "Tutoraggio d'aula"
                doc_val = str(row[doc_col] or "").strip() if doc_col != -1 and doc_col < len(row) else ""

                extracted_entries.append({
                    "date": d_iso,
                    "hours": hrs,
                    "start_time": s_time,
                    "end_time": e_time,
                    "modulo": mod_val,
                    "docente": doc_val,
                    "is_anomalous": is_anomalous
                })
        else:
            # 4. FREE-FORM FALLBACK SCANNER
            for row in raw_rows:
                found_date = None
                found_hrs = 0.0
                text_parts = []
                for cell in row:
                    if cell is None:
                        continue
                    d = _parse_it_date_flexible(cell)
                    if d and not found_date:
                        found_date = d
                        continue
                    # Check hours
                    num = _parse_float_safe(cell, -1)
                    if 0.5 <= num <= 12.0 and found_hrs == 0.0:
                        found_hrs = num
                    elif str(cell).strip():
                        text_parts.append(str(cell).strip())

                if found_date:
                    extracted_entries.append({
                        "date": found_date,
                        "hours": found_hrs if found_hrs > 0 else 6.0,
                        "start_time": "14:00" if found_hrs >= 5 else "09:00",
                        "end_time": "20:00" if found_hrs >= 5 else "13:00",
                        "modulo": " - ".join(text_parts[:2]) if text_parts else "Tutoraggio d'aula",
                        "docente": ""
                    })

    # 4. RECONCILIATION AGAINST COURSE CALENDAR SESSIONS
    reconciled_entries = []
    seen_dates = set()
    used_session_ids = set()

    for idx, e in enumerate(extracted_entries, start=1):
        edate = e["date"]
        try:
            dt = datetime.strptime(edate, "%Y-%m-%d")
            display_date = dt.strftime("%d/%m/%Y")
            dow_list = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"]
            day_of_week = dow_list[dt.weekday()]
        except Exception:
            display_date = edate
            day_of_week = ""

        is_duplicate = edate in seen_dates
        seen_dates.add(edate)

        # Associazione con sessione ufficiale: priorita a sessioni non ancora utilizzate su quella data
        matching_sessions = sessions_by_date.get(edate, [])
        msess = None
        for s in matching_sessions:
            if s["id"] not in used_session_ids:
                msess = s
                break
        if not msess and matching_sessions:
            msess = matching_sessions[0]
        if msess:
            used_session_ids.add(msess["id"])

        if msess:
            expected_hrs = float(msess.get("hours", 0.0))
            hrs = float(e.get("hours", 0.0))
            is_anomalous = e.get("is_anomalous", False) or (hrs > 12.0)

            if hrs == 0.0 and not is_anomalous:
                hrs = expected_hrs

            has_hours_diff = abs(hrs - expected_hrs) > 0.01

            s_time = e.get("start_time") or msess.get("start_time", "09:00")
            e_time = e.get("end_time") or msess.get("end_time", "13:00")

            if is_anomalous:
                status = "error_hours"
                selected = False
                badge = "❌ Ore anomale"
                detail = f"Valore letto ({hrs:.1f}h) supera il limite di 12h (probabile monte ore o totale modulo). Deselezionato automaticamente per sicurezza: verifica prima di confermare."
            elif has_hours_diff:
                status = "warning_hours"
                selected = True
                badge = "⚠️ Ore difformi"
                detail = f"Calendario prevede {expected_hrs}h ({msess.get('modulo', '')})"
            else:
                status = "match"
                selected = True
                badge = "✅ Corrisponde"
                detail = f"Lezione confermata: {msess.get('modulo', '')} con {msess.get('docente', '')}"

            reconciled_entries.append({
                "row_id": idx,
                "selected": selected,
                "date": edate,
                "display_date": display_date,
                "day_of_week": day_of_week,
                "hours": hrs,
                "expected_hours": expected_hrs,
                "start_time": s_time,
                "end_time": e_time,
                "modulo": msess.get("modulo") or e.get("modulo", "Tutoraggio d'aula"),
                "docente": msess.get("docente") or e.get("docente", ""),
                "status": status,
                "matched_session_id": msess["id"],
                "status_badge": badge,
                "status_detail": detail,
                "is_duplicate": is_duplicate
            })
        else:
            # MISMATCH: Data non presente nelle lezioni ufficiali del corso
            hrs = float(e.get("hours", 0.0))
            is_anomalous = e.get("is_anomalous", False) or (hrs > 12.0)
            if hrs == 0.0 and not is_anomalous:
                hrs = 4.0

            if is_anomalous:
                status = "error_hours"
                selected = False
                badge = "❌ Ore anomale"
                detail = f"Valore letto ({hrs:.1f}h) anomalo (> 12h) e data non in calendario."
            else:
                status = "mismatch"
                selected = False
                badge = "❌ Non nel corso"
                detail = f"Nessuna lezione in calendario il {display_date}. Correggi la data o associa a una sessione ufficiale."

            reconciled_entries.append({
                "row_id": idx,
                "selected": selected,
                "date": edate,
                "display_date": display_date,
                "day_of_week": day_of_week,
                "hours": hrs,
                "expected_hours": None,
                "start_time": e.get("start_time") or "09:00",
                "end_time": e.get("end_time") or "13:00",
                "modulo": e.get("modulo", "Tutoraggio non in calendario"),
                "docente": e.get("docente", ""),
                "status": status,
                "matched_session_id": None,
                "status_badge": badge,
                "status_detail": detail,
                "is_duplicate": is_duplicate
            })

    total_entries = len(reconciled_entries)
    matches_count = sum(1 for e in reconciled_entries if e["status"] == "match")
    warnings_count = sum(1 for e in reconciled_entries if e["status"] == "warning_hours")
    mismatches_count = sum(1 for e in reconciled_entries if e["status"] == "mismatch")
    total_hours = sum(e["hours"] for e in reconciled_entries)

    return {
        "status": "ok",
        "filename": filename,
        "total_entries": total_entries,
        "total_hours": round(total_hours, 1),
        "matches_count": matches_count,
        "warnings_count": warnings_count,
        "mismatches_count": mismatches_count,
        "entries": reconciled_entries,
        "course_sessions": [
            {
                "id": s["id"],
                "date": s["date"],
                "display_date": s["date"][8:10] + "/" + s["date"][5:7] + "/" + s["date"][:4],
                "hours": s["hours"],
                "modulo": s.get("modulo", ""),
                "docente": s.get("docente", ""),
                "start_time": s.get("start_time", ""),
                "end_time": s.get("end_time", "")
            }
            for s in course_sessions
        ]
    }
