# Architettura

HTTP Node.js nativo, SQLite node:sqlite e JavaScript ES Modules senza dipendenze runtime.

Routes contiene HTTP, autenticazione e autorizzazione. src contiene logica, validazioni,
SQLite e conversioni. Database contiene SQL idempotente e migrazioni additive.
public contiene le schermate responsive e gli script browser per pagina.

Letture e scritture SQLite avvengono mediante statement preparati. Le importazioni
sono transazionali; per i file CSV/XLSX viene salvato SHA-256 per rilevare gli import
ripetuti. Le sessioni usano token random e hash SHA-256 nel database. Il browser
usa cookie HttpOnly SameSite=Strict e DOM textContent per i dati dinamici.

Costo: lettura di N movimenti O(N) tempo e memoria per l'export Excel.
L'importazione richiede O(N) tempo di parsing ed inserimento, con buffer massimo
per gli allegati e massimo XML per mitigare archivi decompressi eccessivi.
Per carichi molto grandi introdurre streaming e batch processing.
